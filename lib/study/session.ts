import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  studyCards,
  tags,
  type FieldValue,
} from '@/db/schema';
import { listFieldDefs } from '@/lib/fields/registry';
import { buildCards, type CardSource, type StudyCardSpec } from './cards';
import { sessionRules, type StudyConfig } from './config';
import { review, reviewWithoutRescheduling, type Grade } from './srs';

/**
 * Core fields carry the sheet's own provenance, the same as every stored
 * value: the extraction was mechanical, and nobody has checked a brand list
 * against Micromedex either. Marking them verified here would quietly let a
 * "verified only" session fill up with unchecked facts.
 */
function sheetValue(value: string | null): FieldValue {
  return { value, status: 'unverified', source: 'class sheet', updatedAt: '', updatedBy: null };
}

async function loadSources(): Promise<CardSource[]> {
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
      needsPairingReview: drug.needsPairingReview,
      values: {
        ...drug.fields,
        generic: sheetValue(drug.genericName),
        brand: sheetValue(brands.join('\n') || null),
        indication: sheetValue(indications.join('\n') || null),
        drug_class: sheetValue(drug.drugClass),
        controlled: drug.schedule
          ? sheetValue(drug.schedule)
          : { value: null, status: 'not_applicable', source: 'class sheet', updatedAt: '', updatedBy: null },
      },
    };
  });
}

export type SessionDeck = {
  cards: StudyCardSpec[];
  /** Everything the scope matched, before the due filter. */
  inScope: number;
};

export async function loadDeck(userId: string, config: StudyConfig): Promise<SessionDeck> {
  const [sources, defs] = await Promise.all([loadSources(), listFieldDefs()]);
  const all = buildCards(sources, defs, config);
  const rules = sessionRules(config);

  if (!rules.dueOnly) return { cards: all, inScope: all.length };

  const schedules = await db.select().from(studyCards).where(eq(studyCards.userId, userId));
  const dueByCard = new Map(schedules.map((row) => [`${row.drugId}:${row.cardKey}`, row.dueAt]));
  const now = new Date();

  // A card nobody has seen has no row, and a card never seen is due.
  const cards = all.filter((card) => {
    const dueAt = dueByCard.get(`${card.drugId}:${card.cardKey}`);
    return !dueAt || dueAt <= now;
  });

  return { cards, inScope: all.length };
}

/**
 * Writes one answer. In review the schedule moves; in cram it does not, and
 * only the fact that the card was seen is recorded.
 */
export async function recordGrade(input: {
  userId: string;
  card: Pick<StudyCardSpec, 'drugId' | 'cardKey' | 'fieldKeys'>;
  config: StudyConfig;
  grade: Grade;
}) {
  const { userId, card, config, grade } = input;
  const rules = sessionRules(config);

  const [existing] = await db
    .select()
    .from(studyCards)
    .where(and(eq(studyCards.userId, userId), eq(studyCards.drugId, card.drugId), eq(studyCards.cardKey, card.cardKey)));

  const current = existing ?? {
    ease: 2.5,
    intervalDays: 0,
    dueAt: new Date(),
    reviewCount: 0,
  };

  const next = rules.reschedules
    ? review(current, grade)
    : reviewWithoutRescheduling({ ...current, dueAt: current.dueAt }, grade);

  if (existing) {
    await db
      .update(studyCards)
      .set({
        ease: next.ease,
        intervalDays: next.intervalDays,
        dueAt: next.dueAt,
        reviewCount: next.reviewCount,
        lastResult: next.lastResult,
        lastReviewedAt: new Date(),
      })
      .where(eq(studyCards.id, existing.id));
    return;
  }

  await db.insert(studyCards).values({
    userId,
    drugId: card.drugId,
    cardKey: card.cardKey,
    mode: config.mode,
    direction: config.direction,
    fieldKeys: card.fieldKeys,
    ease: next.ease,
    intervalDays: next.intervalDays,
    dueAt: next.dueAt,
    reviewCount: next.reviewCount,
    lastResult: next.lastResult,
    lastReviewedAt: new Date(),
  });
}
