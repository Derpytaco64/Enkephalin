'use server';

import { revalidatePath } from 'next/cache';
import { clearFlag } from '@/lib/admin/flagged';
import type { Result } from '@/lib/drugs/mutations';
import { requireAdmin } from '@/lib/session';

// The role is re-checked here: the layout guard protects the render, not a
// direct POST to the action.

/**
 * Clears one value's flag, leaving the value itself alone.
 *
 * Takes its two arguments rather than a `FormData`, because there is no form
 * here to take one from -- the control is a button, and wrapping it in a form
 * purely to carry two hidden fields would put this file in the
 * `tests/form-reset.test.ts` allowlist for a reset nobody wants.
 */
export async function clearFlagAction(slug: string, fieldKey: string): Promise<Result> {
  const session = await requireAdmin();
  if (!slug || !fieldKey) return { ok: false, message: 'Which value? The page lost track.' };

  const result = await clearFlag(slug, fieldKey, session.user.id);
  if (!result.ok) return result;

  // The status shows in four places, so clearing it on one screen must not
  // leave the other three disagreeing: the queue, the browse list's
  // needs-attention filter, and both of the drug's own pages.
  revalidatePath('/admin/flagged');
  revalidatePath('/drugs');
  revalidatePath(`/drugs/${slug}`);
  revalidatePath(`/drugs/${slug}/edit`);
  return { ok: true };
}
