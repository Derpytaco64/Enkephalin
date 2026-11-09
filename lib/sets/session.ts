/**
 * Loading a deck or a paper for one imported set.
 *
 * Thin on purpose. The engine, the SRS and the scoring are the drug section's
 * and are reused as they stand; what lives here is the two things a set needs
 * that a drug does not -- its own subject (so the identity question says
 * *Which hormone?*) and its own `recall_only` rule (a row that will not
 * decompose flashcards but is never offered as multiple choice).
 */
import { eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { studyCards } from '../../db/schema.ts';
import type { StudyConfig } from '../study/config.ts';
import { sessionRules } from '../study/config.ts';
import { buildCards, type StudyCardSpec, type StudySubject } from '../study/cards.ts';
import { buildQuiz, capQuiz, type QuizDirection, type QuizQuestion } from '../study/quiz.ts';
import { questionWeights } from '../study/quiz-session.ts';
import { wasMissed } from '../study/priority.ts';
import { loadSet, withIdentityValue, type SetStudySource } from './source.ts';

export type SetDeck = {
  cards: StudyCardSpec[];
  inScope: number;
  available: number;
};

export type SetPaper = {
  id: string;
  questions: QuizQuestion[];
  available: number;
  /** Rows held back from the paper because they are flashcard-only. */
  recallOnly: number;
  /**
   * How many drawn questions this user has missed before, or null when the
   * draw was even. Same meaning as the drug quiz's, so the page can say it in
   * the same words -- and never imply a count it did not measure.
   */
  missed: number | null;
};

/**
 * The set's own identity, as the engine's subject.
 *
 * `askingWhich` is built from the declared kind, so a set of receptors asks
 * *Which receptor?* -- the wording comes from the file rather than from a
 * constant, which is the whole point of the kind being declared.
 */
export function subjectOf(source: SetStudySource): StudySubject {
  return {
    identityKey: source.set.identityKey,
    identityLabel: source.set.identityLabel,
    askingWhich: `Which ${source.set.identityKind}?`,
  };
}

/** Loads the set and folds its name in as a value, which every surface needs. */
export async function loadSetStudy(slug: string): Promise<SetStudySource | null> {
  const source = await loadSet(slug);
  return source ? withIdentityValue(source) : null;
}

function sample<T>(items: T[], size: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, size);
}

/**
 * A deck for one set.
 *
 * The due filter reads `item_id`, which is the only line that differs from the
 * drug deck -- and it is why `study_cards` grew a second column instead of
 * reusing the first.
 */
export async function loadSetDeck(
  userId: string,
  source: SetStudySource,
  config: StudyConfig,
): Promise<SetDeck> {
  const all = buildCards(source.sources, source.defs, config, subjectOf(source));
  const rules = sessionRules(config);

  const capped = (cards: StudyCardSpec[], inScope: number): SetDeck => {
    const available = cards.length;
    if (config.maxCards > 0 && available > config.maxCards) {
      return { cards: sample(cards, config.maxCards), inScope, available };
    }
    return { cards, inScope, available };
  };

  if (!rules.dueOnly) return capped(all, all.length);

  const schedules = await db
    .select({ itemId: studyCards.itemId, cardKey: studyCards.cardKey, dueAt: studyCards.dueAt })
    .from(studyCards)
    .where(eq(studyCards.userId, userId));

  const dueByCard = new Map(schedules.map((row) => [`${row.itemId}:${row.cardKey}`, row.dueAt]));
  const now = new Date();

  const due = all.filter((card) => {
    const dueAt = dueByCard.get(`${card.drugId}:${card.cardKey}`);
    return !dueAt || dueAt <= now;
  });

  return capped(due, all.length);
}

/**
 * A paper for one set.
 *
 * `recall_only` rows are removed *before* the builder sees them, which matters
 * for more than the question they would have been asked: left in, they would
 * also have supplied wrong answers to everyone else, and a nine-stem matching
 * table is not a distractor.
 */
export async function loadSetPaper(
  source: SetStudySource,
  config: StudyConfig,
  direction: QuizDirection = 'random',
  /**
   * Whose history to weight the draw by, exactly as the drug quiz means it.
   * `questionWeights` already coalesces `drug_id` and `item_id`, so a set's
   * own answers are the history being read -- no second weighter.
   */
  weightFor: string | null = null,
): Promise<SetPaper> {
  const askable = source.sources.filter(
    (item) => source.extras.get(item.slug)?.recallOnly !== true,
  );

  const weights = weightFor === null ? null : await questionWeights(weightFor);
  const all = buildQuiz(askable, source.defs, config, {
    direction,
    subject: subjectOf(source),
  });
  const questions = capQuiz(all, config.maxCards, Math.random, weights ?? undefined);

  return {
    id: crypto.randomUUID(),
    questions,
    available: all.length,
    recallOnly: source.sources.length - askable.length,
    missed: weights === null
      ? null
      : questions.filter((question) => wasMissed(weights, question)).length,
  };
}

/** The columns a set can be studied on, in the order the file declared them. */
export function studiableFields(source: SetStudySource) {
  return source.defs.filter(
    (def) => def.isQuizzable && def.key !== source.set.identityKey,
  );
}
