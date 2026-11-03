/**
 * The users admin: who has an account, what they may do, and the one way back
 * in for somebody who has forgotten their password.
 *
 * That last one is why this exists at all. There is no mailer, so a forgotten
 * password has no self-service route -- `/account` can only change one you
 * still know. An admin setting a new one is the *only* recovery path in the
 * deployment, which makes this screen a prerequisite for inviting anyone, not
 * a convenience for managing a roster of one.
 *
 * Every write takes the actor and refuses to let them act on themselves for
 * the three operations that could lock everyone out -- role, status, delete.
 * That single rule is what makes lockout impossible: the only account that can
 * remove the last admin's access is that admin's own, and it is not allowed to.
 * No "is this the last admin" count is needed, and a count would be the thing
 * that went wrong.
 */
import { and, count, desc, eq, ilike, max, ne, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { db } from '@/db';
import {
  accounts, auditLog, quizAttempts, sessions, studyCards, studyPresets, users,
} from '@/db/schema';
import type { Result } from '@/lib/drugs/mutations';
import { MIN_PASSWORD_LENGTH } from '@/lib/users';

export type Role = 'student' | 'admin';
export type Status = 'active' | 'disabled';

export function isRole(value: unknown): value is Role {
  return value === 'student' || value === 'admin';
}

export function isStatus(value: unknown): value is Status {
  return value === 'active' || value === 'disabled';
}

export type UserRow = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: Role;
  status: Status;
  createdAt: Date;
  /** Open sessions, which is also how many devices a force-logout would drop. */
  sessions: number;
  /** When they last signed in, or null if they never have since being created. */
  lastSignIn: Date | null;
};

/**
 * Everyone, admins first and then newest.
 *
 * Admins first because the question this screen is usually opened with is
 * "who can change things", and newest after because the next most common one
 * is "did the person I just invited get in".
 */
export async function listUsers(query?: string): Promise<UserRow[]> {
  const term = (query ?? '').trim();
  // Escaped, or a classmate searching for `a_b` would match `axb` and `%`
  // would match everyone -- the same rule the drug lookup follows.
  const like = `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      image: users.image,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      sessions: count(sessions.id),
      lastSignIn: max(sessions.createdAt),
    })
    .from(users)
    .leftJoin(sessions, eq(sessions.userId, users.id))
    .where(term === '' ? undefined : or(ilike(users.email, like), ilike(users.name, like)))
    .groupBy(users.id)
    .orderBy(sql`case when ${users.role} = 'admin' then 0 else 1 end`, desc(users.createdAt));

  return rows.map((row) => ({
    ...row,
    role: isRole(row.role) ? row.role : 'student',
    status: isStatus(row.status) ? row.status : 'active',
    lastSignIn: row.lastSignIn === null ? null : new Date(row.lastSignIn),
  }));
}

/** What a delete would take with it, which the audit row has to record. */
export type UserFootprint = {
  email: string;
  cards: number;
  attempts: number;
  setups: number;
  sessions: number;
};

export async function footprintOf(userId: string): Promise<UserFootprint | null> {
  const [user] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user === undefined) return null;

  const [cards, attempts, setups, open] = await Promise.all([
    db.select({ n: count() }).from(studyCards).where(eq(studyCards.userId, userId)),
    db.select({ n: count() }).from(quizAttempts).where(eq(quizAttempts.userId, userId)),
    db.select({ n: count() }).from(studyPresets).where(eq(studyPresets.userId, userId)),
    db.select({ n: count() }).from(sessions).where(eq(sessions.userId, userId)),
  ]);

  return {
    email: user.email,
    cards: cards[0].n,
    attempts: attempts[0].n,
    setups: setups[0].n,
    sessions: open[0].n,
  };
}

/* ------------------------------------------------------------- writes ---- */

/**
 * The guard behind every destructive operation here.
 *
 * Self-action is refused rather than warned about. An admin demoting, disabling
 * or deleting themselves is one click from an installation nobody can
 * administer, and there is no second channel to recover through -- no mailer,
 * and the env-seeded admin is only seeded when no admin exists at all.
 */
function notYourself(actorId: string, userId: string, verb: string): Result | null {
  if (actorId !== userId) return null;
  return {
    ok: false,
    message: `You cannot ${verb} your own account — ask another admin, or use the env-seeded one.`,
  };
}

async function exists(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return row !== undefined;
}

export async function setUserRole(
  actorId: string,
  userId: string,
  role: unknown,
): Promise<Result> {
  if (!isRole(role)) return { ok: false, message: 'That is not a role.' };
  const refusal = notYourself(actorId, userId, 'change the role on');
  if (refusal) return refusal;

  const [before] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (before === undefined) return { ok: false, message: 'That account no longer exists.' };
  if (before.role === role) return { ok: true };

  await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
  await audit(actorId, 'user.role', userId, { from: before.role, to: role });
  return { ok: true };
}

/**
 * Disabling drops every session the account holds, immediately.
 *
 * `lib/session.ts` already revokes them on the account's *next* request, which
 * covers the case of a status changed by hand in the database. Doing it here
 * too means a disabled account is out as the button is clicked rather than
 * whenever it next loads a page -- which, on an open tab doing nothing, could
 * be never.
 */
export async function setUserStatus(
  actorId: string,
  userId: string,
  status: unknown,
): Promise<Result<{ sessionsDropped: number }>> {
  if (!isStatus(status)) return { ok: false, message: 'That is not a status.' };
  const refusal = notYourself(actorId, userId, 'disable or enable');
  if (refusal) return refusal;

  const [before] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (before === undefined) return { ok: false, message: 'That account no longer exists.' };

  let dropped = 0;
  await db.transaction(async (tx) => {
    await tx.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
    if (status === 'disabled') {
      const gone = await tx
        .delete(sessions)
        .where(eq(sessions.userId, userId))
        .returning({ id: sessions.id });
      dropped = gone.length;
    }
  });

  if (before.status !== status) {
    await audit(actorId, 'user.status', userId, { from: before.status, to: status });
  }
  return { ok: true, value: { sessionsDropped: dropped } };
}

/**
 * Sign someone out everywhere, without changing anything else about them.
 *
 * Allowed on yourself, unlike the three above: signing yourself out of your
 * other devices is a sensible thing to want and costs nothing — the session
 * doing the asking is the one that survives.
 */
export async function signOutUser(
  actorId: string,
  userId: string,
  keepSessionId?: string,
): Promise<Result<{ sessionsDropped: number }>> {
  if (!await exists(userId)) return { ok: false, message: 'That account no longer exists.' };

  const gone = await db
    .delete(sessions)
    .where(keepSessionId === undefined
      ? eq(sessions.userId, userId)
      : and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)))
    .returning({ id: sessions.id });

  await audit(actorId, 'user.signout', userId, { sessionsDropped: gone.length });
  return { ok: true, value: { sessionsDropped: gone.length } };
}

/**
 * Setting somebody else's password: the only route back in for a forgotten one.
 *
 * Hashed with better-auth's own hasher, for the reason `lib/users.ts` gives --
 * sign-in verifies against that format, and there is no endpoint for an admin
 * to set another account's password through.
 *
 * Every session the account holds is dropped. Whoever is being given a new
 * password either has no session (they are locked out, which is why we are
 * here) or should not keep the old one, since the usual other reason to set
 * somebody's password is that theirs has been found out.
 *
 * Allowed on yourself. It is the same thing `/account` does with one more step
 * of proof, and refusing it would mean an admin who typed their new password
 * into the wrong box has to use the other page anyway.
 */
export async function setUserPassword(
  actorId: string,
  userId: string,
  password: unknown,
): Promise<Result<{ sessionsDropped: number }>> {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  if (!await exists(userId)) return { ok: false, message: 'That account no longer exists.' };

  const hash = await hashPassword(password);
  let dropped = 0;

  await db.transaction(async (tx) => {
    const updated = await tx
      .update(accounts)
      .set({ password: hash, updatedAt: new Date() })
      .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
      .returning({ id: accounts.id });

    // No credential row is not a state this app creates -- `createCredentialUser`
    // always writes one -- but a restored backup or a hand-made row could be
    // missing it, and refusing would leave that account unrecoverable.
    if (updated.length === 0) {
      await tx.insert(accounts).values({
        id: randomUUID(), userId, accountId: userId, providerId: 'credential', password: hash,
      });
    }

    const gone = await tx
      .delete(sessions)
      .where(eq(sessions.userId, userId))
      .returning({ id: sessions.id });
    dropped = gone.length;
  });

  // The password itself is never in the diff, hashed or otherwise.
  await audit(actorId, 'user.password', userId, { sessionsDropped: dropped, self: actorId === userId });
  return { ok: true, value: { sessionsDropped: dropped } };
}

/**
 * Deleting an account, and everything it holds.
 *
 * Hard, not a flag: `users` is referenced with `on delete cascade` from
 * sessions, accounts, preferences, saved setups, study schedules, quiz attempts
 * and invite redemptions, so one statement takes the lot. The only reference
 * that survives is `audit_log.actor_id`, which is `set null` -- the record of
 * what they did stays, without a name on it.
 *
 * What is lost is their *study history*, which is theirs and nobody else's, so
 * the footprint is counted first and written into the audit row: after the
 * delete there is nothing left to say how much there was.
 */
export async function deleteUser(actorId: string, userId: string): Promise<Result<UserFootprint>> {
  const refusal = notYourself(actorId, userId, 'delete');
  if (refusal) return refusal;

  const footprint = await footprintOf(userId);
  if (footprint === null) return { ok: false, message: 'That account no longer exists.' };

  await db.delete(users).where(eq(users.id, userId));
  await audit(actorId, 'user.delete', userId, { ...footprint });

  return { ok: true, value: footprint };
}

async function audit(
  actorId: string,
  action: string,
  userId: string,
  diff: Record<string, unknown>,
): Promise<void> {
  await db.insert(auditLog).values({
    actorId, action, targetType: 'user', targetId: userId, diff,
  });
}
