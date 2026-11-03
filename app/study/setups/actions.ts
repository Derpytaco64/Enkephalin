'use server';

import { revalidatePath } from 'next/cache';
import type { Result } from '@/lib/drugs/mutations';
import { deleteSetup, isSurface, saveSetup, type Setup, type SetupParams } from '@/lib/study/presets';
import { requireUser } from '@/lib/session';

/**
 * Saves the setup described by the form's hidden parameters under a name.
 *
 * The parameters arrive as form fields rather than being re-derived here,
 * because what is being saved is the settings of the page you came *from* and
 * this page never had them. `saveSetup` filters them to the ones that page
 * reads either way, so a hand-made POST can smuggle in nothing a form could
 * not.
 */
export async function saveSetupAction(formData: FormData): Promise<Result<Setup>> {
  const session = await requireUser();

  const surface = formData.get('surface');
  if (!isSurface(surface)) return { ok: false, message: 'That is not a study page.' };

  const params: SetupParams = {};
  for (const [key, value] of formData.entries()) {
    if (key === 'surface' || key === 'name' || typeof value !== 'string') continue;
    const existing = params[key];
    if (existing === undefined) params[key] = value;
    else params[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }

  const result = await saveSetup({
    userId: session.user.id,
    surface,
    name: String(formData.get('name') ?? ''),
    params,
  });
  if (!result.ok) return result;

  // Safe here, and only here. The study pages deliberately never revalidate:
  // re-rendering one redraws the deck or the paper underneath a session in
  // progress. This page has no session running on it.
  revalidatePath('/study/setups');
  return result;
}

export async function deleteSetupAction(formData: FormData): Promise<Result> {
  const session = await requireUser();

  const id = formData.get('id');
  if (typeof id !== 'string' || id === '') return { ok: false, message: 'Which setup?' };

  const result = await deleteSetup(session.user.id, id);
  if (result.ok) revalidatePath('/study/setups');
  return result;
}
