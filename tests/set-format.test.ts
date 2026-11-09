import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSet, SET_FORMAT, itemSlug } from '@/lib/sets/format';
import { ANSWER_TYPES } from '@/lib/sets/vocabulary';

/**
 * Reading an `enkephalin.set/1` file.
 *
 * Two things are being tested, and the first matters more. **The guide and the
 * parser must not drift**: `docs/set-format.md` is what somebody is handed
 * along with their lecture notes, so its worked example is a promise, and this
 * file holds the parser to it by reading that example out of the document
 * rather than copying it.
 *
 * Second, **every refusal in the list refuses**. The importer is all-or-nothing
 * because a half-imported set is a set whose gaps nobody knows about, so each
 * entry on that list is load-bearing and each one gets a case here.
 */

const base = () => ({
  format: SET_FORMAT,
  slug: 'thyroid-drugs',
  name: 'Thyroid — Drugs to Know',
  identity: { key: 'generic', label: 'Generic', kind: 'drug' },
  kinds: ['drug'],
  fields: [
    { key: 'mechanism', label: 'Mechanism', type: 'markdown', answers: 'mechanism' },
  ],
  items: [
    { generic: 'Methimazole', mechanism: 'Inhibits thyroid peroxidase' },
  ],
}) as Record<string, unknown>;

const problems = (input: unknown) => {
  const result = parseSet(input);
  return result.ok ? [] : result.problems;
};
const refusedAt = (input: unknown) => problems(input).map((problem) => problem.at);

describe('the guide and the parser stay in step', () => {
  /**
   * Read out of the document, not copied from it. A copy would keep passing
   * after somebody edited the guide, which is the drift this is here to catch.
   */
  it('accepts the worked example in docs/set-format.md', () => {
    const doc = readFileSync('docs/set-format.md', 'utf8');
    const blocks = [...doc.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1]);

    const examples = blocks
      .map((block) => {
        try {
          return JSON.parse(block) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((parsed): parsed is Record<string, unknown> => parsed?.format === SET_FORMAT);

    // The skeleton is deliberately blank, so the only *complete* example is the
    // worked one at the end. If that stops being true, this needs to know.
    expect(examples.length).toBeGreaterThan(0);

    const worked = examples[examples.length - 1];
    const result = parseSet(worked);

    // Printed, because "expected true, got false" is useless when the guide
    // and the parser have drifted and the question is *how*.
    if (!result.ok) {
      throw new Error(`The guide's worked example no longer parses:\n${
        result.problems.map((problem) => `  ${problem.at}: ${problem.message}`).join('\n')}`);
    }

    expect(result.set.slug).toBe('ergi-pd-hyperthyroidism-drugs');
    expect(result.set.items).toHaveLength(2);
    expect(result.set.groupKey).toBe('subclass');
  });

  it('documents every answer type it accepts, and accepts every one it documents', () => {
    const doc = readFileSync('docs/set-format.md', 'utf8');
    for (const type of ANSWER_TYPES) {
      expect(doc, `${type} is accepted but not documented`).toContain(`\`${type}\``);
    }
  });
});

describe('the format marker', () => {
  it('refuses a file that is not a set, and says so once', () => {
    expect(refusedAt({ ...base(), format: 'anki/2' })).toEqual(['format']);
    expect(refusedAt({ slug: 'x' })).toEqual(['format']);
  });

  it('refuses something that is not an object at all', () => {
    expect(refusedAt('[]')).toEqual(['file']);
    expect(refusedAt([1, 2, 3])).toEqual(['file']);
  });
});

describe('the set itself', () => {
  it('needs a slug, in kebab-case', () => {
    expect(refusedAt({ ...base(), slug: undefined })).toContain('slug');
    expect(refusedAt({ ...base(), slug: 'Thyroid Drugs' })).toContain('slug');
    expect(parseSet({ ...base(), slug: 'a-b-2' }).ok).toBe(true);
  });

  it('needs a name and an identity', () => {
    expect(refusedAt({ ...base(), name: '  ' })).toContain('name');
    expect(refusedAt({ ...base(), identity: undefined })).toContain('identity');
    expect(refusedAt({ ...base(), identity: { label: 'Generic', kind: 'drug' } }))
      .toContain('identity.key');
  });

  /** Declared up front means declared -- including the set's own default. */
  it('refuses an identity kind missing from kinds', () => {
    expect(refusedAt({ ...base(), kinds: ['hormone'] })).toContain('identity.kind');
  });

  it('refuses a group naming a column that does not exist', () => {
    expect(refusedAt({ ...base(), group: 'subclass' })).toEqual(['group']);
    expect(parseSet({ ...base(), group: 'mechanism' }).ok).toBe(true);
  });
});

describe('the columns', () => {
  it('refuses an answers type outside the vocabulary', () => {
    const input = base();
    input.fields = [{ key: 'vibe', label: 'Vibe', answers: 'vibes' }];
    expect(refusedAt(input)).toContain('fields[0].answers');
  });

  /** The rule that stops every set growing a Notes column nobody can answer. */
  it('refuses a column that is asked but says nothing about what it holds', () => {
    const input = base();
    input.fields = [{ key: 'notes', label: 'Notes' }];
    expect(refusedAt(input)).toContain('fields[0].answers');
  });

  it('accepts that same column once it says it is not an answer', () => {
    const input = base();
    input.fields = [
      { key: 'mechanism', answers: 'mechanism' },
      { key: 'notes', label: 'Notes', asks: false },
    ];
    const result = parseSet(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const notes = result.set.fields.find((field) => field.key === 'notes')!;
      expect(notes.asks).toBe(false);
      expect(notes.answersType).toBeNull();
    }
  });

  it('refuses two columns with the same key', () => {
    const input = base();
    input.fields = [
      { key: 'use', answers: 'indication' },
      { key: 'use', answers: 'effect' },
    ];
    expect(refusedAt(input)).toContain('fields[1].key');
  });

  it('refuses an enum column with no options', () => {
    const input = base();
    input.fields = [{ key: 'subclass', type: 'enum', answers: 'chemical_class' }];
    expect(refusedAt(input)).toContain('fields[0].options');
  });

  it('fills in a label from the key, and a type from the answers', () => {
    const input = base();
    input.fields = [
      { key: 'mechanism', answers: 'mechanism' },
      { key: 'use', answers: 'indication' },
      { key: 'residues', answers: 'count' },
    ];
    const result = parseSet(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byKey = new Map(result.set.fields.map((field) => [field.key, field]));
    expect(byKey.get('mechanism')!.label).toBe('mechanism');
    expect(byKey.get('mechanism')!.dataType).toBe('markdown');
    expect(byKey.get('use')!.dataType).toBe('list');
    expect(byKey.get('residues')!.dataType).toBe('number');
  });

  /**
   * An entity can be the clue -- *which drug inhibits TPO?* -- and prose
   * cannot, because *which drug has this description?* is answerable by
   * reading. A column may still override either way.
   */
  it('makes entity columns reversible and prose not, unless told otherwise', () => {
    const input = base();
    input.fields = [
      { key: 'target', answers: 'enzyme' },
      { key: 'blurb', answers: 'prose' },
      { key: 'forced', answers: 'prose', reversible: true },
    ];
    // The base row carries a `mechanism` cell, and these columns do not
    // include it -- which the parser is right to refuse.
    input.items = [{ generic: 'Methimazole', target: 'Thyroid peroxidase' }];
    const result = parseSet(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const byKey = new Map(result.set.fields.map((field) => [field.key, field]));
    expect(byKey.get('target')!.reversible).toBe(true);
    expect(byKey.get('blurb')!.reversible).toBe(false);
    expect(byKey.get('forced')!.reversible).toBe(true);
  });
});

describe('the rows', () => {
  it('refuses a row with no identity value', () => {
    const input = base();
    input.items = [{ mechanism: 'Does a thing' }];
    expect(refusedAt(input)).toContain('items[0].generic');
  });

  it('refuses two rows that are the same thing, however they are cased', () => {
    const input = base();
    input.items = [{ generic: 'Methimazole' }, { generic: 'methimazole' }];
    expect(refusedAt(input)).toContain('items[1].generic');
  });

  /** Different words, same slug: a collision in the database and in a URL. */
  it('refuses two rows that shorten to one slug', () => {
    const input = base();
    input.items = [{ generic: 'T-4' }, { generic: 'T 4' }];
    expect(refusedAt(input)).toContain('items[1].generic');
  });

  it('refuses a kind the set did not declare', () => {
    const input = base();
    input.items = [{ generic: 'Thyroxine', kind: 'hormone' }];
    expect(refusedAt(input)).toContain('items[0].kind');
  });

  it('refuses a cell for a column that was never declared', () => {
    const input = base();
    input.items = [{ generic: 'Methimazole', toxicity: 'Agranulocytosis' }];
    expect(refusedAt(input)).toContain('items[0].toxicity');
  });

  it('refuses an enum cell outside its own options', () => {
    const input = base();
    input.fields = [{ key: 'subclass', type: 'enum', answers: 'chemical_class', options: ['Thioamide', 'Iodide'] }];
    input.items = [{ generic: 'Methimazole', subclass: 'Thioamides' }];
    expect(refusedAt(input)).toContain('items[0].subclass');
  });

  it('refuses a number cell that is not a number', () => {
    const input = base();
    input.fields = [{ key: 'residues', answers: 'count' }];
    input.items = [{ generic: 'Insulin', residues: '51 amino acids' }];
    expect(refusedAt(input)).toContain('items[0].residues');
  });

  it('leaves a missing cell out rather than storing an empty one', () => {
    const input = base();
    input.items = [{ generic: 'Methimazole', mechanism: '   ' }];
    const result = parseSet(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.set.items[0].values).toEqual({});
  });

  it('joins a list cell the way the field formatter reads it', () => {
    const input = base();
    input.fields = [{ key: 'use', answers: 'indication' }];
    input.items = [{ generic: 'Methimazole', use: ['Hyperthyroidism', 'Graves disease'] }];
    const result = parseSet(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.set.items[0].values.use).toBe('Hyperthyroidism\nGraves disease');
  });

  it('does not split a single string in a list column', () => {
    const input = base();
    input.fields = [{ key: 'use', answers: 'indication' }];
    input.items = [{ generic: 'Metformin', use: 'Diabetes, type 2' }];
    const result = parseSet(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.set.items[0].values.use).toBe('Diabetes, type 2');
  });
});

describe('aliases', () => {
  it('refuses the same alias on two rows', () => {
    const input = base();
    input.kinds = ['drug', 'hormone'];
    input.items = [
      { generic: 'Levothyroxine', aliases: ['T4'] },
      { generic: 'Liothyronine', aliases: ['T4'] },
    ];
    expect(refusedAt(input)).toContain('items[1].aliases');
  });

  it('refuses an alias that is another row name', () => {
    const input = base();
    input.items = [
      { generic: 'Thyroxine' },
      { generic: 'Levothyroxine', aliases: ['Thyroxine'] },
    ];
    expect(refusedAt(input)).toContain('items[1].aliases');
  });

  it('keeps the aliases a row legitimately has', () => {
    const input = base();
    input.items = [{ generic: 'Levothyroxine', aliases: ['T4', 'Thyroxine', 'Synthroid'] }];
    const result = parseSet(input);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.set.items[0].aliases).toEqual(['T4', 'Thyroxine', 'Synthroid']);
  });
});

describe('sequences', () => {
  it('refuses a position with no sequence to be in', () => {
    const input = base();
    input.items = [{ generic: 'Organification', order: 2 }];
    expect(refusedAt(input)).toContain('items[0].order');
  });

  it('refuses a sequence with no position', () => {
    const input = base();
    input.items = [{ generic: 'Organification', sequence: 't4-synthesis' }];
    expect(refusedAt(input)).toContain('items[0].sequence');
  });

  it('refuses two rows at one position in one sequence', () => {
    const input = base();
    input.items = [
      { generic: 'Organification', sequence: 't4', order: 2 },
      { generic: 'Coupling', sequence: 't4', order: 2 },
    ];
    expect(refusedAt(input)).toContain('items[1].order');
  });

  it('allows one position per sequence across two sequences', () => {
    const input = base();
    input.items = [
      { generic: 'Organification', sequence: 't4', order: 2 },
      { generic: 'Gs activation', sequence: 'gpcr', order: 2 },
    ];
    expect(parseSet(input).ok).toBe(true);
  });

  /** The slides skip steps, and 2-3-5 still answers "what follows 3". */
  it('allows a gap in the numbering', () => {
    const input = base();
    input.items = [
      { generic: 'Second', sequence: 't4', order: 2 },
      { generic: 'Fifth', sequence: 't4', order: 5 },
    ];
    expect(parseSet(input).ok).toBe(true);
  });

  it('refuses a position that is not a whole number', () => {
    const input = base();
    input.items = [{ generic: 'Organification', sequence: 't4', order: 2.5 }];
    expect(refusedAt(input)).toContain('items[0].order');
  });
});

describe('reporting problems', () => {
  /**
   * All of them at once, because fixing a generated file one error per run is
   * how somebody gives up on a format.
   */
  it('reports every problem in the file, not just the first', () => {
    const input = base();
    input.fields = [{ key: 'vibe', answers: 'vibes' }];
    input.items = [{ mechanism: 'x' }, { mechanism: 'y' }];

    expect(problems(input).length).toBeGreaterThan(2);
  });

  it('says where, in the file own words', () => {
    const input = base();
    input.items = [{ generic: 'Methimazole', nope: 'x' }];
    const [problem] = problems(input);
    expect(problem.at).toBe('items[0].nope');
    expect(problem.message).toContain('nope');
  });
});

describe('itemSlug', () => {
  it('is kebab, stripped of accents and punctuation', () => {
    expect(itemSlug('Lugol’s solution')).toBe('lugol-s-solution');
    expect(itemSlug('Radioactive iodide (131-I)')).toBe('radioactive-iodide-131-i');
    expect(itemSlug('Lévothyroxine')).toBe('levothyroxine');
  });

  it('is empty for something with nothing to slug', () => {
    expect(itemSlug('???')).toBe('');
  });
});
