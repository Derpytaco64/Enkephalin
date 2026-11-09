import { describe, expect, it } from 'vitest';
import { cellLines, cellOneLine, isMultiline } from '@/lib/sets/render';
import { parseSet, SET_FORMAT } from '@/lib/sets/format';
import { buildQuiz } from '@/lib/study/quiz';
import { defOf } from '@/lib/sets/source';
import type { CardSource } from '@/lib/study/cards';
import type { StudyConfig } from '@/lib/study/config';

/**
 * A cell written in several parts.
 *
 * `docs/set-format.md` tells an author to break a long answer with `<br>`
 * rather than running it together with semicolons. There is **no markdown
 * library in this project at all**, so a literal `<br>` would otherwise reach a
 * reader as four characters.
 *
 * The two properties that matter are both about what the split is *not*:
 *
 * - **It is presentational only.** A cell is one answer however it is written,
 *   so the quiz builder, the distractor pool and the answer key must see the
 *   whole value and never a line of it.
 * - **Nothing is injected as HTML.** The tag is recognised and *discarded*,
 *   never passed through -- accepting one tag from an imported file is how a
 *   format grows an XSS hole.
 */

describe('splitting a cell', () => {
  it('breaks on <br>, however it is written', () => {
    expect(cellLines('One<br>Two')).toEqual(['One', 'Two']);
    expect(cellLines('One<br/>Two')).toEqual(['One', 'Two']);
    expect(cellLines('One<br />Two')).toEqual(['One', 'Two']);
    expect(cellLines('One<BR>Two')).toEqual(['One', 'Two']);
  });

  /** A JSON string can carry one, and an author means the same thing by it. */
  it('treats a real newline identically', () => {
    expect(cellLines('One\nTwo')).toEqual(['One', 'Two']);
    expect(cellLines('One\r\nTwo')).toEqual(['One', 'Two']);
  });

  it('trims the parts and drops the empty ones', () => {
    expect(cellLines('One <br>  Two ')).toEqual(['One', 'Two']);
    expect(cellLines('One<br><br>Two')).toEqual(['One', 'Two']);
    expect(cellLines('<br>One<br>')).toEqual(['One']);
  });

  it('gives one line for an ordinary cell and none for an empty one', () => {
    expect(cellLines('Inhibits thyroid peroxidase')).toEqual(['Inhibits thyroid peroxidase']);
    expect(cellLines('')).toEqual([]);
    expect(cellLines(null)).toEqual([]);
    expect(cellLines(undefined)).toEqual([]);
    expect(cellLines('   ')).toEqual([]);
  });

  it('says whether a cell was written in parts', () => {
    expect(isMultiline('One<br>Two')).toBe(true);
    expect(isMultiline('One')).toBe(false);
    expect(isMultiline(null)).toBe(false);
  });

  /**
   * Joined with a middot rather than a space: the parts were written apart on
   * purpose, and running them together reads as the one garbled sentence
   * `<br>` was introduced to stop.
   */
  it('folds to one line where there is no room to break', () => {
    expect(cellOneLine('Inhibits TPO<br>Blocks organification'))
      .toBe('Inhibits TPO · Blocks organification');
    expect(cellOneLine('Just the one')).toBe('Just the one');
  });
});

describe('nothing is injected as HTML', () => {
  /**
   * The tag is consumed by the split and never returned, so there is nothing
   * for a renderer to be tempted to trust.
   */
  it('returns no markup, only text', () => {
    for (const line of cellLines('One<br>Two<br/>Three')) {
      expect(line).not.toContain('<');
      expect(line).not.toContain('>');
    }
  });

  /** Any other tag is text, and stays text -- it is not a format we accept. */
  it('leaves a script tag as the characters it is', () => {
    const nasty = 'Safe<br><script>alert(1)</script>';
    expect(cellLines(nasty)).toEqual(['Safe', '<script>alert(1)</script>']);
    // Which React escapes on render. What must never happen is this function
    // handing back something a caller would pass to dangerouslySetInnerHTML,
    // and a plain string cannot be that.
    expect(cellLines(nasty).every((line) => typeof line === 'string')).toBe(true);
  });

  it('does not break on a tag that merely starts like one', () => {
    expect(cellLines('Rate <break>point')).toEqual(['Rate <break>point']);
    expect(cellLines('a<brb>c')).toEqual(['a<brb>c']);
  });
});

describe('the split never reaches the quiz', () => {
  /**
   * The guarantee this file exists under, tested through the real builder
   * rather than through the key function it uses -- which is private, and
   * rightly so.
   *
   * Two rows here share their first line and differ only after the break. If
   * anything in the engine saw a *line* instead of the cell, those two would
   * key alike: one would be treated as the other's answer and quietly dropped
   * from the options as "not wrong".
   */
  it('tells two rows apart when they differ only after the break', () => {
    const rows = [
      ['a', 'Inhibits TPO<br>Blocks organification'],
      ['b', 'Inhibits TPO<br>Also inhibits D1'],
      ['c', 'Destroys thyroid tissue'],
      ['d', 'Inhibits hormone release'],
    ] as const;

    const sources: CardSource[] = rows.map(([slug, mechanism]) => ({
      drugId: slug, slug, generic: slug.toUpperCase(), drugClass: null,
      schedule: null, routes: [], tags: [], indications: [],
      dosingSig: null, dosingBranches: [], needsPairingReview: false,
      values: {
        mechanism: {
          value: mechanism, status: 'ok', source: 'test', updatedAt: '', updatedBy: null,
        },
      },
    }));

    const defs = [defOf({
      id: 'f1', key: 'mechanism', label: 'Mechanism', dataType: 'markdown',
      enumOptions: null, prompt: null, asks: true, sortOrder: 0,
    })];

    const config = {
      mode: 'exclusive', direction: 'drug_to_fields', fields: ['mechanism'],
      scope: {
        tags: [], classes: [], categories: [], indications: [], routes: [], schedules: [],
        dueOnly: false,
      },
      grading: 'binary', maxCards: 0, blockSize: 0, sessionMode: 'cram', yearLevel: null,
    } as unknown as StudyConfig;

    const questions = buildQuiz(sources, defs, config, { rng: () => 0.5 });
    const asked = questions.find((question) => question.slug === 'a');
    expect(asked).toBeDefined();

    // The other near-identical cell is offered as a wrong answer, which only
    // happens if the engine compared the whole values.
    expect(asked!.options).toContain('Inhibits TPO<br>Also inhibits D1');
    expect(asked!.options[asked!.correctIndex]).toBe('Inhibits TPO<br>Blocks organification');
    // And it is not treated as another name for the same answer.
    expect(asked!.acceptable).not.toContain('Inhibits TPO<br>Also inhibits D1');
  });

  it('stores the cell whole, so the builder sees the whole thing', () => {
    const result = parseSet({
      format: SET_FORMAT,
      slug: 'thyroid',
      name: 'Thyroid',
      identity: { key: 'generic', label: 'Generic', kind: 'drug' },
      kinds: ['drug'],
      fields: [{ key: 'mechanism', answers: 'mechanism' }],
      items: [{ generic: 'Methimazole', mechanism: 'Inhibits TPO<br>Blocks organification' }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Parsed and stored verbatim. The breaking happens at render and nowhere
    // else, which is what keeps one answer one answer.
    expect(result.set.items[0].values.mechanism).toBe('Inhibits TPO<br>Blocks organification');
  });
});
