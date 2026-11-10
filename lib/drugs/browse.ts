import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  drugBrands, drugIndications, drugTags, drugVariantValues, drugs, indications, tags,
} from '@/db/schema';
import { UNCATEGORIZED } from '@/lib/drugs/drug-class';
import { formatFieldValue, splitList, type FormattedField } from '@/lib/fields/format';
import { listFieldDefs } from '@/lib/fields/registry';

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * One line of searchable text for a value, whatever shape it is.
 *
 * `none` and `missing` deliberately produce nothing: neither is text somebody
 * typed, and a drug with no black box warning must not be a hit for "none".
 * Lists join with `; ` and markdown with a space, because the only reader is a
 * substring search -- the profile keeps the shape, see `lib/fields/prose.ts`.
 */
function flatten(formatted: FormattedField): string {
  switch (formatted.kind) {
    case 'none':
    case 'missing':
      return '';
    case 'list':
      return formatted.items.join('; ');
    case 'markdown':
      return formatted.paragraphs.join(' ');
    case 'enum':
      return formatted.option;
    case 'bool':
      return formatted.value ? 'yes' : 'no';
    default:
      return formatted.text;
  }
}

export type DrugIndexRow = {
  slug: string;
  generic: string;
  brands: string[];
  drugClass: string | null;
  schedule: string | null;
  tags: string[];
  indications: string[];
  /**
   * Every stored field this drug has a value for, flattened to one line of
   * text, keyed by field key.
   *
   * This is what makes one search box able to find a drug by *anything* -- a
   * mechanism, a warning, a regimen name, a route -- rather than only by its
   * name and its brands. It is also the bulk of the payload: around 500
   * characters a drug, so roughly 120 KB over 236 of them, which is the price
   * of search that needs no round trip. Flattened rather than structured
   * because searching does not care about paragraphs, and a `Record` rather
   * than a single blob because the rail reports *which* field matched.
   */
  values: Record<string, string>;
  /** Field keys with no value and no "none" meaning: genuine gaps. */
  missing: string[];
  /**
   * How many alternate profiles this drug has: the **V-3** pill on its row.
   *
   * The count rather than the layers themselves, because the list is a list --
   * 236 rows holding every class's wording for every field would be a payload
   * several times over, and the question a row can usefully answer is "is
   * there another version of this?". The versions themselves are one click
   * away, in the dropdown on the profile.
   *
   * Counted from `drug_variant_values`, so a drug merely *tagged* with a class
   * does not count: a layer that says nothing of its own is not another
   * version of anything.
   */
  variants: number;
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
  /** Routes, split out of the `route` field's own values. */
  routes: string[];
  tags: { slug: string; label: string; kind: string }[];
  fields: { key: string; label: string }[];
};

/**
 * One payload for the whole browse page. A few hundred drugs is around 100 KB,
 * so search and filtering run in the browser with no round-trips, which is the
 * only way a filter rail feels instant.
 */
export async function getDrugIndex(): Promise<{ rows: DrugIndexRow[]; facets: BrowseFacets }> {
  const [drugRows, brandRows, indicationRows, tagRows, defs, variantRows] = await Promise.all([
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
    // One row per layer, not per value: `count` would need a group-by and this
    // table is small -- one row per drug per class that says anything.
    db.select({ drugId: drugVariantValues.drugId }).from(drugVariantValues),
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

  const variantsByDrug = new Map<string, number>();
  for (const row of variantRows) {
    variantsByDrug.set(row.drugId, (variantsByDrug.get(row.drugId) ?? 0) + 1);
  }

  // Core fields live in their own columns, so only the stored ones can be
  // missing or flagged.
  const storedDefs = defs.filter((def) => !def.isCore);

  const rows: DrugIndexRow[] = drugRows.map((drug) => {
    const missing: string[] = [];
    const values: Record<string, string> = {};
    let flagged = false;

    for (const def of storedDefs) {
      const value = drug.fields[def.key];
      const formatted = formatFieldValue(def, value);

      if (formatted.kind === 'missing') {
        missing.push(def.key);
        continue;
      }
      if (value?.status === 'flagged') flagged = true;
      // `none` carries no text to search, and searching for the word "none"
      // should not find every drug without a black box warning -- the *Still
      // blank* filter is the way to ask that question.
      const text = flatten(formatted);
      if (text) values[def.key] = text;
    }

    return {
      slug: drug.slug,
      generic: drug.genericName,
      brands: brandsByDrug.get(drug.id) ?? [],
      drugClass: drug.drugClass,
      schedule: drug.schedule,
      tags: tagsByDrug.get(drug.id) ?? [],
      indications: indicationsByDrug.get(drug.id) ?? [],
      values,
      missing,
      variants: variantsByDrug.get(drug.id) ?? 0,
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
      // Out of the field's own values rather than a column: route is a list
      // field, so "PO; IV" on one drug is two options for the rail.
      routes: [...new Set(
        rows.flatMap((r) => splitList(r.values.route ?? '')),
      )].sort(byName),
      tags: [...facetTags.values()].sort((a, b) => byName(a.label, b.label)),
      fields: storedDefs.map((def) => ({ key: def.key, label: def.label })),
    },
  };
}
