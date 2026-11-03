/**
 * The two plain columns a person can change about themselves.
 *
 * The password is not here: better-auth owns the hash format that sign-in
 * verifies against, so changing one goes through `auth.api.changePassword` in
 * `app/account/actions.ts`. `lib/users.ts` reaches for better-auth's hasher
 * only because account *creation* has no endpoint to call -- sign-up is
 * disabled -- and changing a password does.
 */
import { and, eq } from 'drizzle-orm';
import { verifyPassword } from 'better-auth/crypto';
import { db } from '@/db';
import { accounts, auditLog, users } from '@/db/schema';
import type { Result } from '@/lib/drugs/mutations';
import { isDuplicateEmail } from '@/lib/users';
import {
  EMAIL_LIMIT, IMAGE_LIMIT, isStorableEmail, isStorableImage, NAME_LIMIT, normalizeEmail,
  normalizeName,
} from './shape';

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

/**
 * Changing the address you sign in with.
 *
 * **The password is required, and that is the whole protection.** There is no
 * mailer, so neither address can be confirmed: the new one cannot be verified
 * before the switch, and the old one cannot be told the switch happened. What
 * is left is proving you are the account's owner and not someone who found the
 * laptop unlocked -- because the email *is* the sign-in name, so changing it
 * silently would hand the account over.
 *
 * better-auth's own `changeEmail` is not used, deliberately. It is built around
 * sending a verification link, which is the one thing this deployment cannot
 * do; with no sender configured it would either fail or quietly change nothing.
 * The password check is done against better-auth's hash with its own verifier,
 * so this does not become a second opinion about how a password is stored.
 *
 * `emailVerified` goes to **false**, because the new address has not been. That
 * is honest rather than convenient: if a mailer is configured later and
 * verification is turned on, this account will be asked to verify, which is
 * exactly right for an address nobody ever confirmed.
 *
 * An audit row is written, since this is the one self-service change that moves
 * who can get into the account.
 */
export async function setEmail(
  userId: string,
  rawEmail: unknown,
  currentPassword: unknown,
): Promise<Result<{ email: string }>> {
  if (typeof rawEmail !== 'string' || typeof currentPassword !== 'string') {
    return { ok: false, message: 'Fill in both fields.' };
  }

  const email = normalizeEmail(rawEmail);
  if (email === '') return { ok: false, message: 'Type the new email address.' };
  if (!isStorableEmail(email)) {
    return email.length > EMAIL_LIMIT
      ? { ok: false, message: 'That address is too long to be one.' }
      : { ok: false, message: 'That does not look like an email address.' };
  }

  const [me] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (me === undefined) return { ok: false, message: 'That account no longer exists.' };
  // Said rather than silently succeeding, so a mistyped-then-corrected form
  // does not report a change it did not make.
  if (me.email === email) return { ok: false, message: 'That is the address you already use.' };

  const [credential] = await db
    .select({ password: accounts.password })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, 'credential')))
    .limit(1);
  if (credential?.password == null) {
    return { ok: false, message: 'This account has no password set, so it cannot be verified.' };
  }
  if (!await verifyPassword({ hash: credential.password, password: currentPassword })) {
    return { ok: false, message: 'That password is not right.' };
  }

  try {
    await db
      .update(users)
      .set({ email, emailVerified: false, updatedAt: new Date() })
      .where(eq(users.id, userId));
  } catch (error) {
    // The column is unique, and two people claiming one address is a thing a
    // person does by accident -- their old address, their classmate's.
    if (isDuplicateEmail(error)) {
      return { ok: false, message: 'Another account already uses that address.' };
    }
    throw error;
  }

  await db.insert(auditLog).values({
    actorId: userId,
    action: 'account.email',
    targetType: 'user',
    targetId: userId,
    diff: { from: me.email, to: email },
  });

  return { ok: true, value: { email } };
}
