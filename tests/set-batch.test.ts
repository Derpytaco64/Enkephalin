import { describe, expect, it } from 'vitest';
import { parseBatch, type SetInput } from '@/lib/sets/batch';
import { SET_FORMAT } from '@/lib/sets/format';

/**
 * Importing several set files in one go.
 *
 * The parsing is `parseSet`'s job and tested in `set-format.test.ts`. What is
 * tested here is the batch's two policy decisions, both of which are about
 * what happens to the *other* files when one of them is wrong:
 *
 * - **A file is the unit of success.** One bad file must not stop the good
 *   ones, or a typo in the ninth deck costs you the other eight.
 * - **A slug collision refuses the batch.** Two files claiming the same set
 *   would resolve by read order, which is not something a person can reason
 *   about -- so neither is written.
 *
 * No database here: `parseBatch` deliberately does not touch one, which is
 * what makes these decisions testable as decisions.
 */

/** A minimal valid set, as a file. */
function file(name: string, slug: string, items: Record<string, unknown>[] = [
  { generic: 'One', mechanism: 'A' },
  { generic: 'Two', mechanism: 'B' },
]): SetInput {
  return {
    name,
    text: JSON.stringify({
      format: SET_FORMAT,
      slug,
      name: slug,
      identity: { key: 'generic', label: 'Generic', kind: 'drug' },
      kinds: ['drug'],
      fields: [{ key: 'mechanism', answers: 'mechanism' }],
      items,
    }),
  };
}

describe('reading a batch', () => {
  it('parses every file and keeps the order they were given in', () => {
    const entries = parseBatch([
      file('thyroid.json', 'thyroid'),
      file('adrenal.json', 'adrenal'),
      file('pituitary.json', 'pituitary'),
    ]);

    expect(entries.map((entry) => entry.name))
      .toEqual(['thyroid.json', 'adrenal.json', 'pituitary.json']);
    expect(entries.every((entry) => entry.ok)).toBe(true);
  });

  it('carries the filename through, because that is what you scan for', () => {
    const [entry] = parseBatch([file('unit-5-thyroid.json', 'thyroid')]);
    expect(entry.name).toBe('unit-5-thyroid.json');
    expect(entry.ok && entry.set.slug).toBe('thyroid');
  });

  it('handles one file, which is still the ordinary case', () => {
    const entries = parseBatch([file('one.json', 'one')]);
    expect(entries).toHaveLength(1);
    expect(entries[0].ok).toBe(true);
  });

  it('has nothing to say about no files', () => {
    expect(parseBatch([])).toEqual([]);
  });
});

describe('one bad file does not stop the good ones', () => {
  it('reports the broken one and parses the rest', () => {
    const entries = parseBatch([
      file('good-1.json', 'thyroid'),
      { name: 'broken.json', text: '{ "format": "enkephalin.set/1", oops }' },
      file('good-2.json', 'adrenal'),
    ]);

    expect(entries.map((entry) => entry.ok)).toEqual([true, false, true]);
    // And the failure says where, which is the useful half of a JSON error.
    const broken = entries[1];
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect('message' in broken && broken.message).toContain('not valid JSON');
  });

  it('tells a JSON syntax error apart from a file that is not a set', () => {
    const entries = parseBatch([
      { name: 'syntax.json', text: '{ not json' },
      { name: 'shape.json', text: '{"format":"enkephalin.set/1"}' },
    ]);

    const [syntax, shape] = entries;
    expect(syntax.ok).toBe(false);
    expect(shape.ok).toBe(false);
    if (syntax.ok || shape.ok) return;

    // A syntax error is one message; a wrong shape is a list of problems with
    // paths, so the two are rendered differently and must stay distinguishable.
    expect('message' in syntax).toBe(true);
    expect('problems' in shape).toBe(true);
    expect('problems' in shape && shape.problems.length).toBeGreaterThan(0);
  });

  it('calls an empty file empty rather than a JSON error', () => {
    const [entry] = parseBatch([{ name: 'blank.json', text: '   \n  ' }]);
    expect(entry.ok).toBe(false);
    if (entry.ok) return;
    expect('message' in entry && entry.message).toBe('The file is empty.');
  });
});

describe('two files claiming the same set', () => {
  it('refuses both rather than letting read order decide', () => {
    const entries = parseBatch([
      file('thyroid-v1.json', 'thyroid'),
      file('thyroid-v2.json', 'thyroid'),
    ]);

    expect(entries.map((entry) => entry.ok)).toEqual([false, false]);
    for (const entry of entries) {
      if (entry.ok) continue;
      expect('message' in entry && entry.message).toContain('"thyroid"');
      // The point of the refusal, said out loud.
      expect('message' in entry && entry.message).toContain('order they were read');
    }
  });

  it('names the other file, so you know which two to look at', () => {
    const [first, second] = parseBatch([
      file('thyroid-v1.json', 'thyroid'),
      file('thyroid-v2.json', 'thyroid'),
    ]);

    if (first.ok || second.ok) throw new Error('both should have been refused');
    expect('message' in first && first.message).toContain('thyroid-v2.json');
    expect('message' in second && second.message).toContain('thyroid-v1.json');
  });

  it('leaves the other sets in the batch alone', () => {
    const entries = parseBatch([
      file('a.json', 'thyroid'),
      file('b.json', 'adrenal'),
      file('c.json', 'thyroid'),
      file('d.json', 'pituitary'),
    ]);

    expect(entries.map((entry) => `${entry.name}:${entry.ok}`)).toEqual([
      'a.json:false', 'b.json:true', 'c.json:false', 'd.json:true',
    ]);
  });

  it('refuses all three when three files claim it', () => {
    const entries = parseBatch([
      file('a.json', 'thyroid'),
      file('b.json', 'thyroid'),
      file('c.json', 'thyroid'),
    ]);
    expect(entries.every((entry) => !entry.ok)).toBe(true);
  });

  /**
   * A file that failed to parse has no slug, so it cannot collide with
   * anything -- and must not make a single good file look like a duplicate.
   */
  it('does not count an unparseable file as a claim on anything', () => {
    const entries = parseBatch([
      file('good.json', 'thyroid'),
      { name: 'broken.json', text: 'not json at all' },
    ]);

    expect(entries[0].ok).toBe(true);
    expect(entries[1].ok).toBe(false);
  });

  /** Same slug, different filenames is the collision; same file name is not. */
  it('does not refuse two files that merely share a filename', () => {
    const entries = parseBatch([
      { ...file('set.json', 'thyroid') },
      { ...file('set.json', 'adrenal') },
    ]);
    expect(entries.every((entry) => entry.ok)).toBe(true);
  });
});
