'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createDrug,
  setDosingUnique,
  setDrugBrands,
  setDrugField,
  setDrugIndications,
  setDrugTags,
  updateDrugIdentity,
  type IdentityInput,
  type Result,
} from '@/lib/drugs/mutations';
import { listFieldDefs } from '@/lib/fields/registry';
import { requireAdmin } from '@/lib/session';

// Each action re-checks the role: the page guard protects the render, not a
// direct POST to the action.

const text = (formData: FormData, name: string) => String(formData.get(name) ?? '');

function identity(formData: FormData): IdentityInput {
  return {
    genericName: text(formData, 'genericName'),
    drugClass: text(formData, 'drugClass'),
    schedule: text(formData, 'schedule'),
    scheduleNote: text(formData, 'scheduleNote'),
  };
}

/**
 * Saves the whole profile in one submission.
 *
 * Each part is written by its own function and reports its own refusal, and a
 * part that fails does not stop the others: a mistyped tag should not throw
 * away the paragraph of mechanism you just wrote. Whatever refused is
 * collected and shown, so nothing fails silently either.
 */
export async function saveDrugAction(formData: FormData): Promise<Result<string>> {
  const session = await requireAdmin();
  const actorId = session.user.id;
  const slug = text(formData, 'slug');
  if (!slug) return { ok: false, message: 'Which drug? The form lost its slug.' };

  const problems: string[] = [];
  const note = (result: Result) => { if (!result.ok) problems.push(result.message); };

  note(await updateDrugIdentity(slug, identity(formData), actorId));
  // Before the fields, so the dosing re-parse below sees the new answer to
  // "is this sig meant to be decodable?".
  note(await setDosingUnique(slug, formData.get('dosing_unique') !== null, actorId));
  note(await setDrugBrands(slug, text(formData, 'brands'), actorId));
  note(await setDrugIndications(slug, text(formData, 'indications'), actorId));
  note(await setDrugTags(slug, formData.getAll('tag').map(String), actorId));

  // Only the fields the form actually carried, so a field hidden by the
  // editor's own visibility preferences is left alone rather than blanked.
  for (const def of await listFieldDefs()) {
    if (def.isCore || !formData.has(`f_${def.key}`)) continue;
    note(await setDrugField(slug, def, {
      key: def.key,
      value: text(formData, `f_${def.key}`),
      source: text(formData, `src_${def.key}`),
      status: text(formData, `st_${def.key}`),
    }, actorId));
  }

  revalidatePath(`/drugs/${slug}`);
  revalidatePath(`/drugs/${slug}/edit`);
  revalidatePath('/drugs');

  if (problems.length > 0) return { ok: false, message: problems.join(' ') };
  return { ok: true, value: slug };
}

/** Creates the drug, then lands on its editor so the rest can be filled in. */
export async function createDrugAction(formData: FormData): Promise<Result<string>> {
  const session = await requireAdmin();

  const result = await createDrug({
    ...identity(formData),
    brands: text(formData, 'brands'),
    indications: text(formData, 'indications'),
    dosing: text(formData, 'dosing'),
    dosingUnique: formData.get('dosing_unique') !== null,
    tagSlugs: formData.getAll('tag').map(String),
  }, session.user.id);

  if (!result.ok) return result;

  revalidatePath('/drugs');
  redirect(`/drugs/${result.value}/edit?created=1`);
}
