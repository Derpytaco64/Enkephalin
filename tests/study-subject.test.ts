import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { drugs, setItems, sets, studyCards, users } from '@/db/schema';

/**
 * The study tables learning a second kind of subject.
 *
 * Everything here is enforced in SQL that Drizzle cannot express, which is
 * exactly why it needs a test: migration 0011's unique index coalesces two
 * nullable columns, and the check constraints are the only thing making "a card
 * about nothing" unrepresentable.
 *
 * **The index is the trap, and this project has already fallen into it once.**
 * In Postgres nulls are distinct, so the moment `drug_id` could be null,
 * `(user_id, drug_id, card_key)` stopped constraining the set-item case at all
 * -- every set card would look unique and a deck would grow a duplicate on
 * every rebuild. Migration 0010 hit the same thing and fixed it the same way.
 */

const ME = 'me-id';

beforeEach(async () => {
  await db.delete(studyCards);
  await db.delete(sets);
  await db.delete(drugs);
  await db.delete(users);
  await db.insert(users).values({ id: ME, email: 'me@example.test', role: 'admin' });
});

async function aDrug() {
  const [row] = await db.insert(drugs)
    .values({ slug: 'atenolol', genericName: 'Atenolol', fields: {} })
    .returning({ id: drugs.id });
  return row.id;
}

async function anItem(slug = 'methimazole', extra: Record<string, unknown> = {}) {
  const [set] = await db.insert(sets).values({
    slug: 'thyroid', name: 'Thyroid', identityKey: 'generic',
    identityLabel: 'Generic', identityKind: 'drug', kinds: ['drug'],
  }).onConflictDoNothing().returning({ id: sets.id });

  const setId = set?.id ?? (await db.select({ id: sets.id }).from(sets))[0].id;
  const [row] = await db.insert(setItems)
    .values({ setId, name: slug, slug, kind: 'drug', ...extra } as never)
    .returning({ id: setItems.id });
  return row.id;
}

const card = (over: Record<string, unknown>) => ({
  userId: ME, cardKey: 'moa', mode: 'exclusive' as const,
  direction: 'drug_to_fields' as const, fieldKeys: ['moa'], ...over,
});

describe('the unique index, which Drizzle cannot write', () => {
  it('coalesces both subject columns rather than listing them', async () => {
    const [row] = await db.execute<{ indexdef: string }>(sql`
      select indexdef from pg_indexes where indexname = 'study_cards_unique'`);

    const def = row.indexdef.toLowerCase();
    expect(def).toContain('coalesce(drug_id');
    expect(def).toContain('coalesce(item_id');
    expect(def).toContain('unique');
  });

  /**
   * The regression the coalesce exists for. With a plain index this passes
   * silently and the second row lands.
   */
  it('still catches a duplicate card about a set item', async () => {
    const itemId = await anItem();
    await db.insert(studyCards).values(card({ itemId }));

    await expect(db.insert(studyCards).values(card({ itemId }))).rejects.toThrow();
    expect(await db.select().from(studyCards)).toHaveLength(1);
  });

  it('still catches a duplicate card about a drug', async () => {
    const drugId = await aDrug();
    await db.insert(studyCards).values(card({ drugId }));

    await expect(db.insert(studyCards).values(card({ drugId }))).rejects.toThrow();
  });

  /**
   * And it must not over-constrain: a drug and a set item sharing a card key
   * are two different cards, and the zero-uuid placeholder has to keep them
   * apart rather than collapsing them together.
   */
  it('lets a drug card and a set card share a card key', async () => {
    const drugId = await aDrug();
    const itemId = await anItem();

    await db.insert(studyCards).values(card({ drugId }));
    await db.insert(studyCards).values(card({ itemId }));

    expect(await db.select().from(studyCards)).toHaveLength(2);
  });
});

describe('exactly one subject', () => {
  it('refuses a card about nothing', async () => {
    await expect(db.insert(studyCards).values(card({}))).rejects.toThrow();
  });

  it('refuses a card about both at once', async () => {
    const drugId = await aDrug();
    const itemId = await anItem();
    await expect(db.insert(studyCards).values(card({ drugId, itemId }))).rejects.toThrow();
  });
});

describe('a sequence is both keys or neither', () => {
  it('refuses a position with no sequence to be in', async () => {
    await expect(anItem('orphan-step', { sequenceOrder: 2 })).rejects.toThrow();
  });

  it('refuses a sequence with no position', async () => {
    await expect(anItem('vague-step', { sequence: 't4-synthesis' })).rejects.toThrow();
  });

  it('takes both together', async () => {
    const id = await anItem('organification', { sequence: 't4-synthesis', sequenceOrder: 2 });
    expect(id).toBeTruthy();
  });

  /** Two rows at one position is a set that cannot answer "what follows 3". */
  it('refuses two rows at the same position in one sequence', async () => {
    await anItem('organification', { sequence: 't4-synthesis', sequenceOrder: 2 });
    await expect(anItem('also-second', { sequence: 't4-synthesis', sequenceOrder: 2 }))
      .rejects.toThrow();
  });

  it('allows the same position in two different sequences', async () => {
    await anItem('organification', { sequence: 't4-synthesis', sequenceOrder: 2 });
    const other = await anItem('gpcr-step-2', { sequence: 'gpcr-cascade', sequenceOrder: 2 });
    expect(other).toBeTruthy();
  });

  /**
   * Gaps are fine and must stay fine: the slides skip steps, and a set holding
   * only 2, 3 and 5 still asks "what follows 3" correctly.
   */
  it('allows a gap in the numbering', async () => {
    await anItem('second', { sequence: 't4-synthesis', sequenceOrder: 2 });
    await anItem('fifth', { sequence: 't4-synthesis', sequenceOrder: 5 });
    expect(await db.select().from(setItems)).toHaveLength(2);
  });
});

describe('a set column is unique per set, not globally', () => {
  it('lets two sets both have a column called definition', async () => {
    const [a] = await db.insert(sets).values({
      slug: 'one', name: 'One', identityKey: 'term',
      identityLabel: 'Term', identityKind: 'term', kinds: ['term'],
    }).returning({ id: sets.id });
    const [b] = await db.insert(sets).values({
      slug: 'two', name: 'Two', identityKey: 'term',
      identityLabel: 'Term', identityKind: 'term', kinds: ['term'],
    }).returning({ id: sets.id });

    // The whole reason this is not `field_defs`, whose key is globally unique.
    await db.execute(sql`
      insert into set_fields (set_id, key, label) values
        (${a.id}, 'definition', 'Definition'),
        (${b.id}, 'definition', 'Definition')`);

    const [row] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from set_fields where key = 'definition'`);
    expect(row.n).toBe(2);
  });
});
