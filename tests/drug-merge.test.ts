import { and, asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  accounts, auditLog, brandIndications, dosingRegimens, drugBrands, drugIndications, drugTags,
  drugs, fieldDefs, indications, quizAnswers, quizAttempts, sessions, studyCards, tags, users,
} from '@/db/schema';
import { deleteDrug, mergeDrugs, previewDelete, previewMerge } from '@/lib/drugs/merge';
import { syncDrugs, type SeedDrug } from '@/lib/content/sync';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';

const ADMIN = 'user-admin';
const STUDENT = 'user-student';

/** The pair this feature exists for: the same drug entered twice. */
const SEED: SeedDrug[] = [
  {
    slug: 'simvastatin',
    generic: 'Simvastatin',
    drug_class: 'HMG-CoA Reductase Inhibitor',
    dosing: '20 mg by mouth at bedtime',
    moa: 'HMG-CoA reductase inhibition',
    bbw: '',
    bbw_status: 'none',
    brands: [{ id: 's--b0', name: 'Zocor', family: 'Zocor' }],
    indications: [{ id: 's--i0', text: 'Hyperlipidemia' }],
  },
  {
    // No class, no mechanism, a brand the other does not have, and an
    // indication it shares: every merge rule has something to act on.
    slug: 'simvastatin-dup',
    generic: 'Simvastatin (duplicate)',
    dosing: '',
    moa: '',
    bbw: '',
    bbw_status: 'none',
    brands: [
      { id: 'd--b0', name: 'ZOCOR', family: 'Zocor' },
      { id: 'd--b1', name: 'FloLipid', family: 'FloLipid' },
    ],
    indications: [
      { id: 'd--i0', text: 'Hyperlipidemia' },
      { id: 'd--i1', text: 'Cardiovascular risk reduction' },
    ],
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
];

async function idOf(slug: string) {
  const [row] = await db.select({ id: drugs.id }).from(drugs).where(eq(drugs.slug, slug));
  return row?.id ?? null;
}

/** One dosing row: syncDrugs does not build them, the backfill script does. */
async function regimen(slug: string, sourceText: string) {
  await db.insert(dosingRegimens).values({
    drugId: (await idOf(slug))!,
    sourceText,
    frequency: { kind: 'once' },
    needsReview: true,
  });
}

/** A schedule and an answered question, so history has something to move. */
async function studyHistory(slug: string, cardKey: string, answers: number) {
  const drugId = (await idOf(slug))!;
  await db.insert(studyCards).values({
    userId: STUDENT, drugId, cardKey, mode: 'inclusive', direction: 'drug_to_fields',
    fieldKeys: ['moa'], reviewCount: 3,
  });

  const [attempt] = await db
    .insert(quizAttempts)
    .values({ userId: STUDENT, config: {}, total: answers })
    .returning({ id: quizAttempts.id });

  for (let i = 0; i < answers; i += 1) {
    await db.insert(quizAnswers).values({
      attemptId: attempt.id, drugId, questionKey: `q${i}`, fieldKey: 'moa',
      prompt: {}, choices: [], correctIndex: 0, wasCorrect: false, answeredAt: new Date(),
    });
  }
  return drugId;
}

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(quizAnswers);
  await db.delete(quizAttempts);
  await db.delete(studyCards);
  await db.delete(brandIndications);
  await db.delete(dosingRegimens);
  await db.delete(drugTags);
  await db.delete(drugBrands);
  await db.delete(drugIndications);
  await db.delete(indications);
  await db.delete(drugs);
  await db.delete(tags);
  await db.delete(fieldDefs);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);

  await db.insert(users).values([
    { id: ADMIN, email: 'admin@example.test', role: 'admin' },
    { id: STUDENT, email: 'student@example.test' },
  ]);
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);
  await db.insert(tags).values([
    { slug: 'statins', label: 'Statins', kind: 'system' },
    { slug: 'pharm-1', label: 'Pharmacology I', kind: 'course' },
  ]);
  await syncDrugs(SEED);
});

describe('previewDelete', () => {
  it('counts everything that would go with it', async () => {
    await studyHistory('alprazolam', 'inclusive|drug_to_fields|moa', 2);
    const preview = await previewDelete('alprazolam');

    expect(preview).toMatchObject({
      slug: 'alprazolam', generic: 'Alprazolam',
      brands: 1, indications: 1, cards: 1, answers: 2,
    });
  });

  it('has nothing to say about a drug that is not there', async () => {
    expect(await previewDelete('aspirin')).toBeNull();
  });
});

describe('deleteDrug', () => {
  it('takes the drug and everything hanging off it', async () => {
    const drugId = await studyHistory('alprazolam', 'inclusive|drug_to_fields|moa', 2);

    const result = await deleteDrug('alprazolam', ADMIN);
    expect(result.ok).toBe(true);
    expect(result.ok && result.value!.answers).toBe(2);

    expect(await idOf('alprazolam')).toBeNull();
    const hangingOff = [
      ['brands', drugBrands], ['indications', drugIndications], ['tags', drugTags],
      ['schedules', studyCards], ['answers', quizAnswers],
    ] as const;
    for (const [label, table] of hangingOff) {
      const rows = await db.select().from(table).where(eq(table.drugId, drugId));
      expect(rows, label).toHaveLength(0);
    }
  });

  it('leaves every other drug alone', async () => {
    await deleteDrug('alprazolam', ADMIN);
    expect(await idOf('simvastatin')).not.toBeNull();
    const brands = await db.select().from(drugBrands);
    expect(brands.map((row) => row.name).sort()).toEqual(['FloLipid', 'ZOCOR', 'Zocor']);
  });

  it('writes down what it destroyed, since nothing else will remember', async () => {
    await deleteDrug('alprazolam', ADMIN);
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'drug.delete'));

    expect(entry.actorId).toBe(ADMIN);
    expect(entry.diff).toMatchObject({ generic: 'Alprazolam', schedule: 'CIV', brands: 1 });
  });

  it('refuses a drug that is not there', async () => {
    expect(await deleteDrug('aspirin', ADMIN)).toMatchObject({ ok: false });
  });
});

describe('previewMerge', () => {
  it('says which brands move and which are already held', async () => {
    const preview = await previewMerge('simvastatin-dup', 'simvastatin');
    expect(preview.ok).toBe(true);

    // "ZOCOR" is the same brand as "Zocor", so it is dropped rather than
    // duplicated; FloLipid is new and moves.
    expect(preview.ok && preview.value!.brands).toEqual({
      moved: ['FloLipid'], dropped: ['ZOCOR'],
    });
  });

  it('says the same about indications, by name', async () => {
    const preview = await previewMerge('simvastatin-dup', 'simvastatin');
    expect(preview.ok && preview.value!.indications).toEqual({
      moved: ['Cardiovascular risk reduction'], dropped: ['Hyperlipidemia'],
    });
  });

  it('names the gaps the loser would fill', async () => {
    const preview = await previewMerge('simvastatin', 'simvastatin-dup');
    // The duplicate has no class and no mechanism; the original has both.
    expect(preview.ok && preview.value!.columnsFilled).toContain('drug_class');
    expect(preview.ok && preview.value!.fieldsFilled).toContain('moa');
  });

  it('fills nothing when the survivor already has an answer', async () => {
    const preview = await previewMerge('simvastatin-dup', 'simvastatin');
    expect(preview.ok && preview.value!.fieldsFilled).toEqual([]);
    expect(preview.ok && preview.value!.columnsFilled).toEqual([]);
  });

  it('refuses a drug merged into itself', async () => {
    expect(await previewMerge('simvastatin', 'simvastatin')).toMatchObject({ ok: false });
  });

  it('refuses a drug that is not there', async () => {
    expect(await previewMerge('aspirin', 'simvastatin')).toMatchObject({ ok: false });
    expect(await previewMerge('simvastatin', 'aspirin')).toMatchObject({ ok: false });
  });
});

describe('mergeDrugs', () => {
  it('leaves one drug holding both sets of brands, without duplicates', async () => {
    await mergeDrugs('simvastatin-dup', 'simvastatin', ADMIN);

    const survivor = (await idOf('simvastatin'))!;
    const brands = await db
      .select({ name: drugBrands.name })
      .from(drugBrands)
      .where(eq(drugBrands.drugId, survivor))
      .orderBy(asc(drugBrands.sortOrder));

    expect(brands.map((row) => row.name)).toEqual(['Zocor', 'FloLipid']);
    expect(await idOf('simvastatin-dup')).toBeNull();
  });

  it('keeps one link per indication and adds the ones only the loser had', async () => {
    await mergeDrugs('simvastatin-dup', 'simvastatin', ADMIN);

    const survivor = (await idOf('simvastatin'))!;
    const rows = await db
      .select({ label: indications.label })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .where(eq(drugIndications.drugId, survivor))
      .orderBy(asc(drugIndications.sortOrder));

    expect(rows.map((row) => row.label)).toEqual([
      'Hyperlipidemia', 'Cardiovascular risk reduction',
    ]);
  });

  // brand_indications points at a drug_indications row, not at the vocabulary.
  // A brand that moves has to find its pairing already pointing at the
  // survivor's row, or the pairing is dangling or gone.
  it('carries a brand pairing across to the survivor row', async () => {
    const loser = (await idOf('simvastatin-dup'))!;
    const [brand] = await db
      .select({ id: drugBrands.id })
      .from(drugBrands)
      .where(and(eq(drugBrands.drugId, loser), eq(drugBrands.name, 'FloLipid')));
    const [link] = await db
      .select({ id: drugIndications.id })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .where(and(eq(drugIndications.drugId, loser), eq(indications.label, 'Hyperlipidemia')));

    // FloLipid is for the shared indication, whose link row is the one that
    // gets dropped as a duplicate.
    await db.insert(brandIndications).values({ brandId: brand.id, indicationId: link.id });

    await mergeDrugs('simvastatin-dup', 'simvastatin', ADMIN);

    const survivor = (await idOf('simvastatin'))!;
    const pairings = await db
      .select({ brand: drugBrands.name, label: indications.label })
      .from(brandIndications)
      .innerJoin(drugBrands, eq(drugBrands.id, brandIndications.brandId))
      .innerJoin(drugIndications, eq(drugIndications.id, brandIndications.indicationId))
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId));

    expect(pairings).toEqual([{ brand: 'FloLipid', label: 'Hyperlipidemia' }]);
    const [owner] = await db
      .select({ drugId: drugIndications.drugId })
      .from(drugIndications)
      .innerJoin(brandIndications, eq(brandIndications.indicationId, drugIndications.id));
    expect(owner.drugId).toBe(survivor);
  });

  it('fills the survivor gaps and leaves its own answers alone', async () => {
    // Merging the full record into the empty duplicate: the duplicate keeps
    // its own name, and gains what it had nothing for.
    await mergeDrugs('simvastatin', 'simvastatin-dup', ADMIN);

    const [survivor] = await db.select().from(drugs).where(eq(drugs.slug, 'simvastatin-dup'));
    expect(survivor.genericName).toBe('Simvastatin (duplicate)');
    expect(survivor.drugClass).toBe('HMG-CoA Reductase Inhibitor');
    expect(survivor.fields.moa?.value).toBe('HMG-CoA reductase inhibition');
  });

  it('does not overwrite a value the survivor already had', async () => {
    await mergeDrugs('simvastatin-dup', 'simvastatin', ADMIN);
    const [survivor] = await db.select().from(drugs).where(eq(drugs.slug, 'simvastatin'));

    expect(survivor.fields.moa?.value).toBe('HMG-CoA reductase inhibition');
    expect(survivor.fields.dosing?.value).toBe('20 mg by mouth at bedtime');
  });

  it('moves tags the survivor is missing and skips the ones it has', async () => {
    const loser = (await idOf('simvastatin-dup'))!;
    const survivor = (await idOf('simvastatin'))!;
    const [statins] = await db.select().from(tags).where(eq(tags.slug, 'statins'));
    const [pharm] = await db.select().from(tags).where(eq(tags.slug, 'pharm-1'));

    await db.insert(drugTags).values([
      { drugId: survivor, tagId: statins.id },
      { drugId: loser, tagId: statins.id },
      { drugId: loser, tagId: pharm.id },
    ]);

    await mergeDrugs('simvastatin-dup', 'simvastatin', ADMIN);

    const held = await db.select({ tagId: drugTags.tagId }).from(drugTags).where(eq(drugTags.drugId, survivor));
    const ids = held.map((row) => row.tagId);

    // The course tag moved; the one both already had is there once, not twice.
    expect(ids).toContain(pharm.id);
    expect(ids.filter((id) => id === statins.id)).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('moves dosing into a drug that has none', async () => {
    await regimen('simvastatin', '20 mg by mouth at bedtime');

    await mergeDrugs('simvastatin', 'simvastatin-dup', ADMIN);

    const survivor = (await idOf('simvastatin-dup'))!;
    const after = await db.select().from(dosingRegimens).where(eq(dosingRegimens.drugId, survivor));
    expect(after.map((row) => row.sourceText)).toEqual(['20 mg by mouth at bedtime']);
  });

  it('keeps the survivor dosing when both have some', async () => {
    // Half of one drug's regimens beside half of another's would read as one
    // contradictory schedule, so the survivor's own stands and the loser's go.
    await regimen('simvastatin', '20 mg by mouth at bedtime');
    await regimen('simvastatin-dup', 'something else entirely');

    await mergeDrugs('simvastatin-dup', 'simvastatin', ADMIN);

    const survivor = (await idOf('simvastatin'))!;
    const after = await db.select().from(dosingRegimens).where(eq(dosingRegimens.drugId, survivor));
    expect(after.map((row) => row.sourceText)).toEqual(['20 mg by mouth at bedtime']);
  });

  it('moves every quiz answer, because it was the same drug being asked about', async () => {
    await studyHistory('simvastatin-dup', 'inclusive|drug_to_fields|moa', 3);
    await mergeDrugs('simvastatin-dup', 'simvastatin', ADMIN);

    const survivor = (await idOf('simvastatin'))!;
    const moved = await db.select().from(quizAnswers).where(eq(quizAnswers.drugId, survivor));
    expect(moved).toHaveLength(3);
  });

  it('keeps the schedule already being answered against when both have one', async () => {
    const key = 'inclusive|drug_to_fields|moa';
    await studyHistory('simvastatin', key, 0);
    await studyHistory('simvastatin-dup', key, 0);

    // Same person, same card key, two drugs: only one row can survive, and it
    // is the one belonging to the drug that stays.
    const survivor = (await idOf('simvastatin'))!;
    const [before] = await db
      .select({ id: studyCards.id })
      .from(studyCards)
      .where(and(eq(studyCards.drugId, survivor), eq(studyCards.cardKey, key)));

    await mergeDrugs('simvastatin-dup', 'simvastatin', ADMIN);

    const after = await db.select().from(studyCards).where(eq(studyCards.drugId, survivor));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
  });

  it('moves a schedule the survivor does not have', async () => {
    await studyHistory('simvastatin-dup', 'exclusive|fields_to_drug|bbw', 0);
    await mergeDrugs('simvastatin-dup', 'simvastatin', ADMIN);

    const survivor = (await idOf('simvastatin'))!;
    const after = await db.select().from(studyCards).where(eq(studyCards.drugId, survivor));
    expect(after.map((row) => row.cardKey)).toEqual(['exclusive|fields_to_drug|bbw']);
  });

  it('records what it did against the drug that survived', async () => {
    await mergeDrugs('simvastatin-dup', 'simvastatin', ADMIN);

    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, 'drug.merge'));
    expect(entry.actorId).toBe(ADMIN);
    expect(entry.targetId).toBe(await idOf('simvastatin'));
    expect(entry.diff).toMatchObject({
      from: { slug: 'simvastatin-dup' },
      into: { slug: 'simvastatin' },
    });
  });

  it('refuses the degenerate and the missing', async () => {
    expect(await mergeDrugs('simvastatin', 'simvastatin', ADMIN)).toMatchObject({ ok: false });
    expect(await mergeDrugs('aspirin', 'simvastatin', ADMIN)).toMatchObject({ ok: false });

    // Nothing was touched by either refusal.
    expect(await idOf('simvastatin')).not.toBeNull();
  });

  it('leaves an unrelated drug exactly as it was', async () => {
    const [before] = await db.select().from(drugs).where(eq(drugs.slug, 'alprazolam'));
    await mergeDrugs('simvastatin-dup', 'simvastatin', ADMIN);
    const [after] = await db.select().from(drugs).where(eq(drugs.slug, 'alprazolam'));

    expect(after).toEqual(before);
  });
});
