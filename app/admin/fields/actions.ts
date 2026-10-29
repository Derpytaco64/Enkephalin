'use server';

import { revalidatePath } from 'next/cache';
import { readFieldDefInput } from '@/lib/fields/form-input';
import {
  createFieldDef,
  restoreFieldDef,
  softDeleteFieldDef,
  updateFieldDef,
} from '@/lib/fields/mutations';
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
