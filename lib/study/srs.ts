/**
 * A trimmed SM-2. Small and readable on purpose: this is "show me what I am
 * about to forget", not an Anki clone.
 */

import type { GradingScale } from './config';

export type Grade = 'again' | 'hard' | 'good' | 'easy';

/**
 * The buttons each scale shows, worst first so the two read the same way
 * round. The binary pair borrows the four-point words it maps to rather than
 * inventing a second vocabulary: the short scale is visibly the long one with
 * the middle removed, and nobody switching modes has to learn new labels.
 */
export const GRADE_BUTTONS: Record<GradingScale, { grade: Grade; label: string }[]> = {
  'four-point': [
    { grade: 'again', label: 'Again' },
    { grade: 'hard', label: 'Hard' },
    { grade: 'good', label: 'Good' },
    { grade: 'easy', label: 'Easy' },
  ],
  binary: [
    { grade: 'again', label: 'Again' },
    { grade: 'good', label: 'Good' },
  ],
};

export type Schedule = {
  ease: number;
  intervalDays: number;
  dueAt: Date;
  reviewCount: number;
  lastResult: boolean;
};

const MIN_EASE = 1.3;
const EASE_DELTA: Record<Grade, number> = {
  again: -0.2,
  hard: -0.15,
  good: 0,
  easy: 0.15,
};

/** The binary scale is a display over the same mechanism, not a second one. */
export function gradeFromBinary(recalled: boolean): Grade {
  return recalled ? 'good' : 'again';
}

/** Good or better clears a card from its block; Again and Hard requeue it. */
export function clearsBlock(grade: Grade) {
  return grade === 'good' || grade === 'easy';
}

function nextInterval(current: number, ease: number, grade: Grade, reviewCount: number) {
  if (grade === 'again') return 0;
  if (grade === 'hard') return Math.max(1, current * 1.2);

  // A first correct answer is worth a day, a second three; after that the
  // ease does the work.
  if (reviewCount === 0 || current === 0) return grade === 'easy' ? 3 : 1;
  if (current < 3) return grade === 'easy' ? 5 : 3;

  return current * ease * (grade === 'easy' ? 1.3 : 1);
}

export function review(
  card: { ease: number; intervalDays: number; reviewCount: number },
  grade: Grade,
  now = new Date(),
): Schedule {
  const ease = Math.max(MIN_EASE, card.ease + EASE_DELTA[grade]);
  const intervalDays = nextInterval(card.intervalDays, ease, grade, card.reviewCount);

  // A missed card comes back in the same session rather than tomorrow, which
  // is what "wrong resets to same-session" means in practice.
  const dueAt = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  return {
    ease,
    intervalDays,
    dueAt,
    reviewCount: card.reviewCount + 1,
    lastResult: grade !== 'again',
  };
}

/**
 * Cram leaves the schedule alone. An evening of blocks should not flatten
 * weeks of spacing, so a cram pass records that the card was seen and how it
 * went, and nothing else.
 */
export function reviewWithoutRescheduling(
  card: { ease: number; intervalDays: number; dueAt: Date; reviewCount: number },
  grade: Grade,
): Schedule {
  return {
    ease: card.ease,
    intervalDays: card.intervalDays,
    dueAt: card.dueAt,
    reviewCount: card.reviewCount + 1,
    lastResult: grade !== 'again',
  };
}
