/**
 * How big a backup the restore screen accepts, in one place.
 *
 * Three things have to agree about this and did not: the action that checks the
 * file's size and names the limit in its refusal, the form that asks for the
 * file, and **Next's own server-action body parser**, which defaults to 1 MB
 * and rejects the request before any of this app's code runs.
 *
 * On 2026-11-10 the export crossed that megabyte -- 1.05 MB, of which about
 * four tenths is the indentation that makes the file readable -- and restoring
 * one stopped working. There was nothing to read about why: the framework
 * refuses the request, the action never runs, so the 24 MB it advertises was
 * never the limit anybody was hitting. A limit the app states and does not
 * enforce is worse than no limit, because it sends you looking at the wrong
 * thing.
 *
 * So the number lives here, client-safe and with no imports, and
 * `next.config.ts` reads it too. Raising it is one edit.
 */

/** What the restore accepts. The whole database as JSON is about one megabyte. */
export const MAX_BACKUP_BYTES = 24 * 1024 * 1024;

/**
 * What Next's body parser allows: a megabyte above what the app accepts.
 *
 * Deliberately the looser of the two, so the app's own refusal is the one a
 * person reads. A file between the two sizes gets *that file is 24.5 MB; the
 * limit is 24 MB*, which says what to do about it; a framework rejection says
 * nothing at all.
 */
export const SERVER_ACTION_BODY_LIMIT = MAX_BACKUP_BYTES + 1024 * 1024;

/** `24 MB`, for a sentence. */
export function asMegabytes(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}
