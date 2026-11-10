'use server';

import { revalidatePath } from 'next/cache';
import { deleteDrug } from '@/lib/drugs/merge';
import { clearVariantLayer } from '@/lib/drugs/variants';
import { requireAdmin } from '@/lib/session';

export type RemoveReport = {
  drugs: string[];
  layers: string[];
  /** Checked layers skipped because their drug was going anyway. */
  withTheDrug: number;
  /**
   * `"<drugSlug>:<tagSlug>"` for every class or exam membership that went out
   * with a version -- its own, and any other scope the same lecture pointed at
   * it. Reported because it is a deletion the person did not tick, and a
   * screen that quietly untags twenty-four drugs is one nobody can trust.
   */
  untagged: string[];
  problems: string[];
};

export type RemoveState =
  | { kind: 'idle' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; report: RemoveReport };

/**
 * Deletes what was ticked, and nothing it was not told to.
 *
 * Two kinds of thing on one list, because a bad import leaves two kinds of
 * mess: drugs that should never have been created, and a version's wording
 * written over a drug that was fine. Deleting the drug takes its versions with
 * it; deleting a version takes the class and exam tags that arrived with it,
 * and leaves the drug, its lists and its other versions alone.
 *
 * The typed confirmation is the `/admin/data` restore screen's, for the same
 * reason -- a mis-click must not be able to empty the database -- and this
 * screen can delete more in one press than that one can.
 */
export async function removeAction(formData: FormData): Promise<RemoveState> {
  const session = await requireAdmin();

  if (String(formData.get('confirm') ?? '').trim().toUpperCase() !== 'DELETE') {
    return { kind: 'error', message: 'Type DELETE to confirm. Nothing was removed.' };
  }

  const drugSlugs = [...new Set(formData.getAll('drug').map(String).filter(Boolean))];
  // "<drugSlug>:<variantSlug>" -- a layer is identified by both, since one
  // class words many drugs and one drug is worded by many classes.
  const layerKeys = [...new Set(formData.getAll('layer').map(String).filter(Boolean))];

  if (drugSlugs.length === 0 && layerKeys.length === 0) {
    return { kind: 'error', message: 'Nothing was ticked.' };
  }

  const report: RemoveReport = {
    drugs: [], layers: [], withTheDrug: 0, untagged: [], problems: [],
  };
  const going = new Set(drugSlugs);

  // Layers first, and only the ones whose drug survives: deleting the drug
  // takes its layers with it, so clearing one of those is a write that races
  // its own cascade for no reason.
  for (const key of layerKeys) {
    const at = key.indexOf(':');
    if (at < 1) continue;
    const drugSlug = key.slice(0, at);
    const variantSlug = key.slice(at + 1);
    if (going.has(drugSlug)) {
      report.withTheDrug += 1;
      continue;
    }
    const result = await clearVariantLayer({ drugSlug, variantSlug });
    if (result.ok) {
      report.layers.push(key);
      // The class and exam tags the version took with it -- see
      // `clearVariantLayer`, which decides which memberships those are.
      for (const slug of result.untagged) report.untagged.push(`${drugSlug}:${slug}`);
    } else report.problems.push(`${key}: ${result.message}`);
  }

  for (const slug of drugSlugs) {
    const result = await deleteDrug(slug, session.user.id);
    if (result.ok) report.drugs.push(slug);
    else report.problems.push(`${slug}: ${result.message}`);
  }

  revalidatePath('/drugs');
  revalidatePath('/admin/remove');
  // Memberships changed, so the tag screens' counts did too.
  revalidatePath('/admin/tags');
  for (const slug of report.layers.map((key) => key.slice(0, key.indexOf(':')))) {
    revalidatePath(`/drugs/${slug}`);
  }

  return { kind: 'done', report };
}
