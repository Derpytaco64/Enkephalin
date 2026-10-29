import { verifyPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { accounts, inviteRedemptions, invites, sessions, users } from '@/db/schema';
import {
  claimInvite,
  createInvite,
  normalizeCode,
  recordRedemption,
  releaseInvite,
  revokeInvite,
} from '@/lib/invites';
import { createCredentialUser, isDuplicateEmail } from '@/lib/users';

let adminId: string;

beforeEach(async () => {
  // Child rows first: every one of these references users.
  await db.delete(inviteRedemptions);
  await db.delete(invites);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);

  const admin = await createCredentialUser({
    email: 'admin@test.local',
    password: 'longenough123',
    role: 'admin',
  });
  adminId = admin.id;
});

async function freshCode(options: { maxUses?: number; expiresAt?: Date | null } = {}) {
  const invite = await createInvite({ createdBy: adminId, ...options });
  return invite;
}

describe('normalizeCode', () => {
  it('upper-cases and strips anything that is not a code character', () => {
    expect(normalizeCode('  ab-cd ef12 ')).toBe('ABCDEF12');
  });
});

describe('claimInvite', () => {
  it('accepts a fresh code and consumes one use', async () => {
    const invite = await freshCode();
    const claim = await claimInvite(invite.code);

    expect(claim).toEqual({ ok: true, inviteId: invite.id });
    const [row] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(row.uses).toBe(1);
  });

  it('is case and punctuation insensitive about the code as typed', async () => {
    const invite = await freshCode();
    const claim = await claimInvite(` ${invite.code.toLowerCase()} `);
    expect(claim.ok).toBe(true);
  });

  it('rejects an unknown code', async () => {
    expect(await claimInvite('NOSUCHCODE')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rejects an empty code', async () => {
    expect(await claimInvite('')).toEqual({ ok: false, reason: 'unknown' });
  });

  it('rejects a spent code', async () => {
    const invite = await freshCode({ maxUses: 1 });
    await claimInvite(invite.code);
    expect(await claimInvite(invite.code)).toEqual({ ok: false, reason: 'spent' });
  });

  it('rejects an expired code', async () => {
    const invite = await freshCode({ expiresAt: new Date(Date.now() - 1000) });
    expect(await claimInvite(invite.code)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a revoked code', async () => {
    const invite = await freshCode();
    await revokeInvite(invite.id);
    expect(await claimInvite(invite.code)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('honours max_uses across sequential claims', async () => {
    const invite = await freshCode({ maxUses: 3 });
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await claimInvite(invite.code));

    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results[3]).toEqual({ ok: false, reason: 'spent' });
  });

  it('lets exactly one of several simultaneous claims win the last use', async () => {
    // The point of claiming in a single statement: two classmates racing the
    // same code must not both get in.
    const invite = await freshCode({ maxUses: 1 });
    const results = await Promise.all(Array.from({ length: 8 }, () => claimInvite(invite.code)));

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const [row] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(row.uses).toBe(1);
  });

  it('never oversubscribes a multi-use code under concurrency', async () => {
    const invite = await freshCode({ maxUses: 3 });
    const results = await Promise.all(Array.from({ length: 10 }, () => claimInvite(invite.code)));

    expect(results.filter((r) => r.ok)).toHaveLength(3);
    const [row] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(row.uses).toBe(3);
  });
});

describe('releaseInvite', () => {
  it('hands a use back so a failed registration does not burn the code', async () => {
    const invite = await freshCode({ maxUses: 1 });
    await claimInvite(invite.code);
    await releaseInvite(invite.id);

    const [row] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(row.uses).toBe(0);
    expect((await claimInvite(invite.code)).ok).toBe(true);
  });

  it('floors at zero rather than going negative', async () => {
    const invite = await freshCode();
    await releaseInvite(invite.id);
    const [row] = await db.select().from(invites).where(eq(invites.id, invite.id));
    expect(row.uses).toBe(0);
  });
});

describe('recordRedemption', () => {
  it('records who used which code, and tolerates a repeat', async () => {
    const invite = await freshCode();
    await recordRedemption(invite.id, adminId);
    await recordRedemption(invite.id, adminId);

    const rows = await db.select().from(inviteRedemptions);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ inviteId: invite.id, userId: adminId });
  });
});

describe('createCredentialUser', () => {
  it('stores a password better-auth can verify, and defaults to student', async () => {
    const created = await createCredentialUser({
      email: 'Student@Test.Local',
      password: 'longenough123',
      name: '  Casey  ',
    });

    const [user] = await db.select().from(users).where(eq(users.id, created.id));
    expect(user.email).toBe('student@test.local');
    expect(user.name).toBe('Casey');
    expect(user.role).toBe('student');
    expect(user.status).toBe('active');
    expect(user.emailVerified).toBe(false);

    const [account] = await db.select().from(accounts).where(eq(accounts.userId, created.id));
    expect(account.providerId).toBe('credential');
    expect(await verifyPassword({ hash: account.password!, password: 'longenough123' })).toBe(true);
    expect(await verifyPassword({ hash: account.password!, password: 'wrong' })).toBe(false);
  });

  it('refuses a duplicate email in a way the caller can recognise', async () => {
    await createCredentialUser({ email: 'dupe@test.local', password: 'longenough123' });

    // Drizzle wraps driver errors, so the postgres code sits on the cause.
    const err = await createCredentialUser({ email: 'dupe@test.local', password: 'longenough123' })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(err).not.toBeNull();
    expect(isDuplicateEmail(err)).toBe(true);
    expect(isDuplicateEmail(new Error('something else'))).toBe(false);
  });
});
