import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  brandIndications, drugBrands, drugIndications, drugTags, drugs, indications, tags,
} from '@/db/schema';
import { syncDrugs, type SeedDrug } from '@/lib/content/sync';

beforeEach(async () => {
  await db.delete(brandIndications);
  await db.delete(drugTags);
  await db.delete(drugBrands);
  await db.delete(drugIndications);
  await db.delete(indications);
  await db.delete(drugs);
  await db.delete(tags);
});

/** Shaped like data/drugs-seed.json, including tirzepatide's real pairing. */
function seed(): SeedDrug[] {
  return [
    {
      slug: 'tirzepatide',
      generic: 'Tirzepatide',
      drug_class: 'GLP-1 Receptor Agonist',
      dosing: '2.5 mg subcutaneously once weekly',
      moa: 'GIP and GLP-1 receptor agonist',
      bbw: 'Thyroid C-cell tumors',
      bbw_status: 'from_sheet',
      needs_pairing_review: true,
      rxcui: '2601723',
      brands: [
        { id: 'tz--brand-0', name: 'Mounjaro', family: 'Mounjaro', indication_ids: ['tz--ind-0'] },
        { id: 'tz--brand-1', name: 'Zepbound', family: 'Zepbound', indication_ids: ['tz--ind-2'] },
      ],
      indications: [
        { id: 'tz--ind-0', text: 'Diabetes' },
        { id: 'tz--ind-1', text: 'Obstructive sleep apnea' },
        { id: 'tz--ind-2', text: 'Weight management' },
      ],
    },
    {
      slug: 'acetylcysteine',
      generic: 'Acetylcysteine',
      // The sheet resolved no class: a human picks from the candidates.
      drug_class: null,
      needs_class_review: true,
      class_candidates_ranked: ['ANTIDOTES/DETERRENTS,OTHER', 'Mucolytics'],
      class_suggestion: 'ANTIDOTES/DETERRENTS,OTHER',
      dosing: '300 mg/kg total dose',
      moa: 'Restores hepatic glutathione',
      bbw: '',
      bbw_status: 'none',
      brands: [{ id: 'ac--brand-0', name: 'Acetadote', family: 'Acetadote' }],
      indications: [{ id: 'ac--ind-0', text: 'Acetaminophen overdose' }],
    },
    {
      slug: 'alprazolam',
      generic: 'Alprazolam',
      drug_class: 'Benzodiazepine',
      schedule: 'CIV',
      schedule_note: 'Schedule IV',
      dosing: '0.25 mg by mouth three times a day',
      bbw: 'Risks from concomitant use with opioids',
      bbw_status: 'from_sheet',
      brands: [{ id: 'al--brand-0', name: 'Xanax', family: 'Xanax' }],
      indications: [{ id: 'al--ind-0', text: 'Anxiety' }],
    },
  ];
}

async function drugBySlug(slug: string) {
  const [row] = await db.select().from(drugs).where(eq(drugs.slug, slug));
  return row;
}

describe('syncDrugs', () => {
  it('imports drugs, brands, indications, links and the list tag', async () => {
    const report = await syncDrugs(seed());

    expect(report.drugsInserted).toBe(3);
    expect(report.brandsInserted).toBe(4);
    expect(report.indicationsInserted).toBe(5);
    expect(report.linksInserted).toBe(2);
    expect(report.tagsLinked).toBe(3);

    const tirzepatide = await drugBySlug('tirzepatide');
    expect(tirzepatide.drugClass).toBe('GLP-1 Receptor Agonist');
    expect(tirzepatide.needsPairingReview).toBe(true);
    expect(tirzepatide.fields.dosing?.value).toBe('2.5 mg subcutaneously once weekly');

    const [tag] = await db.select().from(tags);
    expect(tag.slug).toBe('top-drugs-2026');
    expect(tag.kind).toBe('top_list');
  });

  it('pairs Mounjaro with diabetes and Zepbound with weight management', async () => {
    // The whole reason brands and indications are entities: flat lists would
    // teach Mounjaro for weight management.
    await syncDrugs(seed());

    const rows = await db
      .select({ brand: drugBrands.name, indication: indications.label })
      .from(brandIndications)
      .innerJoin(drugBrands, eq(drugBrands.id, brandIndications.brandId))
      .innerJoin(drugIndications, eq(drugIndications.id, brandIndications.indicationId))
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId));

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { brand: 'Mounjaro', indication: 'Diabetes' },
        { brand: 'Zepbound', indication: 'Weight management' },
      ]),
    );
  });

  it('records an absent black box warning as "none", not as a gap', async () => {
    await syncDrugs(seed());

    const acetylcysteine = await drugBySlug('acetylcysteine');
    expect(acetylcysteine.fields.bbw).toMatchObject({ value: null, status: 'none' });

    const alprazolam = await drugBySlug('alprazolam');
    expect(alprazolam.fields.bbw).toMatchObject({ status: 'ok' });
    expect(alprazolam.schedule).toBe('CIV');
  });

  it('stores one wording for an indication the sheet spells two ways', async () => {
    const seeded = seed();
    seeded[2].indications = [{ id: 'al--ind-1', text: 'Seizure' }];
    await syncDrugs(seeded);

    const alprazolam = await drugBySlug('alprazolam');
    const rows = await db
      .select({ text: indications.label })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .where(eq(drugIndications.drugId, alprazolam.id));

    // The sheet says "Seizure"; the database keeps "Seizures", so a profile
    // and a quiz option read the same words.
    expect(rows.map((row) => row.text)).toEqual(['Seizures']);
  });

  it('shares one vocabulary row between drugs with the same indication', async () => {
    const seeded = seed();
    seeded[2].indications = [{ id: 'al--ind-1', text: 'Diabetes' }];
    await syncDrugs(seeded);

    // Tirzepatide and alprazolam both say Diabetes. One row, so renaming it
    // later is one edit and the study filter finds both drugs.
    const rows = await db.select().from(indications).where(eq(indications.slug, 'diabetes'));
    expect(rows).toHaveLength(1);

    const links = await db
      .select({ drugId: drugIndications.drugId })
      .from(drugIndications)
      .where(eq(drugIndications.indicationId, rows[0].id));
    expect(links).toHaveLength(2);
  });

  it('reports the wordings it had to invent, and nothing on a re-run', async () => {
    const first = await syncDrugs(seed());
    // Every indication in the sheet is new the first time round.
    expect(first.newIndications.length).toBeGreaterThan(0);

    const second = await syncDrugs(seed());
    // A re-import that invents a wording means the sheet grew a second
    // spelling of something, which is worth seeing rather than absorbing.
    expect(second.newIndications).toEqual([]);
  });

  it('does not re-add the sheet spelling beside the canonical one', async () => {
    const seeded = seed();
    seeded[2].indications = [{ id: 'al--ind-1', text: 'Seizure' }];
    await syncDrugs(seeded);
    const report = await syncDrugs(seeded);

    const alprazolam = await drugBySlug('alprazolam');
    const rows = await db
      .select().from(drugIndications).where(eq(drugIndications.drugId, alprazolam.id));

    expect(rows).toHaveLength(1);
    expect(report.indicationsInserted).toBe(0);
    expect(report.orphanIndications).toEqual([]);
  });

  it('carries the class review queue rather than guessing a class', async () => {
    await syncDrugs(seed());

    const row = await drugBySlug('acetylcysteine');
    expect(row.drugClass).toBeNull();
    expect(row.needsClassReview).toBe(true);
    expect(row.classCandidates).toEqual(['ANTIDOTES/DETERRENTS,OTHER', 'Mucolytics']);
    expect(row.classSuggestion).toBe('ANTIDOTES/DETERRENTS,OTHER');
  });

  it('run twice produces no second-run writes', async () => {
    await syncDrugs(seed());
    const second = await syncDrugs(seed());

    expect(second).toMatchObject({
      drugsInserted: 0,
      drugsUpdated: 0,
      drugsUnchanged: 3,
      brandsInserted: 0,
      brandsUpdated: 0,
      indicationsInserted: 0,
      linksInserted: 0,
      tagsLinked: 0,
    });
    expect(second.humanKept).toEqual([]);
  });

  it('leaves updatedAt alone on a run that changes nothing', async () => {
    await syncDrugs(seed());
    const before = (await drugBySlug('tirzepatide')).updatedAt;

    await syncDrugs(seed());
    expect((await drugBySlug('tirzepatide')).updatedAt).toEqual(before);
  });

  it('updates exactly the drug whose sheet entry changed', async () => {
    await syncDrugs(seed());
    const untouched = (await drugBySlug('alprazolam')).updatedAt;

    const edited = seed();
    edited[0].dosing = '5 mg subcutaneously once weekly';
    const report = await syncDrugs(edited);

    expect(report.drugsUpdated).toBe(1);
    expect(report.drugsUnchanged).toBe(2);
    expect((await drugBySlug('tirzepatide')).fields.dosing?.value).toBe('5 mg subcutaneously once weekly');
    expect((await drugBySlug('alprazolam')).updatedAt).toEqual(untouched);
  });

  it('never clobbers what a person wrote, and says which it withheld', async () => {
    await syncDrugs(seed());

    const row = await drugBySlug('tirzepatide');
    await db
      .update(drugs)
      .set({
        fields: {
          ...row.fields,
          // updatedBy is what says a person wrote this, now that no status does.
          moa: { ...row.fields.moa!, value: 'Rewritten in the editor', updatedBy: 'user-admin' },
        },
      })
      .where(eq(drugs.id, row.id));

    const report = await syncDrugs(seed());
    expect(report.humanKept).toEqual(['tirzepatide.moa']);
    expect((await drugBySlug('tirzepatide')).fields.moa).toMatchObject({
      value: 'Rewritten in the editor',
      updatedBy: 'user-admin',
    });
  });

  it('refreshes its own earlier value without being forced', async () => {
    await syncDrugs(seed());
    const row = await drugBySlug('tirzepatide');
    await db
      .update(drugs)
      .set({
        // No author: the importer wrote this, so the importer may correct it.
        fields: { ...row.fields, moa: { ...row.fields.moa!, value: 'Stale note', updatedBy: null } },
      })
      .where(eq(drugs.id, row.id));

    const report = await syncDrugs(seed());
    expect(report.humanKept).toEqual([]);
    expect((await drugBySlug('tirzepatide')).fields.moa).toMatchObject({
      value: 'GIP and GLP-1 receptor agonist',
      status: 'ok',
    });
  });

  it('overwrites even a hand-written value when forced', async () => {
    await syncDrugs(seed());
    const row = await drugBySlug('tirzepatide');
    await db
      .update(drugs)
      .set({
        fields: { ...row.fields, moa: { ...row.fields.moa!, value: 'Stale note', updatedBy: 'user-admin' } },
      })
      .where(eq(drugs.id, row.id));

    const report = await syncDrugs(seed(), { force: true });
    expect(report.humanKept).toEqual([]);
    expect((await drugBySlug('tirzepatide')).fields.moa).toMatchObject({
      value: 'GIP and GLP-1 receptor agonist',
    });
  });

  it('fills a gap but never blanks a value a human supplied', async () => {
    await syncDrugs(seed());

    // A human resolves the class review by hand.
    await db
      .update(drugs)
      .set({ drugClass: 'Mucolytic', needsClassReview: false })
      .where(eq(drugs.slug, 'acetylcysteine'));

    // The sheet still has no class for it; the import must not undo the work.
    await syncDrugs(seed());
    const row = await drugBySlug('acetylcysteine');
    expect(row.drugClass).toBe('Mucolytic');
    expect(row.needsClassReview).toBe(false);
  });

  it('keeps human-confirmed brand pairings and does not re-raise a settled suspect flag', async () => {
    const withSuspect = seed();
    withSuspect[2].brands = [
      {
        id: 'al--brand-0',
        name: 'Xanax',
        family: 'Xanax',
        default_pairing_suspect: true,
        suspect_reason: 'Confirm this brand really treats: Anxiety',
      },
    ];
    await syncDrugs(withSuspect);

    const [brand] = await db.select().from(drugBrands).where(eq(drugBrands.name, 'Xanax'));
    expect(brand.defaultPairingSuspect).toBe(true);

    // A human confirms the pairing, which clears the flag and adds the link.
    await db.update(drugBrands).set({ defaultPairingSuspect: false }).where(eq(drugBrands.id, brand.id));
    const [indication] = await db
      .select({ id: drugIndications.id })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .where(eq(indications.label, 'Anxiety'));
    await db.insert(brandIndications).values({ brandId: brand.id, indicationId: indication.id });

    await syncDrugs(withSuspect);

    const [after] = await db.select().from(drugBrands).where(eq(drugBrands.id, brand.id));
    expect(after.defaultPairingSuspect).toBe(false);
    const links = await db.select().from(brandIndications).where(eq(brandIndications.brandId, brand.id));
    expect(links).toHaveLength(1);
  });

  it('reports rows the sheet has dropped instead of deleting them', async () => {
    await syncDrugs(seed());

    const trimmed = seed();
    trimmed[0].brands = [trimmed[0].brands![0]];
    trimmed[0].indications = [trimmed[0].indications![0]];

    const report = await syncDrugs(trimmed);
    expect(report.orphanBrands).toEqual(['tirzepatide: Zepbound']);
    expect(report.orphanIndications).toEqual(
      expect.arrayContaining(['tirzepatide: Obstructive sleep apnea', 'tirzepatide: Weight management']),
    );
    // Still there: dropping them would take a confirmed pairing with them.
    expect(await db.select().from(drugBrands).where(eq(drugBrands.name, 'Zepbound'))).toHaveLength(1);
  });

  it('flags variant dosing for a human rather than inventing brand rows', async () => {
    const withVariants = seed();
    withVariants[1].variants = [{ brand: 'Vivelle-Dot\nAlora', dosing: 'Product dependent' }];

    const report = await syncDrugs(withVariants);
    expect(report.variantsSkipped).toEqual(['acetylcysteine']);
  });

  it('folds a generic the sheet lists twice into one drug with explicit pairing', async () => {
    // Sildenafil is the real case: Revatio for pulmonary hypertension and
    // Viagra for erectile dysfunction, both slugged `sildenafil`. Imported
    // naively, the second row's dosing wins and both brands cover both
    // indications, so the app teaches Viagra for pulmonary hypertension.
    const sheet: SeedDrug[] = [
      {
        slug: 'sildenafil',
        generic: 'Sildenafil',
        drug_class: 'Phosphodiesterase-5 Inhibitor',
        dosing: '20 mg by mouth three times a day',
        // Same ids in both rows, exactly as the extractor emits them.
        brands: [{ id: 'sildenafil--brand-0', name: 'Revatio', family: 'Revatio' }],
        indications: [{ id: 'sildenafil--ind-0', text: 'Pulmonary hypertension' }],
      },
      {
        slug: 'sildenafil',
        generic: 'Sildenafil',
        dosing: '50 mg by mouth 1 hour prior to sexual activity',
        brands: [{ id: 'sildenafil--brand-0', name: 'Viagra', family: 'Viagra' }],
        indications: [{ id: 'sildenafil--ind-0', text: 'Erectile dysfunction' }],
      },
    ];

    const report = await syncDrugs(sheet);

    expect(report.mergedSlugs).toEqual(['sildenafil']);
    expect(report.drugsInserted).toBe(1);
    expect(report.drugsUpdated).toBe(0);

    const rows = await db
      .select({
        brand: drugBrands.name,
        indication: indications.label,
        dosing: drugBrands.dosingOverride,
      })
      .from(brandIndications)
      .innerJoin(drugBrands, eq(drugBrands.id, brandIndications.brandId))
      .innerJoin(drugIndications, eq(drugIndications.id, brandIndications.indicationId))
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId));

    // Each brand is pinned to its own row's indication, so neither falls back
    // to covering both.
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { brand: 'Revatio', indication: 'Pulmonary hypertension', dosing: '20 mg by mouth three times a day' },
        { brand: 'Viagra', indication: 'Erectile dysfunction', dosing: '50 mg by mouth 1 hour prior to sexual activity' },
      ]),
    );
  });

  it('a folded drug is still idempotent on a second run', async () => {
    const sheet: SeedDrug[] = [
      {
        slug: 'sildenafil', generic: 'Sildenafil', dosing: '20 mg by mouth three times a day',
        // Same ids in both rows, exactly as the extractor emits them.
        brands: [{ id: 'sildenafil--brand-0', name: 'Revatio', family: 'Revatio' }],
        indications: [{ id: 'sildenafil--ind-0', text: 'Pulmonary hypertension' }],
      },
      {
        slug: 'sildenafil', generic: 'Sildenafil', dosing: '50 mg by mouth 1 hour prior to sexual activity',
        brands: [{ id: 'sildenafil--brand-0', name: 'Viagra', family: 'Viagra' }],
        indications: [{ id: 'sildenafil--ind-0', text: 'Erectile dysfunction' }],
      },
    ];
    await syncDrugs(sheet);
    const second = await syncDrugs(sheet);

    expect(second).toMatchObject({
      drugsInserted: 0, drugsUpdated: 0, drugsUnchanged: 1,
      brandsInserted: 0, brandsUpdated: 0, indicationsInserted: 0, linksInserted: 0,
    });
    expect(second.orphanBrands).toEqual([]);
    expect(second.orphanIndications).toEqual([]);
  });
});
