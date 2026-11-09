/**
 * Which brand treats which indication, for the drugs where that is a real
 * question.
 *
 * **Most drugs are not pairable, and saying so is the point.** A drug with one
 * brand family has nothing to pair; a drug with one indication has nothing to
 * narrow to. Only where both are plural does the question *which of these
 * brands is for which of these conditions* exist at all -- six drugs out of
 * 236. Listing all 236 and letting somebody discover that 230 of them have a
 * single row would be a worse screen than one that knows which six matter.
 *
 * Brand *families* rather than brand rows decide that. `brand_family` collapses
 * Wellbutrin, Wellbutrin SR and Wellbutrin XL into one brand wearing three
 * release forms -- the same collapse `build-seed.py` does, for the same reason:
 * Depakote against Depakote ER is not a pairing question, and three Wellbutrins
 * against one Zyban is.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { brandIndications, drugBrands, drugIndications, drugs, indications } from '@/db/schema';

export type PairingBrand = {
  id: string;
  name: string;
  /** Release forms of one brand share a family; it groups the rows visually. */
  family: string;
  /** The drug_indications ids this brand is narrowed to. Empty means all of them. */
  indicationIds: string[];
};

export type PairingDrug = {
  id: string;
  slug: string;
  generic: string;
  /** Flagged by the importer where the sheet could not say. */
  needsReview: boolean;
  brands: PairingBrand[];
  indications: { id: string; label: string }[];
};

export type PairingCounts = {
  /** Drugs where pairing is a real question. */
  pairable: number;
  /** Of those, how many the importer flagged for a human. */
  needsReview: number;
  /** Of those, how many have no narrowing at all -- every brand covers everything. */
  unnarrowed: number;
};

/**
 * The drugs worth showing, each with everything the grid needs.
 *
 * Four queries rather than one join, because a join across brands and
 * indications multiplies them into a grid of rows that has to be folded back
 * up in JS anyway -- and with six drugs the round trips are free.
 */
export async function pairingDrugs(): Promise<PairingDrug[]> {
  const drugRows = await db
    .select({
      id: drugs.id,
      slug: drugs.slug,
      generic: drugs.genericName,
      needsReview: drugs.needsPairingReview,
    })
    .from(drugs)
    .orderBy(asc(drugs.genericName));

  const ids = drugRows.map((row) => row.id);
  if (ids.length === 0) return [];

  const [brandRows, indicationRows, linkRows] = await Promise.all([
    db.select({
      id: drugBrands.id,
      drugId: drugBrands.drugId,
      name: drugBrands.name,
      family: drugBrands.family,
    })
      .from(drugBrands)
      .where(inArray(drugBrands.drugId, ids))
      .orderBy(asc(drugBrands.sortOrder)),

    db.select({
      id: drugIndications.id,
      drugId: drugIndications.drugId,
      label: indications.label,
      sortOrder: drugIndications.sortOrder,
    })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .where(inArray(drugIndications.drugId, ids))
      .orderBy(asc(drugIndications.sortOrder)),

    db.select({
      brandId: brandIndications.brandId,
      indicationId: brandIndications.indicationId,
    })
      .from(brandIndications),
  ]);

  const linksByBrand = new Map<string, string[]>();
  for (const link of linkRows) {
    const found = linksByBrand.get(link.brandId);
    if (found) found.push(link.indicationId);
    else linksByBrand.set(link.brandId, [link.indicationId]);
  }

  return drugRows
    .map((drug) => {
      const brands = brandRows.filter((row) => row.drugId === drug.id);
      const drugIndicationRows = indicationRows.filter((row) => row.drugId === drug.id);
      return {
        id: drug.id,
        slug: drug.slug,
        generic: drug.generic,
        needsReview: drug.needsReview,
        brands: brands.map((row) => ({
          id: row.id,
          name: row.name,
          family: row.family ?? row.name,
          indicationIds: linksByBrand.get(row.id) ?? [],
        })),
        indications: drugIndicationRows.map((row) => ({ id: row.id, label: row.label })),
      };
    })
    // Pairable means both axes are plural, with release forms of one brand
    // counted once. See the note at the top of this file.
    .filter((drug) =>
      new Set(drug.brands.map((brand) => brand.family)).size > 1
      && drug.indications.length > 1)
    // Anything the importer flagged leads; the rest alphabetical, which is
    // where the list starts life.
    .sort((a, b) =>
      Number(b.needsReview) - Number(a.needsReview) || a.generic.localeCompare(b.generic));
}

export async function pairingCounts(): Promise<PairingCounts> {
  const rows = await pairingDrugs();
  return {
    pairable: rows.length,
    needsReview: rows.filter((row) => row.needsReview).length,
    unnarrowed: rows.filter((row) =>
      row.brands.every((brand) => brand.indicationIds.length === 0)).length,
  };
}
