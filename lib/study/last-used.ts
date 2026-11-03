/**
 * The settings of the last deck and the last quiz you actually started.
 *
 * Separate from `study_presets`, which holds setups you *named*. A name is a
 * deliberate act and most sessions never get one, so without this the home
 * page could only offer a blank form to someone who sits the same quiz every
 * evening. Nothing here is a promise to keep: it is overwritten by the next
 * session on that page and is only ever a link.
 *
 * Stored in `user_preferences.study_defaults`, which has been an unread jsonb
 * column since phase 0 -- so no migration, and a setting added to either page
 * later needs none either, exactly as for a saved setup.
 *
 * Stored as the page's own query parameters for the same reason setups are,
 * and run through the same whitelist in both directions: see
 * `lib/study/presets.ts`.
 */
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { userPreferences } from '@/db/schema';
import {
  isSurface, setupParams, startsSomething, type SetupParams, type Surface,
} from './presets';

/** The key inside `study_defaults`, which is a bag shared with nothing yet. */
const KEY = 'lastUsed';

export type LastUsed = Partial<Record<Surface, SetupParams>>;

/**
 * Records what a session was started with, merging rather than replacing.
 *
 * One statement, and a jsonb merge rather than a read-then-write, so a deck
 * opened in one tab and a quiz in another both land -- a read-modify-write
 * would have the second overwrite the first's surface with nothing.
 */
export async function rememberSetup(
  userId: string,
  surface: Surface,
  raw: Record<string, string | string[] | undefined>,
): Promise<void> {
  const params = setupParams(surface, raw);
  // A page showing its form started nothing, and recording it would offer
  // "pick up where you left off" on a blank form.
  if (!startsSomething(params)) return;

  // Cast, every one of them: postgres.js sends these as untyped parameters,
  // and `jsonb_build_object($1, ...)` is a function call Postgres cannot
  // resolve without knowing what $1 is -- it refuses the statement outright
  // rather than guessing.
  const patch = sql`${JSON.stringify({ [surface]: params })}::jsonb`;

  await db
    .insert(userPreferences)
    .values({ userId, studyDefaults: { [KEY]: { [surface]: params } } })
    .onConflictDoUpdate({
      target: userPreferences.userId,
      set: {
        studyDefaults: sql`
          coalesce(${userPreferences.studyDefaults}, '{}'::jsonb)
          || jsonb_build_object(
            ${KEY}::text,
            coalesce(${userPreferences.studyDefaults} -> ${KEY}::text, '{}'::jsonb) || ${patch}
          )`,
      },
    });
}

/** Both surfaces, each absent until a session has been started on it. */
export async function lastUsedSetups(userId: string): Promise<LastUsed> {
  const [row] = await db
    .select({ defaults: userPreferences.studyDefaults })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);

  const stored = (row?.defaults ?? {})[KEY];
  if (stored === null || typeof stored !== 'object') return {};

  const out: LastUsed = {};
  for (const [surface, params] of Object.entries(stored as Record<string, unknown>)) {
    if (!isSurface(surface)) continue;
    if (params === null || typeof params !== 'object') continue;
    // Re-filtered on the way out, as a restored backup is not a reason to put
    // keys the page does not understand into a URL.
    const kept = setupParams(surface, params as Record<string, string | string[] | undefined>);
    if (startsSomething(kept)) out[surface] = kept;
  }
  return out;
}
