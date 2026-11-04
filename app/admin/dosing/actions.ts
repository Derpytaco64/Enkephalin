'use server';

import { revalidatePath } from 'next/cache';
import { rebuildRegimens, setDosingUnique, setDrugField, type Result } from '@/lib/drugs/mutations';
import { listFieldDefs } from '@/lib/fields/registry';
import { requireAdmin } from '@/lib/session';

// Each action re-checks the role: the layout guard protects the render, not a
// direct POST to the action.

/**
 * Saves rewritten dosing prose and re-reads it.
 *
 * Deliberately the same two calls the drug editor makes, in the same order:
 * the field, then the regimens. The bench is a *view* of the review queue and
 * must not become a second way for dosing to reach the database -- there is
 * one parser, one writer, and one audit trail whichever screen you came from.
 */
export async function saveDosingAction(formData: FormData): Promise<Result> {
  const session = await requireAdmin();

  const slug = String(formData.get('slug') ?? '');
  if (!slug) return { ok: false, message: 'Which drug? The form lost its slug.' };

  const prose = String(formData.get('dosing') ?? '');
  const defs = await listFieldDefs();
  const dosing = defs.find((def) => def.key === 'dosing');
  if (!dosing) return { ok: false, message: 'There is no dosing field defined.' };

  const written = await setDrugField(
    slug,
    dosing,
    { key: 'dosing', value: prose, source: String(formData.get('source') ?? ''), status: '' },
    session.user.id,
  );
  if (!written.ok) return written;

  const drugId = String(formData.get('drugId') ?? '');
  const generic = String(formData.get('generic') ?? '');
  if (!drugId || !generic) return { ok: false, message: 'The form lost the drug it was editing.' };

  await rebuildRegimens(drugId, generic, prose.trim() || null, session.user.id);

  applied(slug);
  return { ok: true };
}

/**
 * "The source really is like that."
 *
 * Not the same as fixing it, and the queue shows it differently: the row keeps
 * its wording and stays free recall only, but it stops counting as work
 * nobody has done. "Nobody has looked at this" and "somebody looked and this
 * is the answer" are different states that otherwise look identical.
 */
export async function markUniqueAction(formData: FormData): Promise<Result> {
  const session = await requireAdmin();

  const slug = String(formData.get('slug') ?? '');
  if (!slug) return { ok: false, message: 'Which drug? The form lost its slug.' };

  const result = await setDosingUnique(slug, formData.get('unique') !== null, session.user.id);
  if (result.ok) applied(slug);
  return result;
}

/**
 * The queue, the drug's own pages, and the browse list -- the dosing shows on
 * all three, so a save that only refreshed the bench would leave two screens
 * disagreeing with it.
 */
function applied(slug: string) {
  revalidatePath('/admin/dosing');
  revalidatePath(`/drugs/${slug}`);
  revalidatePath(`/drugs/${slug}/edit`);
  revalidatePath('/drugs');
}
