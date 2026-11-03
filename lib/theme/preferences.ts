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
import { getSiteSettings } from '@/lib/settings';
import { isColorAxis, normalizeHex, type ColorAxis } from './palette';

export type ThemePref = 'light' | 'dark' | 'system';

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'light' || value === 'dark' || value === 'system';
}

export type Preferences = {
  theme: ThemePref;
  colorAxis: ColorAxis;
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

/** Creates the row on first change; `theme` and `colorAxis` are independent. */
async function upsert(
  userId: string,
  patch: Partial<{
    theme: ThemePref;
    colorAxis: ColorAxis;
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
  if (!/^[a-z]+:[^:]{1,200}$/.test(key)) {
    return { ok: false, message: 'That is not something with a colour.' };
  }

  const [row] = await db
    .select({ overrides: userPreferences.paletteOverrides })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  const overrides = { ...(row?.overrides ?? {}) };

  if (color.trim() === '') {
    delete overrides[key];
    await upsert(userId, { paletteOverrides: overrides });
    return { ok: true, value: { color: null } };
  }

  const hex = normalizeHex(color);
  if (hex === null) {
    return { ok: false, message: 'Give a colour as a hex code, like #2563eb.' };
  }

  overrides[key] = hex;
  await upsert(userId, { paletteOverrides: overrides });
  return { ok: true, value: { color: hex } };
}

/** Back to the defaults, all of them at once. */
export async function clearPalette(userId: string): Promise<Result> {
  await upsert(userId, { paletteOverrides: {} });
  return { ok: true };
}
