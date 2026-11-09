import { describe, expect, it } from 'vitest';
import { mergeSources } from '@/lib/sets/scope';
import { subjectOf } from '@/lib/sets/session';
import { defOf, type SetStudySource } from '@/lib/sets/source';
import type { FieldValue } from '@/db/schema';
import type { FieldDef } from '@/lib/fields/registry';

/**
 * Merging several sets into one deck.
 *
 * This is where studying a node of the tree is decided, and the governing rule
 * is *a node studies what its sets agree on, and says what it left out*. Each
 * test below is one half of that: what survives the merge, or what is dropped
 * and named.
 */

function value(text: string): FieldValue {
  return { value: text, status: 'ok', source: 'test', updatedAt: '', updatedBy: null };
}

function def(
  key: string,
  label: string,
  over: Partial<Parameters<typeof defOf>[0]> = {},
): FieldDef {
  return defOf({
    id: `def-${key}`,
    key,
    label,
    dataType: 'text',
    enumOptions: null,
    prompt: null,
    asks: true,
    sortOrder: 0,
    ...over,
  });
}

/** A loaded set, as `loadSet` + `withIdentityValue` would hand it over. */
function loaded(input: {
  slug: string;
  identityKey?: string;
  identityLabel?: string;
  identityKind?: string;
  defs: FieldDef[];
  items: { name: string; slug: string; values: Record<string, string>; recallOnly?: boolean }[];
}): SetStudySource {
  const identityKey = input.identityKey ?? 'generic';
  const identityLabel = input.identityLabel ?? 'Generic';
  const identityKind = input.identityKind ?? 'drug';

  return {
    set: {
      id: `set-${input.slug}`,
      slug: input.slug,
      name: input.slug,
      course: 'Pharm', exam: 'Exam 3', unit: null, topic: null,
      identityKey, identityLabel, identityKind,
      groupKey: null,
    },
    defs: [def(identityKey, identityLabel, { sortOrder: -1 }), ...input.defs],
    sources: input.items.map((item) => ({
      drugId: `item-${input.slug}-${item.slug}`,
      slug: item.slug,
      generic: item.name,
      drugClass: null,
      schedule: null,
      routes: [],
      tags: [`set:${input.slug}`, 'course:pharm', 'exam:exam-3'],
      indications: [],
      dosingSig: null,
      dosingBranches: [],
      needsPairingReview: false,
      values: {
        ...Object.fromEntries(Object.entries(item.values).map(([key, text]) => [key, value(text)])),
        [identityKey]: value(item.name),
      },
    })),
    extras: new Map(input.items.map((item) => [item.slug, {
      kind: identityKind,
      aliases: [],
      sequence: null,
      sequenceOrder: null,
      recallOnly: item.recallOnly ?? false,
      answersTypes: {},
    }])),
  };
}

const thyroid = loaded({
  slug: 'thyroid',
  defs: [def('mechanism', 'Mechanism')],
  items: [
    { name: 'Levothyroxine', slug: 'levothyroxine', values: { mechanism: 'T4 replacement' } },
    { name: 'Methimazole', slug: 'methimazole', values: { mechanism: 'Blocks TPO' } },
  ],
});

const adrenal = loaded({
  slug: 'adrenal',
  defs: [def('mechanism', 'Mechanism')],
  items: [
    { name: 'Hydrocortisone', slug: 'hydrocortisone', values: { mechanism: 'Glucocorticoid' } },
  ],
});

describe('what survives the merge', () => {
  it('puts every set\'s rows in one deck', () => {
    const { source } = mergeSources([thyroid, adrenal]);
    expect(source.sources.map((item) => item.generic))
      .toEqual(['Levothyroxine', 'Methimazole', 'Hydrocortisone']);
  });

  it('keeps a column the sets share as one column', () => {
    const { source } = mergeSources([thyroid, adrenal]);
    expect(source.defs.map((d) => d.key)).toEqual(['mechanism']);
  });

  /** The reason to study a unit instead of a set: a bigger pool to draw from. */
  it('leaves three rows answering the same column, which is the distractor pool', () => {
    const { source } = mergeSources([thyroid, adrenal]);
    const answers = source.sources.map((item) => item.values.mechanism?.value);
    expect(answers).toEqual(['T4 replacement', 'Blocks TPO', 'Glucocorticoid']);
  });

  it('keeps a column only one set has', () => {
    const extra = loaded({
      slug: 'renal',
      defs: [def('mechanism', 'Mechanism'), def('onset', 'Onset')],
      items: [{ name: 'Furosemide', slug: 'furosemide', values: { onset: 'Fast' } }],
    });

    const { source, notes } = mergeSources([thyroid, extra]);
    expect(source.defs.map((d) => d.key).sort()).toEqual(['mechanism', 'onset']);
    expect(notes).toEqual([]);
  });

  it('never offers a set\'s identity column as a fact to be asked', () => {
    const { source } = mergeSources([thyroid, adrenal]);
    expect(source.defs.map((d) => d.key)).not.toContain('generic');
  });

  it('names every row under the chosen identity key, so one question fits all', () => {
    const { source } = mergeSources([thyroid, adrenal]);
    for (const item of source.sources) {
      expect(source.set.identityKey in item.values).toBe(true);
      expect(item.values[source.set.identityKey]?.value).toBe(item.generic);
    }
  });

  it('sorts the merged columns by the order the files declared', () => {
    const a = loaded({
      slug: 'a',
      defs: [def('second', 'Second', { sortOrder: 2 }), def('first', 'First', { sortOrder: 1 })],
      items: [{ name: 'X', slug: 'x', values: {} }],
    });
    const { source } = mergeSources([a]);
    expect(source.defs.map((d) => d.key)).toEqual(['first', 'second']);
  });
});

describe('two sets with a row of the same name', () => {
  const dup = loaded({
    slug: 'other',
    defs: [def('mechanism', 'Mechanism')],
    items: [{ name: 'Levothyroxine', slug: 'levothyroxine', values: { mechanism: 'Also T4' }, recallOnly: true }],
  });

  it('keeps them apart by prefixing the set', () => {
    const { source } = mergeSources([thyroid, dup]);
    expect(source.sources.map((item) => item.slug)).toEqual([
      'thyroid/levothyroxine', 'thyroid/methimazole', 'other/levothyroxine',
    ]);
  });

  /** The flag that would otherwise cross over: one row is flashcard-only. */
  it('keeps each row\'s own flags with it', () => {
    const { source } = mergeSources([thyroid, dup]);
    expect(source.extras.get('thyroid/levothyroxine')?.recallOnly).toBe(false);
    expect(source.extras.get('other/levothyroxine')?.recallOnly).toBe(true);
  });

  it('leaves the real item ids untouched, because the schedule is keyed on them', () => {
    const { source } = mergeSources([thyroid, dup]);
    expect(source.sources.map((item) => item.drugId)).toEqual([
      'item-thyroid-levothyroxine', 'item-thyroid-methimazole', 'item-other-levothyroxine',
    ]);
  });
});

describe('what the merge refuses to guess', () => {
  it('drops a column two sets disagree about the shape of, and says so', () => {
    const typed = loaded({
      slug: 'renal',
      defs: [def('mechanism', 'Mechanism'), def('onset', 'Onset', { dataType: 'number' })],
      items: [{ name: 'Furosemide', slug: 'furosemide', values: { onset: '30' } }],
    });
    const texty = loaded({
      slug: 'cardio',
      defs: [def('onset', 'Onset')],
      items: [{ name: 'Metoprolol', slug: 'metoprolol', values: { onset: 'Fast' } }],
    });

    const { source, notes } = mergeSources([typed, texty]);
    expect(source.defs.map((d) => d.key)).toEqual(['mechanism']);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Onset');
    expect(notes[0]).toContain('number');
    expect(notes[0]).toContain('cardio');
  });

  it('will not ask a column that any set calls context', () => {
    const asks = loaded({
      slug: 'a',
      defs: [def('notes', 'Notes')],
      items: [{ name: 'X', slug: 'x', values: { notes: 'Something' } }],
    });
    const context = loaded({
      slug: 'b',
      defs: [def('notes', 'Notes', { asks: false })],
      items: [{ name: 'Y', slug: 'y', values: { notes: 'Other' } }],
    });

    const { source, notes } = mergeSources([asks, context]);
    const merged = source.defs.find((d) => d.key === 'notes');
    // Still there to read; never an answer.
    expect(merged).toBeDefined();
    expect(merged?.isQuizzable).toBe(false);
    expect(notes.join(' ')).toContain('never asked');
  });
});

describe('the subject of a mixed deck', () => {
  const hormones = loaded({
    slug: 'hormones',
    identityKey: 'hormone', identityLabel: 'Hormone', identityKind: 'hormone',
    defs: [def('mechanism', 'Mechanism')],
    items: [{ name: 'TSH', slug: 'tsh', values: { mechanism: 'Stimulates thyroid' } }],
  });

  it('asks for the kind when every set is about the same kind', () => {
    const { source, notes } = mergeSources([thyroid, adrenal]);
    expect(source.set.identityKind).toBe('drug');
    expect(subjectOf(source).askingWhich).toBe('Which drug?');
    expect(notes).toEqual([]);
  });

  it('falls back to a name, and says why, when the sets are about different things', () => {
    const { source, notes } = mergeSources([thyroid, hormones]);
    expect(subjectOf(source).askingWhich).toBe('Which one?');
    expect(notes.join(' ')).toContain('different things');
    expect(notes.join(' ')).toContain('hormone');
  });

  it('takes the identity the most sets share', () => {
    const { source } = mergeSources([hormones, thyroid, adrenal]);
    expect(source.set.identityKey).toBe('generic');
  });

  it('drops every set\'s identity column from the askable columns, not just one', () => {
    const { source } = mergeSources([thyroid, hormones]);
    expect(source.defs.map((d) => d.key)).toEqual(['mechanism']);
  });
});

describe('a deck of one', () => {
  it('is just that set', () => {
    const { source, notes } = mergeSources([thyroid]);
    expect(source.sources).toHaveLength(2);
    expect(source.defs.map((d) => d.key)).toEqual(['mechanism']);
    expect(notes).toEqual([]);
  });
});
