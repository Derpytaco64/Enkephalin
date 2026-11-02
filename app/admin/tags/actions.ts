'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { Result } from '@/lib/drugs/mutations';
import { createTag, deleteTag, renameTag, setTagDrugs } from '@/lib/tags/mutations';
import { requireAdmin } from '@/lib/session';

// Each action re-checks the role: the layout guard protects the render, not a
// direct POST to the action.

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '');

export async function createTagAction(formData: FormData): Promise<Result<string>> {
  const session = await requireAdmin();
  const result = await createTag(
    { label: text(formData, 'label'), kind: text(formData, 'kind') },
    session.user.id,
  );
  if (!result.ok) return result;

  revalidatePath('/admin/tags');
  // Straight into the checklist: a list with no drugs in it is not finished.
  redirect(`/admin/tags/${result.value}`);
}

export async function saveTagMembersAction(formData: FormData): Promise<Result> {
  const session = await requireAdmin();
  const slug = text(formData, 'slug');

  const renamed = await renameTag(slug, text(formData, 'label'), session.user.id);
  if (!renamed.ok) return renamed;

  const result = await setTagDrugs(slug, formData.getAll('drug').map(String), session.user.id);
  if (!result.ok) return result;

  revalidatePath('/admin/tags');
  revalidatePath(`/admin/tags/${slug}`);
  revalidatePath('/drugs');
  revalidatePath('/study/flashcards');
  return { ok: true };
}

export async function deleteTagAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const result = await deleteTag(text(formData, 'slug'), session.user.id);
  if (!result.ok) console.error('[tags] delete refused:', result.message);

  revalidatePath('/admin/tags');
  revalidatePath('/drugs');
  redirect('/admin/tags');
}
