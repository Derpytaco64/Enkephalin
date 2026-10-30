import { describe, expect, it } from 'vitest';
import {
  blockProgress,
  createSession,
  currentCard,
  grade as gradeCard,
  type Session,
} from '@/lib/study/blocks';
import { DEFAULT_CONFIG, cardKey, fieldsForYear, normalizeConfig } from '@/lib/study/config';
import { clearsBlock, gradeFromBinary, review, reviewWithoutRescheduling, type Grade } from '@/lib/study/srs';

const ids = (count: number) => Array.from({ length: count }, (_, i) => `c${i + 1}`);

/** Grades the front card repeatedly, following whatever the queue offers. */
function play(session: Session, grades: Grade[]) {
  return grades.reduce((current, grade) => gradeCard(current, grade), session);
}

describe('study config', () => {
  it('defaults to two buttons and blocks of twenty', () => {
    expect(DEFAULT_CONFIG.grading).toBe('binary');
    expect(DEFAULT_CONFIG.blockSize).toBe(20);
  });

  it('turns a year level into exactly the fields that year owns', () => {
    const defs = [
      { key: 'generic', yearLevels: ['P1', 'P2', 'P3'], isQuizzable: true },
      { key: 'dosing', yearLevels: ['P2', 'P3'], isQuizzable: true },
      { key: 'moa', yearLevels: ['P3'], isQuizzable: true },
      { key: 'internal', yearLevels: ['P2'], isQuizzable: false },
    ];

    expect(fieldsForYear(defs, 'P2')).toEqual(['generic', 'dosing']);
    expect(fieldsForYear(defs, 'P3')).toEqual(['generic', 'dosing', 'moa']);
    // A field marked not quizzable stays out however the years line up.
    expect(fieldsForYear(defs, 'P2')).not.toContain('internal');
  });

  it('builds a card key that survives reordering the same selection', () => {
    const a = cardKey({ mode: 'inclusive', direction: 'drug_to_fields', fieldKeys: ['moa', 'dosing'] });
    const b = cardKey({ mode: 'inclusive', direction: 'drug_to_fields', fieldKeys: ['dosing', 'moa'] });
    expect(a).toBe(b);
  });

  it('separates keys that mean different things to recall', () => {
    const inclusive = cardKey({ mode: 'inclusive', direction: 'drug_to_fields', fieldKeys: ['moa', 'dosing'] });
    const exclusive = cardKey({ mode: 'exclusive', direction: 'drug_to_fields', fieldKeys: ['moa'] });
    const reversed = cardKey({ mode: 'exclusive', direction: 'fields_to_drug', fieldKeys: ['moa'] });

    expect(new Set([inclusive, exclusive, reversed]).size).toBe(3);
  });

  it('fills gaps in a stored config rather than trusting it whole', () => {
    const config = normalizeConfig({ blockSize: -5, fields: ['moa'] });
    expect(config.blockSize).toBe(0);
    expect(config.grading).toBe('binary');
    expect(config.scope.verifiedOnly).toBe(false);
  });
});

describe('grading scales', () => {
  it('maps the two buttons onto the four-point scale', () => {
    expect(gradeFromBinary(true)).toBe('good');
    expect(gradeFromBinary(false)).toBe('again');
  });

  it('agrees about what clears a block', () => {
    expect(clearsBlock('good')).toBe(true);
    expect(clearsBlock('easy')).toBe(true);
    expect(clearsBlock('hard')).toBe(false);
    expect(clearsBlock('again')).toBe(false);
    // Got it clears exactly as Good does -- the same claim about the card.
    expect(clearsBlock(gradeFromBinary(true))).toBe(true);
  });
});

describe('scheduling', () => {
  const fresh = { ease: 2.5, intervalDays: 0, reviewCount: 0 };

  it('sends a first correct answer a day out and a second three', () => {
    const first = review(fresh, 'good');
    expect(first.intervalDays).toBe(1);

    const second = review({ ease: first.ease, intervalDays: 1, reviewCount: 1 }, 'good');
    expect(second.intervalDays).toBe(3);
  });

  it('resets a missed card to the same session and lowers its ease', () => {
    const missed = review({ ease: 2.5, intervalDays: 10, reviewCount: 4 }, 'again');
    expect(missed.intervalDays).toBe(0);
    expect(missed.ease).toBeLessThan(2.5);
    expect(missed.lastResult).toBe(false);
  });

  it('never lets ease fall through the floor, however often a card is missed', () => {
    let card = { ease: 2.5, intervalDays: 0, reviewCount: 0 };
    for (let i = 0; i < 20; i += 1) {
      const next = review(card, 'again');
      card = { ease: next.ease, intervalDays: next.intervalDays, reviewCount: next.reviewCount };
    }
    expect(card.ease).toBe(1.3);
  });

  it('stretches further for easy than for good, and shrinks for hard', () => {
    const base = { ease: 2.5, intervalDays: 10, reviewCount: 5 };
    expect(review(base, 'easy').intervalDays).toBeGreaterThan(review(base, 'good').intervalDays);
    expect(review(base, 'hard').intervalDays).toBeLessThan(review(base, 'good').intervalDays);
  });

  it('counts a cram pass without touching the schedule', () => {
    // An evening of blocks must not flatten weeks of spacing.
    const due = new Date('2026-12-01T00:00:00Z');
    const card = { ease: 2.5, intervalDays: 21, dueAt: due, reviewCount: 7 };

    const after = reviewWithoutRescheduling(card, 'again');
    expect(after.dueAt).toEqual(due);
    expect(after.intervalDays).toBe(21);
    expect(after.ease).toBe(2.5);
    expect(after.reviewCount).toBe(8);
    expect(after.lastResult).toBe(false);
  });
});

describe('blocks', () => {
  it('chops the session into consecutive blocks and starts on the first', () => {
    const session = createSession(ids(25), 10);
    expect(session.blocks.map((block) => block.length)).toEqual([10, 10, 5]);
    expect(currentCard(session)).toBe('c1');
    expect(blockProgress(session)).toMatchObject({ block: 1, blocks: 3, cleared: 0, size: 10 });
  });

  it('treats a block size of zero as one flat pass', () => {
    const session = createSession(ids(25), 0);
    expect(session.blocks).toHaveLength(1);
    expect(session.blocks[0]).toHaveLength(25);
  });

  it('does not open the next block until every card in this one is cleared', () => {
    let session = createSession(ids(6), 3);

    // Clear two of three, miss the third.
    session = play(session, ['good', 'good', 'again']);
    expect(blockProgress(session).block).toBe(1);
    // The missed card is all that is left of the block.
    expect(currentCard(session)).toBe('c3');

    session = gradeCard(session, 'good');
    expect(blockProgress(session).block).toBe(2);
    expect(currentCard(session)).toBe('c4');
  });

  it('sends a missed card to the back rather than straight back at you', () => {
    // The answer is still on screen; asking again immediately tests nothing.
    let session = createSession(ids(3), 3);
    session = gradeCard(session, 'again');

    expect(currentCard(session)).toBe('c2');
    expect(session.queue).toEqual(['c2', 'c3', 'c1']);
  });

  it('keeps a stubborn card coming round until it is known', () => {
    let session = createSession(ids(2), 2);
    session = play(session, ['again', 'good']);

    // c1 missed, c2 cleared: only c1 is left, and it is still block one.
    expect(currentCard(session)).toBe('c1');
    expect(blockProgress(session)).toMatchObject({ block: 1, cleared: 1 });

    session = play(session, ['again', 'hard']);
    expect(currentCard(session)).toBe('c1');
    expect(session.finished).toBe(false);

    session = gradeCard(session, 'good');
    expect(session.finished).toBe(true);
  });

  it('clears progress between blocks so each is judged on its own', () => {
    let session = createSession(ids(4), 2);
    session = play(session, ['good', 'good']);

    expect(blockProgress(session)).toMatchObject({ block: 2, cleared: 0, size: 2 });
  });

  it('finishes only after the last block is clear', () => {
    let session = createSession(ids(4), 2);
    session = play(session, ['good', 'good', 'good', 'good']);

    expect(session.finished).toBe(true);
    expect(currentCard(session)).toBeNull();
  });

  it('an empty selection is finished rather than stuck', () => {
    const session = createSession([], 10);
    expect(session.finished).toBe(true);
    expect(currentCard(session)).toBeNull();
    // Grading a finished session is a no-op rather than a crash.
    expect(gradeCard(session, 'good')).toBe(session);
  });

  it('runs a whole binary session through to the end', () => {
    let session = createSession(ids(5), 2);
    let guard = 0;

    while (!session.finished && guard < 100) {
      // Knows the odd-numbered ones, misses the rest the first time.
      const card = currentCard(session)!;
      const gotIt = session.cleared.has(card) || Number(card.slice(1)) % 2 === 1 || guard > 10;
      session = gradeCard(session, gradeFromBinary(gotIt));
      guard += 1;
    }

    expect(session.finished).toBe(true);
    expect(guard).toBeLessThan(100);
  });
});
