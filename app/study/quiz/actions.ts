'use server';

import { revalidatePath } from 'next/cache';
import { normalizeConfig, type StudyConfig } from '@/lib/study/config';
import type { QuizQuestion } from '@/lib/study/quiz';
import { recordAttempt, type SubmittedAnswer } from '@/lib/study/quiz-session';
import { requireUser } from '@/lib/session';

export type FinishState = { ok: true; score: number; total: number } | { ok: false; message: string };

/**
 * Records one finished paper.
 *
 * The questions come back from the client because they were generated there
 * for this attempt and nowhere else -- rebuilding them here would reshuffle
 * the options and grade against a paper nobody sat. What stops that being a
 * way to fake a score is that nothing reads it back as truth: an attempt is
 * your own study history, which you are welcome to lie to yourself in.
 */
export async function finishQuizAction(input: {
  config: StudyConfig;
  questions: QuizQuestion[];
  answers: SubmittedAnswer[];
}): Promise<FinishState> {
  const session = await requireUser();

  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    return { ok: false, message: 'That paper had no questions in it.' };
  }

  const result = await recordAttempt({
    userId: session.user.id,
    config: normalizeConfig(input.config),
    questions: input.questions,
    answers: input.answers,
  });

  revalidatePath('/study/quiz');
  return { ok: true, score: result.score, total: result.total };
}
