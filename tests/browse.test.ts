import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { brandIndications, drugBrands, drugIndications, drugTags, drugs, fieldDefs, tags } from '@/db/schema';
import { syncDrugs, type SeedDrug } from '@/lib/content/sync';
import { getDrugIndex } from '@/lib/drugs/browse';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';

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
      slug: 'lisinopril',
      generic: 'Lisinopril',
      drug_class: 'ACE Inhibitor',
      dosing: '10 mg by mouth once a day',
      // No mechanism recorded: a genuine gap.
      moa: '',
      bbw: '',
      bbw_status: 'none',
      brands: [{ id: 'l--b0', name: 'Zestril', family: 'Zestril' }],
      indications: [{ id: 'l--i0', text: 'Hypertension' }],
    },
    {
      slug: 'enalapril',
      generic: 'Enalapril',
      drug_class: 'ACE Inhibitor',
      dosing: '5 mg by mouth once a day',
      moa: 'ACE inhibition',
      bbw: '',
      bbw_status: 'none',
      needs_class_review: true,
      brands: [],
      indications: [],
    },
  ];

  await syncDrugs(seed);
});

async function rowFor(slug: string) {
  const { rows } = await getDrugIndex();
  return rows.find((row) => row.slug === slug)!;
}

describe('getDrugIndex', () => {
  it('reads the route out of the dosing text during the import', async () => {
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'alprazolam'));
    expect(drug.fields.route).toMatchObject({ value: 'Oral', source: 'the sheet dosing text' });
  });

  it('returns one row per drug with its brands, class and schedule', async () => {
    const { rows } = await getDrugIndex();

    expect(rows).toHaveLength(3);
    // Ordered by generic name, which is the order the page shows unfiltered.
    expect(rows.map((row) => row.slug)).toEqual(['alprazolam', 'enalapril', 'lisinopril']);

    const alprazolam = rows[0];
    expect(alprazolam.brands).toEqual(['Xanax']);
    expect(alprazolam.drugClass).toBe('Benzodiazepine');
    expect(alprazolam.schedule).toBe('CIV');
    expect(alprazolam.tags).toEqual(['top-drugs-2026']);
  });

  it('counts a gap as missing but an affirmed absence as not missing', async () => {
    // Lisinopril has no mechanism recorded and no black box warning. Only the
    // first is a gap: 147 drugs genuinely have no warning, and listing them as
    // missing one would bury the real work.
    const lisinopril = await rowFor('lisinopril');
    expect(lisinopril.missing).toEqual(['moa']);

    const alprazolam = await rowFor('alprazolam');
    expect(alprazolam.missing).toEqual([]);
  });

  it('calls a drug complete when every stored field has a value', async () => {
    // Nothing waits to be verified any more, so a filled profile is simply
    // complete: the rollup is about gaps and doubts, not signatures.
    expect((await rowFor('alprazolam')).review).toBe('ok');
  });

  it('reports gaps when a stored field has no value', async () => {
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'lisinopril'));
    expect(drug.fields.moa?.value ?? null).toBeNull();

    const row = await rowFor('lisinopril');
    expect(row.missing).toContain('moa');
    expect(row.review).toBe('gaps');
  });

  it('a flagged field outranks a gap in the rollup', async () => {
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'lisinopril'));
    await db
      .update(drugs)
      .set({ fields: { ...drug.fields, dosing: { ...drug.fields.dosing!, status: 'flagged' } } })
      .where(eq(drugs.id, drug.id));

    // A wrong answer in a deck costs more than a missing one, which simply
    // makes no card.
    expect((await rowFor('lisinopril')).review).toBe('flagged');
  });

  it('counts an affirmed absence as answered rather than as a gap', async () => {
    // Enalapril has dosing and moa filled and no warning at all.
    const enalapril = await rowFor('enalapril');
    expect(enalapril.missing).toEqual([]);
    expect(enalapril.review).toBe('ok');
  });

  it('surfaces the review queue as a flag on the row', async () => {
    expect((await rowFor('enalapril')).needsReview).toBe(true);
    expect((await rowFor('alprazolam')).needsReview).toBe(false);
  });

  it('carries the indications each drug treats, for the indication filter', async () => {
    expect((await rowFor('alprazolam')).indications).toEqual(['Anxiety']);
    expect((await rowFor('lisinopril')).indications).toEqual(['Hypertension']);
    expect((await rowFor('enalapril')).indications).toEqual([]);
  });

  it('sorts facets the way a person reads them, not by ASCII', async () => {
    // A default sort puts every lower-case initial after every upper-case one,
    // so "beta2-Adrenergic Agonist" would land past "Xanthine Oxidase
    // Inhibitor" in a list that is supposed to be alphabetical.
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'enalapril'));
    await db.update(drugs).set({ drugClass: 'beta2-Adrenergic Agonist' }).where(eq(drugs.id, drug.id));

    const { facets } = await getDrugIndex();
    expect(facets.classes).toEqual(['ACE Inhibitor', 'Benzodiazepine', 'beta2-Adrenergic Agonist']);
  });

  it('builds facets from what the data actually contains', async () => {
    const { facets } = await getDrugIndex();

    expect(facets.classes).toEqual(['ACE Inhibitor', 'Benzodiazepine']);
    expect(facets.indications).toEqual(['Anxiety', 'Hypertension']);
    expect(facets.schedules).toEqual(['CIV']);
    expect(facets.tags.map((tag) => tag.slug)).toEqual(['top-drugs-2026']);
    // Only the stored fields can be missing, so core fields stay out of the
    // missing-field filter.
    expect(facets.fields.map((field) => field.key)).toEqual(['route', 'dosing', 'moa', 'bbw']);
  });

  it('leaves a soft-deleted field out of the facets and the gap count', async () => {
    await db.update(fieldDefs).set({ deletedAt: new Date() }).where(eq(fieldDefs.key, 'moa'));

    const { rows, facets } = await getDrugIndex();
    expect(facets.fields.map((field) => field.key)).toEqual(['route', 'dosing', 'bbw']);
    expect(rows.find((row) => row.slug === 'lisinopril')!.missing).toEqual([]);
  });

});
