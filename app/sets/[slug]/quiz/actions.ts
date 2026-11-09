'use server';

import { requireUser } from '@/lib/session';
import { normalizeConfig, type StudyConfig } from '@/lib/study/config';
import type { QuizQuestion } from '@/lib/study/quiz';
import { recordAttempt, type SubmittedAnswer } from '@/lib/study/quiz-session';

export type FinishState =
  | { ok: true; score: number; total: number }
  | { ok: false; message: string };

/** One finished paper about a set. See the drug version for why nothing is revalidated. */
export async function finishSetQuizAction(input: {
  config: StudyConfig;
  questions: QuizQuestion[];
  answers: SubmittedAnswer[];
}): Promise<FinishState> {
  const session = await requireUser();

  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    return { ok: false, message: 'That quiz had no questions in it.' };
  }

  const result = await recordAttempt({
    userId: session.user.id,
    config: normalizeConfig(input.config),
    questions: input.questions,
    answers: input.answers,
    subject: 'item',
  });

  return { ok: true, score: result.score, total: result.total };
}
