/**
 * Every drug as the card and question builders want it: core fields folded in
 * beside the stored ones, tags and indications already slugged.
 *
 * Shared by flashcards and the quiz on purpose. Two loaders would be two
 * answers to "what is in scope", and the two modes are meant to disagree about
 * nothing.
 */
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  dosingRegimens,
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  indications,
  tags,
  type FieldValue,
} from '@/db/schema';
import { toSig } from '@/lib/dosing/sig';
import type { CardSource } from './cards';

/**
 * Core fields wrapped in the same envelope as the stored ones, so the card
 * builder treats every field alike. Their provenance is the sheet.
 */
function sheetValue(value: string | null): FieldValue {
  return { value, status: 'ok', source: 'class sheet', updatedAt: '', updatedBy: null };
}

export async function loadCardSources(): Promise<CardSource[]> {
  const [drugRows, brandRows, indicationRows, tagRows, regimenRows] = await Promise.all([
    db.select().from(drugs).orderBy(asc(drugs.genericName)),
    db
      .select({ drugId: drugBrands.drugId, name: drugBrands.name })
      .from(drugBrands)
      .orderBy(asc(drugBrands.sortOrder)),
    db
      .select({
        // The link row's own id, because a dosing row points at the link and
        // not at the shared vocabulary -- a dose belongs to "this drug, for
        // this condition", which is what a link row is.
        linkId: drugIndications.id,
        drugId: drugIndications.drugId,
        slug: indications.slug,
        label: indications.label,
      })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .orderBy(asc(drugIndications.sortOrder)),
    db
      .select({ drugId: drugTags.drugId, slug: tags.slug })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId)),
    db
      .select().from(dosingRegimens)
      .orderBy(asc(dosingRegimens.alternative), asc(dosingRegimens.step)),
  ]);

  const indicationLabelByLink = new Map(indicationRows.map((row) => [row.linkId, row.label]));

  // One comparable key per drug: every regimen printed as sig and joined. Null
  // the moment a row has no components, because half a reading compares to
  // nothing -- such a drug falls back to being compared by its wording, which
  // is all it ever had.
  //
  // Rows carrying an indication are held out of it and gathered per branch
  // below. Folding them in would be the original bug in a new place: one
  // string holding two different doses, with nothing saying which is which.
  const sigByDrug = new Map<string, string | null>();
  for (const regimen of regimenRows) {
    if (regimen.indicationId !== null) continue;
    if (sigByDrug.get(regimen.drugId) === null) continue;
    const sig = regimen.amounts.length > 0 ? toSig(regimen) : '';
    if (!sig) {
      sigByDrug.set(regimen.drugId, null);
      continue;
    }
    const current = sigByDrug.get(regimen.drugId);
    sigByDrug.set(regimen.drugId, current ? `${current} | ${sig}` : sig);
  }

  /**
   * The indication-scoped rows, gathered per drug and per branch.
   *
   * A branch's sig goes null on the same rule as a drug's -- one unreadable
   * row and the branch is compared by its wording -- and the text is the slice
   * of prose the branch was read from, which is what the editor typed and what
   * a reader should see.
   */
  const branchesByDrug = new Map<string, Map<string, { label: string; text: string; sig: string | null }>>();
  for (const regimen of regimenRows) {
    if (regimen.indicationId === null) continue;
    const label = indicationLabelByLink.get(regimen.indicationId);
    // A link row deleted under us: the dose is still the drug's, it just has
    // no branch to hang off any more.
    if (label === undefined) continue;

    const branches = branchesByDrug.get(regimen.drugId) ?? new Map();
    branchesByDrug.set(regimen.drugId, branches);

    const sig = regimen.amounts.length > 0 ? toSig(regimen) : null;
    const held = branches.get(regimen.indicationId);
    if (held === undefined) {
      branches.set(regimen.indicationId, { label, text: regimen.sourceText, sig });
      continue;
    }
    branches.set(regimen.indicationId, {
      label,
      text: `${held.text} | ${regimen.sourceText}`,
      sig: held.sig === null || sig === null ? null : `${held.sig} | ${sig}`,
    });
  }

  const group = <T, K extends keyof T>(rows: T[], pick: K) => {
    const map = new Map<string, T[K][]>();
    for (const row of rows) {
      const id = (row as unknown as { drugId: string }).drugId;
      const list = map.get(id);
      if (list) list.push(row[pick]);
      else map.set(id, [row[pick]]);
    }
    return map;
  };

  const brandsByDrug = group(brandRows, 'name');
  const indicationsByDrug = group(indicationRows, 'label');
  const indicationSlugsByDrug = group(indicationRows, 'slug');
  const tagsByDrug = group(tagRows, 'slug');

  return drugRows.map((drug) => {
    const brands = brandsByDrug.get(drug.id) ?? [];
    const indicationLabels = indicationsByDrug.get(drug.id) ?? [];
    const routeValue = drug.fields.route?.value ?? '';

    return {
      drugId: drug.id,
      slug: drug.slug,
      generic: drug.genericName,
      drugClass: drug.drugClass,
      schedule: drug.schedule,
      routes: routeValue ? routeValue.split('\n').map((route) => route.trim()).filter(Boolean) : [],
      tags: tagsByDrug.get(drug.id) ?? [],
      // The stored slug, which is the same row the picker listed -- so the
      // scope a link carries and the drugs it selects cannot drift apart.
      indications: [...new Set(indicationSlugsByDrug.get(drug.id) ?? [])],
      dosingSig: sigByDrug.get(drug.id) ?? null,
      dosingBranches: [...(branchesByDrug.get(drug.id)?.values() ?? [])],
      needsPairingReview: drug.needsPairingReview,
      values: {
        ...drug.fields,
        generic: sheetValue(drug.genericName),
        brand: sheetValue(brands.join('\n') || null),
        indication: sheetValue(indicationLabels.join('\n') || null),
        drug_class: sheetValue(drug.drugClass),
        // Not controlled is an answer, not a gap -- 213 of the 236 are not --
        // so it is recorded as "none" and the card asks the question honestly.
        controlled: drug.schedule
          ? sheetValue(drug.schedule)
          : { value: null, status: 'none', source: 'class sheet', updatedAt: '', updatedBy: null },
      },
    };
  });
}

