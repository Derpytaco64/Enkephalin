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
    const cards = buildCards([source()], defs, config({ fields: ['moa', 'dosing'] }));

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
});
