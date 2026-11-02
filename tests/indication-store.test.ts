import { asc, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  accounts, auditLog, brandIndications, drugBrands, drugIndications, drugs, indications,
  sessions, users,
} from '@/db/schema';
import {
  deleteIndication, listIndications, mergeIndications, renameIndication,
  resolveIndications, setDrugIndicationLinks, unusedIndications,
} from '@/lib/drugs/indication-store';

const ADMIN = 'user-admin';

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(brandIndications);
  await db.delete(drugBrands);
  await db.delete(drugIndications);
  await db.delete(indications);
  await db.delete(drugs);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);
  await db.insert(users).values({ id: ADMIN, email: 'admin@example.test', role: 'admin' });
});

async function seedDrug(slug: string) {
  const [drug] = await db
    .insert(drugs)
    .values({ slug, genericName: slug[0].toUpperCase() + slug.slice(1) })
    .returning({ id: drugs.id });
  return drug.id;
}

async function labelsOf(drugId: string) {
  const rows = await db
    .select({ label: indications.label })
    .from(drugIndications)
    .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
    .where(eq(drugIndications.drugId, drugId))
    .orderBy(asc(drugIndications.sortOrder));
  return rows.map((row) => row.label);
}

describe('resolveIndications', () => {
  it('creates what is new and reuses what is not', async () => {
    const first = await resolveIndications(['Hypertension', 'Angina']);
    expect(first.created.map((row) => row.label).sort()).toEqual(['Angina', 'Hypertension']);

    const second = await resolveIndications(['Angina', 'Heart failure']);
    expect(second.created.map((row) => row.label)).toEqual(['Heart failure']);
    expect(await db.select().from(indications)).toHaveLength(3);
  });

  it('matches on the slug, so case and canonical wording find the same row', async () => {
    await resolveIndications(['Seizures']);
    // "Panic Disorder" vs "Panic disorder" is the near-duplicate free text
    // accumulated without anyone deciding to; "Seizure" is the sheet's own
    // second spelling, folded by the alias table.
    const again = await resolveIndications(['seizures', 'Seizure', 'SEIZURES']);

    expect(again.created).toEqual([]);
    expect(again.rows).toHaveLength(1);
    expect(again.rows[0].label).toBe('Seizures');
  });

  it('keeps the order it was given, and drops blank wording', async () => {
    const { rows } = await resolveIndications(['  ', 'Pain', '', 'Anxiety']);
    expect(rows.map((row) => row.label)).toEqual(['Pain', 'Anxiety']);
  });
});

describe('setDrugIndicationLinks', () => {
  it('keeps a kept row, and its brand pairing, through a reorder', async () => {
    const drugId = await seedDrug('alprazolam');
    await setDrugIndicationLinks(drugId, ['Anxiety', 'Panic disorder']);

    const [anxiety] = await db
      .select().from(drugIndications)
      .where(eq(drugIndications.drugId, drugId)).orderBy(asc(drugIndications.sortOrder));
    const [brand] = await db
      .insert(drugBrands).values({ drugId, name: 'Xanax', family: 'Xanax' })
      .returning({ id: drugBrands.id });
    await db.insert(brandIndications).values({ brandId: brand.id, indicationId: anxiety.id });

    await setDrugIndicationLinks(drugId, ['Panic disorder', 'Anxiety']);

    expect(await labelsOf(drugId)).toEqual(['Panic disorder', 'Anxiety']);
    // The pairing hangs off the link row's id, so a delete-and-reinsert would
    // have silently unpaired Xanax from the indication it still treats.
    expect(await db.select().from(brandIndications).where(eq(brandIndications.brandId, brand.id)))
      .toHaveLength(1);
  });

  it('removes only what left the list', async () => {
    const drugId = await seedDrug('alprazolam');
    await setDrugIndicationLinks(drugId, ['Anxiety', 'Panic disorder']);
    await setDrugIndicationLinks(drugId, ['Anxiety']);

    expect(await labelsOf(drugId)).toEqual(['Anxiety']);
    // The word stays in the vocabulary; another drug may be for it.
    expect(await db.select().from(indications)).toHaveLength(2);
  });

  it('stores one link when the same indication is written twice', async () => {
    const drugId = await seedDrug('alprazolam');
    await setDrugIndicationLinks(drugId, ['Anxiety', 'anxiety']);
    expect(await labelsOf(drugId)).toEqual(['Anxiety']);
  });
});

describe('renameIndication', () => {
  it('changes the wording on every drug at once, keeping the address', async () => {
    const one = await seedDrug('alprazolam');
    const two = await seedDrug('lorazepam');
    await setDrugIndicationLinks(one, ['Anxeity']);
    await setDrugIndicationLinks(two, ['Anxeity']);

    expect(await renameIndication('anxeity', 'Anxiety', ADMIN)).toEqual({ ok: true });

    expect(await labelsOf(one)).toEqual(['Anxiety']);
    expect(await labelsOf(two)).toEqual(['Anxiety']);
    // The slug is in saved study links, so it does not move with the label.
    const [row] = await db.select().from(indications);
    expect(row.slug).toBe('anxeity');
  });

  it('canonicalises what is typed, and refuses a blank', async () => {
    const drugId = await seedDrug('alprazolam');
    await setDrugIndicationLinks(drugId, ['Fits']);

    await renameIndication('fits', '  Seizure  ', ADMIN);
    expect(await labelsOf(drugId)).toEqual(['Seizures']);

    expect(await renameIndication('fits', '   ', ADMIN))
      .toEqual({ ok: false, message: 'Give the indication a name.' });
  });

  it('refuses an indication that is gone', async () => {
    expect(await renameIndication('nothing-here', 'Anxiety', ADMIN))
      .toEqual({ ok: false, message: 'That indication no longer exists.' });
  });
});

describe('mergeIndications', () => {
  it('moves every drug to the winner and removes the loser', async () => {
    const one = await seedDrug('alprazolam');
    const two = await seedDrug('lorazepam');
    await setDrugIndicationLinks(one, ['Anxeity']);
    await setDrugIndicationLinks(two, ['Anxiety', 'Insomnia']);

    const result = await mergeIndications('anxeity', 'anxiety', ADMIN);
    expect(result).toEqual({ ok: true, value: { moved: 1 } });

    expect(await labelsOf(one)).toEqual(['Anxiety']);
    expect(await labelsOf(two)).toEqual(['Anxiety', 'Insomnia']);
    expect(await db.select().from(indications).where(eq(indications.slug, 'anxeity'))).toEqual([]);
  });

  it('leaves a drug already on both with one row rather than failing', async () => {
    const drugId = await seedDrug('alprazolam');
    await setDrugIndicationLinks(drugId, ['Anxeity', 'Anxiety']);

    const result = await mergeIndications('anxeity', 'anxiety', ADMIN);
    // Nothing to move: the drug was already on the winner, so the loser's row
    // is dropped instead of colliding with the unique index.
    expect(result).toEqual({ ok: true, value: { moved: 0 } });
    expect(await labelsOf(drugId)).toEqual(['Anxiety']);
  });

  it('refuses merging something into itself, or into nothing', async () => {
    const drugId = await seedDrug('alprazolam');
    await setDrugIndicationLinks(drugId, ['Anxiety']);

    expect(await mergeIndications('anxiety', 'anxiety', ADMIN))
      .toEqual({ ok: false, message: 'That is the same indication.' });
    expect(await mergeIndications('anxiety', 'nothing-here', ADMIN))
      .toEqual({ ok: false, message: 'One of those indications no longer exists.' });
  });
});

describe('deleteIndication', () => {
  it('removes one nothing carries', async () => {
    const drugId = await seedDrug('alprazolam');
    await setDrugIndicationLinks(drugId, ['Anxiety']);
    await setDrugIndicationLinks(drugId, []);

    expect(await unusedIndications()).toHaveLength(1);
    expect(await deleteIndication('anxiety', ADMIN)).toEqual({ ok: true });
    expect(await db.select().from(indications)).toEqual([]);
  });

  it('refuses one still in use, and says to merge instead', async () => {
    const drugId = await seedDrug('alprazolam');
    await setDrugIndicationLinks(drugId, ['Anxiety']);

    const result = await deleteIndication('anxiety', ADMIN);
    expect(result.ok).toBe(false);
    expect(await labelsOf(drugId)).toEqual(['Anxiety']);
  });
});

describe('listIndications', () => {
  it('counts the drugs on each, including none', async () => {
    const one = await seedDrug('alprazolam');
    const two = await seedDrug('lorazepam');
    await setDrugIndicationLinks(one, ['Anxiety', 'Insomnia']);
    await setDrugIndicationLinks(two, ['Anxiety']);
    await resolveIndications(['Nothing uses this']);

    expect(await listIndications()).toEqual([
      { id: expect.any(String), slug: 'anxiety', label: 'Anxiety', drugs: 2 },
      { id: expect.any(String), slug: 'insomnia', label: 'Insomnia', drugs: 1 },
      { id: expect.any(String), slug: 'nothing-uses-this', label: 'Nothing uses this', drugs: 0 },
    ]);
  });
});

describe('the audit trail', () => {
  it('records who renamed and merged what', async () => {
    const drugId = await seedDrug('alprazolam');
    await setDrugIndicationLinks(drugId, ['Anxeity', 'Insomnia']);
    await renameIndication('insomnia', 'Trouble sleeping', ADMIN);
    await mergeIndications('anxeity', 'insomnia', ADMIN);

    const rows = await db.select().from(auditLog).orderBy(asc(auditLog.at));
    expect(rows.map((row) => row.action).sort())
      .toEqual(['indication.merge', 'indication.rename']);
    expect(rows.every((row) => row.actorId === ADMIN && row.targetType === 'indication')).toBe(true);
  });
});
