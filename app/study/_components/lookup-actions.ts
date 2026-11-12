'use server';

import { requireUser } from '@/lib/session';
import { lookupDrug, searchDrugs, type LookupCard, type LookupHit } from '@/lib/study/lookup';

/**
 * The panel's two reads.
 *
 * Neither revalidates, and neither ever should. A study page is
 * `force-dynamic` and draws a random paper, so `revalidatePath` on one
 * re-renders a *different* paper underneath a session already in progress --
 * the bug behind the "0 of 83" quiz. Looking something up must not be able to
 * change what you are being asked.
 */
export async function searchDrugsAction(query: string): Promise<LookupHit[]> {
  await requireUser();
  return searchDrugs(query);
}

/**
 * @param scopeTags What the session is scoped to, so the panel reads the drug
 *   the way the card asked about it. Slugs only: the server resolves them into
 *   versions itself, exactly as the session did -- see `lookupDrug`.
 */
export async function lookupDrugAction(
  slug: string,
  scopeTags: string[] = [],
): Promise<LookupCard | null> {
  const session = await requireUser();
  return lookupDrug(slug, session.user.id, scopeTags);
}
