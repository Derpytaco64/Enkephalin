import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { inviteRedemptions, invites } from '@/db/schema';

// No I, L, O, 0 or 1: these codes get read off a screen and typed by hand.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

export function normalizeCode(code: string) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function generateCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

export async function createInvite(input: {
  createdBy: string;
  maxUses?: number;
  expiresAt?: Date | null;
  note?: string | null;
}) {
  const [invite] = await db
    .insert(invites)
    .values({
      code: generateCode(),
      createdBy: input.createdBy,
      maxUses: Math.max(1, input.maxUses ?? 1),
      expiresAt: input.expiresAt ?? null,
      note: input.note?.trim() || null,
    })
    .returning();
  return invite;
}

export type ClaimFailure = 'unknown' | 'revoked' | 'expired' | 'spent';

export const claimFailureMessage: Record<ClaimFailure, string> = {
  unknown: 'That invite code is not valid.',
  revoked: 'That invite code has been revoked.',
  expired: 'That invite code has expired.',
  spent: 'That invite code has already been used up.',
};

/**
 * Validates and consumes a code in a single statement, so two people racing
 * the last use of a shared code cannot both get in. A miss is classified
 * afterwards only to choose an error message.
 */
export async function claimInvite(
  rawCode: string,
): Promise<{ ok: true; inviteId: string } | { ok: false; reason: ClaimFailure }> {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: 'unknown' };

  const [claimed] = await db
    .update(invites)
    .set({ uses: sql`${invites.uses} + 1` })
    .where(
      and(
        eq(invites.code, code),
        isNull(invites.revokedAt),
        sql`${invites.uses} < ${invites.maxUses}`,
        or(isNull(invites.expiresAt), gt(invites.expiresAt, new Date())),
      ),
    )
    .returning({ id: invites.id });

  if (claimed) return { ok: true, inviteId: claimed.id };

  const [row] = await db
    .select({ revokedAt: invites.revokedAt, expiresAt: invites.expiresAt })
    .from(invites)
    .where(eq(invites.code, code))
    .limit(1);

  if (!row) return { ok: false, reason: 'unknown' };
  if (row.revokedAt) return { ok: false, reason: 'revoked' };
  if (row.expiresAt && row.expiresAt <= new Date()) return { ok: false, reason: 'expired' };
  return { ok: false, reason: 'spent' };
}

/** Hands a consumed use back when the registration it was claimed for fails. */
export async function releaseInvite(inviteId: string) {
  await db
    .update(invites)
    .set({ uses: sql`greatest(${invites.uses} - 1, 0)` })
    .where(eq(invites.id, inviteId));
}

export async function recordRedemption(inviteId: string, userId: string) {
  await db.insert(inviteRedemptions).values({ inviteId, userId }).onConflictDoNothing();
}

export async function revokeInvite(inviteId: string) {
  await db
    .update(invites)
    .set({ revokedAt: new Date() })
    .where(and(eq(invites.id, inviteId), isNull(invites.revokedAt)));
}

export async function listInvites() {
  return db.select().from(invites).orderBy(desc(invites.createdAt));
}
