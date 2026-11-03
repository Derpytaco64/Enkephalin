'use server';

import { revalidatePath } from 'next/cache';
import type { Result } from '@/lib/drugs/mutations';
import { requireUser } from '@/lib/session';
import {
  clearPalette, setColorAxis, setPaletteColor, setTheme,
} from '@/lib/theme/preferences';

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

export async function clearPaletteAction(): Promise<Result> {
  const session = await requireUser();
  const result = await clearPalette(session.user.id);
  if (result.ok) applied();
  return result;
}
