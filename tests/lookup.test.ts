import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  brandIndications, drugBrands, drugIndications, drugTags, drugs, fieldDefs, tags,
} from '@/db/schema';
import { syncDrugs, type SeedDrug } from '@/lib/content/sync';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { lookupDrug, searchDrugs } from '@/lib/study/lookup';

beforeEach(async () => {
  await db.delete(brandIndications);
  await db.delete(drugTags);
  await db.delete(drugBrands);
  await db.delete(drugIndications);
  await db.delete(drugs);
  await db.delete(tags);
  await db.delete(fieldDefs);
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);

  const seed: SeedDrug[] = [
    {
      slug: 'simvastatin',
      generic: 'Simvastatin',
      drug_class: 'HMG-CoA Reductase Inhibitor',
      dosing: '20 mg by mouth at bedtime',
      moa: 'HMG-CoA reductase inhibition',
      bbw: '',
      bbw_status: 'none',
      brands: [
        { id: 's--b0', name: 'Zocor', family: 'Zocor' },
        { id: 's--b1', name: 'FloLipid', family: 'FloLipid' },
      ],
      indications: [{ id: 's--i0', text: 'Hyperlipidemia' }],
    },
    {
      slug: 'alprazolam',
      generic: 'Alprazolam',
      drug_class: 'Benzodiazepine',
      schedule: 'CIV',
      dosing: '0.25 mg by mouth three times a day',
      moa: 'GABA-A positive allosteric modulator',
      bbw: 'Risks from concomitant opioid use',
      bbw_status: 'from_sheet',
      brands: [{ id: 'a--b0', name: 'Xanax', family: 'Xanax' }],
      indications: [{ id: 'a--i0', text: 'Anxiety' }],
    },
    {
      slug: 'simvastatin-ezetimibe',
      generic: 'Simvastatin and Ezetimibe',
      drug_class: 'HMG-CoA Reductase Inhibitor',
      dosing: '10/20 mg by mouth at bedtime',
      moa: '',
      bbw: '',
      bbw_status: 'none',
      brands: [{ id: 'se--b0', name: 'Vytorin', family: 'Vytorin' }],
      indications: [],
    },
  ];
  await syncDrugs(seed);
});

describe('searchDrugs', () => {
  it('finds a drug by part of its generic name', async () => {
    const hits = await searchDrugs('simva');
    expect(hits.map((hit) => hit.slug)).toEqual(['simvastatin', 'simvastatin-ezetimibe']);
    expect(hits[0].drugClass).toBe('HMG-CoA Reductase Inhibitor');
    expect(hits[0].matchedBrand).toBeNull();
  });

  it('finds a drug by a brand, and says which brand that was', async () => {
    // Searching Zocor and being shown Simvastatin is only useful if the
    // connection is stated.
    const [hit] = await searchDrugs('zocor');
    expect(hit.slug).toBe('simvastatin');
    expect(hit.matchedBrand).toBe('Zocor');
  });

  it('returns a drug once, however many of its brands match', async () => {
    // Both brands contain "i", which a join would otherwise duplicate.
    const hits = await searchDrugs('lipid');
    expect(hits.map((hit) => hit.slug)).toEqual(['simvastatin']);
  });

  it('carries the schedule, which is the thing worth seeing in a hurry', async () => {
    const [hit] = await searchDrugs('alpraz');
    expect(hit.schedule).toBe('CIV');
  });

  it('says nothing until there is something to go on', async () => {
    expect(await searchDrugs('s')).toEqual([]);
    expect(await searchDrugs('   ')).toEqual([]);
    expect(await searchDrugs('')).toEqual([]);
  });

  it('treats a wildcard as a character, not as a wildcard', async () => {
    // Unescaped, "%" matches everything and the panel confidently shows the
    // wrong drug.
    expect(await searchDrugs('%%')).toEqual([]);
    expect(await searchDrugs('si%in')).toEqual([]);
    expect(await searchDrugs('si_va')).toEqual([]);
  });

  it('finds nothing for a name nothing has', async () => {
    expect(await searchDrugs('tylenol')).toEqual([]);
  });
});

describe('lookupDrug', () => {
  it('gives the heading, the brands and the fields worth reading', async () => {
    const card = await lookupDrug('simvastatin');
    expect(card).not.toBeNull();
    expect(card!.generic).toBe('Simvastatin');
    expect(card!.drugClass).toBe('HMG-CoA Reductase Inhibitor');
    // Sort order, which is the order the sheet gave them, not alphabetical.
    expect(card!.brands).toEqual(['Zocor', 'FloLipid']);
    expect(card!.indications).toEqual(['Hyperlipidemia']);

    const fields = card!.groups.flatMap((group) => group.fields);
    const moa = fields.find((field) => field.key === 'moa');
    expect(moa!.lines).toEqual(['HMG-CoA reductase inhibition']);
  });

  it('does not repeat the heading as a field row', async () => {
    const card = await lookupDrug('alprazolam');
    const keys = card!.groups.flatMap((group) => group.fields).map((field) => field.key);

    // The card already shows the name, class, schedule, brands and
    // indications above the fields; a second copy is noise in an overlay.
    for (const identity of ['generic', 'drug_class', 'controlled', 'brand', 'indication']) {
      expect(keys, identity).not.toContain(identity);
    }
    expect(keys).toContain('dosing');
  });

  it('keeps the two kinds of empty apart, as the profile does', async () => {
    const card = await lookupDrug('simvastatin-ezetimibe');
    const fields = card!.groups.flatMap((group) => group.fields);

    // Nobody has written the mechanism; the drug genuinely has no black box.
    expect(fields.find((field) => field.key === 'moa')!.lines).toEqual(['Not recorded yet']);
    expect(fields.find((field) => field.key === 'bbw')!.lines).toEqual(['None']);
  });

  it('has nothing to show for a drug that is not there', async () => {
    expect(await lookupDrug('aspirin')).toBeNull();
  });
});

/* The rules the panel exists under, asserted against the source because they
   are invariants about wiring rather than about a value. Each one has a way of
   being quietly undone by an ordinary-looking edit. */
describe('the rules the lookup panel runs under', () => {
  const quiz = readFileSync('app/study/quiz/quiz-runner.tsx', 'utf8');
  const flashcards = readFileSync('app/study/flashcards/session-runner.tsx', 'utf8');
  const panel = readFileSync('app/study/_components/lookup-panel.tsx', 'utf8');
  const actions = readFileSync('app/study/_components/lookup-actions.ts', 'utf8');

  /** Declarations only: the prose in these files says "revalidate" too. */
  const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');

  it('never revalidates, because that re-rolls a live paper', () => {
    // The "0 of 83" bug: a study page is force-dynamic and randomised, so
    // revalidating one swaps the paper under whoever is sitting in front of
    // it. Looking something up must not be able to change the question.
    expect(code(actions)).not.toContain('revalidate');
    expect(code(panel)).not.toContain('revalidate');
    expect(code(panel)).not.toContain('router.refresh');
  });

  it('is shut while a question is unanswered and a card unflipped', () => {
    expect(quiz).toContain('available={answered}');
    expect(flashcards).toContain('available={revealed}');
    // Disabled, not merely styled: a trigger that only looks unavailable is
    // still a button somebody can press.
    expect(panel).toContain('disabled={!available}');
  });

  it('closes itself if it stops being allowed while open', () => {
    // Next moves to an unanswered question without the panel being touched.
    expect(panel).toContain('if (!available && open) close()');
  });

  it('stands the runner keyboard down, so typing cannot answer', () => {
    for (const [name, source] of [['quiz', quiz], ['flashcards', flashcards]] as const) {
      expect(source, name).toContain('if (lookingUp || typingSomewhere(event)) return;');
      expect(source, name).toContain('function typingSomewhere');
    }
  });

  it('opens the full profile in a new tab, since a session is in memory', () => {
    expect(panel).toContain('target="_blank"');
  });
});
