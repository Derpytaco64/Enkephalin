import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, drugs, fieldDefs, users, type FieldValue } from '@/db/schema';
import { bulkFields, bulkTargets, setFieldAcross } from '@/lib/admin/bulk';
import { listFieldDefs } from '@/lib/fields/registry';

/**
 * Bulk field set.
 *
 * The two things worth pinning are both about **not lying to the person about
 * to press Apply**. The roster's "gap" count has to mean a genuine gap -- a
 * blank on a `blankMeansNone` field is the answer *none*, not something
 * missing, and getting that backwards would offer to overwrite 146 recorded
 * facts as though they were holes. And the outcome has to separate *changed*
 * from *already matched*, because reporting 180 writes when 179 of them were
 * no-ops makes every future count untrustworthy.
 */

const ADMIN = 'user-admin';

function value(text: string, status: FieldValue['status'], updatedBy: string | null = null): FieldValue {
  return { value: text, status, source: 'class sheet', updatedAt: new Date().toISOString(), updatedBy };
}

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(drugs);
  await db.delete(fieldDefs);
  await db.delete(users);
  await db.insert(users).values({ id: ADMIN, email: 'admin@example.test', role: 'admin' });
  await db.insert(fieldDefs).values([
    { key: 'generic', label: 'Generic name', dataType: 'text', isCore: true },
    { key: 'moa', label: 'Mechanism of action', dataType: 'markdown' },
    { key: 'bbw', label: 'Black box warning', dataType: 'markdown', blankMeansNone: true },
  ]);
});

const def = async (key: string) => (await listFieldDefs()).find((each) => each.key === key)!;

describe('which fields can be set in bulk', () => {
  it('leaves out the core fields, which are columns rather than values', async () => {
    const keys = bulkFields(await listFieldDefs()).map((each) => each.key);
    expect(keys).toContain('moa');
    expect(keys).toContain('bbw');
    expect(keys).not.toContain('generic');
  });
});

describe('the roster', () => {
  it('shows what each drug holds now, and marks a genuine gap', async () => {
    await db.insert(drugs).values([
      { slug: 'has', genericName: 'Has One', fields: { moa: value('Blocks a thing', 'ok') } },
      { slug: 'gap', genericName: 'Gap', fields: {} },
    ]);

    const rows = await bulkTargets(await def('moa'));
    const by = new Map(rows.map((row) => [row.slug, row]));
    expect(by.get('has')?.current).toBe('Blocks a thing');
    expect(by.get('has')?.empty).toBe(false);
    expect(by.get('gap')?.current).toBe('');
    expect(by.get('gap')?.empty).toBe(true);
  });

  /**
   * The distinction the whole field system turns on, and the one this screen
   * could most easily get backwards: a blank black box warning means the drug
   * has none. It is an answer, it is quizzed, and it is **not** a gap waiting
   * to be filled by a bulk write.
   */
  it('does not call a blank on a blankMeansNone field a gap', async () => {
    await db.insert(drugs).values([
      { slug: 'none', genericName: 'No Warning', fields: { bbw: value('', 'none') } },
      { slug: 'bare', genericName: 'Nothing Stored', fields: {} },
    ]);

    const rows = await bulkTargets(await def('bbw'));
    expect(rows.every((row) => row.empty === false)).toBe(true);
    expect(rows.every((row) => row.current === 'None')).toBe(true);
  });

  it('marks the values a person has edited, which a bulk write would undo', async () => {
    await db.insert(drugs).values([
      { slug: 'sheet', genericName: 'From Sheet', fields: { moa: value('x', 'ok', null) } },
      { slug: 'human', genericName: 'By Hand', fields: { moa: value('y', 'ok', ADMIN) } },
    ]);

    const by = new Map((await bulkTargets(await def('moa'))).map((row) => [row.slug, row]));
    expect(by.get('sheet')?.humanSet).toBe(false);
    expect(by.get('human')?.humanSet).toBe(true);
  });
});

describe('applying a value', () => {
  it('separates what changed from what already matched', async () => {
    await db.insert(drugs).values([
      { slug: 'a', genericName: 'Aaa', fields: {} },
      { slug: 'b', genericName: 'Bbb', fields: { moa: value('Shared answer', 'ok') } },
    ]);

    const outcome = await setFieldAcross(
      await def('moa'),
      ['a', 'b'],
      { value: 'Shared answer', source: 'reviewed in bulk', status: 'ok' },
      ADMIN,
    );

    expect(outcome.changed).toEqual(['a']);
    expect(outcome.unchanged).toEqual(['b']);
    expect(outcome.failed).toEqual([]);
  });

  it('writes one ordinary audit row per drug it changed', async () => {
    await db.insert(drugs).values([
      { slug: 'a', genericName: 'Aaa', fields: {} },
      { slug: 'b', genericName: 'Bbb', fields: {} },
    ]);

    await setFieldAcross(
      await def('bbw'),
      ['a', 'b'],
      { value: '', source: 'no warning on the label', status: 'none' },
      ADMIN,
    );

    const log = await db.select().from(auditLog).where(eq(auditLog.action, 'drug.field'));
    expect(log).toHaveLength(2);
    expect(log.every((row) => row.actorId === ADMIN)).toBe(true);
  });

  it('records the source and status it was given', async () => {
    await db.insert(drugs).values({ slug: 'a', genericName: 'Aaa', fields: {} });

    await setFieldAcross(
      await def('moa'),
      ['a'],
      { value: 'Inhibits something', source: 'FDA label', status: 'flagged' },
      ADMIN,
    );

    const [after] = await db.select().from(drugs);
    expect(after.fields.moa?.value).toBe('Inhibits something');
    expect(after.fields.moa?.source).toBe('FDA label');
    expect(after.fields.moa?.status).toBe('flagged');
    expect(after.fields.moa?.updatedBy).toBe(ADMIN);
  });

  it('reports a slug it cannot find instead of throwing', async () => {
    await db.insert(drugs).values({ slug: 'a', genericName: 'Aaa', fields: {} });

    const outcome = await setFieldAcross(
      await def('moa'),
      ['a', 'ghost'],
      { value: 'x', source: '', status: 'ok' },
      ADMIN,
    );

    expect(outcome.changed).toEqual(['a']);
    expect(outcome.failed).toEqual([{ slug: 'ghost', message: 'No such drug.' }]);
  });

  it('touches nothing when given no drugs', async () => {
    await db.insert(drugs).values({ slug: 'a', genericName: 'Aaa', fields: { moa: value('keep', 'ok') } });

    const outcome = await setFieldAcross(
      await def('moa'), [], { value: 'overwrite', source: '', status: 'ok' }, ADMIN,
    );

    expect(outcome).toEqual({ changed: [], unchanged: [], failed: [] });
    const [after] = await db.select().from(drugs);
    expect(after.fields.moa?.value).toBe('keep');
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });
});
