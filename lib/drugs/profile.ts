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

export async function getDrugProfile(slug: string, userId?: string) {
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
    drug,
    brands,
    indications: indicationRows.map((row) => row.label),
    tags: tagRows,
    defs: visibleDefs,
    siblings,
  };
}
