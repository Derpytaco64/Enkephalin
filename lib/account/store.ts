/**
 * The two plain columns a person can change about themselves.
 *
 * The password is not here: better-auth owns the hash format that sign-in
 * verifies against, so changing one goes through `auth.api.changePassword` in
 * `app/account/actions.ts`. `lib/users.ts` reaches for better-auth's hasher
 * only because account *creation* has no endpoint to call -- sign-up is
 * disabled -- and changing a password does.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import type { Result } from '@/lib/drugs/mutations';
import { IMAGE_LIMIT, isStorableImage, NAME_LIMIT, normalizeName } from './shape';

/**
 * The name shown instead of the email, or blank to go back to the email.
 *
 * Blank is a deliberate clear rather than an error: the field starts empty for
 * everyone, since registration never asked for a name.
 */
export async function setDisplayName(userId: string, raw: unknown): Promise<Result> {
  if (typeof raw !== 'string') return { ok: false, message: 'That is not a name.' };

  const name = normalizeName(raw);
  if (name.length > NAME_LIMIT) {
    return { ok: false, message: `Keep the name under ${NAME_LIMIT} characters.` };
  }

  await db
    .update(users)
    .set({ name: name === '' ? null : name, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return { ok: true };
}

/** A data URL as `shape.ts` defines one, or null to remove the picture. */
export async function setProfileImage(userId: string, raw: unknown): Promise<Result> {
  if (raw !== null && typeof raw !== 'string') {
    return { ok: false, message: 'That is not a picture.' };
  }

  const image = raw === null || raw.trim() === '' ? null : raw.trim();
  if (image !== null && !isStorableImage(image)) {
    // Two refusals rather than one, because they call for different actions:
    // one means pick a smaller file, the other means pick a different kind.
    return image.length > IMAGE_LIMIT
      ? { ok: false, message: 'That picture is too large even after resizing — try a smaller one.' }
      : { ok: false, message: 'Pictures have to be a PNG, JPEG or WebP image.' };
  }

  await db.update(users).set({ image, updatedAt: new Date() }).where(eq(users.id, userId));
  return { ok: true };
}
