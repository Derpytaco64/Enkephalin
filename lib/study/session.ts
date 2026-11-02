import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { studyCards } from '@/db/schema';
import { listFieldDefs } from '@/lib/fields/registry';
import { buildCards, type StudyCardSpec } from './cards';
import { loadCardSources } from './sources';
import { sessionRules, type StudyConfig } from './config';
import { review, reviewWithoutRescheduling, type Grade } from './srs';

export type SessionDeck = {
  cards: StudyCardSpec[];
  /** Everything the scope matched, before the due filter. */
  inScope: number;
  /** What was available after the due filter, before any cap. */
  available: number;
};

/**
 * Takes `size` of them at random, Fisher-Yates over a copy.
 *
 * Random rather than the first N: the deck arrives in alphabetical order, so a
 * truncation would teach the A's and never reach the Z's. Random rather than
 * "least recently seen", too -- that is the schedule's job, and it has already
 * had its say in the due filter above.
 */
function sample<T>(items: T[], size: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, size);
}

/** Caps the deck, reporting what it had to choose from. */
function capped(cards: StudyCardSpec[], inScope: number, config: StudyConfig): SessionDeck {
  const available = cards.length;
  if (config.maxCards > 0 && available > config.maxCards) {
    return { cards: sample(cards, config.maxCards), inScope, available };
  }
  return { cards, inScope, available };
}

export async function loadDeck(userId: string, config: StudyConfig): Promise<SessionDeck> {
  const [sources, defs] = await Promise.all([loadCardSources(), listFieldDefs()]);
  const all = buildCards(sources, defs, config);
  const rules = sessionRules(config);

  if (!rules.dueOnly) return capped(all, all.length, config);

  const schedules = await db.select().from(studyCards).where(eq(studyCards.userId, userId));
  const dueByCard = new Map(schedules.map((row) => [`${row.drugId}:${row.cardKey}`, row.dueAt]));
  const now = new Date();

  // A card nobody has seen has no row, and a card never seen is due.
  const due = all.filter((card) => {
    const dueAt = dueByCard.get(`${card.drugId}:${card.cardKey}`);
    return !dueAt || dueAt <= now;
  });

  // The cap applies to what you will actually be shown, so "max 50" means
  // fifty cards in front of you -- not fifty picked and then thinned by the
  // schedule down to nine.
  return capped(due, all.length, config);
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
