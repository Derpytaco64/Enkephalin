import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { db } from '@/db';
import { accounts, users } from '@/db/schema';
import { isUniqueViolation } from '@/lib/db-errors';

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

/** The email is already registered. */
export function isDuplicateEmail(err: unknown): boolean {
  return isUniqueViolation(err);
}
