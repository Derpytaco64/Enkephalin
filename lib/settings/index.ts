import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, siteSettings } from '@/db/schema';
import type { Result } from '@/lib/drugs/mutations';
import {
  DISCLAIMER_MAX, FALLBACK_SITE_NAME, isRegistrationMode, SITE_NAME_MAX,
  type RegistrationMode, type SiteIdentity,
} from './shape';

// Re-exported so a server caller has one import for the whole subject; the
// definitions live in `shape.ts` because the admin form runs in a browser.
export * from './shape';

/**
 * The site's own answers: what it is called, who may register, and the
 * sentence at the foot of the page.
 *
 * These three were stored from phase 0 and editable nowhere. `registration_mode`
 * in particular is a lock -- the register page refuses a stranger because of it
 * -- and the only way to turn it was SQL or a backup restore. That is the gap
 * this file closes.
 *
 * The *look* half of the singleton (default theme, season, palette) is written
 * from `lib/theme/preferences.ts`, which is a different question asked of the
 * same row. Both go through `upsertSiteSettings` below so there is one
 * statement that creates row 1, rather than two that could disagree about
 * whether it exists.
 */

export async function getSiteSettings() {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, 1)).limit(1);
  return row;
}

/**
 * The name, for the places that print it: the tab title, the wordmark, the
 * signed-out front page.
 *
 * Falls back rather than returning undefined, because every one of those
 * callers would have to invent the same fallback, and a header with a hole in
 * it is a worse failure than a header saying the default name.
 */
export async function getSiteName(): Promise<string> {
  const name = (await getSiteSettings())?.siteName?.trim();
  return name === undefined || name === '' ? FALLBACK_SITE_NAME : name;
}

export async function getRegistrationMode(): Promise<RegistrationMode> {
  const mode = (await getSiteSettings())?.registrationMode;
  return isRegistrationMode(mode) ? mode : 'invite';
}

/**
 * Creates row 1 on first write, like the per-user upsert does for a person.
 *
 * Exported so `lib/theme/preferences.ts` writes the same row through the same
 * statement; the patch type is deliberately the row's own, so adding a column
 * does not need this touched.
 */
export type SiteSettingsPatch = Partial<typeof siteSettings.$inferInsert>;

export async function upsertSiteSettings(patch: SiteSettingsPatch): Promise<void> {
  await db
    .insert(siteSettings)
    .values({ id: 1, ...patch })
    .onConflictDoUpdate({ target: siteSettings.id, set: patch });
}

/**
 * All three at once, validated, with the change recorded.
 *
 * One writer rather than three, because they are one form: an admin changing
 * the name and the disclaimer in the same sitting should not be able to land
 * the first and be refused the second, which is exactly what three independent
 * setters would do.
 *
 * **Both texts are required.** A blank name leaves the bar and the tab title
 * with a hole in them. A blank disclaimer is the more interesting one, and the
 * refusal is deliberate: this is a study aid built off a class sheet, the
 * sentence saying it is not a clinical reference is the one sentence it should
 * not be able to lose, and "clear the field" is far too quiet a way to lose
 * it. Rewording it is the control that exists; removing it is not.
 */
export async function saveSiteIdentity(
  input: { siteName: unknown; registrationMode: unknown; disclaimerText: unknown },
  actorId: string,
): Promise<Result<SiteIdentity>> {
  const name = typeof input.siteName === 'string' ? input.siteName.trim() : '';
  if (name === '') return { ok: false, message: 'The site needs a name.' };
  if (name.length > SITE_NAME_MAX) {
    return { ok: false, message: `A name has to fit the top bar — ${SITE_NAME_MAX} characters.` };
  }

  if (!isRegistrationMode(input.registrationMode)) {
    return { ok: false, message: 'That is not a registration mode.' };
  }

  const disclaimer = typeof input.disclaimerText === 'string' ? input.disclaimerText.trim() : '';
  if (disclaimer === '') {
    return {
      ok: false,
      message: 'The disclaimer cannot be empty. Reword it, but it has to say something.',
    };
  }
  if (disclaimer.length > DISCLAIMER_MAX) {
    return { ok: false, message: `The disclaimer has to fit a footer — ${DISCLAIMER_MAX} characters.` };
  }

  const next: SiteIdentity = {
    siteName: name,
    registrationMode: input.registrationMode,
    disclaimerText: disclaimer,
  };

  // Read before writing, so the audit row can say what it *was*. Two tabs
  // racing is not a scenario worth a transaction here: the loser's answer is
  // still a whole, valid set of three, and the log records both attempts.
  const before = await getSiteSettings();
  await upsertSiteSettings(next);

  // Only the fields that moved. An audit row saying "the name changed from
  // Enkephalin to Enkephalin" is noise in the one log that has to stay
  // readable, and a change with nothing in it is not a change.
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of ['siteName', 'registrationMode', 'disclaimerText'] as const) {
    const was = before?.[key];
    if (was !== next[key]) diff[key] = { from: was ?? null, to: next[key] };
  }

  if (Object.keys(diff).length > 0) {
    await db.insert(auditLog).values({
      actorId,
      action: 'site_settings.update',
      targetType: 'site_settings',
      targetId: '1',
      diff,
    });
  }

  return { ok: true, value: next };
}
