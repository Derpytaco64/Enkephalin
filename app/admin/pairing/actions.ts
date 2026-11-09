'use server';

import { revalidatePath } from 'next/cache';
import { setBrandIndications, type Result } from '@/lib/drugs/mutations';
import { requireAdmin } from '@/lib/session';

// The role is re-checked here: the layout guard protects the render, not a
// direct POST to the action.

/**
 * Saves one drug's whole brand-to-indication map.
 *
 * The form posts a `pair` entry per ticked box as `<brandId>:<indicationId>`,
 * plus a `brand` entry per brand *row on the page*. Both are needed: a brand
 * with nothing ticked has to arrive as an empty list rather than be absent,
 * because "not narrowed" is a state somebody chose and dropping the key would
 * make it indistinguishable from a brand the form never showed.
 */
export async function savePairingAction(formData: FormData): Promise<Result> {
  const session = await requireAdmin();

  const slug = String(formData.get('slug') ?? '');
  if (!slug) return { ok: false, message: 'The form lost which drug it meant.' };

  const pairs: Record<string, string[]> = {};
  for (const brandId of formData.getAll('brand')) pairs[String(brandId)] = [];

  for (const raw of formData.getAll('pair')) {
    const [brandId, indicationId] = String(raw).split(':');
    if (!brandId || !indicationId) {
      return { ok: false, message: 'The form sent a pairing it could not read.' };
    }
    // A ticked box for a brand the form did not declare means the two halves
    // disagree, which is a bug rather than an edit to apply.
    if (!(brandId in pairs)) {
      return { ok: false, message: 'The form sent a brand it did not show. Reload and try again.' };
    }
    pairs[brandId].push(indicationId);
  }

  const result = await setBrandIndications(slug, pairs, session.user.id);
  if (!result.ok) return result;

  // The pairing shows on the profile and drives brand questions, so the queue
  // alone refreshing would leave the drug's own page disagreeing with it.
  revalidatePath('/admin/pairing');
  revalidatePath(`/drugs/${slug}`);
  revalidatePath(`/drugs/${slug}/edit`);
  return { ok: true };
}
