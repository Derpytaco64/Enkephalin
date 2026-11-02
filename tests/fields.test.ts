import { eq, isNull } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { fieldDefs, type FieldValue } from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { emptyLabel, formatFieldValue } from '@/lib/fields/format';
import { groupFieldDefs, listFieldDefs, type FieldDef } from '@/lib/fields/registry';

beforeEach(async () => {
  await db.delete(fieldDefs);
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);
});

function value(partial: Partial<FieldValue>): FieldValue {
  return {
    value: null,
    status: 'ok',
    source: null,
    updatedAt: '2026-10-29',
    updatedBy: null,
    ...partial,
  };
}

async function def(key: string) {
  const [row] = await db.select().from(fieldDefs).where(eq(fieldDefs.key, key));
  return row;
}

describe('the seeded field set', () => {
  it('carries the year levels the sheet assigns', async () => {
    expect((await def('generic')).yearLevels).toEqual(['P1', 'P2', 'P3']);
    expect((await def('dosing')).yearLevels).toEqual(['P2', 'P3']);
    expect((await def('moa')).yearLevels).toEqual(['P3']);
  });

  it('marks blank as an answer only where blank really is one', async () => {
    expect((await def('bbw')).blankMeansNone).toBe(true);
    expect((await def('controlled')).blankMeansNone).toBe(true);
    expect((await def('moa')).blankMeansNone).toBe(false);
    expect((await def('dosing')).blankMeansNone).toBe(false);
  });

  it('flags the column-backed fields as core', () => {
    const core = CORE_FIELD_DEFS.filter((d) => d.isCore).map((d) => d.key);
    expect(core).toEqual(['generic', 'brand', 'indication', 'drug_class', 'controlled']);
  });

  it('re-seeding leaves an admin rename alone', async () => {
    await db.update(fieldDefs).set({ label: 'MOA', sortOrder: 5 }).where(eq(fieldDefs.key, 'moa'));
    await db.insert(fieldDefs).values(CORE_FIELD_DEFS).onConflictDoNothing({ target: fieldDefs.key });

    const moa = await def('moa');
    expect(moa.label).toBe('MOA');
    expect(moa.sortOrder).toBe(5);
  });
});

describe('listFieldDefs', () => {
  it('returns fields in sort order and hides soft-deleted ones', async () => {
    await db.update(fieldDefs).set({ deletedAt: new Date() }).where(eq(fieldDefs.key, 'dosing'));

    const keys = (await listFieldDefs()).map((d) => d.key);
    expect(keys).not.toContain('dosing');
    expect(keys).toEqual(['generic', 'brand', 'indication', 'drug_class', 'controlled', 'route', 'moa', 'bbw']);
  });

  it('can include soft-deleted fields, and the definition survives an undelete', async () => {
    await db.update(fieldDefs).set({ deletedAt: new Date() }).where(eq(fieldDefs.key, 'dosing'));
    expect((await listFieldDefs({ includeDeleted: true })).map((d) => d.key)).toContain('dosing');

    await db.update(fieldDefs).set({ deletedAt: null }).where(eq(fieldDefs.key, 'dosing'));
    const restored = await def('dosing');
    expect(restored.yearLevels).toEqual(['P2', 'P3']);
    expect((await listFieldDefs()).map((d) => d.key)).toContain('dosing');
  });

  it('keeps keys stable across a rename, so stored values still match', async () => {
    await db.update(fieldDefs).set({ label: 'Renamed entirely' }).where(eq(fieldDefs.key, 'moa'));
    const rows = await db.select().from(fieldDefs).where(isNull(fieldDefs.deletedAt));
    expect(rows.map((r) => r.key)).toContain('moa');
  });
});

describe('groupFieldDefs', () => {
  it('keeps groups in the order their fields first appear', async () => {
    const grouped = groupFieldDefs(await listFieldDefs());
    expect(grouped.map(([name]) => name)).toEqual(['Identity', 'Clinical', 'Regulatory']);
    expect(grouped[0][1].map((d) => d.key)).toEqual(['generic', 'brand', 'drug_class']);
  });

  it('files a field with no group under Other', () => {
    const bare = { key: 'x', label: 'X', group: null } as FieldDef;
    expect(groupFieldDefs([bare]).map(([name]) => name)).toEqual(['Other']);
  });
});

describe('formatFieldValue', () => {
  it('reads a blank black box warning as None, not as a gap', async () => {
    const bbw = await def('bbw');
    expect(formatFieldValue(bbw, value({ value: '' }))).toEqual({ kind: 'none' });
    expect(formatFieldValue(bbw, undefined)).toEqual({ kind: 'none' });
    expect(emptyLabel('none', bbw)).toBe('None');
  });

  it('reads a blank mechanism of action as a gap', async () => {
    const moa = await def('moa');
    expect(formatFieldValue(moa, value({ value: '   ' }))).toEqual({ kind: 'missing' });
    expect(emptyLabel('missing', moa)).toBe('Not recorded yet');
  });

  it('lets an explicit "none" override a field that is normally a gap', async () => {
    const moa = await def('moa');
    expect(formatFieldValue(moa, value({ value: '', status: 'none' }))).toEqual({ kind: 'none' });
  });

  it('says Not controlled rather than None for the schedule', async () => {
    const controlled = await def('controlled');
    expect(emptyLabel('none', controlled)).toBe('Not controlled');
    expect(formatFieldValue(controlled, value({ value: 'CII' }))).toEqual({ kind: 'enum', option: 'CII' });
  });

  it('splits lists on newlines or semicolons and drops bullet markers', async () => {
    const brand = await def('brand');
    expect(formatFieldValue(brand, value({ value: 'Prozac; Sarafem ; ' }))).toEqual({
      kind: 'list',
      items: ['Prozac', 'Sarafem'],
    });
    expect(formatFieldValue(brand, value({ value: '- Mounjaro\n- Zepbound' }))).toEqual({
      kind: 'list',
      items: ['Mounjaro', 'Zepbound'],
    });
  });

  it('splits markdown into paragraphs', async () => {
    const moa = await def('moa');
    expect(formatFieldValue(moa, value({ value: 'One.\n\nTwo.' }))).toEqual({
      kind: 'markdown',
      paragraphs: ['One.', 'Two.'],
    });
  });

  it('shows an unparseable number as itself rather than hiding it', async () => {
    const numeric = { ...(await def('moa')), dataType: 'number' as const };
    expect(formatFieldValue(numeric, value({ value: '12.5' }))).toEqual({ kind: 'number', text: '12.5' });
    expect(formatFieldValue(numeric, value({ value: 'about 12' }))).toEqual({ kind: 'text', text: 'about 12' });
  });

  it('understands the words people actually type for booleans', async () => {
    const flag = { ...(await def('moa')), dataType: 'bool' as const };
    expect(formatFieldValue(flag, value({ value: 'Yes' }))).toEqual({ kind: 'bool', value: true });
    expect(formatFieldValue(flag, value({ value: 'no' }))).toEqual({ kind: 'bool', value: false });
    expect(formatFieldValue(flag, value({ value: 'sometimes' }))).toEqual({ kind: 'text', text: 'sometimes' });
  });
});

describe('what is study material', () => {
  /**
   * The class sheet's own columns are the syllabus, and only they are asked.
   * Drug class comes from RxNorm and route is read out of the name and dosing
   * text, so neither is something the course teaches as a column -- they earn
   * their place as filters, as colour coding, and as distractor support.
   *
   * Pinned because it is quiet to break: a re-seed or an admin edit flips a
   * checkbox, and a field nobody is taught starts appearing in decks.
   */
  const SHEET_COLUMNS = ['generic', 'brand', 'indication', 'dosing', 'controlled', 'moa', 'bbw'];

  it('asks about the sheet columns and nothing else', async () => {
    const defs = await listFieldDefs();

    expect(defs.filter((def) => def.isQuizzable).map((def) => def.key).sort())
      .toEqual([...SHEET_COLUMNS].sort());
  });

  it('keeps class and route as data rather than as questions', async () => {
    const defs = await listFieldDefs();

    for (const key of ['drug_class', 'route']) {
      const def = defs.find((candidate) => candidate.key === key);
      expect(def, `${key} should still exist`).toBeDefined();
      expect(def!.isQuizzable, `${key} should not be asked`).toBe(false);
      // Still a field: profiles show it and the study scope filters on it.
      expect(def!.deletedAt).toBeNull();
    }
  });
});
