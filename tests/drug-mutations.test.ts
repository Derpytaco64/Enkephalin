import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  accounts,
  auditLog,
  brandIndications,
  dosingRegimens,
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  fieldDefs,
  sessions,
  tags,
  users,
} from '@/db/schema';
import {
  brandFamily,
  createDrug,
  rebuildRegimens,
  setDosingUnique,
  setDrugBrands,
  setDrugField,
  setDrugIndications,
  setDrugTags,
  updateDrugIdentity,
} from '@/lib/drugs/mutations';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { listFieldDefs, type FieldDef } from '@/lib/fields/registry';

const ADMIN = 'user-admin';
let defs: FieldDef[];

async function def(key: string) {
  const found = defs.find((row) => row.key === key);
  if (!found) throw new Error(`no field def ${key}`);
  return found;
}

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(brandIndications);
  await db.delete(dosingRegimens);
  await db.delete(drugTags);
  await db.delete(drugBrands);
  await db.delete(drugIndications);
  await db.delete(drugs);
  await db.delete(tags);
  await db.delete(fieldDefs);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);

  await db.insert(users).values({ id: ADMIN, email: 'admin@example.test', role: 'admin' });
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);
  defs = await listFieldDefs();

  await db.insert(tags).values([
    { slug: 'top-drugs-2026', label: 'Top Drugs 2026', kind: 'top_list' },
    { slug: 'pharm-1', label: 'Pharmacology I', kind: 'course' },
    { slug: 'statins', label: 'Statins', kind: 'system' },
  ]);
});

async function seedDrug() {
  const [drug] = await db
    .insert(drugs)
    .values({
      slug: 'alprazolam',
      genericName: 'Alprazolam',
      drugClass: 'Benzodiazepine',
      schedule: 'CIV',
      fields: {
        dosing: {
          value: '0.25 mg by mouth three times a day',
          status: 'ok', source: 'class sheet', updatedAt: '', updatedBy: null,
        },
      },
    })
    .returning({ id: drugs.id });
  return drug.id;
}

describe('createDrug', () => {
  it('makes the drug, its lists and its structured dosing in one go', async () => {
    const result = await createDrug({
      genericName: 'Amoxicillin/Clavulanate',
      drugClass: 'Penicillin-class Antibacterial',
      schedule: '',
      scheduleNote: '',
      brands: 'Augmentin\nAugmentin XR',
      indications: 'Bacterial infection',
      dosing: '500 mg by mouth every 8 hours',
      dosingUnique: false,
      tagSlugs: ['top-drugs-2026'],
    }, ADMIN);

    expect(result).toEqual({ ok: true, value: 'amoxicillin-clavulanate' });

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'amoxicillin-clavulanate'));
    expect(drug.genericName).toBe('Amoxicillin/Clavulanate');
    expect(drug.schedule).toBeNull();

    // Never attributed to the sheet: source and author are the provenance, and
    // updatedBy is what keeps a later import off it.
    expect(drug.fields.dosing.source).toBe('added by hand');
    expect(drug.fields.dosing.status).toBe('ok');
    expect(drug.fields.dosing.updatedBy).toBe(ADMIN);

    const brands = await db
      .select().from(drugBrands).where(eq(drugBrands.drugId, drug.id)).orderBy(asc(drugBrands.sortOrder));
    expect(brands.map((row) => row.name)).toEqual(['Augmentin', 'Augmentin XR']);
    // Both are one brand family, or sampling offers three Augmentins as distractors.
    expect(brands.map((row) => row.family)).toEqual(['Augmentin', 'Augmentin']);

    const regimens = await db.select().from(dosingRegimens).where(eq(dosingRegimens.drugId, drug.id));
    expect(regimens).toHaveLength(1);
    expect(regimens[0].frequency).toEqual({ kind: 'interval', low: 8, high: null, unit: 'hour' });
    expect(regimens[0].source).toBe('drug editor');
  });

  it('refuses a name that would collide, rather than suffixing it', async () => {
    await seedDrug();
    const result = await createDrug({
      genericName: 'Alprazolam', drugClass: '', schedule: '', scheduleNote: '',
      brands: '', indications: '', dosing: '', dosingUnique: false, tagSlugs: [],
    }, ADMIN);

    // Two drugs a slug apart is how the sheet's sildenafil duplicate happened;
    // the answer there was one drug with two brands.
    expect(result).toEqual({ ok: false, message: 'A drug already exists at /drugs/alprazolam.' });
  });

  it('needs a name to make an address from', async () => {
    const blank = await createDrug({
      genericName: '  ', drugClass: '', schedule: '', scheduleNote: '',
      brands: '', indications: '', dosing: '', dosingUnique: false, tagSlugs: [],
    }, ADMIN);
    expect(blank).toEqual({ ok: false, message: 'A drug needs a generic name.' });

    const punctuation = await createDrug({
      genericName: '???', drugClass: '', schedule: '', scheduleNote: '',
      brands: '', indications: '', dosing: '', dosingUnique: false, tagSlugs: [],
    }, ADMIN);
    expect(punctuation.ok).toBe(false);
  });
});

describe('updateDrugIdentity', () => {
  it('renames the drug but never its address', async () => {
    await seedDrug();

    expect(await updateDrugIdentity('alprazolam', {
      genericName: 'Alprazolam ER', drugClass: '', schedule: 'CII', scheduleNote: 'CIV elsewhere',
    }, ADMIN)).toEqual({ ok: true });

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'alprazolam'));
    expect(drug.genericName).toBe('Alprazolam ER');
    // The slug is in saved session links and in every card's history.
    expect(drug.slug).toBe('alprazolam');
    expect(drug.drugClass).toBeNull();
    expect(drug.schedule).toBe('CII');
    expect(drug.scheduleNote).toBe('CIV elsewhere');
  });

  it('drops an unrecognised schedule rather than storing it', async () => {
    await seedDrug();
    await updateDrugIdentity('alprazolam', {
      genericName: 'Alprazolam', drugClass: '', schedule: 'CVII', scheduleNote: '',
    }, ADMIN);

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'alprazolam'));
    expect(drug.schedule).toBeNull();
  });
});

describe('setDrugBrands and setDrugIndications', () => {
  it('keeps what a kept row carries, and removes only what left the list', async () => {
    const drugId = await seedDrug();
    const [indication] = await db
      .insert(drugIndications).values({ drugId, text: 'Anxiety', sortOrder: 0 })
      .returning({ id: drugIndications.id });
    const [brand] = await db
      .insert(drugBrands)
      .values({ drugId, name: 'Xanax', family: 'Xanax', sortOrder: 0, dosingOverride: '0.5 mg ODT' })
      .returning({ id: drugBrands.id });
    await db.insert(brandIndications).values({ brandId: brand.id, indicationId: indication.id });

    // Xanax stays, in second place, with Niravam added before it.
    expect(await setDrugBrands('alprazolam', 'Niravam\nXanax\n\n', ADMIN)).toEqual({ ok: true });

    const brands = await db
      .select().from(drugBrands).where(eq(drugBrands.drugId, drugId)).orderBy(asc(drugBrands.sortOrder));
    expect(brands.map((row) => row.name)).toEqual(['Niravam', 'Xanax']);

    const kept = brands.find((row) => row.name === 'Xanax')!;
    // The same row, so its own dosing and its indication pairing survived a
    // reorder -- which a delete-and-reinsert would have thrown away.
    expect(kept.id).toBe(brand.id);
    expect(kept.dosingOverride).toBe('0.5 mg ODT');
    expect(await db.select().from(brandIndications).where(eq(brandIndications.brandId, brand.id)))
      .toHaveLength(1);
  });

  it('deletes a brand that was taken off the list, pairings with it', async () => {
    const drugId = await seedDrug();
    const [brand] = await db
      .insert(drugBrands).values({ drugId, name: 'Xanax', family: 'Xanax' })
      .returning({ id: drugBrands.id });

    await setDrugBrands('alprazolam', '', ADMIN);

    expect(await db.select().from(drugBrands).where(eq(drugBrands.drugId, drugId))).toEqual([]);
    expect(await db.select().from(brandIndications).where(eq(brandIndications.brandId, brand.id)))
      .toEqual([]);
  });

  it('drops duplicate lines rather than storing a name twice', async () => {
    const drugId = await seedDrug();
    await setDrugIndications('alprazolam', 'Anxiety\nanxiety\nPanic disorder', ADMIN);

    const rows = await db
      .select().from(drugIndications).where(eq(drugIndications.drugId, drugId))
      .orderBy(asc(drugIndications.sortOrder));
    expect(rows.map((row) => row.text)).toEqual(['Anxiety', 'Panic disorder']);
  });

  it('stores the canonical wording of an indication, whatever was typed', async () => {
    const drugId = await seedDrug();
    const typed = ['Seizure', 'Bacterial infection', 'BPH'].join(String.fromCharCode(10));
    await setDrugIndications('alprazolam', typed, ADMIN);

    const rows = await db
      .select().from(drugIndications).where(eq(drugIndications.drugId, drugId))
      .orderBy(asc(drugIndications.sortOrder));

    // Same table the importer uses, so however the words arrive the database
    // holds one spelling of each.
    expect(rows.map((row) => row.text)).toEqual([
      'Seizures', 'Bacterial infections', 'Benign prostatic hypertrophy (BPH)',
    ]);
  });

  it('refuses a drug that is gone', async () => {
    expect(await setDrugBrands('nothing-here', 'Xanax', ADMIN))
      .toEqual({ ok: false, message: 'That drug no longer exists.' });
  });
});

describe('setDrugTags', () => {
  it('replaces the assignable tags and leaves the categories alone', async () => {
    const drugId = await seedDrug();
    const rows = await db.select({ id: tags.id, slug: tags.slug }).from(tags);
    const idOf = (slug: string) => rows.find((row) => row.slug === slug)!.id;

    await db.insert(drugTags).values([
      { drugId, tagId: idOf('statins') },
      { drugId, tagId: idOf('top-drugs-2026') },
    ]);

    expect(await setDrugTags('alprazolam', ['pharm-1'], ADMIN)).toEqual({ ok: true });

    const after = await db
      .select({ slug: tags.slug })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId))
      .where(eq(drugTags.drugId, drugId));

    // The course tag replaced the list tag; the category survived untouched,
    // because scripts/seed-categories.ts owns system links and rebuilds them.
    expect(after.map((row) => row.slug).sort()).toEqual(['pharm-1', 'statins']);
  });

  it('refuses a category, saying so, rather than silently dropping it', async () => {
    await seedDrug();
    expect(await setDrugTags('alprazolam', ['statins'], ADMIN)).toEqual({
      ok: false,
      message: 'Not a tag you can assign here: statins.',
    });
  });
});

describe('setDrugField', () => {
  it('records the editor as the author, which is what the importer checks', async () => {
    const drugId = await seedDrug();

    await setDrugField('alprazolam', await def('moa'), {
      key: 'moa', value: 'GABA-A positive allosteric modulator', source: 'Micromedex', status: 'ok',
    }, ADMIN);

    const [drug] = await db.select().from(drugs).where(eq(drugs.id, drugId));
    expect(drug.fields.moa.value).toBe('GABA-A positive allosteric modulator');
    expect(drug.fields.moa.status).toBe('ok');
    // updatedBy is what stops a later sheet import overwriting this.
    expect(drug.fields.moa.updatedBy).toBe(ADMIN);
  });

  it('keeps an existing flag when the submission does not speak to it', async () => {
    const drugId = await seedDrug();
    await db.update(drugs).set({
      fields: {
        moa: {
          value: 'Probably wrong', status: 'flagged', source: 'class sheet',
          updatedAt: '2026-10-30', updatedBy: null,
        },
      },
    }).where(eq(drugs.id, drugId));

    await setDrugField('alprazolam', await def('moa'), {
      key: 'moa', value: 'Still being looked into', source: '', status: '',
    }, ADMIN);

    const [drug] = await db.select().from(drugs).where(eq(drugs.id, drugId));
    // Clearing the flag is a decision, so it takes saying so.
    expect(drug.fields.moa.status).toBe('flagged');
  });

  it('flags a value when the submission asks for it', async () => {
    const drugId = await seedDrug();
    await setDrugField('alprazolam', await def('moa'), {
      key: 'moa', value: 'GABA-A PAM', source: 'lecture', status: 'flagged',
    }, ADMIN);

    const [drug] = await db.select().from(drugs).where(eq(drugs.id, drugId));
    expect(drug.fields.moa.status).toBe('flagged');
    expect(drug.fields.moa.source).toBe('lecture');
  });

  it('records a blank as "none" where blank means none, and as a gap otherwise', async () => {
    const drugId = await seedDrug();

    await setDrugField('alprazolam', await def('bbw'), { key: 'bbw', value: '  ', source: '', status: '' }, ADMIN);
    await setDrugField('alprazolam', await def('moa'), { key: 'moa', value: '', source: '', status: '' }, ADMIN);

    const [drug] = await db.select().from(drugs).where(eq(drugs.id, drugId));
    // No black box warning is an answer; an unfilled mechanism is not.
    expect(drug.fields.bbw.status).toBe('none');
    expect(drug.fields.moa.status).toBe('ok');
    expect(drug.fields.moa.value).toBeNull();
  });

  it('refuses a core field, which lives in its own column', async () => {
    await seedDrug();
    const result = await setDrugField('alprazolam', await def('brand'), {
      key: 'brand', value: 'Xanax', source: '', status: '',
    }, ADMIN);

    expect(result).toEqual({ ok: false, message: 'Brand names is stored in its own column, not here.' });
  });

  it('re-reads the structured dosing when the prose is edited', async () => {
    const drugId = await seedDrug();
    await rebuildRegimens(drugId, 'Alprazolam', '0.25 mg by mouth three times a day', ADMIN);

    await setDrugField('alprazolam', await def('dosing'), {
      key: 'dosing', value: '0.5 mg by mouth twice a day', source: 'lecture', status: '',
    }, ADMIN);

    const regimens = await db.select().from(dosingRegimens).where(eq(dosingRegimens.drugId, drugId));
    expect(regimens).toHaveLength(1);
    expect(regimens[0].sourceText).toBe('0.5 mg by mouth twice a day');
    expect(regimens[0].frequency).toEqual({ kind: 'per_day', times: 2, timesHigh: null });
  });
});

describe('setDosingUnique', () => {
  it('settles a refused dosing instead of leaving it as review work', async () => {
    const drugId = await seedDrug();
    const prose = '300 mg/kg total dose administered as a 21-hour IV infusion regimen consisting of 3 doses';
    await setDrugField('alprazolam', await def('dosing'), {
      key: 'dosing', value: prose, source: 'class sheet', status: '',
    }, ADMIN);

    // The parser cannot read it, so it lands as review work.
    const [before] = await db.select().from(dosingRegimens).where(eq(dosingRegimens.drugId, drugId));
    expect(before.needsReview).toBe(true);
    expect(before.amounts).toEqual([]);

    expect(await setDosingUnique('alprazolam', true, ADMIN)).toEqual({ ok: true });

    const [after] = await db.select().from(dosingRegimens).where(eq(dosingRegimens.drugId, drugId));
    // Same prose, still askable -- but nobody is waiting on it any more.
    expect(after.sourceText).toBe(prose);
    expect(after.needsReview).toBe(false);
    expect(after.reviewNotes.join(' ')).toContain('Marked a unique sig');
    expect((await db.select().from(drugs).where(eq(drugs.id, drugId)))[0].dosingUnique).toBe(true);
  });

  it('puts the dosing back under review when the mark is taken off', async () => {
    const drugId = await seedDrug();
    await setDrugField('alprazolam', await def('dosing'), {
      key: 'dosing', value: 'Dose per protocol', source: '', status: '',
    }, ADMIN);
    await setDosingUnique('alprazolam', true, ADMIN);

    await setDosingUnique('alprazolam', false, ADMIN);

    const [row] = await db.select().from(dosingRegimens).where(eq(dosingRegimens.drugId, drugId));
    expect(row.needsReview).toBe(true);
    expect(row.reviewNotes.join(' ')).not.toContain('Marked a unique sig');
  });

  it('keeps the mark through a later edit of the prose', async () => {
    const drugId = await seedDrug();
    await setDosingUnique('alprazolam', true, ADMIN);

    await setDrugField('alprazolam', await def('dosing'), {
      key: 'dosing', value: 'Load 150 mg/kg, then 50 mg/kg over 4 hours', source: '', status: '',
    }, ADMIN);

    const rows = await db.select().from(dosingRegimens).where(eq(dosingRegimens.drugId, drugId));
    // Editing the wording of a sig you already called complicated does not
    // make it simple, so it must not quietly become review work again.
    expect(rows.every((row) => !row.needsReview)).toBe(true);
  });

  it('does nothing and reports fine when the mark is already where it should be', async () => {
    await seedDrug();
    expect(await setDosingUnique('alprazolam', false, ADMIN)).toEqual({ ok: true });
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});

describe('rebuildRegimens', () => {
  it('replaces the rows it finds, because the prose is the source', async () => {
    const drugId = await seedDrug();
    await db.insert(dosingRegimens).values({
      drugId,
      sourceText: '0.25 mg by mouth three times a day',
      frequency: { kind: 'per_day', times: 3, timesHigh: null },
    });

    const result = await rebuildRegimens(drugId, 'Alprazolam', '0.5 mg by mouth twice a day', ADMIN);

    expect(result).toEqual({ status: 'replaced', rows: 1 });
    const rows = await db.select().from(dosingRegimens).where(eq(dosingRegimens.drugId, drugId));
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceText).toBe('0.5 mg by mouth twice a day');
  });

  it('still stores a row for prose it cannot read, so the dosing is not lost', async () => {
    const drugId = await seedDrug();
    const result = await rebuildRegimens(drugId, 'Alprazolam', 'Dose per protocol', ADMIN);

    expect(result.rows).toBe(1);
    const [row] = await db.select().from(dosingRegimens).where(eq(dosingRegimens.drugId, drugId));
    expect(row.sourceText).toBe('Dose per protocol');
    expect(row.amounts).toEqual([]);
    expect(row.needsReview).toBe(true);
  });

  it('leaves no rows behind when the prose is cleared', async () => {
    const drugId = await seedDrug();
    await rebuildRegimens(drugId, 'Alprazolam', '0.25 mg by mouth three times a day', ADMIN);

    expect(await rebuildRegimens(drugId, 'Alprazolam', null, ADMIN))
      .toEqual({ status: 'cleared', rows: 0 });
    expect(await db.select().from(dosingRegimens).where(eq(dosingRegimens.drugId, drugId))).toEqual([]);
  });
});

describe('audit trail', () => {
  it('records who changed what', async () => {
    await seedDrug();
    await updateDrugIdentity('alprazolam', {
      genericName: 'Alprazolam', drugClass: 'Benzodiazepine', schedule: 'CIV', scheduleNote: '',
    }, ADMIN);
    await setDrugBrands('alprazolam', 'Xanax', ADMIN);

    const rows = await db.select().from(auditLog);
    expect(rows.map((row) => row.action).sort()).toEqual(['drug.brands', 'drug.identity']);
    expect(rows.every((row) => row.actorId === ADMIN && row.targetType === 'drug')).toBe(true);
  });
});

describe('brandFamily', () => {
  it('collapses release forms and nothing else', () => {
    expect(brandFamily('Wellbutrin SR')).toBe('Wellbutrin');
    expect(brandFamily('Wellbutrin XL')).toBe('Wellbutrin');
    // A different brand of the same drug, which must stay its own family.
    expect(brandFamily('Zyban')).toBe('Zyban');
  });
});
