import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, setFields, setItems, sets, users } from '@/db/schema';
import { parseSet, SET_FORMAT, type ParsedSet } from '@/lib/sets/format';
import { importSet, MIN_DISTINCT, reportColumns } from '@/lib/sets/import';

/**
 * Writing a set into the database, and re-writing it later.
 *
 * The first import is the easy half. What needs pinning is **re-import**, now
 * that sets are editable after the fact: `updatedBy` answers *has a human
 * touched this*, and if they have, the file does not get to overwrite them. The
 * file supplies content; it does not own it after the first import.
 *
 * And the one refusal that belongs here rather than in the parser: a column
 * whose **type** changed under it. The stored cells are one shape or the other,
 * and quietly reinterpreting them is how a parser earns distrust.
 */

const ME = 'me-id';

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(sets);
  await db.delete(users);
  await db.insert(users).values({ id: ME, email: 'me@example.test', role: 'admin' });
});

function file(over: Record<string, unknown> = {}): ParsedSet {
  const result = parseSet({
    format: SET_FORMAT,
    slug: 'thyroid',
    name: 'Thyroid',
    course: 'PSCI 413',
    exam: 'Exam 3',
    unit: 'Unit 5: Thyroid',
    identity: { key: 'generic', label: 'Generic', kind: 'drug' },
    kinds: ['drug'],
    fields: [
      { key: 'mechanism', label: 'Mechanism', type: 'markdown', answers: 'mechanism' },
      { key: 'use', label: 'Clinical use', answers: 'indication' },
    ],
    items: [
      { generic: 'Methimazole', mechanism: 'Inhibits TPO', use: ['Hyperthyroidism'] },
      { generic: 'Propylthiouracil', mechanism: 'Inhibits TPO and D1', use: ['Hyperthyroidism'] },
      { generic: 'Iodide solutions', mechanism: 'Inhibits release', use: ['Pre-surgery'] },
      { generic: 'Radioactive iodide', mechanism: 'Destroys tissue', use: ['Radiotherapy'] },
    ],
    ...over,
  });
  if (!result.ok) throw new Error(`fixture does not parse: ${JSON.stringify(result.problems)}`);
  return result.set;
}

const storedSet = async () => (await db.select().from(sets))[0];
const storedItems = async (setId: string) =>
  db.select().from(setItems).where(eq(setItems.setId, setId));
const liveFields = async (setId: string) =>
  db.select().from(setFields).where(and(eq(setFields.setId, setId), isNull(setFields.deletedAt)));

describe('the first import', () => {
  it('writes the set, its columns and its rows', async () => {
    const result = await importSet(file(), ME, 'merge');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.created).toBe(true);
    expect(result.report.fieldsInserted).toBe(2);
    expect(result.report.itemsInserted).toBe(4);

    const set = await storedSet();
    expect(set.slug).toBe('thyroid');
    expect(set.unit).toBe('Unit 5: Thyroid');
    expect(set.identityKey).toBe('generic');
    expect(await liveFields(set.id)).toHaveLength(2);
    expect(await storedItems(set.id)).toHaveLength(4);
  });

  it('stores a cell the same shape a drug field has, with its provenance', async () => {
    await importSet(file(), ME, 'merge');
    const set = await storedSet();
    const [item] = (await storedItems(set.id)).filter((row) => row.slug === 'methimazole');

    expect(item.values.mechanism?.value).toBe('Inhibits TPO');
    expect(item.values.mechanism?.source).toBe('imported set');
    expect(item.values.mechanism?.status).toBe('ok');
    // Null is the point: an imported value has not been touched by a human, and
    // that is exactly what lets the next re-import overwrite it.
    expect(item.values.mechanism?.updatedBy).toBeNull();
  });

  it('writes one audit row saying what it did', async () => {
    await importSet(file(), ME, 'merge');
    const [row] = await db.select().from(auditLog);
    expect(row.action).toBe('set.import');
    expect(row.targetType).toBe('set');
    expect(row.actorId).toBe(ME);
  });

  it('calls a re-import by its own name in the log', async () => {
    await importSet(file(), ME, 'merge');
    await db.delete(auditLog);
    await importSet(file(), ME, 'merge');
    const [row] = await db.select().from(auditLog);
    expect(row.action).toBe('set.reimport');
  });
});

describe('what the set can be quizzed on', () => {
  /**
   * Said at import time rather than at question time: a column needs four
   * distinct answers before it can make a four-option question, and hearing
   * that while looking at the import beats a short quiz six weeks later.
   */
  it('counts distinct answers per column and says which will quiz', () => {
    const columns = reportColumns(file());
    const byKey = new Map(columns.map((column) => [column.key, column]));

    expect(byKey.get('mechanism')!.distinct).toBe(4);
    expect(byKey.get('mechanism')!.quizzable).toBe(true);

    // Three uses across four rows, one of them repeated.
    expect(byKey.get('use')!.distinct).toBe(3);
    expect(byKey.get('use')!.quizzable).toBe(false);
  });

  it('counts two spellings of one answer once', () => {
    const columns = reportColumns(file({
      items: [
        { generic: 'A', mechanism: 'Inhibits TPO' },
        { generic: 'B', mechanism: 'inhibits tpo' },
        { generic: 'C', mechanism: 'Something else' },
        { generic: 'D', mechanism: 'A third thing' },
      ],
    }));
    expect(columns.find((column) => column.key === 'mechanism')!.distinct).toBe(3);
  });

  it('never calls a context column quizzable', () => {
    const columns = reportColumns(file({
      fields: [
        { key: 'mechanism', answers: 'mechanism' },
        { key: 'notes', label: 'Notes', asks: false },
      ],
      items: [
        { generic: 'A', mechanism: 'One', notes: 'a' },
        { generic: 'B', mechanism: 'Two', notes: 'b' },
        { generic: 'C', mechanism: 'Three', notes: 'c' },
        { generic: 'D', mechanism: 'Four', notes: 'd' },
      ],
    }));
    const notes = columns.find((column) => column.key === 'notes')!;
    expect(notes.distinct).toBe(4);
    expect(notes.quizzable).toBe(false);
  });

  it('warns about a thin column rather than refusing it', async () => {
    const result = await importSet(file(), ME, 'merge');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.warnings.some((warning) => warning.includes('Clinical use'))).toBe(true);
    expect(result.report.warnings.some((warning) => warning.includes(`${MIN_DISTINCT}-option`)))
      .toBe(true);
  });

  /** A sequence draws only from its own steps, so a short one cannot be asked. */
  it('warns about a sequence too short to ask', async () => {
    const result = await importSet(file({
      items: [
        { generic: 'Trapping', sequence: 't4', order: 1 },
        { generic: 'Organification', sequence: 't4', order: 2 },
        { generic: 'Methimazole', mechanism: 'Inhibits TPO' },
        { generic: 'Propylthiouracil', mechanism: 'Inhibits D1' },
      ],
    }), ME, 'merge');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.warnings.some((warning) => warning.includes('"t4"'))).toBe(true);
  });
});

describe('re-import keeps what a person changed', () => {
  it('leaves a row somebody edited alone in merge', async () => {
    await importSet(file(), ME, 'merge');
    const set = await storedSet();

    // A person corrects a cell: `updatedBy` is what records that.
    await db
      .update(setItems)
      .set({
        updatedBy: ME,
        updatedAt: new Date(),
        values: {
          mechanism: {
            value: 'Inhibits thyroid peroxidase, blocking organification',
            status: 'ok', source: 'FDA label',
            updatedAt: new Date().toISOString(), updatedBy: ME,
          },
        },
      })
      .where(and(eq(setItems.setId, set.id), eq(setItems.slug, 'methimazole')));

    const again = await importSet(file(), ME, 'merge');
    expect(again.ok).toBe(true);
    if (!again.ok) return;

    expect(again.report.itemsKept).toEqual(['Methimazole']);
    const [item] = (await storedItems(set.id)).filter((row) => row.slug === 'methimazole');
    expect(item.values.mechanism?.value)
      .toBe('Inhibits thyroid peroxidase, blocking organification');
  });

  it('overwrites a row nobody has touched', async () => {
    await importSet(file(), ME, 'merge');
    const set = await storedSet();

    const changed = file({
      items: [
        { generic: 'Methimazole', mechanism: 'Reworded upstream', use: ['Hyperthyroidism'] },
        { generic: 'Propylthiouracil', mechanism: 'Inhibits TPO and D1', use: ['Hyperthyroidism'] },
        { generic: 'Iodide solutions', mechanism: 'Inhibits release', use: ['Pre-surgery'] },
        { generic: 'Radioactive iodide', mechanism: 'Destroys tissue', use: ['Radiotherapy'] },
      ],
    });
    await importSet(changed, ME, 'merge');

    const [item] = (await storedItems(set.id)).filter((row) => row.slug === 'methimazole');
    expect(item.values.mechanism?.value).toBe('Reworded upstream');
  });

  it('leaves a column somebody renamed alone in merge', async () => {
    await importSet(file(), ME, 'merge');
    const set = await storedSet();

    await db
      .update(setFields)
      .set({ label: 'Mechanism of action', updatedBy: ME, updatedAt: new Date() })
      .where(and(eq(setFields.setId, set.id), eq(setFields.key, 'mechanism')));

    const again = await importSet(file(), ME, 'merge');
    expect(again.ok && again.report.fieldsKept).toEqual(['Mechanism of action']);

    const fields = await liveFields(set.id);
    expect(fields.find((field) => field.key === 'mechanism')!.label).toBe('Mechanism of action');
  });

  /**
   * The resurrection problem `npm run seed` has with drugs, one table over, and
   * the answer is the same: soft-delete, and the importer skips a key it finds
   * already deleted rather than reviving it.
   */
  it('leaves a column somebody deleted deleted in merge', async () => {
    await importSet(file(), ME, 'merge');
    const set = await storedSet();

    await db
      .update(setFields)
      .set({ deletedAt: new Date() })
      .where(and(eq(setFields.setId, set.id), eq(setFields.key, 'use')));

    const again = await importSet(file(), ME, 'merge');
    expect(again.ok && again.report.fieldsLeftDeleted).toEqual(['Clinical use']);
    expect(await liveFields(set.id)).toHaveLength(1);
  });

  it('revives it in replace, which is what replace is for', async () => {
    await importSet(file(), ME, 'merge');
    const set = await storedSet();
    await db
      .update(setFields)
      .set({ deletedAt: new Date() })
      .where(and(eq(setFields.setId, set.id), eq(setFields.key, 'use')));

    await importSet(file(), ME, 'replace');
    expect(await liveFields(set.id)).toHaveLength(2);
  });

  it('overwrites an edit in replace, and says nothing was kept', async () => {
    await importSet(file(), ME, 'merge');
    const set = await storedSet();
    await db
      .update(setItems)
      .set({ updatedBy: ME, values: { mechanism: {
        value: 'Mine', status: 'ok', source: 'me',
        updatedAt: new Date().toISOString(), updatedBy: ME,
      } } })
      .where(and(eq(setItems.setId, set.id), eq(setItems.slug, 'methimazole')));

    const again = await importSet(file(), ME, 'replace');
    expect(again.ok && again.report.itemsKept).toEqual([]);
    const [item] = (await storedItems(set.id)).filter((row) => row.slug === 'methimazole');
    expect(item.values.mechanism?.value).toBe('Inhibits TPO');
  });
});

describe('rows the file stops mentioning', () => {
  it('are left alone in merge', async () => {
    await importSet(file(), ME, 'merge');
    const set = await storedSet();

    await importSet(file({
      items: [{ generic: 'Methimazole', mechanism: 'Inhibits TPO' }],
    }), ME, 'merge');

    expect(await storedItems(set.id)).toHaveLength(4);
  });

  it('are deleted in replace', async () => {
    await importSet(file(), ME, 'merge');
    const set = await storedSet();

    const result = await importSet(file({
      items: [{ generic: 'Methimazole', mechanism: 'Inhibits TPO' }],
    }), ME, 'replace');

    expect(result.ok && result.report.itemsDeleted).toBe(3);
    expect(await storedItems(set.id)).toHaveLength(1);
  });
});

describe('a column whose type changed under it', () => {
  /**
   * The one refusal that belongs to the importer rather than the parser: the
   * file alone is fine, and it is only wrong against what is already stored.
   */
  it('refuses, naming the column, and writes nothing', async () => {
    await importSet(file(), ME, 'merge');
    const set = await storedSet();
    const before = await storedItems(set.id);

    const retyped = file({
      fields: [
        { key: 'mechanism', label: 'Mechanism', type: 'number', answers: 'count' },
        { key: 'use', label: 'Clinical use', answers: 'indication' },
      ],
      items: [
        { generic: 'Methimazole', mechanism: 1, use: ['Hyperthyroidism'] },
        { generic: 'Propylthiouracil', mechanism: 2, use: ['Hyperthyroidism'] },
        { generic: 'Iodide solutions', mechanism: 3, use: ['Pre-surgery'] },
        { generic: 'Radioactive iodide', mechanism: 4, use: ['Radiotherapy'] },
      ],
    });

    const result = await importSet(retyped, ME, 'merge');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('Mechanism');
    expect(result.message).toContain('markdown');

    // Nothing written: the rows and the column are exactly as they were.
    const after = await storedItems(set.id);
    expect(after.map((row) => row.values.mechanism?.value))
      .toEqual(before.map((row) => row.values.mechanism?.value));
    const fields = await liveFields(set.id);
    expect(fields.find((field) => field.key === 'mechanism')!.dataType).toBe('markdown');
  });

  it('does not refuse a type that did not change', async () => {
    await importSet(file(), ME, 'merge');
    const again = await importSet(file(), ME, 'merge');
    expect(again.ok).toBe(true);
  });
});

describe('a second set', () => {
  it('can hold a column with the same key, which is why this is not field_defs', async () => {
    await importSet(file(), ME, 'merge');
    await importSet(file({
      slug: 'adrenal',
      name: 'Adrenal',
      items: [
        { generic: 'Ketoconazole', mechanism: 'Inhibits P450c17' },
        { generic: 'Metyrapone', mechanism: 'Inhibits 11-beta-hydroxylase' },
        { generic: 'Mitotane', mechanism: 'Destroys adrenal cortex' },
        { generic: 'Spironolactone', mechanism: 'Blocks the mineralocorticoid receptor' },
      ],
    }), ME, 'merge');

    expect(await db.select().from(sets)).toHaveLength(2);
    const all = await db.select().from(setFields).where(eq(setFields.key, 'mechanism'));
    expect(all).toHaveLength(2);
  });

  it('keeps its rows to itself', async () => {
    await importSet(file(), ME, 'merge');
    await importSet(file({ slug: 'adrenal', name: 'Adrenal', items: [{ generic: 'Mitotane' }] }), ME, 'merge');

    const rows = await db.select().from(sets).where(eq(sets.slug, 'adrenal'));
    expect(await storedItems(rows[0].id)).toHaveLength(1);
  });
});
