'use server';

import { headers } from 'next/headers';
import { auth } from '@/lib/auth';
import {
  claimInvite,
  claimFailureMessage,
  recordRedemption,
  releaseInvite,
} from '@/lib/invites';
import { getRegistrationMode } from '@/lib/settings';
import { MIN_PASSWORD_LENGTH, createCredentialUser, isDuplicateEmail } from '@/lib/users';

export type RegisterResult = { ok: true } | { ok: false; message: string };

export async function registerWithInvite(input: {
  email: string;
  password: string;
  name: string;
  code: string;
}): Promise<RegisterResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes('@')) return { ok: false, message: 'Enter a valid email address.' };
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, message: `Use at least ${MIN_PASSWORD_LENGTH} characters for the password.` };
  }

  const mode = await getRegistrationMode();
  if (mode === 'closed') return { ok: false, message: 'Registration is closed right now.' };

  let inviteId: string | null = null;
  if (mode === 'invite') {
    const claim = await claimInvite(input.code);
    if (!claim.ok) return { ok: false, message: claimFailureMessage[claim.reason] };
    inviteId = claim.inviteId;
  }

  try {
    const user = await createCredentialUser({ email, password: input.password, name: input.name });
    if (inviteId) await recordRedemption(inviteId, user.id);
  } catch (err) {
    // The code was already consumed, so give the use back rather than
    // burning it on a registration that never happened.
    if (inviteId) await releaseInvite(inviteId);
    if (isDuplicateEmail(err)) {
      return { ok: false, message: 'An account with that email already exists.' };
    }
    throw err;
  }

  // Sets the session cookie through the nextCookies plugin.
  await auth.api.signInEmail({ body: { email, password: input.password }, headers: await headers() });
  return { ok: true };
}
