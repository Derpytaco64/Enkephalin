import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { db } from '@/db';
import { accounts, users } from '@/db/schema';

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Creates a credential user the way better-auth would, hashing with its own
 * hasher so sign-in verifies. Used by both the env-seeded admin and invited
 * registrations; better-auth's own sign-up endpoint is disabled, so this is
 * the only path that creates an account.
 */
export async function createCredentialUser(input: {
  email: string;
  password: string;
  name?: string | null;
  role?: 'student' | 'admin';
  emailVerified?: boolean;
}) {
  const email = input.email.trim().toLowerCase();
  const id = randomUUID();
  const password = await hashPassword(input.password);

  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id,
      email,
      name: input.name?.trim() || null,
      role: input.role ?? 'student',
      status: 'active',
      emailVerified: input.emailVerified ?? false,
    });
    await tx.insert(accounts).values({
      id: randomUUID(),
      userId: id,
      accountId: id,
      providerId: 'credential',
      password,
    });
  });

  return { id, email };
}

/**
 * Postgres unique_violation, i.e. the email is already registered. Drizzle
 * wraps driver errors in its own Error, so the driver's code sits on the
 * cause rather than on what was thrown.
 */
export function isDuplicateEmail(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== 'object') return false;
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
