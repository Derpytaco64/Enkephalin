import { beforeEach, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import {
  auditLog, brandIndications, drugBrands, drugIndications, drugs, indications, users,
} from '@/db/schema';
import { pairingCounts, pairingDrugs } from '@/lib/admin/pairing';
import { setBrandIndications } from '@/lib/drugs/mutations';

/**
 * The brand-to-indication pairing editor, and the writer it gave
 * `brand_indications` -- a table that until now could only be written by the
 * importer, so a pairing was unchangeable once asserted.
 *
 * Two things are worth pinning. **Which drugs appear**, because the screen's
 * claim is that pairing is only a question where both axes are plural and
 * release forms of one brand do not count as competing brands. And **that an
 * empty tick list means "covers all"** rather than "treats nothing", because
 * those are opposite meanings stored identically as no rows.
 */

const ADMIN = 'user-admin';

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(drugs);
  await db.delete(indications);
  await db.delete(users);
  await db.insert(users).values({ id: ADMIN, email: 'admin@example.test', role: 'admin' });
});

async function makeDrug(input: {
  slug: string;
  generic: string;
  brands: { name: string; family?: string }[];
  indications: string[];
  needsReview?: boolean;
}) {
  const [drug] = await db.insert(drugs).values({
    slug: input.slug,
    genericName: input.generic,
    fields: {},
    needsPairingReview: input.needsReview ?? false,
  }).returning({ id: drugs.id });

  const brands = await db.insert(drugBrands).values(
    input.brands.map((brand, i) => ({
      drugId: drug.id, name: brand.name, family: brand.family ?? brand.name, sortOrder: i,
    })),
  ).returning({ id: drugBrands.id, name: drugBrands.name });

  // `indications` is a shared vocabulary with a unique slug -- an indication is
  // one row used by many drugs -- so two drugs in one test naming the same
  // condition must reuse the row rather than insert a second.
  const slugs = input.indications.map((label) => ({
    slug: label.toLowerCase().replace(/\W+/g, '-'), label,
  }));
  await db.insert(indications).values(slugs).onConflictDoNothing({ target: indications.slug });
  const vocab = await db
    .select({ id: indications.id, label: indications.label })
    .from(indications)
    .where(inArray(indications.slug, slugs.map((row) => row.slug)));

  const links = await db.insert(drugIndications).values(
    vocab.map((row, i) => ({ drugId: drug.id, indicationId: row.id, sortOrder: i })),
  ).returning({ id: drugIndications.id, indicationId: drugIndications.indicationId });

  return {
    id: drug.id,
    brand: (name: string) => brands.find((row) => row.name === name)!.id,
    indication: (label: string) => {
      const vocabRow = vocab.find((row) => row.label === label)!;
      return links.find((row) => row.indicationId === vocabRow.id)!.id;
    },
  };
}

describe('which drugs are worth pairing', () => {
  it('needs more than one brand and more than one condition', async () => {
    await makeDrug({
      slug: 'both', generic: 'Both Plural',
      brands: [{ name: 'Aone' }, { name: 'Atwo' }], indications: ['First', 'Second'],
    });
    await makeDrug({
      slug: 'one-brand', generic: 'One Brand',
      brands: [{ name: 'Solo' }], indications: ['First', 'Second'],
    });
    await makeDrug({
      slug: 'one-condition', generic: 'One Condition',
      brands: [{ name: 'Bone' }, { name: 'Btwo' }], indications: ['Only'],
    });

    const queue = await pairingDrugs();
    expect(queue.map((row) => row.slug)).toEqual(['both']);
    expect((await pairingCounts()).pairable).toBe(1);
  });

  /**
   * Depakote against Depakote ER is one brand in two release forms, not two
   * brands competing for an indication -- the same collapse `build-seed.py`
   * does. Three Wellbutrins against one Zyban *is* a real question.
   */
  it('counts release forms of one brand as one brand', async () => {
    await makeDrug({
      slug: 'forms', generic: 'Forms Only',
      brands: [{ name: 'Depakote', family: 'Depakote' }, { name: 'Depakote ER', family: 'Depakote' }],
      indications: ['Seizures', 'Bipolar disorder'],
    });
    await makeDrug({
      slug: 'rivals', generic: 'Rivals',
      brands: [
        { name: 'Wellbutrin', family: 'Wellbutrin' },
        { name: 'Wellbutrin XL', family: 'Wellbutrin' },
        { name: 'Zyban', family: 'Zyban' },
      ],
      indications: ['Depression', 'Smoking cessation'],
    });

    expect((await pairingDrugs()).map((row) => row.slug)).toEqual(['rivals']);
  });

  it('leads with whatever the importer flagged', async () => {
    await makeDrug({
      slug: 'zzz-flagged', generic: 'Zzz Flagged', needsReview: true,
      brands: [{ name: 'Zone' }, { name: 'Ztwo' }], indications: ['First', 'Second'],
    });
    await makeDrug({
      slug: 'aaa-clear', generic: 'Aaa Clear',
      brands: [{ name: 'Aone' }, { name: 'Atwo' }], indications: ['First', 'Second'],
    });

    expect((await pairingDrugs()).map((row) => row.slug)).toEqual(['zzz-flagged', 'aaa-clear']);
    expect((await pairingCounts()).needsReview).toBe(1);
  });
});

describe('saving a map', () => {
  it('narrows each brand to what was ticked', async () => {
    const drug = await makeDrug({
      slug: 'bup', generic: 'Bupropionish',
      brands: [{ name: 'Wellbutrin' }, { name: 'Zyban' }],
      indications: ['Depression', 'Smoking cessation'],
    });

    const result = await setBrandIndications('bup', {
      [drug.brand('Wellbutrin')]: [drug.indication('Depression')],
      [drug.brand('Zyban')]: [drug.indication('Smoking cessation')],
    }, ADMIN);
    expect(result.ok).toBe(true);

    const [after] = await pairingDrugs();
    const byName = new Map(after.brands.map((brand) => [brand.name, brand.indicationIds]));
    expect(byName.get('Wellbutrin')).toEqual([drug.indication('Depression')]);
    expect(byName.get('Zyban')).toEqual([drug.indication('Smoking cessation')]);
  });

  /**
   * The distinction the whole screen turns on: no rows means the brand is not
   * narrowed, which is the importer's default and the common case.
   */
  it('treats an empty list as "covers all" and clears the rows', async () => {
    const drug = await makeDrug({
      slug: 'alb', generic: 'Albuterolish',
      brands: [{ name: 'Ventolin' }, { name: 'Proair' }],
      indications: ['Asthma', 'COPD'],
    });

    await setBrandIndications('alb', {
      [drug.brand('Ventolin')]: [drug.indication('Asthma')],
      [drug.brand('Proair')]: [],
    }, ADMIN);

    // Now widen Ventolin back out again, which must delete its row.
    await setBrandIndications('alb', {
      [drug.brand('Ventolin')]: [],
      [drug.brand('Proair')]: [],
    }, ADMIN);

    expect(await db.select().from(brandIndications)).toHaveLength(0);
    expect((await pairingCounts()).unnarrowed).toBe(1);
  });

  it('replaces the whole map rather than adding to it', async () => {
    const drug = await makeDrug({
      slug: 'sil', generic: 'Sildenafilish',
      brands: [{ name: 'Revatio' }, { name: 'Viagra' }],
      indications: ['Pulmonary hypertension', 'Erectile dysfunction'],
    });

    await setBrandIndications('sil', {
      [drug.brand('Revatio')]: [
        drug.indication('Pulmonary hypertension'), drug.indication('Erectile dysfunction'),
      ],
      [drug.brand('Viagra')]: [],
    }, ADMIN);
    expect(await db.select().from(brandIndications)).toHaveLength(2);

    await setBrandIndications('sil', {
      [drug.brand('Revatio')]: [drug.indication('Pulmonary hypertension')],
      [drug.brand('Viagra')]: [drug.indication('Erectile dysfunction')],
    }, ADMIN);

    const rows = await db.select().from(brandIndications);
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.brandId === drug.brand('Revatio'))).toHaveLength(1);
  });

  it('refuses a brand or indication from another drug', async () => {
    const mine = await makeDrug({
      slug: 'mine', generic: 'Mine',
      brands: [{ name: 'Mone' }, { name: 'Mtwo' }], indications: ['First', 'Second'],
    });
    const theirs = await makeDrug({
      slug: 'theirs', generic: 'Theirs',
      brands: [{ name: 'Tone' }, { name: 'Ttwo' }], indications: ['Third', 'Fourth'],
    });

    const wrongBrand = await setBrandIndications('mine', {
      [theirs.brand('Tone')]: [mine.indication('First')],
    }, ADMIN);
    expect(wrongBrand.ok).toBe(false);

    const wrongIndication = await setBrandIndications('mine', {
      [mine.brand('Mone')]: [theirs.indication('Third')],
    }, ADMIN);
    expect(wrongIndication.ok).toBe(false);

    // And nothing was written on the way to refusing.
    expect(await db.select().from(brandIndications)).toHaveLength(0);
  });

  it('names brands in the audit row, not ids', async () => {
    const drug = await makeDrug({
      slug: 'bup', generic: 'Bupropionish',
      brands: [{ name: 'Wellbutrin' }, { name: 'Zyban' }],
      indications: ['Depression', 'Smoking cessation'],
    });

    await setBrandIndications('bup', {
      [drug.brand('Wellbutrin')]: [drug.indication('Depression')],
      [drug.brand('Zyban')]: [],
    }, ADMIN);

    const [row] = await db.select().from(auditLog).where(eq(auditLog.action, 'drug.brand_indications'));
    expect(row).toBeDefined();
    const diff = row.diff as { narrowed: Record<string, number>; coversAll: string[] };
    expect(diff.narrowed).toEqual({ Wellbutrin: 1 });
    expect(diff.coversAll).toEqual(['Zyban']);
  });

  it('refuses a drug that is gone', async () => {
    const result = await setBrandIndications('nope', {}, ADMIN);
    expect(result.ok).toBe(false);
  });
});
