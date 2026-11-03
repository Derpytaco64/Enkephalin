import { and, eq } from 'drizzle-orm';
import { verifyPassword } from 'better-auth/crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  accounts, auditLog, quizAttempts, sessions, studyCards, studyPresets, users,
} from '@/db/schema';
import {
  deleteUser, footprintOf, listUsers, setUserPassword, setUserRole, setUserStatus, signOutUser,
} from '@/lib/admin/users';
import { createCredentialUser } from '@/lib/users';

const BOSS = 'user-boss';

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(studyPresets);
  await db.delete(studyCards);
  await db.delete(quizAttempts);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);

  const day = (iso: string) => new Date(iso);
  await db.insert(users).values([
    { id: BOSS, email: 'boss@example.test', role: 'admin', createdAt: day('2026-01-01') },
    { id: 'user-dana', email: 'dana.ruiz@example.test', name: 'Dana Ruiz', createdAt: day('2026-03-01') },
    { id: 'user-sam', email: 'sam@example.test', name: 'Sam Okafor', createdAt: day('2026-05-01') },
    { id: 'user-odd', email: 'a_b@example.test', name: '100% Keen', createdAt: day('2026-02-01') },
  ]);
});

const open = async (userId: string, howMany: number) => {
  await db.insert(sessions).values(Array.from({ length: howMany }, (_, index) => ({
    id: `${userId}-s${index}`,
    userId,
    token: `${userId}-t${index}`,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(2026, 5, index + 1),
  })));
};

const auditRows = () => db.select().from(auditLog);

const roleOf = async (userId: string) => {
  const [row] = await db
    .select({ role: users.role, status: users.status })
    .from(users)
    .where(eq(users.id, userId));
  return row;
};

describe('listUsers', () => {
  it('puts admins first and the newest of the rest after', async () => {
    const rows = await listUsers();
    expect(rows.map((row) => row.id)).toEqual(['user-boss', 'user-sam', 'user-dana', 'user-odd']);
  });

  it('counts open sessions and reports the last sign-in', async () => {
    await open('user-dana', 3);
    const rows = await listUsers();
    const dana = rows.find((row) => row.id === 'user-dana')!;

    expect(dana.sessions).toBe(3);
    expect(dana.lastSignIn).toEqual(new Date(2026, 5, 3));
    // Nobody else borrowed the count from the join.
    expect(rows.find((row) => row.id === 'user-sam')!.sessions).toBe(0);
    expect(rows.find((row) => row.id === 'user-sam')!.lastSignIn).toBeNull();
  });

  it('searches email and name alike, case-insensitively', async () => {
    expect((await listUsers('DANA')).map((row) => row.id)).toEqual(['user-dana']);
    expect((await listUsers('okafor')).map((row) => row.id)).toEqual(['user-sam']);
    expect((await listUsers('example.test')).length).toBe(4);
  });

  it('escapes the wildcards a search term can contain', async () => {
    // Unescaped, `_` matches any one character and `%` matches everything, so
    // searching for a percent sign would return the whole roster. Escaped,
    // both are just characters -- and the only row holding either is the one
    // whose name actually contains them.
    expect((await listUsers('a_b')).map((row) => row.id)).toEqual(['user-odd']);
    expect((await listUsers('100%')).map((row) => row.id)).toEqual(['user-odd']);
    expect((await listUsers('%')).map((row) => row.id)).toEqual(['user-odd']);
    expect((await listUsers('b_ss')).map((row) => row.id)).toEqual([]);
  });

  it('is empty rather than everything for a term nothing matches', async () => {
    expect(await listUsers('nobody')).toEqual([]);
  });
});

describe('setUserRole', () => {
  it('promotes somebody and records it', async () => {
    expect(await setUserRole(BOSS, 'user-dana', 'admin')).toEqual({ ok: true });
    expect((await roleOf('user-dana')).role).toBe('admin');

    const [entry] = await auditRows();
    expect(entry.action).toBe('user.role');
    expect(entry.targetId).toBe('user-dana');
    expect(entry.diff).toEqual({ from: 'student', to: 'admin' });
  });

  it('refuses to change your own role', async () => {
    // The one rule that makes locking everybody out impossible: the only
    // account that could remove the last admin's access is that admin's own.
    const result = await setUserRole(BOSS, BOSS, 'student');
    expect(result.ok).toBe(false);
    expect((await roleOf(BOSS)).role).toBe('admin');
  });

  it('refuses a role that is not one', async () => {
    expect((await setUserRole(BOSS, 'user-dana', 'superuser')).ok).toBe(false);
    expect((await roleOf('user-dana')).role).toBe('student');
  });

  it('writes no audit row when the role is already what was asked for', async () => {
    await setUserRole(BOSS, 'user-dana', 'student');
    expect(await auditRows()).toEqual([]);
  });
});

describe('setUserStatus', () => {
  it('disables an account and drops every session it holds', async () => {
    await open('user-dana', 2);
    const result = await setUserStatus(BOSS, 'user-dana', 'disabled');

    expect(result.ok && result.value?.sessionsDropped).toBe(2);
    expect((await roleOf('user-dana')).status).toBe('disabled');
    // Dropped here rather than only on their next request: an open tab doing
    // nothing might never make one.
    const left = await db.select().from(sessions).where(eq(sessions.userId, 'user-dana'));
    expect(left).toEqual([]);
  });

  it('leaves other people signed in', async () => {
    await open('user-dana', 1);
    await open('user-sam', 1);
    await setUserStatus(BOSS, 'user-dana', 'disabled');
    expect((await db.select().from(sessions).where(eq(sessions.userId, 'user-sam')))).toHaveLength(1);
  });

  it('re-enabling drops nothing', async () => {
    await setUserStatus(BOSS, 'user-dana', 'disabled');
    await open('user-dana', 1);
    const result = await setUserStatus(BOSS, 'user-dana', 'active');

    expect(result.ok && result.value?.sessionsDropped).toBe(0);
    expect((await roleOf('user-dana')).status).toBe('active');
  });

  it('refuses to disable your own account', async () => {
    const result = await setUserStatus(BOSS, BOSS, 'disabled');
    expect(result.ok).toBe(false);
    expect((await roleOf(BOSS)).status).toBe('active');
  });
});

describe('signOutUser', () => {
  it('drops every session', async () => {
    await open('user-dana', 3);
    const result = await signOutUser(BOSS, 'user-dana');
    expect(result.ok && result.value?.sessionsDropped).toBe(3);
  });

  it('keeps the one doing the asking, when that is your own', async () => {
    // Otherwise "sign out everywhere" on your own row ends on the login page.
    await open(BOSS, 3);
    const result = await signOutUser(BOSS, BOSS, `${BOSS}-s1`);

    expect(result.ok && result.value?.sessionsDropped).toBe(2);
    const left = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, BOSS));
    expect(left).toEqual([{ id: `${BOSS}-s1` }]);
  });

  it('refuses an account that is not there', async () => {
    expect((await signOutUser(BOSS, 'user-ghost')).ok).toBe(false);
  });
});

describe('setUserPassword', () => {
  /** A real credential user, since this is about the stored hash. */
  const made = async () => {
    const email = `zz-${Math.random().toString(36).slice(2)}@example.test`;
    const { id } = await createCredentialUser({ email, password: 'old-password' });
    return id;
  };

  const storedHash = async (userId: string) => {
    const [row] = await db
      .select({ password: accounts.password })
      .from(accounts)
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')));
    return row.password!;
  };

  it('writes a hash the sign-in verifier accepts', async () => {
    const id = await made();
    expect(await setUserPassword(BOSS, id, 'brand-new-password')).toMatchObject({ ok: true });

    const hash = await storedHash(id);
    expect(await verifyPassword({ hash, password: 'brand-new-password' })).toBe(true);
    expect(await verifyPassword({ hash, password: 'old-password' })).toBe(false);
  });

  it('drops the sessions the account still has', async () => {
    const id = await made();
    await open(id, 2);
    const result = await setUserPassword(BOSS, id, 'brand-new-password');

    expect(result.ok && result.value?.sessionsDropped).toBe(2);
    expect(await db.select().from(sessions).where(eq(sessions.userId, id))).toEqual([]);
  });

  it('refuses one that is too short, and changes nothing', async () => {
    const id = await made();
    const before = await storedHash(id);
    expect((await setUserPassword(BOSS, id, 'short')).ok).toBe(false);
    expect(await storedHash(id)).toBe(before);
  });

  it('creates the credential row if a restored backup lacks one', async () => {
    // Not a state this app creates, but refusing would leave such an account
    // permanently unrecoverable.
    await setUserPassword(BOSS, 'user-dana', 'brand-new-password');
    const hash = await storedHash('user-dana');
    expect(await verifyPassword({ hash, password: 'brand-new-password' })).toBe(true);
  });

  it('is allowed on your own account', async () => {
    expect((await setUserPassword(BOSS, BOSS, 'brand-new-password')).ok).toBe(true);
  });

  it('never records the password, hashed or otherwise', async () => {
    const id = await made();
    await setUserPassword(BOSS, id, 'brand-new-password');
    const [entry] = await auditRows();
    expect(entry.action).toBe('user.password');
    expect(JSON.stringify(entry.diff)).not.toContain('brand-new-password');
  });
});

describe('footprintOf / deleteUser', () => {
  /* Attempts and setups only. A study card needs a drug row, and the two
     tables that do not are enough to show the cascade and the count. */
  const studied = async (userId: string) => {
    await db.insert(quizAttempts).values([
      { userId, config: {}, score: 1, total: 1 },
      { userId, config: {}, score: 0, total: 2 },
    ]);
    await db.insert(studyPresets).values({ userId, name: 'Evenings', config: {} });
  };

  it('counts what a delete would take', async () => {
    await studied('user-dana');
    await open('user-dana', 1);

    expect(await footprintOf('user-dana')).toEqual({
      email: 'dana.ruiz@example.test', cards: 0, attempts: 2, setups: 1, sessions: 1,
    });
  });

  it('is null for an account that is not there', async () => {
    expect(await footprintOf('user-ghost')).toBeNull();
  });

  it('deletes the account and everything that cascades off it', async () => {
    await studied('user-dana');
    await open('user-dana', 2);

    const result = await deleteUser(BOSS, 'user-dana');
    expect(result.ok).toBe(true);

    expect(await db.select().from(users).where(eq(users.id, 'user-dana'))).toEqual([]);
    expect(await db.select().from(sessions).where(eq(sessions.userId, 'user-dana'))).toEqual([]);
    expect(await db.select().from(quizAttempts).where(eq(quizAttempts.userId, 'user-dana'))).toEqual([]);
    expect(await db.select().from(studyPresets).where(eq(studyPresets.userId, 'user-dana'))).toEqual([]);
  });

  it('records what was lost, since nothing will be left to say', async () => {
    await studied('user-dana');
    await deleteUser(BOSS, 'user-dana');

    const [entry] = await auditRows();
    expect(entry.action).toBe('user.delete');
    expect(entry.diff).toMatchObject({ email: 'dana.ruiz@example.test', attempts: 2, setups: 1 });
  });

  it('refuses to delete your own account', async () => {
    const result = await deleteUser(BOSS, BOSS);
    expect(result.ok).toBe(false);
    expect(await db.select({ id: users.id }).from(users).where(eq(users.id, BOSS))).toHaveLength(1);
  });

  it('leaves the audit trail behind with no actor on it', async () => {
    // `audit_log.actor_id` is `set null`: what somebody did stays recorded
    // after they are gone, without a name on it.
    await setUserRole(BOSS, 'user-dana', 'admin');
    await db.delete(users).where(eq(users.id, BOSS));

    const [entry] = await auditRows();
    expect(entry.actorId).toBeNull();
    expect(entry.action).toBe('user.role');
  });
});
