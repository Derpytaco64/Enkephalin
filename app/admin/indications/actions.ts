'use server';

import { revalidatePath } from 'next/cache';
import {
  deleteIndication, mergeIndications, renameIndication, type Result,
} from '@/lib/drugs/indication-store';
import { requireAdmin } from '@/lib/session';

// Each action re-checks the role: the layout guard protects the render, not a
// direct POST to the action.

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '');

/**
 * An indication is in the browse rail, every drug profile that carries it, and
 * both study pickers, so a rename has to clear all of them. The slug does not
 * change, which is why no saved study link is among them.
 */
function revalidateEverywhere() {
  revalidatePath('/admin/indications');
  revalidatePath('/drugs');
  revalidatePath('/study/flashcards');
  revalidatePath('/study/quiz');
}

export async function renameIndicationAction(formData: FormData): Promise<Result> {
  const session = await requireAdmin();
  const result = await renameIndication(
    text(formData, 'slug'),
    text(formData, 'label'),
    session.user.id,
  );
  if (!result.ok) return result;

  revalidateEverywhere();
  return { ok: true };
}

export async function mergeIndicationsAction(formData: FormData): Promise<Result<{ moved: number }>> {
  const session = await requireAdmin();
  const result = await mergeIndications(
    text(formData, 'from'),
    text(formData, 'into'),
    session.user.id,
  );
  if (!result.ok) return result;

  revalidateEverywhere();
  return result;
}

export async function deleteIndicationAction(formData: FormData): Promise<Result> {
  const session = await requireAdmin();
  const result = await deleteIndication(text(formData, 'slug'), session.user.id);
  if (!result.ok) return result;

  revalidateEverywhere();
  return { ok: true };
}
