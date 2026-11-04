/**
 * What the site's three settings are allowed to be, with no database in sight.
 *
 * Split from `index.ts` for the same reason `lib/account/shape.ts` is split
 * from its store: the admin form is a client component and needs the modes,
 * the labels and the two caps. Importing them from a module that reaches for
 * `@/db` pulls `postgres` into the client bundle, which does not build -- it
 * wants `fs` and `perf_hooks`. (Found the hard way, again.)
 */

export type RegistrationMode = 'invite' | 'open' | 'closed';

export const REGISTRATION_MODES: RegistrationMode[] = ['invite', 'open', 'closed'];

export function isRegistrationMode(value: unknown): value is RegistrationMode {
  return typeof value === 'string' && (REGISTRATION_MODES as string[]).includes(value);
}

/**
 * What each mode means, in the words the admin screen uses.
 *
 * Here rather than in the form, because the register page has to say the same
 * thing to whoever it turns away, and two hand-kept wordings for one lock
 * would eventually describe different locks.
 */
export const REGISTRATION_LABELS: Record<RegistrationMode, string> = {
  invite: 'Invite code required',
  open: 'Anyone with the address can register',
  closed: 'Nobody can register',
};

/**
 * The name is a wordmark in a 32px-tall bar, and the disclaimer is a line in a
 * footer. Both caps are about the layout rather than the column: `text` would
 * take a novel, and a novel would break the page it is printed on.
 */
export const SITE_NAME_MAX = 40;
export const DISCLAIMER_MAX = 500;

/** The name to print when the singleton has not been written yet. */
export const FALLBACK_SITE_NAME = 'Enkephalin';

export type SiteIdentity = {
  siteName: string;
  registrationMode: RegistrationMode;
  disclaimerText: string;
};
