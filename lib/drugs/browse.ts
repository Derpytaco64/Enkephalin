import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { drugBrands, drugTags, drugs, tags } from '@/db/schema';
import { formatFieldValue } from '@/lib/fields/format';
import { listFieldDefs } from '@/lib/fields/registry';

export type DrugIndexRow = {
  slug: string;
  generic: string;
  brands: string[];
  drugClass: string | null;
  schedule: string | null;
  tags: string[];
  /** Field keys with no value and no "none" meaning: genuine gaps. */
  missing: string[];
  verification: 'verified' | 'flagged' | 'partial' | 'unverified';
  needsReview: boolean;
};

export type BrowseFacets = {
  classes: string[];
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
  const [drugRows, brandRows, tagRows, defs] = await Promise.all([
    db.select().from(drugs).orderBy(asc(drugs.genericName)),
    db.select({ drugId: drugBrands.drugId, name: drugBrands.name }).from(drugBrands).orderBy(asc(drugBrands.sortOrder)),
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

  const tagsByDrug = new Map<string, string[]>();
  for (const tag of tagRows) {
    const list = tagsByDrug.get(tag.drugId);
    if (list) list.push(tag.slug);
    else tagsByDrug.set(tag.drugId, [tag.slug]);
  }

  // Core fields live in their own columns, so only the stored ones can be
  // missing or unverified.
  const storedDefs = defs.filter((def) => !def.isCore);

  const rows: DrugIndexRow[] = drugRows.map((drug) => {
    const missing: string[] = [];
    let flagged = false;
    let unverified = false;
    let verified = 0;
    let considered = 0;

    for (const def of storedDefs) {
      const value = drug.fields[def.key];
      const formatted = formatFieldValue(def, value);

      if (formatted.kind === 'missing') {
        missing.push(def.key);
        unverified = true;
        continue;
      }
      if (formatted.kind === 'none') continue;

      considered += 1;
      if (value?.status === 'flagged') flagged = true;
      else if (value?.status === 'verified') verified += 1;
      else unverified = true;
    }

    return {
      slug: drug.slug,
      generic: drug.genericName,
      brands: brandsByDrug.get(drug.id) ?? [],
      drugClass: drug.drugClass,
      schedule: drug.schedule,
      tags: tagsByDrug.get(drug.id) ?? [],
      missing,
      verification: flagged
        ? 'flagged'
        : considered > 0 && verified === considered && !unverified
          ? 'verified'
          : verified > 0
            ? 'partial'
            : 'unverified',
      needsReview: drug.needsClassReview || drug.needsPairingReview,
    };
  });

  const facetTags = new Map<string, { slug: string; label: string; kind: string }>();
  for (const tag of tagRows) facetTags.set(tag.slug, { slug: tag.slug, label: tag.label, kind: tag.kind });

  return {
    rows,
    facets: {
      classes: [...new Set(rows.map((r) => r.drugClass).filter((c): c is string => Boolean(c)))].sort(),
      schedules: [...new Set(rows.map((r) => r.schedule).filter((s): s is string => Boolean(s)))].sort(),
      tags: [...facetTags.values()].sort((a, b) => a.label.localeCompare(b.label)),
      fields: storedDefs.map((def) => ({ key: def.key, label: def.label })),
    },
  };
}
