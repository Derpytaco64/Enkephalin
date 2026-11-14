import { describe, expect, it } from 'vitest';
import { splitSections } from '@/lib/fields/prose';

/**
 * A prose field cut into its named pieces.
 *
 * `groupProse` folds a regimen for *reading*; this cuts it for *asking*. The
 * difference matters: folding keeps everything on one profile and may nest as
 * deep as it likes, while a cut has to produce pieces that each stand alone as
 * a flashcard, with nothing left over and nothing said twice.
 */

const FOLFOX = [
  '### FOLFOX',
  '',
  'Adjuvant colon cancer, stage III',
  '',
  '- Oxaliplatin — 85 mg/m2 IV day 1',
  '- Leucovorin — 400 mg/m2 IV day 1',
  '',
  '### FOLFIRI',
  '',
  'Metastatic colorectal cancer, second line',
  '',
  '- Irinotecan — 180 mg/m2 IV day 1',
].join('\n');

describe('cutting a regimen into its protocols', () => {
  it('gives one piece per heading, each holding what was written under it', () => {
    const slices = splitSections(FOLFOX);

    expect(slices.map((slice) => slice.heading)).toEqual(['FOLFOX', 'FOLFIRI']);
    expect(slices[0].text).toBe(
      'Adjuvant colon cancer, stage III\n\n- Oxaliplatin — 85 mg/m2 IV day 1\n'
      + '- Leucovorin — 400 mg/m2 IV day 1',
    );
    expect(slices[1].text).toBe(
      'Metastatic colorectal cancer, second line\n\n- Irinotecan — 180 mg/m2 IV day 1',
    );
  });

  it('cuts at the shallowest heading, so a deeper one stays inside its protocol', () => {
    const slices = splitSections(
      '## FOLFOX\n- oxaliplatin\n### Choosing it\n- RAS mutated -> bevacizumab\n## FOLFIRI\n- irinotecan',
    );

    expect(slices.map((slice) => slice.heading)).toEqual(['FOLFOX', 'FOLFIRI']);
    // The sub-heading is the protocol's own structure, not a protocol.
    expect(slices[0].text).toContain('### Choosing it');
  });

  it('has nothing to cut where the field has no headings', () => {
    expect(splitSections('Vancomycin 15 mg/kg IV every 12 hours.')).toEqual([]);
  });

  /* The fallback, and the reason it is one: those words introduce all of the
     protocols and belong to none of them. Cutting would either lose them or
     repeat them on every card, so such a field is asked whole as it always
     was -- see `partsOf`. */
  it('refuses to cut a field that says something before its first heading', () => {
    expect(splitSections('Given with a fluoropyrimidine backbone.\n\n### FOLFOX\n- oxaliplatin'))
      .toEqual([]);
  });

  it('drops a heading with nothing under it, which is a name and not an answer', () => {
    const slices = splitSections('### FOLFOX\n\n### FOLFIRI\n- irinotecan');

    expect(slices.map((slice) => slice.heading)).toEqual(['FOLFIRI']);
  });

  it('keeps a protocol whose name has punctuation in it', () => {
    const slices = splitSections('### Lazertinib + amivantamab\n- Lazertinib\n- Amivantamab');

    expect(slices[0].heading).toBe('Lazertinib + amivantamab');
  });
});
