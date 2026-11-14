import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
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

  /* The panel is opened mid-question to check an answer against the profile,
     so a field that reads as folded protocols on the profile and as a
     paragraph of `###` and hyphens in the panel is two answers to one
     question. The panel draws it; the lookup has to hand it over whole. */
  it('hands a markdown field over as markdown, markers and all', async () => {
    const text = [
      '### FOLFOX',
      '',
      'Metastatic colorectal cancer.',
      '',
      '- Oxaliplatin 85 mg/m2 IV day 1',
      '- Fluorouracil 400 mg/m2 IV bolus, then 2400 mg/m2 over 46 h',
    ].join('\n');

    const [before] = await db.select({ fields: drugs.fields })
      .from(drugs).where(eq(drugs.slug, 'simvastatin'));
    await db.update(drugs)
      .set({
        fields: {
          ...before.fields,
          regimen: {
            value: text, status: 'ok', source: 'test',
            updatedAt: new Date().toISOString(), updatedBy: null,
          },
        },
      })
      .where(eq(drugs.slug, 'simvastatin'));

    const card = await lookupDrug('simvastatin');
    const regimen = card!.groups.flatMap((group) => group.fields)
      .find((field) => field.key === 'regimen')!;

    expect(regimen.prose).toBe(true);
    // The split into paragraphs and the panel's join are each other's
    // inverse, so the renderer is handed the text as it was written.
    expect(regimen.lines.join('\n\n')).toBe(text);
  });

  it('does not call an empty markdown field prose', async () => {
    // "Not recorded yet" is a sentence, not a document, and running it
    // through the renderer would wrap a label in a paragraph.
    const card = await lookupDrug('simvastatin-ezetimibe');
    const regimen = card!.groups.flatMap((group) => group.fields)
      .find((field) => field.key === 'regimen')!;

    expect(regimen.prose).toBe(false);
    expect(regimen.lines).toEqual(['None']);
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
  });

  // Every trigger and every panel must be gated. An ungated one is how this
  // rule gets lost: not by someone removing it, but by someone adding a
  // second way in and forgetting.
  it('has no way in that is not gated, and none that does not name a drug', () => {
    for (const [name, source] of [['quiz', quiz], ['flashcards', flashcards]] as const) {
      const triggers = source.match(/<LookupTrigger[\s\S]{0,400}?\/>/g) ?? [];
      expect(triggers.length, `${name} has triggers`).toBeGreaterThan(0);
      for (const trigger of triggers) {
        expect(trigger, `${name} trigger is gated`).toMatch(/available(=|\s|$)/);
        expect(trigger, `${name} trigger names a drug`).toContain('drug={{');
      }

      const panels = source.match(/<LookupPanel[\s\S]{0,400}?\/>/g) ?? [];
      expect(panels.length, `${name} has a panel`).toBeGreaterThan(0);
      for (const panel of panels) {
        expect(panel, `${name} panel is gated`).toMatch(/available(=|\s|$)/);
      }
    }
  });

  it('offers nothing to press while it is not allowed', () => {
    // Not a disabled button: when the gate is shut the trigger is not a
    // control at all, it is the sentence saying what has to happen first.
    expect(panel).toContain('if (!available) {');
    expect(panel).toContain('{unavailableReason}');
  });

  it('closes itself if it stops being allowed while open', () => {
    // Next moves to an unanswered question without the panel being touched.
    expect(panel).toContain('if (!available && open) close()');
  });

  it('loads the drug the trigger named, without it being searched for', () => {
    expect(panel).toContain('lookupDrugAction(drug.slug, scopeTags)');
  });

  /* The panel reads the drug as the session reads it, which it can only do if
     every runner hands it the scope. A panel without one silently falls back
     to the drug's own profile -- the same wrong answer it used to give
     always, now harder to notice because the other panel is right. */
  it('is told what the session is scoped to, wherever it is opened', () => {
    for (const [name, source] of [['quiz', quiz], ['flashcards', flashcards]] as const) {
      const panels = source.match(/<LookupPanel[\s\S]{0,400}?\/>/g) ?? [];
      expect(panels.length, `${name} has a panel`).toBeGreaterThan(0);
      for (const found of panels) {
        expect(found, `${name} panel carries the scope`).toContain('scopeTags={config.scope.tags}');
      }
    }
  });

  it('resolves the scope on the server rather than believing the browser', () => {
    // The action takes tag slugs and nothing else. Were it to take versions or
    // values, the panel would be a profile anybody could ask for any version
    // of -- and it is reachable by every signed-in user.
    expect(code(actions)).toContain('scopeTags: string[]');
    expect(code(actions)).not.toContain('fields');
  });

  it('leaves no new-tab drug link in a runner, so one way in means one way in', () => {
    // The panel keeps a "Full profile" link out to a new tab. The runners
    // should have none of their own: two affordances for the same drug name,
    // one of which costs the session, is the thing this replaced.
    for (const [name, source] of [['quiz', quiz], ['flashcards', flashcards]] as const) {
      expect(code(source), name).not.toContain('target="_blank"');
    }
  });

  it('opens the full profile in a new tab, since a session is in memory', () => {
    expect(panel).toContain('target="_blank"');
  });

  it('draws a markdown field with the renderer the profile uses', () => {
    // Told which field that is, as the runners are: the panel holds no field
    // definitions, and sniffing for a leading hyphen would turn a dose that
    // starts with one into a bullet list.
    expect(panel).toContain("import { Prose } from '@/app/_components/prose'");
    expect(panel).toContain('field.prose');
  });
});
