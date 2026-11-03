'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { deleteDrug, mergeDrugs, previewMerge, type MergePreview } from '@/lib/drugs/merge';
import type { Result } from '@/lib/drugs/mutations';
import { requireAdmin } from '@/lib/session';

// Each action re-checks the role: the page guard protects the render, not a
// direct POST to the action.

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '');

/**
 * What a merge would do, before it does it.
 *
 * A read, so it neither revalidates nor redirects. The page asks for this when
 * a target is picked and shows the answer beside the button, because "fold
 * these two together" is not a thing anyone should press without being told
 * what moves and what is discarded.
 */
export async function previewMergeAction(formData: FormData): Promise<Result<MergePreview>> {
  await requireAdmin();
  return previewMerge(text(formData, 'from'), text(formData, 'into'));
}

export async function mergeDrugAction(formData: FormData): Promise<Result> {
  const session = await requireAdmin();

  const into = text(formData, 'into');
  const result = await mergeDrugs(text(formData, 'from'), into, session.user.id);
  if (!result.ok) return result;

  revalidatePath('/drugs');
  revalidatePath(`/drugs/${into}`);
  redirect(`/drugs/${into}`);
}

export async function deleteDrugAction(formData: FormData): Promise<Result> {
  const session = await requireAdmin();

  const result = await deleteDrug(text(formData, 'slug'), session.user.id);
  if (!result.ok) return result;

  revalidatePath('/drugs');
  redirect('/drugs');
}
