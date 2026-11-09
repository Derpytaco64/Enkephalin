import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  auditLog, quizAnswers, quizAttempts, setFields, setItems, sets, studyCards, users,
} from '@/db/schema';
import { SET_FORMAT, parseSet, type ParsedSet } from '@/lib/sets/format';
import { deleteSet, importSet, setDeletePreviews } from '@/lib/sets/import';

/**
 * Deleting an imported set.
 *
 * The rows and the columns are the easy half -- they came from a file and the
 * file still exists. What this pins is the half nobody can re-import: the SRS
 * schedules and the quiz answers on those rows, which go with the set and are
 * **counted before they go** so the admin screen can say what it cost.
 *
 * And the one thing that must *not* go: a past attempt. Its score stands even
 * once the questions inside it thin out, because the person did sit it -- and
 * deleting attempts that merely touched the set would take a mixed paper's drug
 * questions with it.
 */

const ME = 'me-id';

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(quizAttempts);
  await db.delete(sets);
  await db.delete(users);
  await db.insert(users).values({ id: ME, email: 'me@example.test', role: 'admin' });
});

function file(over: Record<string, unknown> = {}): ParsedSet {
  const parsed = parseSet({
    format: SET_FORMAT,
    slug: 'thyroid',
    name: 'Thyroid drugs',
    identity: { key: 'generic', label: 'Generic', kind: 'drug' },
    kinds: ['drug'],
    fields: [{ key: 'mechanism', label: 'Mechanism', answers: 'mechanism' }],
    items: [
      { generic: 'Levothyroxine', mechanism: 'T4 replacement' },
      { generic: 'Methimazole', mechanism: 'Blocks thyroid peroxidase' },
    ],
    ...over,
  });
  if (!parsed.ok) throw new Error(parsed.problems.map((problem) => problem.message).join('; '));
  return parsed.set;
}

/** A set, plus one schedule and one answer on its first row. */
async function imported(over: Record<string, unknown> = {}) {
  const result = await importSet(file(over), ME, 'merge');
  if (!result.ok) throw new Error(result.message);

  const [{ id: setId }] = await db
    .select({ id: sets.id }).from(sets).where(eq(sets.slug, result.report.slug));
  const items = await db.select().from(setItems).where(eq(setItems.setId, setId));

  return { setId, items, report: result.report };
}

async function withHistory(itemId: string) {
  await db.insert(studyCards).values({
    userId: ME, itemId, cardKey: 'mechanism', mode: 'exclusive',
    direction: 'drug_to_fields', fieldKeys: ['mechanism'],
  });

  const [attempt] = await db
    .insert(quizAttempts)
    .values({ userId: ME, config: {}, score: 1, total: 1 })
    .returning({ id: quizAttempts.id });

  await db.insert(quizAnswers).values({
    attemptId: attempt.id, itemId, questionKey: 'q1', fieldKey: 'mechanism',
    prompt: {}, choices: ['a', 'b'], correctIndex: 0,
  });

  return attempt.id;
}

describe('deleting a set', () => {
  it('takes its rows and its columns', async () => {
    const { setId } = await imported();

    const result = await deleteSet('thyroid', ME);
    expect(result.ok).toBe(true);

    expect(await db.select().from(sets).where(eq(sets.id, setId))).toHaveLength(0);
    expect(await db.select().from(setItems).where(eq(setItems.setId, setId))).toHaveLength(0);
    expect(await db.select().from(setFields).where(eq(setFields.setId, setId))).toHaveLength(0);
  });

  it('reports what went, counted before it went', async () => {
    const { items } = await imported();
    await withHistory(items[0].id);

    const result = await deleteSet('thyroid', ME);
    if (!result.ok) throw new Error(result.message);

    expect(result.report).toMatchObject({
      slug: 'thyroid',
      name: 'Thyroid drugs',
      items: 2,
      fields: 1,
      cards: 1,
      answers: 1,
    });
  });

  it('takes the schedules and the answers on its rows with it', async () => {
    const { items } = await imported();
    await withHistory(items[0].id);

    expect(await db.select().from(studyCards)).toHaveLength(1);
    expect(await db.select().from(quizAnswers)).toHaveLength(1);

    await deleteSet('thyroid', ME);

    expect(await db.select().from(studyCards)).toHaveLength(0);
    expect(await db.select().from(quizAnswers)).toHaveLength(0);
  });

  it('leaves the attempt itself standing, score and all', async () => {
    const { items } = await imported();
    const attemptId = await withHistory(items[0].id);

    await deleteSet('thyroid', ME);

    const [attempt] = await db
      .select().from(quizAttempts).where(eq(quizAttempts.id, attemptId));
    expect(attempt).toBeDefined();
    expect(attempt.score).toBe(1);
  });

  it('writes an audit row that still names the set afterwards', async () => {
    await imported();
    await deleteSet('thyroid', ME);

    const rows = await db.select().from(auditLog).where(eq(auditLog.action, 'set.delete'));
    expect(rows).toHaveLength(1);
    expect(rows[0].targetType).toBe('set');
    expect(rows[0].actorId).toBe(ME);
    // The row is gone, so the diff is the only place left that knows its name.
    expect(rows[0].diff).toMatchObject({ slug: 'thyroid', name: 'Thyroid drugs', items: 2 });
  });

  it('leaves every other set alone', async () => {
    await imported();
    await imported({ slug: 'adrenal', name: 'Adrenal drugs' });

    await deleteSet('thyroid', ME);

    const left = await db.select({ slug: sets.slug }).from(sets);
    expect(left.map((row) => row.slug)).toEqual(['adrenal']);
    expect(await db.select().from(setItems)).toHaveLength(2);
  });

  it('refuses a slug that is not there rather than reporting a delete', async () => {
    const result = await deleteSet('nothing-like-it', ME);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('nothing-like-it');
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });

  it('refuses an empty slug', async () => {
    const result = await deleteSet('   ', ME);
    expect(result.ok).toBe(false);
  });
});

describe('what a delete would cost, for the whole list', () => {
  it('counts rows, columns, schedules and answers per set', async () => {
    const thyroid = await imported();
    const adrenal = await imported({ slug: 'adrenal', name: 'Adrenal drugs' });
    await withHistory(thyroid.items[0].id);
    await withHistory(thyroid.items[1].id);

    const previews = await setDeletePreviews();

    expect(previews.get(thyroid.setId)).toEqual({ items: 2, fields: 1, cards: 2, answers: 2 });
    expect(previews.get(adrenal.setId)).toEqual({ items: 2, fields: 1, cards: 0, answers: 0 });
  });

  it('counts a set nobody has studied as costing no history', async () => {
    const { setId } = await imported();
    expect(previewOf(await setDeletePreviews(), setId)).toMatchObject({ cards: 0, answers: 0 });
  });

  it('does not count a soft-deleted column as a live one', async () => {
    const { setId } = await imported();
    await db
      .update(setFields)
      .set({ deletedAt: new Date() })
      .where(eq(setFields.setId, setId));

    expect(previewOf(await setDeletePreviews(), setId).fields).toBe(0);
  });
});

function previewOf(previews: Awaited<ReturnType<typeof setDeletePreviews>>, setId: string) {
  const found = previews.get(setId);
  if (!found) throw new Error('no preview for that set');
  return found;
}
