/**
 * What a name and a picture are allowed to be, with no database in sight.
 *
 * Split from `store.ts` because the browser needs these: the file picker
 * resizes a photograph against `IMAGE_LIMIT` before sending it, and the avatar
 * falls back to `initialsFor`. Importing them from a module that reaches for
 * `@/db` pulls `postgres` into the client bundle, which does not build -- it
 * wants `fs` and `tls`.
 */

export const NAME_LIMIT = 60;

/**
 * Longest stored picture, as characters of data URL.
 *
 * The picture is stored **in the user's row**, as a data URL, rather than
 * written to a volume. There is no object storage here and no upload directory
 * in the compose file, and adding one would mean a second thing to back up --
 * where `/admin/data`'s single-file export already carries a column. The cost
 * is that every page load carries the bytes, since the header renders the
 * session's user, and that is what the cap is for: the browser resizes to a
 * 160px square before sending, which lands around 8 KB of base64, so this is
 * headroom rather than a target.
 */
export const IMAGE_LIMIT = 64_000;

/**
 * What a stored picture may be.
 *
 * Raster only. SVG is an image to a browser and a script host to an attacker,
 * and this string goes into an `<img src>` that other people's pages will
 * render once the users admin exists.
 */
const IMAGE_URL = /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;

export function isStorableImage(value: string): boolean {
  return value.length <= IMAGE_LIMIT && IMAGE_URL.test(value);
}

/** Collapses whitespace; an empty result means "no name", not an error. */
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * What to show when there is no picture: one or two letters.
 *
 * Off the display name when there is one, and off the email otherwise -- and
 * off the email's local part, not the domain, so a classful of @gmail.com
 * accounts do not all read "G".
 */
export function initialsFor(input: { name?: string | null; email: string }): string {
  const named = (input.name ?? '').trim();
  const source = named !== '' ? named : input.email.split('@')[0];

  const words = source.split(/[\s._-]+/).filter((word) => /[a-z0-9]/i.test(word));
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/**
 * The longest email anyone may store: the RFC's own limit on an address.
 *
 * Worth stating because the column is unbounded `text`, and the sign-in form
 * is not the only thing that reads it -- the header's title attribute and the
 * users admin both render it in a row.
 */
export const EMAIL_LIMIT = 254;

/**
 * Deliberately not an RFC-complete address grammar.
 *
 * An exhaustive pattern accepts things no mail server would and rejects things
 * it should not, and the only real check -- sending to it and seeing whether it
 * arrives -- is the one this app cannot perform, since there is no mailer. So
 * this catches the mistakes a person makes typing into the box (a missing @, a
 * space, a bare hostname) and leaves the rest to the person reading it back to
 * themselves.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercased and trimmed: the column is unique, and Dana@ is dana@. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isStorableEmail(value: string): boolean {
  return value.length <= EMAIL_LIMIT && EMAIL.test(value);
}
