import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { fieldDefs } from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import {
  createFieldDef,
  reorderFieldDefs,
  restoreFieldDef,
  setFieldFlag,
  softDeleteFieldDef,
  updateFieldDef,
} from '@/lib/fields/mutations';
import { listFieldDefs } from '@/lib/fields/registry';

beforeEach(async () => {
  await db.delete(fieldDefs);
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);
});

async function byKey(key: string) {
  const [row] = await db.select().from(fieldDefs).where(eq(fieldDefs.key, key));
  return row;
}

const valid = { label: 'Half life', dataType: 'text' as const, group: 'Clinical' };

describe('createFieldDef', () => {
  it('adds a field that the registry serves immediately', async () => {
    expect(await createFieldDef('half_life', { ...valid, sortOrder: 65 })).toEqual({ ok: true });

    const keys = (await listFieldDefs()).map((d) => d.key);
    expect(keys).toContain('half_life');
    // Sorted into place rather than appended.
    expect(keys.indexOf('half_life')).toBe(keys.indexOf('dosing') + 1);
  });

  it('normalises the key and trims the label', async () => {
    await createFieldDef('  Half_Life  ', { ...valid, label: '  Half life  ' });
    expect((await byKey('half_life')).label).toBe('Half life');
  });

  it('rejects a key that is not lower snake_case', async () => {
    for (const bad of ['Half Life', '1half', 'half-life', '', 'h']) {
      expect(await createFieldDef(bad, valid)).toEqual({
        ok: false,
        message: 'Key must be lower snake_case, starting with a letter.',
      });
    }
  });

  it('rejects a duplicate key, including one that is soft-deleted', async () => {
    await createFieldDef('half_life', valid);
    expect(await createFieldDef('half_life', valid)).toEqual({
      ok: false,
      message: 'A field with the key "half_life" already exists.',
    });

    const { id } = await byKey('half_life');
    await softDeleteFieldDef(id);
    // The key is still taken and its stored values still sit under it.
    expect((await createFieldDef('half_life', valid)).ok).toBe(false);
  });

  it('requires a label', async () => {
    expect(await createFieldDef('x_field', { ...valid, label: '   ' })).toEqual({
      ok: false,
      message: 'Give the field a label.',
    });
  });

  it('requires options for an enum field, and keeps them only for enums', async () => {
    expect(await createFieldDef('dose_form', { label: 'Dose form', dataType: 'enum', enumOptions: [] })).toEqual({
      ok: false,
      message: 'An enum field needs at least one option.',
    });

    await createFieldDef('dose_form', { label: 'Dose form', dataType: 'enum', enumOptions: [' tablet ', 'capsule', ''] });
    expect((await byKey('dose_form')).enumOptions).toEqual(['tablet', 'capsule']);

    await createFieldDef('notes', { label: 'Notes', dataType: 'text', enumOptions: ['ignored'] });
    expect((await byKey('notes')).enumOptions).toBeNull();
  });

  it('rejects a year level that is not a program year', async () => {
    expect(await createFieldDef('x_field', { ...valid, yearLevels: ['P1', 'P4'] })).toEqual({
      ok: false,
      message: 'Year levels must be P1, P2 or P3.',
    });
  });
});

describe('updateFieldDef', () => {
  it('renames the label while the key, and so stored values, stay put', async () => {
    const before = await byKey('moa');
    expect(await updateFieldDef(before.id, { label: 'MOA', dataType: 'markdown', group: 'Clinical' })).toEqual({
      ok: true,
    });

    const after = await byKey('moa');
    expect(after.label).toBe('MOA');
    expect(after.key).toBe('moa');
    expect(after.id).toBe(before.id);
  });

  it('can turn blank-means-none on for a field that was a gap', async () => {
    const { id } = await byKey('dosing');
    await updateFieldDef(id, {
      label: 'Dosing',
      dataType: 'markdown',
      blankMeansNone: true,
      yearLevels: ['P2', 'P3'],
    });
    expect((await byKey('dosing')).blankMeansNone).toBe(true);
  });

  it('refuses an invalid change without writing it', async () => {
    const { id } = await byKey('dosing');
    expect(await updateFieldDef(id, { label: '', dataType: 'markdown' })).toEqual({
      ok: false,
      message: 'Give the field a label.',
    });
    expect((await byKey('dosing')).label).toBe('Dosing');
  });
});

describe('softDeleteFieldDef', () => {
  it('hides a field without destroying its definition, and restores it', async () => {
    await createFieldDef('half_life', { ...valid, yearLevels: ['P2'] });
    const { id } = await byKey('half_life');

    expect(await softDeleteFieldDef(id)).toEqual({ ok: true });
    expect((await listFieldDefs()).map((d) => d.key)).not.toContain('half_life');

    expect(await restoreFieldDef(id)).toEqual({ ok: true });
    const restored = await byKey('half_life');
    expect(restored.yearLevels).toEqual(['P2']);
    expect((await listFieldDefs()).map((d) => d.key)).toContain('half_life');
  });

  it('refuses to remove a core field, since its value lives in a column', async () => {
    const generic = await byKey('generic');
    expect(await softDeleteFieldDef(generic.id)).toEqual({
      ok: false,
      message: '"Generic name" is a core field and cannot be removed.',
    });
    expect((await byKey('generic')).deletedAt).toBeNull();
  });

  it('reports a field that is already gone', async () => {
    expect(await softDeleteFieldDef('00000000-0000-0000-0000-000000000000')).toEqual({
      ok: false,
      message: 'That field no longer exists.',
    });
  });
});

/* ------------------------------------------------- the list's own two edits -- */

/**
 * Reordering and the three tick boxes, which the field list writes directly.
 *
 * Both exist because the list cannot use `updateFieldDef`: appearance order is
 * only expressible as the whole order, and a tick box that sent the whole
 * definition back would carry a label and a type it never showed anybody.
 */
describe('reorderFieldDefs', () => {
  const keysInOrder = async () => (await listFieldDefs()).map((field) => field.key);

  it('renumbers from the list it is given', async () => {
    const before = await keysInOrder();
    const moved = [before[2], ...before.filter((_, at) => at !== 2)];

    const ids = new Map((await listFieldDefs()).map((field) => [field.key, field.id]));
    expect(await reorderFieldDefs(moved.map((key) => ids.get(key)!))).toEqual({ ok: true });

    expect(await keysInOrder()).toEqual(moved);
  });

  it('leaves no two fields claiming one position', async () => {
    const ids = (await listFieldDefs()).map((field) => field.id);
    await reorderFieldDefs([...ids].reverse());

    const orders = (await listFieldDefs()).map((field) => field.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('keeps a field created afterwards at the end, where the editor puts it', async () => {
    const ids = (await listFieldDefs()).map((field) => field.id);
    await reorderFieldDefs(ids);
    // The editor's default is 100, which has to stay above a renumbered list
    // for a new field to arrive at the bottom rather than in the middle.
    await createFieldDef('half_life', { ...valid, sortOrder: 100 });

    expect((await keysInOrder()).at(-1)).toBe('half_life');
  });

  it('ignores a repeated id rather than numbering it twice', async () => {
    const ids = (await listFieldDefs()).map((field) => field.id);
    await reorderFieldDefs([ids[0], ids[0], ...ids.slice(1)]);

    const orders = (await listFieldDefs()).map((field) => field.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('refuses an empty list rather than renumbering nothing', async () => {
    expect(await reorderFieldDefs([])).toEqual({
      ok: false, message: 'Nothing to reorder.',
    });
  });
});

describe('setFieldFlag', () => {
  it('writes one boolean and touches nothing else', async () => {
    const before = await byKey('dosing');
    expect(await setFieldFlag(before.id, 'blankMeansNone', true)).toEqual({ ok: true });

    const after = await byKey('dosing');
    expect(after.blankMeansNone).toBe(true);
    // The whole point of a narrow mutation: nothing the list never showed can
    // arrive stale and overwrite an edit made in the editor a moment earlier.
    expect(after.label).toBe(before.label);
    expect(after.dataType).toBe(before.dataType);
    expect(after.sortOrder).toBe(before.sortOrder);
    expect(after.isQuizzable).toBe(before.isQuizzable);
    expect(after.defaultVisible).toBe(before.defaultVisible);
  });

  it('turns one off again', async () => {
    const { id } = await byKey('bbw');
    await setFieldFlag(id, 'isQuizzable', false);
    expect((await byKey('bbw')).isQuizzable).toBe(false);
  });

  it('works on a core field, which has these three like any other', async () => {
    const { id } = await byKey('generic');
    expect(await setFieldFlag(id, 'defaultVisible', false)).toEqual({ ok: true });
    expect((await byKey('generic')).defaultVisible).toBe(false);
  });

  it('says so when the field is gone', async () => {
    const result = await setFieldFlag(
      '00000000-0000-0000-0000-000000000000', 'isQuizzable', false,
    );
    expect(result).toEqual({ ok: false, message: 'That field no longer exists.' });
  });
});
