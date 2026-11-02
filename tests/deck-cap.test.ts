import { asc } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { drugs, fieldDefs, studyCards, tags, users } from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { DEFAULT_CONFIG, normalizeConfig, type StudyConfig } from '@/lib/study/config';
import { loadDeck } from '@/lib/study/session';

const USER = 'user-student';

/** Thirty drugs, each with a mechanism, so a cap has something to bite on. */
const COUNT = 30;

beforeEach(async () => {
  await db.delete(studyCards);
  await db.delete(drugs);
  await db.delete(tags);
  await db.delete(fieldDefs);
  await db.delete(users);

  await db.insert(users).values({ id: USER, email: 'student@example.test' });
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);

  await db.insert(drugs).values(
    Array.from({ length: COUNT }, (_, i) => ({
      slug: `drug-${String(i).padStart(2, '0')}`,
      genericName: `Drug ${String(i).padStart(2, '0')}`,
      fields: {
        moa: {
          value: `Mechanism ${i}`, status: 'ok' as const, source: 'test',
          updatedAt: '', updatedBy: null,
        },
      },
    })),
  );
});

const config = (partial: Partial<StudyConfig> = {}): StudyConfig => ({
  ...DEFAULT_CONFIG,
  fields: ['moa'],
  sessionMode: 'cram',
  ...partial,
});

describe('max cards per session', () => {
  it('hands over the whole deck when no cap is set', async () => {
    const deck = await loadDeck(USER, config());

    expect(deck.cards).toHaveLength(COUNT);
    expect(deck.available).toBe(COUNT);
    expect(deck.inScope).toBe(COUNT);
  });

  it('caps the deck and still reports what it drew from', async () => {
    const deck = await loadDeck(USER, config({ maxCards: 10 }));

    expect(deck.cards).toHaveLength(10);
    // So the session can say "10 of 30" rather than pretending 30 was never there.
    expect(deck.available).toBe(COUNT);
    expect(deck.inScope).toBe(COUNT);
  });

  it('samples rather than truncating, so the end of the alphabet is reachable', async () => {
    // Sources arrive sorted by generic name. A truncation would mean the same
    // first ten drugs every session and the last twenty never.
    const first = await loadDeck(USER, config({ maxCards: 10 }));
    expect(first.cards.map((card) => card.slug)).not.toEqual(
      (await db.select({ slug: drugs.slug }).from(drugs).orderBy(asc(drugs.genericName)))
        .slice(0, 10)
        .map((row) => row.slug),
    );

    // And over enough draws the whole deck shows up. Forty, not a dozen: each
    // draw misses a given drug two times in three, so twelve draws leave a
    // ~20% chance of missing at least one and the test would fail on its own
    // randomness rather than on a bug.
    const seen = new Set<string>();
    for (let run = 0; run < 40; run += 1) {
      const deck = await loadDeck(USER, config({ maxCards: 10 }));
      for (const card of deck.cards) seen.add(card.slug);
    }
    expect(seen.size).toBe(COUNT);
  });

  it('never repeats a card inside one session', async () => {
    const deck = await loadDeck(USER, config({ maxCards: 10 }));
    expect(new Set(deck.cards.map((card) => card.id)).size).toBe(10);
  });

  it('leaves a deck smaller than the cap alone', async () => {
    const deck = await loadDeck(USER, config({ maxCards: 500 }));
    expect(deck.cards).toHaveLength(COUNT);
  });

  it('caps what is due rather than what exists', async () => {
    // Twenty of the thirty are scheduled for next week. "Max 5" in review mode
    // should mean five of the ten that are actually due -- not five drawn from
    // thirty and then thinned to one or two by the schedule.
    const rows = await db.select({ id: drugs.id }).from(drugs).orderBy(asc(drugs.genericName));
    const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await db.insert(studyCards).values(
      rows.slice(0, 20).map((row) => ({
        userId: USER,
        drugId: row.id,
        cardKey: 'inclusive:drug_to_fields:moa',
        mode: 'inclusive' as const,
        direction: 'drug_to_fields' as const,
        fieldKeys: ['moa'],
        dueAt: nextWeek,
      })),
    );

    const deck = await loadDeck(USER, config({ sessionMode: 'review', maxCards: 5 }));

    expect(deck.cards).toHaveLength(5);
    expect(deck.available).toBe(10);
    expect(deck.inScope).toBe(COUNT);
  });

  it('is ignored while cramming only in the sense that cram ignores due dates', async () => {
    const rows = await db.select({ id: drugs.id }).from(drugs);
    await db.insert(studyCards).values({
      userId: USER,
      drugId: rows[0].id,
      cardKey: 'inclusive:drug_to_fields:moa',
      mode: 'inclusive',
      direction: 'drug_to_fields',
      fieldKeys: ['moa'],
      dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    const deck = await loadDeck(USER, config({ sessionMode: 'cram', maxCards: 12 }));
    expect(deck.available).toBe(COUNT);
    expect(deck.cards).toHaveLength(12);
  });
});

describe('normalizeConfig and the cap', () => {
  it('floors a fractional cap and refuses a negative one', () => {
    expect(normalizeConfig({ maxCards: 12.7 }).maxCards).toBe(12);
    expect(normalizeConfig({ maxCards: -5 }).maxCards).toBe(0);
    // Absent means the whole deck, which is the default the control shows.
    expect(normalizeConfig({}).maxCards).toBe(0);
  });
});
