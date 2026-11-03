import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listFieldDefs } from '@/lib/fields/registry';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';

/**
 * Colour is decoration, and nothing studied may depend on it.
 *
 * A palette is a per-user preference -- one person's CIV is another's green,
 * and either of them can set it to anything. So a question whose answer
 * depended on a colour would be a question with a different answer for each
 * reader, and one that could be changed by editing Settings rather than by
 * learning anything.
 *
 * The subtler half is the hint. Nobody would write "which of these is the
 * blue one", but colour-coding the four options of a multiple-choice question
 * would do it by accident: the right answer is the option whose colour matches
 * the drug in the prompt, and the question is answerable without reading it.
 * That is why the ban covers the study *pages* and not only the question
 * builder -- a cue is as fatal as a premise.
 *
 * Enforced by reading the source rather than by a comment asking nicely,
 * because the failure is silent: a quiz with a colour cue still scores, still
 * saves, and still looks exactly right.
 */

const COLOUR_IMPORT = /from\s+['"](?:@\/lib\/theme|\.{1,2}\/(?:\.\.\/)*(?:lib\/)?theme)\//;

/** Where questions are built, and where they are shown. */
const MUST_NOT_SEE_COLOUR = ['lib/study', 'app/study'];

function sourceFiles(dir: string): string[] {
  const here = join(process.cwd(), dir);
  const out: string[] = [];

  const walk = (path: string) => {
    for (const entry of readdirSync(path)) {
      const full = join(path, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
  };

  walk(here);
  return out;
}

describe('the study side cannot see the palette', () => {
  it('finds the files it is meant to be checking', () => {
    // A guard that silently checks nothing is worse than no guard: this is
    // here so a moved directory fails loudly instead of passing vacuously.
    for (const dir of MUST_NOT_SEE_COLOUR) {
      expect(sourceFiles(dir).length, dir).toBeGreaterThan(3);
    }
  });

  it('imports nothing from lib/theme, in the builder or the runners', () => {
    const offenders: string[] = [];

    for (const dir of MUST_NOT_SEE_COLOUR) {
      for (const file of sourceFiles(dir)) {
        if (COLOUR_IMPORT.test(readFileSync(file, 'utf8'))) {
          offenders.push(file.slice(process.cwd().length + 1).replaceAll('\\', '/'));
        }
      }
    }

    // If this fails: a colour reached a quiz or a deck. Either it is answering
    // a question, which makes the answer a per-user preference, or it is
    // hinting at one, which lets the paper be sat without reading it.
    expect(offenders).toEqual([]);
  });

  it('catches an import if one were added', () => {
    // The regex is the whole guard, so it is worth knowing it matches what it
    // claims to -- including the relative forms a file inside app/study would
    // reach for.
    expect(COLOUR_IMPORT.test("import { colorFor } from '@/lib/theme/palette';")).toBe(true);
    expect(COLOUR_IMPORT.test("import { x } from '../../lib/theme/palette';")).toBe(true);
    expect(COLOUR_IMPORT.test("import { y } from './theme/preferences';")).toBe(true);
    expect(COLOUR_IMPORT.test("import { z } from '@/lib/study/quiz';")).toBe(false);
  });
});

describe('no field carries a colour as its content', () => {
  it('asks only about fields whose value is words', async () => {
    const defs = await listFieldDefs();
    const quizzable = defs.filter((def) => def.isQuizzable).map((def) => def.key);

    // Every askable field holds text a person wrote or the sheet gave. None
    // holds a colour, a token, or anything the palette decides -- and
    // `drug_class`, the one field colour is assigned from, is not asked.
    expect(quizzable).not.toContain('drug_class');
    for (const key of quizzable) {
      expect(key).not.toMatch(/colo|palette|theme|swatch/i);
    }
  });

  it('keeps the class out of the asked set at its source too', () => {
    // Checked against the seed as well as the database, so a field_defs row
    // edited by hand cannot quietly make the class askable.
    const drugClass = CORE_FIELD_DEFS.find((def) => def.key === 'drug_class');
    expect(drugClass?.isQuizzable).toBe(false);
  });
});
