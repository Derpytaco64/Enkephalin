import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import { db } from '@/db';
import {
  brandIndications,
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  indications,
  tags,
  userPreferences,
} from '@/db/schema';
import { listFieldDefs } from '@/lib/fields/registry';
import { ALL_VARIANTS } from './variant-kinds';
import {
  overlayFields, overriddenKeys, variantLayerFor, variantLayersForDrug, variantOptionsFor,
} from './variants';

export type ProfileBrand = {
  id: string;
  name: string;
  family: string;
  route: string | null;
  dosingOverride: string | null;
  note: string | null;
  defaultPairingSuspect: boolean;
  suspectReason: string | null;
  /** Empty means it covers all of the drug's indications. */
  indications: string[];
};

/**
 * One drug, as a page wants it -- optionally **as one class or exam
 * teaches it**.
 *
 * `variantSlug` picks that version of the profile: its values where it has
 * them, the drug's everywhere else. The overlay happens here rather than in the
 * page so that every reader of a profile sees the same thing, and so the page's
 * *from X* provenance line needs no special case -- an overridden value carries
 * the variant's own `source`, which is what a reader needs to know about it.
 *
 * A variant the drug is not tagged with reads as no variant at all: `variant`
 * comes back null and the base profile is returned. That keeps the picker on
 * the page in agreement with the tag filter in the browser, which both read
 * `drug_tags`.
 */
export async function getDrugProfile(slug: string, userId?: string, variantSlug?: string) {
  const [drug] = await db.select().from(drugs).where(eq(drugs.slug, slug));
  if (!drug) return null;

  const [brandRows, indicationRows, linkRows, tagRows, defs, prefs, siblings] = await Promise.all([
    db.select().from(drugBrands).where(eq(drugBrands.drugId, drug.id)).orderBy(asc(drugBrands.sortOrder)),
    db
      .select({ slug: indications.slug, label: indications.label })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .where(eq(drugIndications.drugId, drug.id))
      .orderBy(asc(drugIndications.sortOrder)),
    // `brand_indications` hangs off the link row, not the vocabulary, so a
    // brand is paired to this drug's indication rather than to the word in the
    // abstract -- which is what keeps the pairing meaningful when two drugs
    // share an indication.
    db
      .select({ brandId: brandIndications.brandId, label: indications.label })
      .from(brandIndications)
      .innerJoin(drugIndications, eq(drugIndications.id, brandIndications.indicationId))
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .where(eq(drugIndications.drugId, drug.id)),
    db
      .select({ slug: tags.slug, label: tags.label, kind: tags.kind })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId))
      .where(eq(drugTags.drugId, drug.id)),
    listFieldDefs(),
    userId
      ? db.select().from(userPreferences).where(eq(userPreferences.userId, userId))
      : Promise.resolve([]),
    drug.drugClass
      ? db
          .select({ slug: drugs.slug, generic: drugs.genericName })
          .from(drugs)
          .where(and(eq(drugs.drugClass, drug.drugClass), ne(drugs.id, drug.id), isNotNull(drugs.drugClass)))
          .orderBy(asc(drugs.genericName))
      : Promise.resolve([]),
  ]);

  // `~all` is a request for the table rather than for a version, so it reads
  // as "no variant in force" everywhere else on the page: the overlay below is
  // the drug's own, and the *reading this as X* banner stays away.
  const wantsAll = variantSlug === ALL_VARIANTS;

  const [variants, variant, layers] = await Promise.all([
    variantOptionsFor(drug.id),
    variantSlug && !wantsAll ? variantLayerFor(drug.id, variantSlug) : Promise.resolve(null),
    wantsAll ? variantLayersForDrug(drug.id) : Promise.resolve(null),
  ]);

  const indicationsByBrand = new Map<string, string[]>();
  for (const link of linkRows) {
    const list = indicationsByBrand.get(link.brandId);
    if (list) list.push(link.label);
    else indicationsByBrand.set(link.brandId, [link.label]);
  }

  const brands: ProfileBrand[] = brandRows.map((brand) => ({
    id: brand.id,
    name: brand.name,
    family: brand.family,
    route: brand.route,
    dosingOverride: brand.dosingOverride,
    note: brand.note,
    defaultPairingSuspect: brand.defaultPairingSuspect,
    suspectReason: brand.suspectReason,
    indications: indicationsByBrand.get(brand.id) ?? [],
  }));

  // A field the user has hidden stays hidden; anything they have not chosen
  // about falls back to the field's own default.
  const visibility = prefs[0]?.fieldVisibility ?? {};
  const visibleDefs = defs.filter((def) => visibility[def.key] ?? def.defaultVisible);

  return {
    // The fields a reader sees. Through a variant this is the overlay, so
    // everything downstream -- the formatter, the flag button, the *from X*
    // line -- works on one shape and never has to ask which layer it got.
    drug: variant ? { ...drug, fields: overlayFields(drug.fields, variant.fields) } : drug,
    brands,
    indications: indicationRows.map((row) => row.label),
    tags: tagRows,
    defs: visibleDefs,
    siblings,
    /** Every class and exam this drug is in, for the picker. */
    variants,
    /** The variant being read through, or null for the drug's own profile. */
    variant,
    /** Which keys this variant speaks about, so the page can mark them. */
    overridden: variant ? new Set(overriddenKeys(variant.fields)) : new Set<string>(),
    /**
     * Every version's stored layer, only when the table was asked for.
     *
     * Null rather than an empty map when it was not, so the page cannot render
     * the table by accident on a profile that never asked for it.
     */
     layers,
  };
}
