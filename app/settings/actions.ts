'use server';

import { revalidatePath } from 'next/cache';
import type { Result } from '@/lib/drugs/mutations';
import { requireUser } from '@/lib/session';
import { isColorAxis, randomPalette } from '@/lib/theme/palette';
import {
  clearPalette, setAmbience, setColorAxis, setPaletteColor, setPaletteColors, setSeason,
  setSeasonTint, setTheme,
} from '@/lib/theme/preferences';
import { listSwatches } from '@/lib/theme/swatches';

/**
 * Every one of these revalidates the layout, not just this page: the theme is
 * stamped on `<html>` and the colours are read per request, so a change that
 * only refreshed the form would leave the rest of the app the old colour until
 * the next navigation.
 */
function applied() {
  revalidatePath('/', 'layout');
}

/**
 * Theme and colour axis together, because they are one question -- how this
 * should look -- and two Save buttons for one answer is two chances to change
 * half of it.
 */
export async function saveLookAction(formData: FormData): Promise<Result> {
  const session = await requireUser();

  const theme = await setTheme(session.user.id, formData.get('theme'));
  if (!theme.ok) return theme;

  const axis = await setColorAxis(session.user.id, formData.get('axis'));
  if (!axis.ok) return axis;

  const season = await setSeason(session.user.id, formData.get('season'));
  if (!season.ok) return season;

  // An unchecked box is absent from the form rather than false, which is
  // exactly what these writers read -- see the note on `setSeasonTint`.
  const tint = await setSeasonTint(session.user.id, formData.get('seasonTint'));
  if (!tint.ok) return tint;

  const ambience = await setAmbience(session.user.id, formData.get('ambience'));
  if (!ambience.ok) return ambience;

  applied();
  return { ok: true };
}

export async function setColorAction(formData: FormData): Promise<Result<{ color: string | null }>> {
  const session = await requireUser();

  const key = formData.get('key');
  if (typeof key !== 'string') return { ok: false, message: 'Which colour?' };

  const color = formData.get('color');
  const result = await setPaletteColor(
    session.user.id,
    key,
    typeof color === 'string' ? color : '',
  );
  if (result.ok) applied();
  return result;
}

/**
 * A fresh colour for everything on one axis.
 *
 * The set of things to colour is read here rather than taken from the form:
 * the client knows which rows it is showing, but what gets written should be
 * what the data says exists, and a request that could name its own keys could
 * fill `palette_overrides` with anything.
 *
 * Not offered for the schedule axis, and refused here as well as hidden in the
 * UI. That ramp is ordinal -- CII strongest through CV faintest -- so shuffling
 * it would throw away the one piece of meaning colour carries in this app.
 */
export async function randomizePaletteAction(formData: FormData): Promise<Result<{ changed: number }>> {
  const session = await requireUser();

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
  const result = await setPaletteColors(
    session.user.id,
    axis,
    randomPalette(swatches.map((swatch) => swatch.key)),
  );
  if (result.ok) applied();
  return result;
}

export async function clearPaletteAction(): Promise<Result> {
  const session = await requireUser();
  const result = await clearPalette(session.user.id);
  if (result.ok) applied();
  return result;
}
