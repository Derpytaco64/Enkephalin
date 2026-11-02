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
    status: 'unverified',
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
    needsPairingReview: false,
    values: {
      generic: value({ value: 'Alprazolam' }),
      brand: value({ value: 'Xanax' }),
      indication: value({ value: 'Anxiety' }),
      moa: value({ value: 'GABA-A positive allosteric modulator' }),
      dosing: value({ value: '0.25 mg by mouth three times a day' }),
      bbw: value({ value: null, status: 'not_applicable' }),
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

  it('asks about an affirmed absence, because that is an answer', () => {
    // 147 drugs have no black box warning. "Does this one?" is a real
    // question, and "None" is the right answer rather than a gap.
    const cards = buildCards([source()], defs, config({ fields: ['bbw'] }));

    expect(cards).toHaveLength(1);
    expect(cards[0].faces[0].text).toBe('None');
  });

  it('skips a field nobody has filled in', () => {
    const bare = source({ values: { ...source().values, moa: value({ value: '   ' }) } });
    expect(buildCards([bare], defs, config({ fields: ['moa'] }))).toEqual([]);
  });

  it('drops a drug entirely when none of its chosen fields have answers', () => {
    const bare = source({ values: {} });
    expect(buildCards([bare], defs, config({ fields: ['moa', 'dosing'] }))).toEqual([]);
  });

  it('keeps only verified values when the config asks for them', () => {
    const mixed = source({
      values: {
        moa: value({ value: 'GABA-A modulator', status: 'verified' }),
        dosing: value({ value: '0.25 mg', status: 'unverified' }),
      },
    });

    const cards = buildCards([mixed], defs, config({
      fields: ['moa', 'dosing'],
      scope: { ...DEFAULT_CONFIG.scope, verifiedOnly: true },
    }));

    expect(cards.map((card) => card.fieldKeys)).toEqual([['moa']]);
  });

  it('will not build a brand-to-indication card while the pairing is unreviewed', () => {
    // Tirzepatide is the case: with the pairing unconfirmed, a card from both
    // fields can teach Mounjaro for weight management.
    const tirzepatide = source({
      slug: 'tirzepatide',
      generic: 'Tirzepatide',
      needsPairingReview: true,
      values: {
        brand: value({ value: 'Mounjaro\nZepbound' }),
        indication: value({ value: 'Diabetes\nWeight management' }),
        moa: value({ value: 'GIP and GLP-1 receptor agonist' }),
      },
    });

    const both = buildCards([tirzepatide], defs, config({ fields: ['brand', 'indication'], mode: 'inclusive' }));
    expect(both).toEqual([]);

    // Its other fields are still fair game.
    const safe = buildCards([tirzepatide], defs, config({ fields: ['moa'] }));
    expect(safe).toHaveLength(1);
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
    const cards = buildCards([source()], defs, config({ fields: ['dosing', 'bbw'], mode: 'inclusive' }));

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
