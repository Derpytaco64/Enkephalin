import { and, asc, eq, isNotNull, ne } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
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
import { listFieldDefs, type FieldDef } from '@/lib/fields/registry';
import { formatFieldValue } from '@/lib/fields/format';
import { ALL_VARIANTS } from './variant-kinds';
import {
  baseVariantOf, overlayFields, overriddenKeys, variantLayerFor, variantLayersForDrug,
  variantOptionsFor,
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

  const variantTagOf = alias(tags, 'variant_tag');

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
    // `named` is the version this membership says it means -- see
    // `drug_tags.variant_tag_id`. Left-joined because most memberships name
    // nothing, and the ones that do are the reason a tag is not a property of
    // the whole drug: amoxicillin is on a top-200 list as itself and in an ID
    // class as that class words it, and a page showing both to a reader of
    // either is the thing this answers.
    db
      .select({
        slug: tags.slug, label: tags.label, kind: tags.kind, named: variantTagOf.slug,
      })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId))
      .leftJoin(variantTagOf, eq(variantTagOf.id, drugTags.variantTagId))
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

  const [variants, variant, layers, baseVariant] = await Promise.all([
    variantOptionsFor(drug.id),
    variantSlug && !wantsAll ? variantLayerFor(drug.id, variantSlug) : Promise.resolve(null),
    wantsAll ? variantLayersForDrug(drug.id) : Promise.resolve(null),
    // Whose words the drug's own profile is, where it is one class's. Read for
    // every view, not only the base one: the picker names it from a variant's
    // page too, which is where somebody is comparing the two.
    baseVariantOf(drug.id),
  ]);

  /**
   * What each tag gets you, which is not the same question as what the drug is
   * tagged with.
   *
   * Three answers, in the order they are decided:
   *
   * - the version the membership names, where it names one and that version
   *   still has wording of its own;
   * - the tag itself, where the tag is a class or an exam that words this drug
   *   differently -- reading the drug through it is reading its layer, which
   *   is what the version pills above do;
   * - the drug's own words, for everything else.
   *
   * A pointer at a version whose layer has since been cleared is ignored
   * rather than honoured, for the same reason it is nulled on the way out in
   * `clearVariantLayer`: what it names is not there to read, and every reader
   * already falls back to the drug's own words. Printing it would be the page
   * claiming a version the drug has not got.
   */
  const worded = new Set(variants.filter((option) => option.n !== null).map((o) => o.slug));
  const profileTags = tagRows.map((row) => {
    const named = row.named !== null && worded.has(row.named) ? row.named : null;
    return {
      slug: row.slug,
      label: row.label,
      kind: row.kind,
      reads: named ?? (worded.has(row.slug) ? row.slug : null),
    };
  });

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

  // Core fields read from their own columns; the rest come out of the JSONB.
  // Built here rather than on the page because the visibility rule below has to
  // ask the same question of them -- *has this drug anything to say under this
  // field* -- and two answers to that would be two profiles.
  const coreValues: Record<string, string | null> = {
    generic: drug.genericName,
    drug_class: drug.drugClass,
    controlled: drug.schedule,
    brand: brands.map((brand) => brand.name).join('\n'),
    indication: indicationRows.map((row) => row.label).join('\n'),
  };

  const fields = variant ? overlayFields(drug.fields, variant.fields) : drug.fields;

  /** Whether this drug says anything under this field, blank-as-an-answer included. */
  const answered = (def: FieldDef) => {
    const value = def.isCore
      ? {
          value: coreValues[def.key] ?? null,
          status: 'ok' as const,
          source: null,
          updatedAt: '',
          updatedBy: null,
        }
      : fields[def.key];
    // The formatter already knows the difference between *nothing recorded* and
    // *nothing to record*: `blankMeansNone` and a stored `none` are answers.
    if (formatFieldValue(def, value).kind !== 'missing') return true;

    // And in the side-by-side table, a field the drug is silent about but some
    // class words is exactly what the table was opened to show. Without this
    // the comparison would drop the row and the layer with it.
    return layers !== null
      && [...layers.values()].some(
        (layer) => formatFieldValue(def, layer[def.key]).kind !== 'missing',
      );
  };

  /**
   * Which fields this profile shows.
   *
   * `defaultVisible` is about **empty** fields, not about the field. Ticked,
   * the row appears on every drug, which is how a gap gets noticed and filled;
   * unticked, it appears only where there is something to read. What it used to
   * mean was *never show this field at all*, which made the declutter switch a
   * censor: unticking it to stop two hundred drugs printing "not recorded yet"
   * also hid the twelve that had the fact, on every drug, with nothing on any
   * screen to say the field existed. Decluttering and withholding are not the
   * same instruction.
   *
   * A reader's own choice still outranks both, in either direction -- and is
   * only settable through a restored backup today, which is the other half of
   * why the old meaning was so sharp: there was no way back.
   */
  const visibility = prefs[0]?.fieldVisibility ?? {};
  const visibleDefs = defs.filter(
    (def) => visibility[def.key] ?? (def.defaultVisible || answered(def)),
  );

  return {
    // The fields a reader sees. Through a variant this is the overlay, so
    // everything downstream -- the formatter, the flag button, the *from X*
    // line -- works on one shape and never has to ask which layer it got.
    drug: variant ? { ...drug, fields } : drug,
    brands,
    indications: indicationRows.map((row) => row.label),
    /** The five core fields as strings, the way a profile row wants them. */
    coreValues,
    /** Each with the version it reads the drug as -- null for its own words. */
    tags: profileTags,
    defs: visibleDefs,
    siblings,
    /** Every class and exam this drug is in, for the picker. */
    variants,
    /** The variant being read through, or null for the drug's own profile. */
    variant,
    /**
     * The class whose words the drug's own profile is, where it is one class's.
     *
     * Null for the 236 off the class sheet, and for anything typed by hand.
     * Not a version -- it is the base, and `variantOptionsFor` leaves it out of
     * `variants` for that reason -- so every screen that prints *the drug's
     * own* has this to print beside it.
     */
    baseVariant,
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
