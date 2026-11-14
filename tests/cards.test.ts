import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { fieldDefs, type FieldValue } from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { listFieldDefs, type FieldDef } from '@/lib/fields/registry';
import { buildCards, type CardSource } from '@/lib/study/cards';
import { DEFAULT_CONFIG, type StudyConfig } from '@/lib/study/config';

let defs: FieldDef[];

beforeEach(async () => {
  await db.delete(fieldDefs);
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);
  defs = await listFieldDefs();
});

function value(partial: Partial<FieldValue>): FieldValue {
  return {
    value: null,
    status: 'ok',
    source: 'class sheet',
    updatedAt: '2026-10-30',
    updatedBy: null,
    ...partial,
  };
}

function source(partial: Partial<CardSource> = {}): CardSource {
  return {
    drugId: 'id-alprazolam',
    slug: 'alprazolam',
    generic: 'Alprazolam',
    drugClass: 'Benzodiazepine',
    schedule: 'CIV',
    routes: ['Oral'],
    tags: ['top-drugs-2026'],
    indications: ['anxiety'],
    dosingSig: '0.25 mg PO TID',
    dosingBranches: [],
    needsPairingReview: false,
    values: {
      generic: value({ value: 'Alprazolam' }),
      brand: value({ value: 'Xanax' }),
      indication: value({ value: 'Anxiety' }),
      moa: value({ value: 'GABA-A positive allosteric modulator' }),
      dosing: value({ value: '0.25 mg by mouth three times a day' }),
      bbw: value({ value: null, status: 'none' }),
    },
    ...partial,
  };
}

const config = (partial: Partial<StudyConfig> = {}): StudyConfig => ({
  ...DEFAULT_CONFIG,
  fields: ['moa'],
  ...partial,
});

describe('buildCards', () => {
  it('builds nothing until fields are chosen', () => {
    expect(buildCards([source()], defs, config({ fields: [] }))).toEqual([]);
  });

  it('makes one card per field in exclusive mode', () => {
    const cards = buildCards([source()], defs, config({ fields: ['moa', 'dosing'], mode: 'exclusive' }));

    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.fieldKeys)).toEqual([['moa'], ['dosing']]);
    // Separate keys, so mechanism recall and dosing recall advance at their
    // own rates.
    expect(new Set(cards.map((card) => card.cardKey)).size).toBe(2);
  });

  it('collapses the same fields into one card in inclusive mode', () => {
    const cards = buildCards([source()], defs, config({ fields: ['moa', 'dosing'], mode: 'inclusive' }));

    expect(cards).toHaveLength(1);
    expect(cards[0].fieldKeys).toEqual(['moa', 'dosing']);
    expect(cards[0].faces.map((face) => face.label)).toEqual(['Mechanism of action', 'Dosing']);
  });

  it('asks with the field prompt template when it has one', () => {
    const cards = buildCards([source()], defs, config({ fields: ['moa'] }));
    expect(cards[0].prompt).toBe('What is the mechanism of action of Alprazolam?');
    expect(cards[0].faces[0].text).toBe('GABA-A positive allosteric modulator');
  });

  it('turns the card round for fields_to_drug', () => {
    const cards = buildCards([source()], defs, config({ fields: ['moa'], direction: 'fields_to_drug' }));

    expect(cards[0].prompt).toContain('GABA-A positive allosteric modulator');
    expect(cards[0].faces).toEqual([{ key: 'generic', label: 'Drug', text: 'Alprazolam' }]);
  });

  it('does not ask about an affirmed absence, because it is not a question', () => {
    // 147 of 237 drugs have no black box warning. *None* is a real answer and
    // the profile still shows it -- it is just not worth a card, and a deck of
    // them buries the ones that have a warning. The quiz has refused the same
    // question about the controlled schedule since it could tell "not
    // controlled" from "not recorded"; this is that rule, on every field.
    expect(buildCards([source()], defs, config({ fields: ['bbw'] }))).toEqual([]);
  });

  it('still asks the drugs that do carry one', () => {
    const warned = source({
      values: { ...source().values, bbw: value({ value: 'Risk of dependence' }) },
    });
    const cards = buildCards([warned], defs, config({ fields: ['bbw'] }));

    expect(cards).toHaveLength(1);
    expect(cards[0].faces[0].text).toBe('Risk of dependence');
  });

  it('drops the absence from a card that asks several fields', () => {
    // The card is built, because the dosing is real; the warning is left off
    // rather than printed as a line saying None.
    const cards = buildCards([source()], defs, config({
      fields: ['dosing', 'bbw'],
      mode: 'inclusive',
    }));

    expect(cards[0].fieldKeys).toEqual(['dosing']);
  });

  it('skips a field nobody has filled in', () => {
    const bare = source({ values: { ...source().values, moa: value({ value: '   ' }) } });
    expect(buildCards([bare], defs, config({ fields: ['moa'] }))).toEqual([]);
  });

  it('drops a drug entirely when none of its chosen fields have answers', () => {
    const bare = source({ values: {} });
    expect(buildCards([bare], defs, config({ fields: ['moa', 'dosing'] }))).toEqual([]);
  });

  it('studies a flagged value rather than withholding it', () => {
    // A flag is a to-do, not a quarantine: dropping the card would quietly
    // shrink the deck and the drug would stop being asked about.
    const doubted = source({
      values: {
        moa: value({ value: 'GABA-A modulator' }),
        dosing: value({ value: '0.25 mg', status: 'flagged' }),
      },
    });

    const cards = buildCards([doubted], defs, config({ fields: ['moa', 'dosing'], mode: 'exclusive' }));
    expect(cards.map((card) => card.fieldKeys)).toEqual([['moa'], ['dosing']]);
  });

  it('builds the brand-to-indication card even where the pairing is unsettled', () => {
    // Holding this back was the old behaviour. The flag now shows on the
    // profile and is fixed in the editor; nothing in the database is withheld.
    const tirzepatide = source({
      slug: 'tirzepatide',
      generic: 'Tirzepatide',
      needsPairingReview: true,
      values: {
        brand: value({ value: 'Mounjaro\nZepbound' }),
        indication: value({ value: 'Diabetes\nWeight management' }),
      },
    });

    const cards = buildCards([tirzepatide], defs, config({
      fields: ['brand', 'indication'], mode: 'inclusive',
    }));
    expect(cards).toHaveLength(1);
    expect(cards[0].fieldKeys).toEqual(['brand', 'indication']);
  });

  it('filters by class, schedule, route and tag', () => {
    const benzo = source();
    const ace = source({
      slug: 'lisinopril',
      generic: 'Lisinopril',
      drugClass: 'ACE Inhibitor',
      schedule: null,
      routes: ['Oral'],
      tags: ['top-drugs-2026'],
      values: { moa: value({ value: 'ACE inhibition' }) },
    });

    const byClass = buildCards([benzo, ace], defs, config({
      scope: { ...DEFAULT_CONFIG.scope, classes: ['ACE Inhibitor'] },
    }));
    expect(byClass.map((card) => card.slug)).toEqual(['lisinopril']);

    const bySchedule = buildCards([benzo, ace], defs, config({
      scope: { ...DEFAULT_CONFIG.scope, schedules: ['CIV'] },
    }));
    expect(bySchedule.map((card) => card.slug)).toEqual(['alprazolam']);

    const byTag = buildCards([benzo, ace], defs, config({
      scope: { ...DEFAULT_CONFIG.scope, tags: ['nonexistent'] },
    }));
    expect(byTag).toEqual([]);

    const byRoute = buildCards([benzo, ace], defs, config({
      scope: { ...DEFAULT_CONFIG.scope, routes: ['Oral'] },
    }));
    expect(byRoute).toHaveLength(2);
  });

  it('ignores a field marked not quizzable', async () => {
    await db.update(fieldDefs).set({ isQuizzable: false }).where(eq(fieldDefs.key, 'moa'));
    const updated = await listFieldDefs();

    expect(buildCards([source()], updated, config({ fields: ['moa'] }))).toEqual([]);
  });

  it('gives the same card the same key across sessions', () => {
    const first = buildCards([source()], defs, config({ fields: ['moa', 'dosing'], mode: 'inclusive' }));
    const reordered = buildCards([source()], defs, config({ fields: ['dosing', 'moa'], mode: 'inclusive' }));

    expect(first[0].cardKey).toBe(reordered[0].cardKey);
  });

  it('never asks about the drug name itself', () => {
    // "Which drug is this?" with the answer "Acyclovir" and nothing else on
    // the card is unanswerable: going drug -> facts the name is the stimulus.
    expect(buildCards([source()], defs, config({ fields: ['generic'] }))).toEqual([]);

    // And going facts -> drug it is the answer, so it must not sit among the
    // clues either.
    const cards = buildCards([source()], defs, config({
      fields: ['generic', 'moa'],
      direction: 'fields_to_drug',
      mode: 'inclusive',
    }));
    expect(cards[0].fieldKeys).toEqual(['moa']);
    expect(cards[0].prompt).not.toContain('Alprazolam');
  });

  it('says what it is asking for when the field has no template', () => {
    // A bare drug name leaves you guessing whether it wants the dose, the
    // mechanism or the warning.
    const warned = source({
      values: { ...source().values, bbw: value({ value: 'Risk of dependence' }) },
    });
    const cards = buildCards([warned], defs, config({ fields: ['dosing', 'bbw'], mode: 'inclusive' }));

    expect(cards[0].prompt).toBe('Alprazolam — Dosing, Black box warning?');
  });

  it('tells you to name the drug when the clues come first', () => {
    const cards = buildCards([source()], defs, config({ fields: ['moa'], direction: 'fields_to_drug' }));

    expect(cards[0].prompt.startsWith('Which drug?')).toBe(true);
    expect(cards[0].prompt).toContain('Mechanism of action: GABA-A positive allosteric modulator');
  });

  it('reads a list and a category as the drugs in both', () => {
    // "Top Drugs 2026 + Anticonvulsants" is the anticonvulsants within that
    // list. Two lists would mean either list, which is why categories are
    // their own axis rather than more entries in `tags`.
    const onBoth = source({ slug: 'topiramate', generic: 'Topiramate', tags: ['top-drugs-2026', 'anticonvulsants'] });
    const listOnly = source({ slug: 'lisinopril', generic: 'Lisinopril', tags: ['top-drugs-2026', 'ace-inhibitors'] });
    const categoryOnly = source({ slug: 'phenytoin', generic: 'Phenytoin', tags: ['anticonvulsants'] });

    const cards = buildCards([onBoth, listOnly, categoryOnly], defs, config({
      scope: { ...DEFAULT_CONFIG.scope, tags: ['top-drugs-2026'], categories: ['anticonvulsants'] },
    }));

    expect(cards.map((card) => card.slug)).toEqual(['topiramate']);
  });

  it('takes either list when several are picked', () => {
    // Two exams mean revising both, which is the sensible default and the one
    // that can never hand back an empty deck.
    const exam2 = source({ slug: 'warfarin', generic: 'Warfarin', tags: ['exam-2'] });
    const exam3 = source({ slug: 'nivolumab', generic: 'Nivolumab', tags: ['heme-onc-exam-3'] });
    const neither = source({ slug: 'lisinopril', generic: 'Lisinopril', tags: ['top-drugs-2026'] });

    const cards = buildCards([exam2, exam3, neither], defs, config({
      scope: { ...DEFAULT_CONFIG.scope, tags: ['exam-2', 'heme-onc-exam-3'] },
    }));

    expect(cards.map((card) => card.slug).sort()).toEqual(['nivolumab', 'warfarin']);
  });

  it('takes only the drugs on every list when asked for all of them', () => {
    // The other question the lists axis can be asked, and the reason it has a
    // control the other axes do not: "Top Drugs 2026 and PHRM 535" is the
    // overlap, not the union.
    const onBoth = source({ slug: 'warfarin', generic: 'Warfarin', tags: ['top-drugs-2026', 'phrm-535'] });
    const listOnly = source({ slug: 'lisinopril', generic: 'Lisinopril', tags: ['top-drugs-2026'] });
    const classOnly = source({ slug: 'nivolumab', generic: 'Nivolumab', tags: ['phrm-535'] });

    const cards = buildCards([onBoth, listOnly, classOnly], defs, config({
      scope: {
        ...DEFAULT_CONFIG.scope, tags: ['top-drugs-2026', 'phrm-535'], tagsAll: true,
      },
    }));

    expect(cards.map((card) => card.slug)).toEqual(['warfarin']);
  });

  it('means the same thing either way when only one list is picked', () => {
    const onList = source({ slug: 'warfarin', generic: 'Warfarin', tags: ['top-drugs-2026'] });
    const off = source({ slug: 'nivolumab', generic: 'Nivolumab', tags: ['phrm-535'] });

    for (const tagsAll of [false, true]) {
      const cards = buildCards([onList, off], defs, config({
        scope: { ...DEFAULT_CONFIG.scope, tags: ['top-drugs-2026'], tagsAll },
      }));
      expect(cards.map((card) => card.slug)).toEqual(['warfarin']);
    }
  });

  it('takes either category when several are picked', () => {
    const anticonvulsant = source({ slug: 'topiramate', generic: 'Topiramate', tags: ['anticonvulsants'] });
    const statin = source({ slug: 'atorvastatin', generic: 'Atorvastatin', tags: ['statins'] });
    const neither = source({ slug: 'lisinopril', generic: 'Lisinopril', tags: ['ace-inhibitors'] });

    const cards = buildCards([anticonvulsant, statin, neither], defs, config({
      scope: { ...DEFAULT_CONFIG.scope, categories: ['anticonvulsants', 'statins'] },
    }));

    expect(cards.map((card) => card.slug).sort()).toEqual(['atorvastatin', 'topiramate']);
  });

  it('takes either indication when several are picked', () => {
    const anxiety = source({ slug: 'alprazolam', generic: 'Alprazolam', indications: ['anxiety'] });
    const both = source({ slug: 'duloxetine', generic: 'Duloxetine', indications: ['depression', 'neuropathic-pain'] });
    const neither = source({ slug: 'lisinopril', generic: 'Lisinopril', indications: ['hypertension'] });

    const cards = buildCards([anxiety, both, neither], defs, config({
      scope: { ...DEFAULT_CONFIG.scope, indications: ['anxiety', 'depression'] },
    }));

    expect(cards.map((card) => card.slug).sort()).toEqual(['alprazolam', 'duloxetine']);
  });

  it('reads a category and an indication as the drugs in both', () => {
    // The two axes are not the same question: picking Antidepressants and
    // "Neuropathic pain" asks for the antidepressants used for nerve pain,
    // not for every drug that is either.
    const both = source({
      slug: 'duloxetine', generic: 'Duloxetine',
      tags: ['antidepressants'], indications: ['depression', 'neuropathic-pain'],
    });
    const categoryOnly = source({
      slug: 'sertraline', generic: 'Sertraline', tags: ['antidepressants'], indications: ['depression'],
    });
    const indicationOnly = source({
      slug: 'gabapentin', generic: 'Gabapentin', tags: ['anticonvulsants'], indications: ['neuropathic-pain'],
    });

    const cards = buildCards([both, categoryOnly, indicationOnly], defs, config({
      scope: { ...DEFAULT_CONFIG.scope, categories: ['antidepressants'], indications: ['neuropathic-pain'] },
    }));

    expect(cards.map((card) => card.slug)).toEqual(['duloxetine']);
  });

  it('narrows to a tagged list', () => {
    const tagged = source();
    const untagged = source({ slug: 'other', generic: 'Other', tags: [] });

    const cards = buildCards([tagged, untagged], defs, config({
      scope: { ...DEFAULT_CONFIG.scope, tags: ['top-drugs-2026'] },
    }));
    expect(cards.map((card) => card.slug)).toEqual(['alprazolam']);
  });

  it('treats brand and generic as a pair, naming what each side wants', () => {
    // Shown a brand, the thing wanted is the generic name, not "which drug"
    // in some looser sense.
    const toGeneric = buildCards([source()], defs, config({
      fields: ['brand'],
      direction: 'fields_to_drug',
    }));
    expect(toGeneric[0].prompt).toBe('Generic name?\n\nBrand names: Xanax');
    expect(toGeneric[0].faces[0].text).toBe('Alprazolam');

    // And its mirror: shown the generic, name the brands.
    const toBrand = buildCards([source()], defs, config({ fields: ['brand'] }));
    expect(toBrand[0].prompt).toBe('Brand name(s)? — Alprazolam');
    expect(toBrand[0].faces[0].text).toBe('Xanax');
  });

  it('keeps the general question when the clues are not the brand', () => {
    const cards = buildCards([source()], defs, config({
      fields: ['moa', 'dosing'],
      direction: 'fields_to_drug',
      mode: 'inclusive',
    }));
    expect(cards[0].prompt.startsWith('Which drug?')).toBe(true);
  });
});

/**
 * A regimen is asked one protocol at a time.
 *
 * *Can we make each subheading of regimens quizable instead of the whole thing
 * so it is easier to block out?* -- 2026-11-14. The field holds up to nineteen
 * named protocols on one drug, and one card for the lot is a card nobody can
 * grade: you either know all nineteen or you do not.
 */
describe('a regimen asked protocol by protocol', () => {
  const REGIMEN = [
    '### FOLFOX',
    '',
    'Adjuvant colon cancer, stage III',
    '',
    '- Oxaliplatin --- 85 mg/m2 IV day 1',
    '- Bevacizumab --- Metastatic, RAS-mutated <- this drug',
    '',
    '### FOLFIRI',
    '',
    'Metastatic colorectal cancer, second line',
    '',
    '- Irinotecan --- 180 mg/m2 IV day 1',
  ].join('\n');

  const withRegimen = (text = REGIMEN) => source({
    generic: 'Bevacizumab',
    slug: 'bevacizumab',
    values: { ...source().values, regimen: value({ value: text }) },
  });

  it('builds one card per protocol, each scheduled on its own', () => {
    const cards = buildCards([withRegimen()], defs, config({ fields: ['regimen'] }));

    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.faces[0].label)).toEqual(['FOLFOX', 'FOLFIRI']);
    // Separate keys, or the two would share one schedule and *Again* on the
    // second would bury the first.
    expect(cards.map((card) => card.cardKey))
      .toEqual(['inclusive:drug_to_fields:regimen#folfox', 'inclusive:drug_to_fields:regimen#folfiri']);
  });

  it('asks for the protocol by name, not for the whole field', () => {
    const [folfox] = buildCards([withRegimen()], defs, config({ fields: ['regimen'] }));

    // The field's own template -- *which named regimens include X* -- asks
    // about all of them, and the protocol has already been named.
    expect(folfox.prompt).toBe('FOLFOX — what is it for, and what is Bevacizumab\'s part in it?');
    expect(folfox.faces[0].text).toContain('Adjuvant colon cancer');
    expect(folfox.faces[0].text).not.toContain('FOLFIRI');
  });

  it('keys a protocol by its name, so reordering the field keeps the schedule', () => {
    const swapped = [
      '### FOLFIRI',
      '',
      'Metastatic colorectal cancer, second line',
      '',
      '- Irinotecan --- 180 mg/m2 IV day 1',
      '',
      '### FOLFOX',
      '',
      'Adjuvant colon cancer, stage III',
      '',
      '- Oxaliplatin --- 85 mg/m2 IV day 1',
      '- Bevacizumab --- Metastatic, RAS-mutated <- this drug',
    ].join('\n');

    // Built from the name, not the position: an editor moving FOLFIRI above
    // FOLFOX must not hand both of them each other's history.
    expect(new Set(buildCards([withRegimen(swapped)], defs, config({ fields: ['regimen'] }))
      .map((card) => card.cardKey)))
      .toEqual(new Set(buildCards([withRegimen()], defs, config({ fields: ['regimen'] }))
        .map((card) => card.cardKey)));
  });

  it('asks a regimen without headings whole, as it always was', () => {
    const cards = buildCards(
      [withRegimen('Given with a fluoropyrimidine backbone.')],
      defs,
      config({ fields: ['regimen'] }),
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].faces[0].label).toBe('Regimens');
    expect(cards[0].prompt).toBe('Which named regimens include Bevacizumab, and at what dose?');
  });

  it('splits an inclusive card only when the regimen is the whole of it', () => {
    // Alone, there is nothing to repeat and the protocols separate.
    expect(buildCards([withRegimen()], defs, config({ fields: ['regimen'] }))).toHaveLength(2);

    // Beside another field, splitting would print the mechanism twice.
    const bundled = buildCards([withRegimen()], defs, config({ fields: ['moa', 'regimen'] }));
    expect(bundled).toHaveLength(1);
    expect(bundled[0].faces.map((face) => face.label))
      .toEqual(['Mechanism of action', 'Regimens']);
  });

  it('splits every protocol out in exclusive mode, beside the other fields', () => {
    const cards = buildCards([withRegimen()], defs, config({
      fields: ['moa', 'regimen'], mode: 'exclusive',
    }));

    expect(cards.map((card) => card.faces[0].label))
      .toEqual(['Mechanism of action', 'FOLFOX', 'FOLFIRI']);
  });

  /* A regimen names its members and marks which one the drug is, so asked
     facts-to-drug the clue would hand over its own answer. */
  it('blanks the drug out of a clue that is asking for it', () => {
    const [folfox] = buildCards([withRegimen()], defs, config({
      fields: ['regimen'], direction: 'fields_to_drug',
    }));

    expect(folfox.prompt).toContain('Which drug?');
    expect(folfox.prompt).toContain('FOLFOX:');
    expect(folfox.prompt).not.toContain('Bevacizumab');

    // The protocol's **name** too, where the name is built out of its members:
    // a third of the real ones are, *lazertinib + amivantamab* among them.
    const [named] = buildCards(
      [withRegimen([
        '### Lazertinib + bevacizumab',
        'EGFR-mutated lung cancer',
        '- Bevacizumab <- this drug',
      ].join('\n'))],
      defs,
      config({ fields: ['regimen'], direction: 'fields_to_drug' }),
    );
    expect(named.prompt).not.toMatch(/bevacizumab/i);
    expect(named.prompt).toContain('Lazertinib + ');
    // The marker stays, which is what makes it a question: *which drug fills
    // this slot*.
    expect(folfox.prompt).toContain('<- this drug');
    expect(folfox.faces[0].text).toBe('Bevacizumab');
  });

  it('leaves the drug named where the drug is not the answer', () => {
    const [folfox] = buildCards([withRegimen()], defs, config({ fields: ['regimen'] }));
    expect(folfox.faces[0].text).toContain('Bevacizumab');
  });
});
