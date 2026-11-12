/**
 * Looking a drug up without leaving the session.
 *
 * Searched on the server rather than by shipping the index: `/drugs` sends all
 * 236 rows and searches them in the browser, which is right for a page whose
 * whole job is the list, but a study page is already carrying a paper or a
 * deck and a lookup is an occasional act.
 *
 * Reads only. Nothing here revalidates anything -- a study page is
 * `force-dynamic` and randomised, so revalidating it mid-session re-rolls the
 * paper under the person sitting in front of it. That mistake cost a whole
 * debugging session once; see *A capped quiz asks what you got wrong first* in
 * PLAN.md.
 */
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { drugBrands, drugs } from '@/db/schema';
import { getDrugProfile } from '@/lib/drugs/profile';
import {
  baseVariantOf,
  membershipVariants,
  overlayFields,
  variantLayersForDrug,
  variantOptionsFor,
  variantSlugsAmong,
  wordedBy,
} from '@/lib/drugs/variants';
import { emptyLabel, formatFieldValue, type FormattedField } from '@/lib/fields/format';
import { groupFieldDefs, type FieldDef } from '@/lib/fields/registry';
import type { FieldValue } from '@/db/schema';
import type { CardVariant } from './cards';

export type LookupHit = {
  slug: string;
  generic: string;
  drugClass: string | null;
  schedule: string | null;
  /** The brand that matched, when the match was on a brand rather than the name. */
  matchedBrand: string | null;
};

export type LookupField = {
  key: string;
  label: string;
  group: string;
  lines: string[];
  /**
   * Whose wording this line is, where it is somebody's -- the same
   * `{ n, label, slug }` a card's pill carries, so the panel and the card
   * name a version identically or not at all.
   */
  version: CardVariant | null;
};

export type LookupCard = {
  slug: string;
  generic: string;
  drugClass: string | null;
  schedule: string | null;
  brands: string[];
  indications: string[];
  groups: { group: string; fields: LookupField[] }[];
  /**
   * The versions this panel is reading, lowest number first -- so V-1 and
   * whose it is leads, and any class that worded a field its own way follows.
   *
   * Only the ones that actually supplied something on screen: a class in scope
   * that has said nothing about this drug is not a version of it, and a pill
   * for it would be a claim about wording that is not there.
   */
  versions: CardVariant[];
};

const MAX_HITS = 8;

/**
 * The same words the profile page shows, as flat lines.
 *
 * Flat because the panel is a reminder, not a second profile: one list of
 * lines per field reads at a glance and survives a 400px-wide overlay, where
 * the page's paragraphs and markers would not.
 */
function linesOf(formatted: FormattedField, def: FieldDef): string[] {
  switch (formatted.kind) {
    case 'list': return formatted.items;
    case 'markdown': return formatted.paragraphs;
    case 'text': return [formatted.text];
    case 'enum': return [formatted.option];
    case 'number': return [formatted.text];
    case 'bool': return [formatted.value ? 'Yes' : 'No'];
    case 'none':
    case 'missing': return [emptyLabel(formatted.kind, def)];
  }
}

/**
 * Name first, brands second, both as "contains".
 *
 * Deliberately not the fuzzy search `/drugs` uses: you reach for this knowing
 * what you want to look up -- the drug the question just named -- so a prefix
 * of the real name finding it is enough, and a fuzzy match that confidently
 * returns the wrong drug mid-session is worse than no match.
 */
export async function searchDrugs(query: string, limit = MAX_HITS): Promise<LookupHit[]> {
  const needle = query.trim();
  if (needle.length < 2) return [];

  const pattern = `%${needle.replace(/[%_]/g, (char) => `\${char}`)}%`;

  const rows = await db
    .selectDistinctOn([drugs.genericName], {
      slug: drugs.slug,
      generic: drugs.genericName,
      drugClass: drugs.drugClass,
      schedule: drugs.schedule,
      brand: drugBrands.name,
      nameHit: sql<boolean>`${drugs.genericName} ilike ${pattern}`,
    })
    .from(drugs)
    .leftJoin(
      drugBrands,
      and(eq(drugBrands.drugId, drugs.id), ilike(drugBrands.name, pattern)),
    )
    .where(or(ilike(drugs.genericName, pattern), ilike(drugBrands.name, pattern)))
    .orderBy(asc(drugs.genericName))
    .limit(limit);

  return rows.map((row) => ({
    slug: row.slug,
    generic: row.generic,
    drugClass: row.drugClass,
    schedule: row.schedule,
    matchedBrand: row.nameHit ? null : row.brand,
  }));
}

/**
 * Everything the panel shows about one drug, formatted as the profile does it
 * and **read as the session is reading it**.
 *
 * @param scopeTags The session's list and exam slugs -- `config.scope.tags`,
 *   passed through from the runner.
 *
 * The panel used to show the drug's own profile whatever was being studied,
 * which made it quietly wrong in exactly the situation the variant feature
 * exists for: a card asks what PHRM 535 says the mechanism is, you flip it,
 * you open the drug to check, and the panel shows the drug's own mechanism
 * with nothing saying the two are different sentences.
 *
 * So it takes the same two inputs the session took -- `variantSlugsAmong` for
 * what the scope names and `membershipVariants` for what each list says a drug
 * is read as -- applies them in the same order, and names the result. Same
 * functions, not the same values re-sent from the browser: a panel that
 * believed what the page told it would be a profile anybody could ask for any
 * version of.
 */
export async function lookupDrug(
  slug: string,
  userId?: string,
  scopeTags: string[] = [],
): Promise<LookupCard | null> {
  const profile = await getDrugProfile(slug, userId);
  if (profile === null) return null;

  const { drug, brands, indications, defs } = profile;

  const [scopeVariants, byMembership, base, options, stored] = await Promise.all([
    variantSlugsAmong(scopeTags),
    membershipVariants(scopeTags),
    baseVariantOf(drug.id),
    variantOptionsFor(drug.id),
    variantLayersForDrug(drug.id),
  ]);

  // The numbers a reader has already seen: the picker's, the browse badge's
  // and the card's. A class with nothing of its own is not in here and gets no
  // pill, which is the rule everywhere else.
  const numbered = new Map(
    options
      .filter((option): option is typeof option & { n: number } => option.n !== null)
      .map((option) => [option.slug, { n: option.n, label: option.label, slug: option.slug }]),
  );

  // The standing choice a list makes first, the deliberate one the scope makes
  // last -- `loadCardSources` orders them that way and the panel must not
  // reorder them, or it would show the losing value as the winning one.
  const layers = [...(byMembership.get(drug.id) ?? []), ...scopeVariants].map((tag) => ({
    fields: stored.get(tag) ?? {},
    variant: numbered.get(tag) ?? null,
  }));

  const fields = overlayFields(drug.fields, ...layers.map((layer) => layer.fields));
  const authors = wordedBy(drug.fields, base, layers);

  // Core fields live in their own columns; the rest come out of the JSONB.
  // Identity is not repeated as a field row -- the card's heading is already
  // the generic name, the class and the schedule.
  const core: Record<string, string | null> = {
    generic: drug.genericName,
    drug_class: drug.drugClass,
    controlled: drug.schedule,
    brand: brands.map((brand) => brand.name).join('\n'),
    indication: indications.join('\n'),
  };
  const SKIP = new Set(['generic', 'drug_class', 'controlled', 'brand', 'indication']);

  const groups = groupFieldDefs(defs).map(([group, groupDefs]) => ({
    group,
    fields: groupDefs
      .filter((def) => !SKIP.has(def.key))
      .map((def): LookupField => {
        const value: FieldValue | undefined = def.isCore
          ? {
              value: core[def.key] ?? null,
              status: 'ok',
              source: 'class sheet',
              updatedAt: drug.updatedAt.toISOString(),
              updatedBy: null,
            }
          : fields[def.key];

        return {
          key: def.key,
          label: def.label,
          group,
          lines: linesOf(formatFieldValue(def, value), def),
          version: authors[def.key] ?? null,
        };
      }),
  })).filter((entry) => entry.fields.length > 0);

  return {
    slug: drug.slug,
    generic: drug.genericName,
    drugClass: drug.drugClass,
    schedule: drug.schedule,
    brands: brands.map((brand) => brand.name),
    indications,
    groups,
    // Deduplicated by slug and ordered by number, which puts V-1 first without
    // having to say so: the base is 1 and a layer is 2 or more.
    versions: [...new Map(Object.values(authors).map((v) => [v.slug, v])).values()]
      .sort((a, b) => a.n - b.n),
  };
}
