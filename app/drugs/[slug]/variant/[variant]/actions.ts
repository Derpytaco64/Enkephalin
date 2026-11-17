'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import { setDrugIndications } from '@/lib/drugs/mutations';
import { saveVariantLayer, type SaveResult } from '@/lib/drugs/variants';
import { normalizeNewlines } from '@/lib/fields/format';
import { listFieldDefs } from '@/lib/fields/registry';

export type VariantState = SaveResult;

/**
 * Saves one class's or exam's version of one drug.
 *
 * **Read from the field registry rather than from the form's key list**, which
 * is the one thing worth being careful about here: a form that posted its own
 * list of keys could be made to write any key at all, and `drugs.fields` is a
 * jsonb map that would accept it. So the keys come from `field_defs`, the form
 * supplies values for them, and anything else in the payload is ignored.
 *
 * Every field is sent on every save, blank ones included -- that is how an
 * override is cleared, and `saveVariantLayer` reads an empty box as *this class
 * says what the drug says*.
 *
 * Two writes, because a version's wording lives in two tables: the fields in
 * `drug_variant_values`, and what it teaches the drug is for in
 * `drug_indications`, which names a version since migration 0018.
 */
export async function saveVariantLayerAction(formData: FormData): Promise<VariantState> {
  const session = await requireAdmin();

  const drugSlug = String(formData.get('slug') ?? '').trim();
  const variantSlug = String(formData.get('variant') ?? '').trim();
  if (!drugSlug || !variantSlug) return { ok: false, message: 'Which drug, and which version?' };

  const defs = await listFieldDefs();
  const values: Record<string, string> = {};
  for (const def of defs) {
    if (def.isCore) continue;
    const raw = formData.get(`field_${def.key}`);
    // Absent is not empty: a field the form did not render must not be read as
    // an instruction to clear this version's value for it.
    if (raw === null) continue;
    // A textarea submits CRLF, which the markdown parser cannot read -- see
    // `normalizeNewlines`. Normalised here rather than deeper in, so what is
    // stored is what the importer would have stored.
    values[def.key] = normalizeNewlines(String(raw));
  }

  const result = await saveVariantLayer({
    drugSlug,
    variantSlug,
    values,
    source: String(formData.get('source') ?? ''),
    note: String(formData.get('note') ?? ''),
    userId: session.user.id,
  });

  /*
   * And what this version teaches the drug is **for**, which is a core field
   * and so not in the loop above: it lives in `drug_indications` rather than
   * in the layer's jsonb, and since migration 0018 those rows name a version.
   *
   * Written after the layer and only if the layer saved, so a refused save
   * leaves both halves untouched. An empty box clears this version's list and
   * the profile falls through to the drug's own, which is the same sentence an
   * empty field box makes.
   */
  if (result.ok && formData.get('indications') !== null) {
    const indications = await setDrugIndications(
      drugSlug,
      normalizeNewlines(String(formData.get('indications'))),
      session.user.id,
      variantSlug,
    );
    if (!indications.ok) return { ok: false, message: indications.message };
  }

  if (result.ok) {
    revalidatePath(`/drugs/${drugSlug}`);
    revalidatePath(`/drugs/${drugSlug}/variant/${variantSlug}`);
  }

  return result;
}
