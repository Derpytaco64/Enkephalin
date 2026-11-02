/**
 * Which questions a capped quiz should reach for first: the ones you got
 * wrong.
 *
 * Client-safe and pure. The history comes from `quiz_answers`, which already
 * records every answer with the drug and the field it was about, so this needs
 * no schema of its own -- the query lives in `quiz-session.ts` and hands the
 * rows here.
 *
 * Deliberately **not** wired into the SM-2 schedule in `srs.ts`. A quiz answer
 * is a four-way guess and a flashcard grade is self-report; letting a lucky
 * guess push a card three weeks into the future would corrupt the one signal
 * that is currently honest. This weighting is quiz-local.
 */

/** Weight per question, keyed by `weightKey`. Absent means never asked. */
export type QuestionWeights = Map<string, number>;

/**
 * What counts as "the same question" across quizzes: a drug and a field.
 *
 * Direction is left out on purpose. "Amiodarone's mechanism is shaky" is a
 * fact about the material, not about which way it was asked, and a paper on
 * mixed directions decides each question's direction by coin toss -- so a
 * direction-keyed weight would match about half the time and the whole
 * mechanism would visibly half-work. Per-drug mode separates itself anyway,
 * since its field key is the joined selection (`moa+dosing`).
 */
export function weightKey(drugId: string, fieldKey: string | null): string {
  return `${drugId}:${fieldKey ?? 'unknown'}`;
}

/**
 * Four to one against the floor, and nothing is ever zero.
 *
 * - **Missed** is the whole point: back to the top of the pile.
 * - **Never asked** sits above answered-correctly, because coverage comes
 *   first. Over 236 drugs a cap of 20 should still be working through the
 *   sheet, not re-testing the same corner of it.
 * - **Answered right** decays with the streak rather than dropping at once:
 *   four options means a 25% guess rate, so one correct answer is weak
 *   evidence and two or three are what it takes to earn the floor.
 *
 * The floor is the part that matters most. Without it a cap of 20 over a pool
 * of 236 becomes the same 20 questions forever and you never meet the rest of
 * the material -- the feature would quietly turn a quiz into a grudge list.
 * At 0.5 against 4 a question you have aced still turns up, an eighth as
 * often as one you missed.
 */
export const MISSED = 4;
export const NEVER_ASKED = 2;
export const FLOOR = 0.5;

/** One answer, as the history query returns it: newest first. */
export type AnsweredRow = {
  drugId: string;
  fieldKey: string | null;
  wasCorrect: boolean | null;
};

/**
 * Folds the answer history into a weight per question.
 *
 * Reads newest-first and stops at the first wrong answer for each question,
 * which is what makes the result depend on the *latest* results rather than a
 * lifetime average: get something wrong and it goes back to 4 whatever came
 * before, get it right three times running and it reaches the floor. It also
 * means the query can be bounded -- truncating the oldest rows only forgets
 * history that had stopped counting anyway.
 *
 * Rows left unanswered are the caller's to exclude. Skipping a question is not
 * the same as missing it -- the schema keeps `answered_at` null precisely to
 * tell those apart -- so running out of time should not reorder your next
 * quiz.
 */
export function weightsFromHistory(rows: AnsweredRow[]): QuestionWeights {
  const streaks = new Map<string, { correct: number; closed: boolean }>();

  for (const row of rows) {
    const key = weightKey(row.drugId, row.fieldKey);
    const right = row.wasCorrect === true;
    const entry = streaks.get(key);

    if (entry === undefined) {
      // The newest answer for this question: a miss settles it outright.
      streaks.set(key, { correct: right ? 1 : 0, closed: !right });
      continue;
    }
    if (entry.closed) continue;
    if (right) entry.correct += 1;
    else entry.closed = true;
  }

  const weights: QuestionWeights = new Map();
  for (const [key, entry] of streaks) {
    weights.set(key, entry.correct === 0 ? MISSED : Math.max(FLOOR, NEVER_ASKED / (1 + entry.correct)));
  }
  return weights;
}

/** The weight a question carries, which for one never asked is `NEVER_ASKED`. */
export function weightOf(
  weights: QuestionWeights,
  question: { drugId: string; fieldKey: string | null },
): number {
  return weights.get(weightKey(question.drugId, question.fieldKey)) ?? NEVER_ASKED;
}

/** Whether the last answer to this question was wrong, for the paper's summary. */
export function wasMissed(
  weights: QuestionWeights,
  question: { drugId: string; fieldKey: string | null },
): boolean {
  return weights.get(weightKey(question.drugId, question.fieldKey)) === MISSED;
}
