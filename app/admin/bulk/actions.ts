'use server';

import { revalidatePath } from 'next/cache';
import { setFieldAcross, type BulkOutcome } from '@/lib/admin/bulk';
import { listFieldDefs } from '@/lib/fields/registry';
import { requireAdmin } from '@/lib/session';

// The role is re-checked here: the layout guard protects the render, not a
// direct POST to the action.

export type BulkResult =
  | { ok: true; outcome: BulkOutcome }
  | { ok: false; message: string };

/**
 * Applies one value to every ticked drug.
 *
 * Refuses an empty selection rather than treating it as "all": a bulk write is
 * the one place where guessing at intent is unforgivable, and a stray click on
 * Apply with nothing ticked must do nothing at all.
 */
export async function bulkSetAction(formData: FormData): Promise<BulkResult> {
  const session = await requireAdmin();

  const fieldKey = String(formData.get('fieldKey') ?? '');
  const defs = await listFieldDefs();
  const def = defs.find((each) => each.key === fieldKey && !each.isCore);
  if (!def) return { ok: false, message: 'That field cannot be set in bulk.' };

  const slugs = formData.getAll('slug').map(String).filter(Boolean);
  if (slugs.length === 0) return { ok: false, message: 'Nothing is ticked, so nothing was set.' };

  const outcome = await setFieldAcross(
    def,
    slugs,
    {
      value: String(formData.get('value') ?? ''),
      source: String(formData.get('source') ?? ''),
      status: String(formData.get('status') ?? ''),
    },
    session.user.id,
  );

  revalidatePath('/admin/bulk');
  revalidatePath('/drugs');
  for (const slug of outcome.changed) {
    revalidatePath(`/drugs/${slug}`);
    revalidatePath(`/drugs/${slug}/edit`);
  }

  return { ok: true, outcome };
}
