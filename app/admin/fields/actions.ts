'use server';

import { revalidatePath } from 'next/cache';
import { readFieldDefInput } from '@/lib/fields/form-input';
import {
  createFieldDef,
  reorderFieldDefs,
  restoreFieldDef,
  setFieldFlag,
  softDeleteFieldDef,
  updateFieldDef,
} from '@/lib/fields/mutations';
import { isFieldFlag, type Result } from '@/lib/fields/constants';
import { requireAdmin } from '@/lib/session';

// Each action re-checks: the layout guard protects the page render, not a
// direct call to the action.

export async function createFieldAction(formData: FormData) {
  await requireAdmin();
  const result = await createFieldDef(String(formData.get('key') ?? ''), readFieldDefInput(formData));
  revalidatePath('/admin/fields');
  return result;
}

export async function updateFieldAction(formData: FormData) {
  await requireAdmin();
  const result = await updateFieldDef(String(formData.get('id') ?? ''), readFieldDefInput(formData));
  revalidatePath('/admin/fields');
  return result;
}

/**
 * The list's two edits, both of which return their result so the row can put
 * the box back where it was when a write is refused.
 *
 * `ids` is the whole list in its new order -- see `reorderFieldDefs`.
 */
export async function reorderFieldsAction(ids: string[]): Promise<Result> {
  await requireAdmin();
  const result = await reorderFieldDefs(ids);
  revalidatePath('/admin/fields');
  return result;
}

export async function setFieldFlagAction(
  id: string,
  flag: string,
  value: boolean,
): Promise<Result> {
  await requireAdmin();
  if (!isFieldFlag(flag)) return { ok: false, message: `"${flag}" is not a field setting.` };

  const result = await setFieldFlag(id, flag, value);
  // Profiles read `defaultVisible` and the study screens read `isQuizzable`,
  // so the list is not the only page that just went stale.
  revalidatePath('/admin/fields');
  revalidatePath('/drugs');
  return result;
}

/**
 * These two are plain form actions, so they return nothing. Both only fail if
 * the field changed underneath us -- someone else removed it, or it is core
 * and the button should not have been there -- and the revalidate below
 * re-renders the current truth either way. Logged rather than dropped.
 */
export async function deleteFieldAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const result = await softDeleteFieldDef(String(formData.get('id') ?? ''));
  if (!result.ok) console.error('[fields] remove refused:', result.message);
  revalidatePath('/admin/fields');
}

export async function restoreFieldAction(formData: FormData): Promise<void> {
  await requireAdmin();
  await restoreFieldDef(String(formData.get('id') ?? ''));
  revalidatePath('/admin/fields');
}
