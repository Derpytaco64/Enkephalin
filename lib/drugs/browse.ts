import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { drugBrands, drugIndications, drugTags, drugs, indications, tags } from '@/db/schema';
import { UNCATEGORIZED } from '@/lib/drugs/drug-class';
import { formatFieldValue } from '@/lib/fields/format';
import { listFieldDefs } from '@/lib/fields/registry';

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export type DrugIndexRow = {
  slug: string;
  generic: string;
  brands: string[];
  drugClass: string | null;
  schedule: string | null;
  tags: string[];
  indications: string[];
  /** Field keys with no value and no "none" meaning: genuine gaps. */
  missing: string[];
  /**
   * What a browse filter can usefully sort on now that nothing waits to be
   * verified: `flagged` is a value someone doubts, `gaps` is a field nobody has
   * filled in, and `ok` is neither.
   */
  review: 'flagged' | 'gaps' | 'ok';
  needsReview: boolean;
};

export type BrowseFacets = {
  classes: string[];
  indications: string[];
  schedules: string[];
  tags: { slug: string; label: string; kind: string }[];
  fields: { key: string; label: string }[];
};

/**
 * One payload for the whole browse page. A few hundred drugs is around 100 KB,
 * so search and filtering run in the browser with no round-trips, which is the
 * only way a filter rail feels instant.
 */
export async function getDrugIndex(): Promise<{ rows: DrugIndexRow[]; facets: BrowseFacets }> {
  const [drugRows, brandRows, indicationRows, tagRows, defs] = await Promise.all([
    db.select().from(drugs).orderBy(asc(drugs.genericName)),
    db.select({ drugId: drugBrands.drugId, name: drugBrands.name }).from(drugBrands).orderBy(asc(drugBrands.sortOrder)),
    db
      .select({ drugId: drugIndications.drugId, label: indications.label })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .orderBy(asc(drugIndications.sortOrder)),
    db
      .select({ drugId: drugTags.drugId, slug: tags.slug, label: tags.label, kind: tags.kind })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId)),
    listFieldDefs(),
  ]);

  const brandsByDrug = new Map<string, string[]>();
  for (const brand of brandRows) {
    const list = brandsByDrug.get(brand.drugId);
    if (list) list.push(brand.name);
    else brandsByDrug.set(brand.drugId, [brand.name]);
  }

  const indicationsByDrug = new Map<string, string[]>();
  for (const indication of indicationRows) {
    const list = indicationsByDrug.get(indication.drugId);
    if (list) list.push(indication.label);
    else indicationsByDrug.set(indication.drugId, [indication.label]);
  }

  const tagsByDrug = new Map<string, string[]>();
  for (const tag of tagRows) {
    const list = tagsByDrug.get(tag.drugId);
    if (list) list.push(tag.slug);
    else tagsByDrug.set(tag.drugId, [tag.slug]);
  }

  // Core fields live in their own columns, so only the stored ones can be
  // missing or flagged.
  const storedDefs = defs.filter((def) => !def.isCore);

  const rows: DrugIndexRow[] = drugRows.map((drug) => {
    const missing: string[] = [];
    let flagged = false;

    for (const def of storedDefs) {
      const value = drug.fields[def.key];
      const formatted = formatFieldValue(def, value);

      if (formatted.kind === 'missing') {
        missing.push(def.key);
        continue;
      }
      if (value?.status === 'flagged') flagged = true;
    }

    return {
      slug: drug.slug,
      generic: drug.genericName,
      brands: brandsByDrug.get(drug.id) ?? [],
      drugClass: drug.drugClass,
      schedule: drug.schedule,
      tags: tagsByDrug.get(drug.id) ?? [],
      indications: indicationsByDrug.get(drug.id) ?? [],
      missing,
      // Flagged outranks a gap: a wrong answer in a deck costs more than a
      // missing one, which simply produces no card.
      review: flagged ? 'flagged' : missing.length > 0 ? 'gaps' : 'ok',
      needsReview: drug.needsClassReview || drug.needsPairingReview,
    };
  });

  const facetTags = new Map<string, { slug: string; label: string; kind: string }>();
  for (const tag of tagRows) facetTags.set(tag.slug, { slug: tag.slug, label: tag.label, kind: tag.kind });

  return {
    rows,
    facets: {
      // localeCompare, not the default sort: that one is ASCII, so
      // "beta2-Adrenergic Agonist" would land after "Xanthine Oxidase
      // Inhibitor" purely for being lower-case.
      // Uncategorized rides at the end rather than being sorted into the Us:
      // it is the absence of a class, not a class beginning with U.
      classes: [
        ...[...new Set(rows.map((r) => r.drugClass).filter((c): c is string => Boolean(c)))].sort(byName),
        ...(rows.some((r) => !r.drugClass) ? [UNCATEGORIZED] : []),
      ],
      indications: [...new Set(rows.flatMap((r) => r.indications))].sort(byName),
      schedules: [...new Set(rows.map((r) => r.schedule).filter((s): s is string => Boolean(s)))].sort(byName),
      tags: [...facetTags.values()].sort((a, b) => byName(a.label, b.label)),
      fields: storedDefs.map((def) => ({ key: def.key, label: def.label })),
    },
  };
}
