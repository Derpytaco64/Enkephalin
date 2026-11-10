/**
 * Loading a quiz and recording what happened in it.
 *
 * The questions are built once on the server and handed to the page whole. A
 * quiz that regenerated per render would reshuffle its options under you, and
 * one that wrote a row per question would leave half-attempts everywhere; so
 * the attempt is written once, at the end, from what the runner collected.
 */
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '@/db';
import { quizAnswers, quizAttempts } from '@/db/schema';
import { listFieldDefs } from '@/lib/fields/registry';
import { loadCardSources } from './sources';
import { membershipVariants, variantSlugsAmong } from '@/lib/drugs/variants';
import type { StudyConfig } from './config';
import {
  wasMissed, weightsFromHistory, type QuestionWeights,
} from './priority';
import { buildQuiz, capQuiz, type QuizDirection, type QuizQuestion } from './quiz';

export type QuizPaper = {
  /**
   * This draw, not these filters. The runner is keyed on it, so a re-render
   * cannot swap the questions out from under a paper being sat, and
   * re-submitting the same filters still starts a new one.
   */
  id: string;
  questions: QuizQuestion[];
  /** Everything the scope could have asked, before the cap. */
  available: number;
  /**
   * How many of the drawn questions are ones the last answer got wrong. Null
   * when the draw was not weighted, which is a different thing from zero: the
   * page says "7 you have missed before" or says nothing, and never implies a
   * clean record it did not check.
   */
  missed: number | null;
};

export type QuizDraw = {
  /** Defaults to mixed, which is the paper's own setting rather than the config's. */
  direction?: QuizDirection;
  /**
   * Whose history to weight the draw by. Null draws evenly, which is the
   * setting a user can choose and also what a quiz with no cap effectively
   * gets -- the whole pool is asked either way, only the order moves.
   */
  weightFor?: string | null;
};

export async function loadQuiz(config: StudyConfig, draw: QuizDraw = {}): Promise<QuizPaper> {
  const { direction = 'random', weightFor = null } = draw;

  // See `loadDeck`: a class in scope is studied in its own words, and the
  // two surfaces must agree about that or a quiz would ask what the deck
  // never taught.
  const [variants, byMembership] = await Promise.all([
    variantSlugsAmong(config.scope.tags),
    membershipVariants(config.scope.tags),
  ]);

  const [sources, defs, weights] = await Promise.all([
    loadCardSources(variants, byMembership),
    listFieldDefs(),
    weightFor === null ? null : questionWeights(weightFor),
  ]);

  const all = buildQuiz(sources, defs, config, { direction });
  const questions = capQuiz(all, config.maxCards, Math.random, weights ?? undefined);

  return {
    id: crypto.randomUUID(),
    questions,
    available: all.length,
    missed: weights === null
      ? null
      : questions.filter((question) => wasMissed(weights, question)).length,
  };
}

/**
 * How much weight each question this user has met now carries.
 *
 * Bounded, and newest first: `weightsFromHistory` stops counting at each
 * question's most recent wrong answer, so the rows past the limit are ones
 * that had stopped mattering. Unanswered rows are excluded here rather than
 * there -- a skipped question is not a missed one.
 */
const HISTORY_LIMIT = 20_000;

export async function questionWeights(userId: string): Promise<QuestionWeights> {
  const rows = await db
    .select({
      subjectId: quizAnswers.drugId,
      fieldKey: quizAnswers.fieldKey,
      wasCorrect: quizAnswers.wasCorrect,
    })
    .from(quizAnswers)
    .innerJoin(quizAttempts, eq(quizAttempts.id, quizAnswers.attemptId))
    .where(and(eq(quizAttempts.userId, userId), isNotNull(quizAnswers.answeredAt)))
    .orderBy(desc(quizAnswers.answeredAt))
    .limit(HISTORY_LIMIT);

  return weightsFromHistory(rows);
}

export type SubmittedAnswer = {
  questionId: string;
  chosenIndex: number | null;
};

/**
 * Writes one finished attempt: the score, and every question with what was
 * chosen and what the options were.
 *
 * The options are stored rather than recomputed, because they were random --
 * a review screen that re-rolled them would show you a question you never
 * answered.
 */
export async function recordAttempt(input: {
  userId: string;
  config: StudyConfig;
  questions: QuizQuestion[];
  answers: SubmittedAnswer[];
}): Promise<{ attemptId: string; score: number; total: number }> {
  const { userId, config, questions, answers } = input;
  const chosenById = new Map(answers.map((answer) => [answer.questionId, answer.chosenIndex]));

  const graded = questions.map((question) => {
    const chosen = chosenById.get(question.id) ?? null;
    return { question, chosen, correct: chosen !== null && chosen === question.correctIndex };
  });

  const score = graded.filter((row) => row.correct).length;

  const [attempt] = await db
    .insert(quizAttempts)
    .values({
      userId,
      config: config as unknown as Record<string, unknown>,
      score,
      total: graded.length,
      finishedAt: new Date(),
    })
    .returning({ id: quizAttempts.id });

  if (graded.length > 0) {
    await db.insert(quizAnswers).values(graded.map((row) => ({
      attemptId: attempt.id,
      drugId: row.question.drugId,
      questionKey: row.question.questionKey,
      fieldKey: row.question.fieldKey,
      prompt: { text: row.question.prompt, generic: row.question.generic, slug: row.question.slug },
      choices: row.question.options,
      acceptable: row.question.acceptable,
      chosenIndex: row.chosen,
      correctIndex: row.question.correctIndex,
      wasCorrect: row.correct,
      answeredAt: row.chosen === null ? null : new Date(),
    })));
  }

  return { attemptId: attempt.id, score, total: graded.length };
}

export type AttemptSummary = {
  id: string;
  score: number;
  total: number;
  startedAt: Date;
  /** Accuracy per field, so a weak area is visible rather than inferred. */
  byField: { fieldKey: string; right: number; asked: number }[];
};

export async function recentAttempts(userId: string, limit = 10): Promise<AttemptSummary[]> {
  const attempts = await db
    .select()
    .from(quizAttempts)
    .where(eq(quizAttempts.userId, userId))
    .orderBy(desc(quizAttempts.startedAt))
    .limit(limit);
  if (attempts.length === 0) return [];

  const rows = await db
    .select({
      attemptId: quizAnswers.attemptId,
      fieldKey: quizAnswers.fieldKey,
      wasCorrect: quizAnswers.wasCorrect,
    })
    .from(quizAnswers)
    .innerJoin(quizAttempts, eq(quizAttempts.id, quizAnswers.attemptId))
    .where(eq(quizAttempts.userId, userId));

  return attempts.map((attempt) => {
    const tally = new Map<string, { right: number; asked: number }>();
    for (const row of rows) {
      if (row.attemptId !== attempt.id) continue;
      const key = row.fieldKey ?? 'unknown';
      const entry = tally.get(key) ?? { right: 0, asked: 0 };
      entry.asked += 1;
      if (row.wasCorrect) entry.right += 1;
      tally.set(key, entry);
    }

    return {
      id: attempt.id,
      score: attempt.score,
      total: attempt.total,
      startedAt: attempt.startedAt,
      byField: [...tally].map(([fieldKey, counts]) => ({ fieldKey, ...counts })),
    };
  });
}

/** What you got wrong across every attempt, worst first. */
export async function weakestFields(userId: string) {
  const rows = await db
    .select({ fieldKey: quizAnswers.fieldKey, wasCorrect: quizAnswers.wasCorrect })
    .from(quizAnswers)
    .innerJoin(quizAttempts, eq(quizAttempts.id, quizAnswers.attemptId))
    .where(and(eq(quizAttempts.userId, userId)));

  const tally = new Map<string, { right: number; asked: number }>();
  for (const row of rows) {
    const key = row.fieldKey ?? 'unknown';
    const entry = tally.get(key) ?? { right: 0, asked: 0 };
    entry.asked += 1;
    if (row.wasCorrect) entry.right += 1;
    tally.set(key, entry);
  }

  return [...tally]
    .map(([fieldKey, counts]) => ({ fieldKey, ...counts, rate: counts.right / counts.asked }))
    .sort((a, b) => a.rate - b.rate);
}
