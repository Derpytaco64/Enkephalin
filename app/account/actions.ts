'use server';

import { headers } from 'next/headers';
import { APIError } from 'better-auth';
import { auth } from '@/lib/auth';
import { setDisplayName, setProfileImage } from '@/lib/account/store';
import type { Result } from '@/lib/drugs/mutations';
import { requireUser } from '@/lib/session';
import { MIN_PASSWORD_LENGTH } from '@/lib/users';

/**
 * Nothing here revalidates. Both forms refresh the route themselves once they
 * know the write landed, which also re-renders the layout -- and so the header
 * avatar -- without a path invalidation that could reach a study page. See
 * PLAN.md on what revalidating a randomised page costs.
 */

/**
 * The name and the picture, saved together.
 *
 * One action because it is one form with one Save: a picture is chosen and the
 * name is corrected in the same visit, and two buttons would mean two visits
 * or a lost change. The picture is sent only when it changed -- `undefined`
 * leaves the stored one alone, where `null` removes it.
 */
export async function saveProfileAction(input: {
  name: string;
  image?: string | null;
}): Promise<Result> {
  const session = await requireUser();

  const named = await setDisplayName(session.user.id, input.name);
  if (!named.ok) return named;

  if (input.image !== undefined) {
    const pictured = await setProfileImage(session.user.id, input.image);
    if (!pictured.ok) return pictured;
  }

  return { ok: true };
}

/**
 * Changing your own password.
 *
 * Handed to better-auth rather than done here: it owns the hash format that
 * sign-in verifies against, and `lib/users.ts` only reaches for its hasher
 * because account *creation* has no endpoint to call -- sign-up is disabled.
 * Changing one does have an endpoint, so re-implementing it would be a second
 * answer to how a password is stored.
 *
 * The current password is required, and better-auth is what checks it. This is
 * not belt-and-braces: a signed-in session on a shared laptop would otherwise
 * be enough to lock the owner out of their own account.
 */
export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
  revokeOthers: boolean;
}): Promise<Result> {
  await requireUser();

  if (input.newPassword.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters.` };
  }
  // Checked on the server as well as in the form, because the form is the
  // half of this that an attacker does not have to run.
  if (input.newPassword !== input.confirmPassword) {
    return { ok: false, message: 'The two new passwords do not match.' };
  }
  if (input.newPassword === input.currentPassword) {
    return { ok: false, message: 'That is the password you already have.' };
  }

  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: {
        currentPassword: input.currentPassword,
        newPassword: input.newPassword,
        // When asked for, this ends every other session and keeps this one.
        revokeOtherSessions: input.revokeOthers,
      },
    });
  } catch (error) {
    // better-auth reports a wrong current password as an APIError, and that is
    // a message for the person typing, not a 500. Anything else is a genuine
    // fault and is rethrown so it reaches the log.
    if (error instanceof APIError) {
      return { ok: false, message: 'That current password is not right.' };
    }
    throw error;
  }

  return { ok: true };
}
