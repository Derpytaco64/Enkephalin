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
import { drugBrands, drugIndications, drugTags, drugs, tags, type FieldValue } from '@/db/schema';
import { indicationSlug } from '@/lib/drugs/indications';
import type { CardSource } from './cards';

/**
 * Core fields wrapped in the same envelope as the stored ones, so the card
 * builder treats every field alike. Their provenance is the sheet.
 */
function sheetValue(value: string | null): FieldValue {
  return { value, status: 'ok', source: 'class sheet', updatedAt: '', updatedBy: null };
}

export async function loadCardSources(): Promise<CardSource[]> {
  const [drugRows, brandRows, indicationRows, tagRows] = await Promise.all([
    db.select().from(drugs).orderBy(asc(drugs.genericName)),
    db
      .select({ drugId: drugBrands.drugId, name: drugBrands.name })
      .from(drugBrands)
      .orderBy(asc(drugBrands.sortOrder)),
    db
      .select({ drugId: drugIndications.drugId, text: drugIndications.text })
      .from(drugIndications)
      .orderBy(asc(drugIndications.sortOrder)),
    db
      .select({ drugId: drugTags.drugId, slug: tags.slug })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId)),
  ]);

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
  const indicationsByDrug = group(indicationRows, 'text');
  const tagsByDrug = group(tagRows, 'slug');

  return drugRows.map((drug) => {
    const brands = brandsByDrug.get(drug.id) ?? [];
    const indications = indicationsByDrug.get(drug.id) ?? [];
    const routeValue = drug.fields.route?.value ?? '';

    return {
      drugId: drug.id,
      slug: drug.slug,
      generic: drug.genericName,
      drugClass: drug.drugClass,
      schedule: drug.schedule,
      routes: routeValue ? routeValue.split('\n').map((route) => route.trim()).filter(Boolean) : [],
      tags: tagsByDrug.get(drug.id) ?? [],
      // Slugged here with the same helper the picker uses, so "Seizures" and
      // "Seizure" land on one filter rather than two half-decks.
      indications: [...new Set(indications.map((text) => indicationSlug(text)).filter(Boolean))],
      needsPairingReview: drug.needsPairingReview,
      values: {
        ...drug.fields,
        generic: sheetValue(drug.genericName),
        brand: sheetValue(brands.join('\n') || null),
        indication: sheetValue(indications.join('\n') || null),
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

