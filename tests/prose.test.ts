import { describe, expect, it } from 'vitest';
import { parseProse } from '@/lib/fields/prose';

/**
 * The little bit of markdown a field's prose is allowed to be.
 *
 * Three constructs, and the reason they are the three is a regimen: a
 * combination protocol is a decision before it is a paragraph, and run
 * together into one paragraph it stops being readable at all. So nesting is
 * load-bearing here in a way it is not anywhere else in the app, and the
 * import format tells authors to use exactly these -- `docs/drug-import.md`.
 */

describe('parsing a field’s prose', () => {
  it('keeps paragraphs, and joins the lines inside one', () => {
    expect(parseProse('First line\nsame paragraph\n\nSecond paragraph')).toEqual([
      { kind: 'paragraph', text: 'First line same paragraph' },
      { kind: 'paragraph', text: 'Second paragraph' },
    ]);
  });

  it('nests a list by indentation, two spaces to a level', () => {
    const blocks = parseProse([
      '- BRAF V600E positive?',
      '  - Yes -> dabrafenib + trametinib',
      '    - High-volume symptomatic disease -> this first',
      '  - No -> ipilimumab + nivolumab',
    ].join('\n'));

    expect(blocks).toEqual([{
      kind: 'list',
      items: [
        { text: 'BRAF V600E positive?', depth: 0, marker: null },
        { text: 'Yes -> dabrafenib + trametinib', depth: 1, marker: null },
        { text: 'High-volume symptomatic disease -> this first', depth: 2, marker: null },
        { text: 'No -> ipilimumab + nivolumab', depth: 1, marker: null },
      ],
    }]);
  });

  it('keeps a numbered step’s own number, because a step is ordered', () => {
    const blocks = parseProse('1. Tumour harvest\n2. Lymphodepletion\n3. TIL infusion');

    expect(blocks[0].kind).toBe('list');
    expect(blocks[0].kind === 'list' && blocks[0].items.map((item) => item.marker))
      .toEqual(['1.', '2.', '3.']);
  });

  it('reads a heading, where one field holds two distinct things', () => {
    const blocks = parseProse('### Ipilimumab + nivolumab\n\n- ipilimumab 3 mg/kg');

    expect(blocks[0]).toEqual({ kind: 'heading', text: 'Ipilimumab + nivolumab' });
    expect(blocks[1].kind).toBe('list');
  });

  it('treats a wrapped line under a bullet as that bullet’s own', () => {
    // An author wrapping a long step mid-sentence means one step. Starting a
    // paragraph there would break the list in two and lose the nesting.
    const blocks = parseProse('- nivolumab 240 mg IV every 2 weeks,\n  or 480 mg every 4 weeks');

    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind === 'list' && blocks[0].items[0].text)
      .toBe('nivolumab 240 mg IV every 2 weeks, or 480 mg every 4 weeks');
  });

  it('starts a list straight after a paragraph, with no blank line between', () => {
    // Markdown would want the blank line. Somebody typing notes will not put
    // one there, and the hyphen already said what it is.
    const blocks = parseProse('Dosed by lesion size.\n- 10^6 PFU/mL first\n- 10^8 PFU/mL after');

    expect(blocks.map((block) => block.kind)).toEqual(['paragraph', 'list']);
  });

  it('leaves what it does not understand as the text it is', () => {
    // A table degrades into a line of pipes rather than disappearing, which is
    // why the format tells an author to write a list instead.
    expect(parseProse('| Drug | Dose |\n|---|---|')).toEqual([
      { kind: 'paragraph', text: '| Drug | Dose | |---|---|' },
    ]);
  });
});
