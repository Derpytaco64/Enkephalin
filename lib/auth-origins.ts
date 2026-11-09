/**
 * Addresses the app may be reached at besides `BETTER_AUTH_URL`.
 *
 * better-auth refuses a sign-in whose `Origin` header it was not told about:
 * `Invalid origin`, 403, and nothing wrong in the logs beyond that line. Its
 * trusted list is seeded with exactly one entry -- the origin of `baseURL` --
 * so putting a reverse proxy in front breaks login the moment the browser's
 * address stops being the one the container was given. The proxy forwards an
 * `Origin` of the public hostname while `baseURL` still says the LAN address,
 * and the two no longer match.
 *
 * Its own module rather than a closure in `auth.ts` so the parsing can be
 * tested without constructing the auth instance, which would want a database.
 */

/**
 * Parses the comma-separated `BETTER_AUTH_TRUSTED_ORIGINS` form.
 *
 * One variable covers a proxy hostname, a Tailscale name and a LAN address at
 * once. Blank entries are dropped rather than passed through: an empty string
 * matches no origin, so it would read as a configured value that quietly does
 * nothing -- and a trailing comma is the most ordinary way to write one.
 *
 * These are **origins**, not URLs: scheme, host and port, no path. A trailing
 * slash is trimmed because `https://host/` is the same place as
 * `https://host` and a reader should not have to know which form the
 * comparison wants.
 */
export function parseTrustedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
}
