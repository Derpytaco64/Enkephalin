'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import { saveVariantLayer, type SaveResult } from '@/lib/drugs/variants';
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
    values[def.key] = String(raw);
  }

  const result = await saveVariantLayer({
    drugSlug,
    variantSlug,
    values,
    source: String(formData.get('source') ?? ''),
    note: String(formData.get('note') ?? ''),
    userId: session.user.id,
  });

  if (result.ok) {
    revalidatePath(`/drugs/${drugSlug}`);
    revalidatePath(`/drugs/${drugSlug}/variant/${variantSlug}`);
  }

  return result;
}
