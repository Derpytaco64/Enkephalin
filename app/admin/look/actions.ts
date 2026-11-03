'use server';

import { revalidatePath } from 'next/cache';
import type { Result } from '@/lib/drugs/mutations';
import { requireAdmin } from '@/lib/session';
import { isColorAxis, randomPalette } from '@/lib/theme/palette';
import {
  clearSitePalette, setSitePaletteColor, setSitePaletteColors, setSiteTheme,
} from '@/lib/theme/preferences';
import { listSwatches } from '@/lib/theme/swatches';

/**
 * The site palette, edited by an admin.
 *
 * Every action is the per-user one with `requireAdmin` in place of
 * `requireUser` and a site writer in place of a user writer. They are separate
 * functions rather than one taking a scope argument on purpose: a scope that
 * arrives in a form is a scope a request can claim, and "write the site
 * default" is not something a signed-in user should be able to ask for by
 * adding a field.
 */
function applied() {
  // The whole layout: the default theme is stamped on `<html>` and the palette
  // is read per request, so refreshing this form alone would leave every other
  // page the old colour until the next navigation.
  revalidatePath('/', 'layout');
}

export async function saveSiteThemeAction(formData: FormData): Promise<Result> {
  await requireAdmin();

  const result = await setSiteTheme(formData.get('theme'));
  if (result.ok) applied();
  return result;
}

export async function setSiteColorAction(formData: FormData): Promise<Result<{ color: string | null }>> {
  await requireAdmin();

  const key = formData.get('key');
  if (typeof key !== 'string') return { ok: false, message: 'Which colour?' };

  const color = formData.get('color');
  const result = await setSitePaletteColor(key, typeof color === 'string' ? color : '');
  if (result.ok) applied();
  return result;
}

/**
 * The keys are read from the data here rather than taken from the form, for
 * the same reason as the per-user shuffle: what gets written should be what
 * the data says exists. Schedules are refused as well as hidden, because that
 * ramp is ordinal and shuffling it would throw away the one piece of meaning
 * colour carries in this app.
 */
export async function randomizeSitePaletteAction(formData: FormData): Promise<Result<{ changed: number }>> {
  await requireAdmin();

  const axis = formData.get('axis');
  if (!isColorAxis(axis) || axis === 'none') {
    return { ok: false, message: 'There is nothing to shuffle.' };
  }
  if (axis === 'schedule') {
    return {
      ok: false,
      message: 'Schedules run strongest to faintest on purpose, so they are not shuffled.',
    };
  }

  const swatches = await listSwatches(axis, {});
  const result = await setSitePaletteColors(
    axis,
    randomPalette(swatches.map((swatch) => swatch.key)),
  );
  if (result.ok) applied();
  return result;
}

export async function clearSitePaletteAction(): Promise<Result> {
  await requireAdmin();

  const result = await clearSitePalette();
  if (result.ok) applied();
  return result;
}
