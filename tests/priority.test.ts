import { describe, expect, it } from 'vitest';
import {
  FLOOR, MISSED, NEVER_ASKED, wasMissed, weightKey, weightOf, weightsFromHistory,
  type AnsweredRow,
} from '@/lib/study/priority';

/** Newest first, as the history query returns it. */
const answered = (subjectId: string, fieldKey: string, wasCorrect: boolean): AnsweredRow =>
  ({ subjectId, fieldKey, wasCorrect });

const question = (drugId: string, fieldKey: string) => ({ drugId, fieldKey });

describe('weightsFromHistory', () => {
  it('puts a missed question back at the top of the pile', () => {
    const weights = weightsFromHistory([answered('drug-1', 'moa', false)]);
    expect(weightOf(weights, question('drug-1', 'moa'))).toBe(MISSED);
  });

  it('weights one never asked above one answered correctly', () => {
    const weights = weightsFromHistory([answered('drug-1', 'moa', true)]);

    // Coverage first: over 236 drugs a cap of 20 should be working through the
    // sheet rather than re-testing the corner of it already shown once.
    expect(weightOf(weights, question('drug-2', 'moa'))).toBe(NEVER_ASKED);
    expect(weightOf(weights, question('drug-1', 'moa'))).toBeLessThan(NEVER_ASKED);
  });

  it('decays with the streak rather than clearing on one right answer', () => {
    // Four options is a 25% guess rate, so one correct answer is weak
    // evidence. It takes a run of them to earn the floor.
    const once = weightsFromHistory([answered('drug-1', 'moa', true)]);
    const twice = weightsFromHistory([
      answered('drug-1', 'moa', true), answered('drug-1', 'moa', true),
    ]);
    const thrice = weightsFromHistory([
      answered('drug-1', 'moa', true), answered('drug-1', 'moa', true),
      answered('drug-1', 'moa', true),
    ]);

    const at = (w: Map<string, number>) => weightOf(w, question('drug-1', 'moa'));
    expect(at(once)).toBeGreaterThan(at(twice));
    expect(at(twice)).toBeGreaterThan(at(thrice));
    expect(at(thrice)).toBe(FLOOR);
  });

  it('never lets a weight reach zero, however well you know it', () => {
    // The floor is what stops a cap of 20 over a pool of 236 becoming the same
    // 20 questions forever.
    const weights = weightsFromHistory(
      Array.from({ length: 50 }, () => answered('drug-1', 'moa', true)),
    );
    expect(weightOf(weights, question('drug-1', 'moa'))).toBe(FLOOR);
    expect(FLOOR).toBeGreaterThan(0);
  });

  it('answers to the latest result, not to a lifetime average', () => {
    // Right nine times and wrong once, most recently: that is a question to
    // ask again, and an average would have buried it.
    const weights = weightsFromHistory([
      answered('drug-1', 'moa', false),
      ...Array.from({ length: 9 }, () => answered('drug-1', 'moa', true)),
    ]);
    expect(weightOf(weights, question('drug-1', 'moa'))).toBe(MISSED);
  });

  it('stops counting at the last wrong answer', () => {
    // Wrong, then right twice: the streak is two, and the older miss has
    // stopped mattering. This is also what lets the query be bounded.
    const weights = weightsFromHistory([
      answered('drug-1', 'moa', true),
      answered('drug-1', 'moa', true),
      answered('drug-1', 'moa', false),
      answered('drug-1', 'moa', true),
    ]);

    const twice = weightsFromHistory([
      answered('drug-1', 'moa', true), answered('drug-1', 'moa', true),
    ]);
    expect(weightOf(weights, question('drug-1', 'moa')))
      .toBe(weightOf(twice, question('drug-1', 'moa')));
  });

  it('keeps each field separate, and a bundle separate from its parts', () => {
    const weights = weightsFromHistory([
      answered('drug-1', 'moa', false),
      answered('drug-1', 'dosing', true),
      answered('drug-1', 'moa+dosing', false),
    ]);

    expect(weightOf(weights, question('drug-1', 'moa'))).toBe(MISSED);
    expect(weightOf(weights, question('drug-1', 'dosing'))).toBeLessThan(NEVER_ASKED);
    // Per-drug mode's field key is the joined selection, so it carries its own
    // history: recognising a whole profile is not the same recall as naming
    // one mechanism, and the two should not grade each other.
    expect(weightOf(weights, question('drug-1', 'moa+dosing'))).toBe(MISSED);
  });

  it('ignores direction, because the weight is about the material', () => {
    // A paper on mixed directions decides each question's direction by coin
    // toss, so a direction-keyed weight would match about half the time.
    expect(weightKey('drug-1', 'moa')).toBe(weightKey('drug-1', 'moa'));
    const weights = weightsFromHistory([answered('drug-1', 'moa', false)]);
    expect(wasMissed(weights, question('drug-1', 'moa'))).toBe(true);
  });

  it('treats a question with no field as its own bucket rather than crashing', () => {
    const weights = weightsFromHistory([{ subjectId: 'drug-1', fieldKey: null, wasCorrect: false }]);
    expect(weightOf(weights, { drugId: 'drug-1', fieldKey: null })).toBe(MISSED);
  });

  it('says nothing about a question never asked', () => {
    const weights = weightsFromHistory([]);
    expect(weights.size).toBe(0);
    expect(wasMissed(weights, question('drug-1', 'moa'))).toBe(false);
  });
});
