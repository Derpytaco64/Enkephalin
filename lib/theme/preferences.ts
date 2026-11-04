/**
 * Per-user theme and colour, read on the server so the page arrives already
 * the right colour.
 *
 * A theme applied in the browser after load is a white flash on every
 * navigation for anyone who chose dark. So the choice is stamped on `<html>`
 * during the render, which costs this: every page is dynamic. They already
 * were -- the whole app reads a session -- so the bill was paid.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { userPreferences } from '@/db/schema';
import type { Result } from '@/lib/drugs/mutations';
import { getSiteSettings, upsertSiteSettings } from '@/lib/settings';
import { withAxisColors, withColor, type Overrides } from './overrides';
import { isColorAxis, type ColorAxis } from './palette';
import { daypartOf, type Daypart } from './ambience';
import { isSeasonPref, resolveSeason, type Season, type SeasonPref } from './seasons';

export type ThemePref = 'light' | 'dark' | 'system';

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'light' || value === 'dark' || value === 'system';
}

export type Preferences = {
  theme: ThemePref;
  colorAxis: ColorAxis;
  /**
   * The *choice*, not the season. `auto` has to survive being read back, or
   * the settings form would show whichever season it happens to be today and
   * saving it would pin that one forever.
   */
  season: SeasonPref;
  /**
   * Whether the season reaches the chrome -- grounds, surfaces, borders -- or
   * stays the wash and the motes. A depth, not a season.
   */
  seasonTint: boolean;
  /**
   * The decorations belonging to light and dark rather than to a season: a
   * starfield, a sunbeam, paper grain, and warmth by the clock.
   */
  ambience: boolean;
  /** The user's own, over the site default. Keyed as in `paletteKey`. */
  paletteOverrides: Record<string, string>;
};

/**
 * Settings a signed-out visitor gets: the site default theme, class colour,
 * and the site palette.
 *
 * Signed out is the login page and nothing else, but it is still a page with a
 * background, and defaulting it to light when the site default is dark would
 * make the first thing anyone sees the one page that ignores the setting.
 */
export async function sitePreferences(): Promise<Preferences> {
  const settings = await getSiteSettings();
  return {
    theme: isThemePref(settings?.defaultTheme) ? settings.defaultTheme : 'system',
    colorAxis: 'class',
    season: isSeasonPref(settings?.defaultSeason) ? settings.defaultSeason : 'off',
    seasonTint: settings?.defaultSeasonTint ?? false,
    ambience: settings?.defaultAmbience ?? false,
    paletteOverrides: settings?.defaultPalette ?? {},
  };
}

/**
 * One person's settings, with the site's as the floor.
 *
 * The row may not exist: `user_preferences` is written the first time somebody
 * changes something, not at registration, so absence means "has not chosen"
 * and not "chose nothing".
 */
export async function getPreferences(userId: string | null): Promise<Preferences> {
  const site = await sitePreferences();
  if (userId === null) return site;

  const [row] = await db
    .select()
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  if (row === undefined) return site;

  return {
    theme: isThemePref(row.theme) ? row.theme : site.theme,
    colorAxis: isColorAxis(row.colorAxis) ? row.colorAxis : site.colorAxis,
    // `off` is the column default, so somebody who has never touched this has
    // a row saying `off` -- which is also the site's default until an admin
    // changes it. A site season therefore reaches only people with no
    // preferences row at all, which is the same way the theme behaves and is
    // the honest reading of "default".
    season: isSeasonPref(row.season) ? row.season : site.season,
    seasonTint: row.seasonTint,
    ambience: row.ambience,
    // The user's entries win, key by key, so overriding one colour does not
    // discard the site's answer for the rest.
    paletteOverrides: { ...site.paletteOverrides, ...row.paletteOverrides },
  };
}

/**
 * What goes on the `<html>` element: `light`, `dark`, or null for system.
 *
 * Null rather than a guess, because `globals.css` already answers system with
 * `prefers-color-scheme` and the server has no business deciding what the
 * operating system thinks.
 */
export function themeAttribute(theme: ThemePref): 'light' | 'dark' | null {
  return theme === 'system' ? null : theme;
}

/**
 * What goes on `<html>` as `data-season`, resolved once per render.
 *
 * Resolved on the server rather than in the browser so the wash arrives with
 * the page, like the theme -- and so the ornament the layout draws and the
 * wash the stylesheet paints cannot disagree about which season it is.
 */
export function seasonAttribute(season: SeasonPref, now?: Date): Season | null {
  return resolveSeason(season, now);
}

/**
 * Everything `<html>` carries for decoration, resolved once per render.
 *
 * One function rather than four, because the four answers are not independent:
 * a tint with no season is nothing, and the daypart is pointless without
 * ambience. Deciding that here means the layout cannot stamp a combination the
 * stylesheet has no rule for.
 */
export type DecorAttributes = {
  season: Season | null;
  /** Only ever set alongside a season; the selector needs both. */
  tint: 'season' | null;
  ambience: boolean;
  /** Only ever set alongside ambience. */
  daypart: Daypart | null;
};

export function decorAttributes(
  preferences: Pick<Preferences, 'season' | 'seasonTint' | 'ambience'>,
  now?: Date,
): DecorAttributes {
  const season = seasonAttribute(preferences.season, now);
  return {
    season,
    tint: season !== null && preferences.seasonTint ? 'season' : null,
    ambience: preferences.ambience,
    daypart: preferences.ambience ? daypartOf(now) : null,
  };
}

/** Creates the row on first change; `theme` and `colorAxis` are independent. */
async function upsert(
  userId: string,
  patch: Partial<{
    theme: ThemePref;
    colorAxis: ColorAxis;
    season: SeasonPref;
    seasonTint: boolean;
    ambience: boolean;
    paletteOverrides: Record<string, string>;
  }>,
): Promise<void> {
  await db
    .insert(userPreferences)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: userPreferences.userId, set: patch });
}

export async function setTheme(userId: string, theme: unknown): Promise<Result> {
  if (!isThemePref(theme)) return { ok: false, message: 'That is not a theme.' };
  await upsert(userId, { theme });
  return { ok: true };
}

export async function setColorAxis(userId: string, axis: unknown): Promise<Result> {
  if (!isColorAxis(axis)) return { ok: false, message: 'That is not a colour axis.' };
  await upsert(userId, { colorAxis: axis });
  return { ok: true };
}

export async function setSeason(userId: string, season: unknown): Promise<Result> {
  if (!isSeasonPref(season)) return { ok: false, message: 'That is not a season.' };
  await upsert(userId, { season });
  return { ok: true };
}

/**
 * The two cosmetic switches.
 *
 * A checkbox posts `'on'` or nothing at all, which is why these read truthiness
 * rather than demanding a boolean: an unchecked box is absent from the form, and
 * refusing `undefined` would make unchecking one impossible.
 */
export async function setSeasonTint(userId: string, on: unknown): Promise<Result> {
  await upsert(userId, { seasonTint: on === true || on === 'on' || on === 'true' });
  return { ok: true };
}

export async function setAmbience(userId: string, on: unknown): Promise<Result> {
  await upsert(userId, { ambience: on === true || on === 'on' || on === 'true' });
  return { ok: true };
}

/** The user's own entries, without the site's underneath them. */
async function userOverrides(userId: string): Promise<Overrides> {
  const [row] = await db
    .select({ overrides: userPreferences.paletteOverrides })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row?.overrides ?? {};
}

/**
 * Pins one value's colour, or clears it back to the default when `color` is
 * blank.
 *
 * Read-then-write rather than a jsonb merge in SQL, because the whole point of
 * the editor is that you are looking at the value you are changing; two tabs
 * racing on the same key is not a scenario worth a round trip to avoid, and
 * the loser's answer is still just a colour.
 */
export async function setPaletteColor(
  userId: string,
  key: string,
  color: string,
): Promise<Result<{ color: string | null }>> {
  const edit = withColor(await userOverrides(userId), key, color);
  if (!edit.ok) return edit;

  await upsert(userId, { paletteOverrides: edit.value!.overrides });
  return { ok: true, value: { color: edit.value!.color } };
}

/** Replaces every colour on one axis at once, leaving the other axes alone. */
export async function setPaletteColors(
  userId: string,
  axis: Exclude<ColorAxis, 'none'>,
  entries: Overrides,
): Promise<Result<{ changed: number }>> {
  const edit = withAxisColors(await userOverrides(userId), axis, entries);
  if (!edit.ok) return edit;

  await upsert(userId, { paletteOverrides: edit.value!.overrides });
  return { ok: true, value: { changed: edit.value!.changed } };
}

/** Back to the defaults, all of them at once. */
export async function clearPalette(userId: string): Promise<Result> {
  await upsert(userId, { paletteOverrides: {} });
  return { ok: true };
}

/* ---------------------------------------------------------------------------
   The site's own answers: what everyone gets before they choose anything, and
   what a signed-out visitor gets full stop.

   Deliberately the same rules and the same shape as the per-user writers
   above, over `site_settings` rather than `user_preferences`, so the two
   palettes cannot disagree about what a key is or what clearing one means.
   Authorisation is not here -- these are called only from an admin-gated
   action, and a function that checks its own caller is a function you cannot
   test or reuse.
   ------------------------------------------------------------------------ */

/**
 * Creates row 1 on first change, like the per-user upsert.
 *
 * The statement itself lives in `lib/settings.ts`, which owns the row: the
 * look half and the identity half are two questions asked of one singleton,
 * and two copies of "create it if it is not there" is exactly the kind of pair
 * that drifts.
 */
async function upsertSite(
  patch: Partial<{
    defaultTheme: ThemePref;
    defaultSeason: SeasonPref;
    defaultSeasonTint: boolean;
    defaultAmbience: boolean;
    defaultPalette: Overrides;
  }>,
): Promise<void> {
  await upsertSiteSettings(patch);
}

async function siteOverrides(): Promise<Overrides> {
  return (await getSiteSettings())?.defaultPalette ?? {};
}

export async function setSiteTheme(theme: unknown): Promise<Result> {
  if (!isThemePref(theme)) return { ok: false, message: 'That is not a theme.' };
  await upsertSite({ defaultTheme: theme });
  return { ok: true };
}

export async function setSiteSeason(season: unknown): Promise<Result> {
  if (!isSeasonPref(season)) return { ok: false, message: 'That is not a season.' };
  await upsertSite({ defaultSeason: season });
  return { ok: true };
}

export async function setSiteSeasonTint(on: unknown): Promise<Result> {
  await upsertSite({ defaultSeasonTint: on === true || on === 'on' || on === 'true' });
  return { ok: true };
}

export async function setSiteAmbience(on: unknown): Promise<Result> {
  await upsertSite({ defaultAmbience: on === true || on === 'on' || on === 'true' });
  return { ok: true };
}

export async function setSitePaletteColor(
  key: string,
  color: string,
): Promise<Result<{ color: string | null }>> {
  const edit = withColor(await siteOverrides(), key, color);
  if (!edit.ok) return edit;

  await upsertSite({ defaultPalette: edit.value!.overrides });
  return { ok: true, value: { color: edit.value!.color } };
}

export async function setSitePaletteColors(
  axis: Exclude<ColorAxis, 'none'>,
  entries: Overrides,
): Promise<Result<{ changed: number }>> {
  const edit = withAxisColors(await siteOverrides(), axis, entries);
  if (!edit.ok) return edit;

  await upsertSite({ defaultPalette: edit.value!.overrides });
  return { ok: true, value: { changed: edit.value!.changed } };
}

export async function clearSitePalette(): Promise<Result> {
  await upsertSite({ defaultPalette: {} });
  return { ok: true };
}
