import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  accounts,
  brandIndications,
  dosingRegimens,
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  fieldDefs,
  sessions,
  siteSettings,
  studyCards,
  studyPresets,
  tags,
  userPreferences,
  users,
} from '@/db/schema';
import { BACKUP_VERSION, exportBackup, restoreBackup, type Backup } from '@/lib/data/backup';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';

const USER = 'user-admin';
const EMAIL = 'admin@example.test';

async function wipe() {
  await db.delete(brandIndications);
  await db.delete(dosingRegimens);
  await db.delete(drugTags);
  await db.delete(drugBrands);
  await db.delete(drugIndications);
  await db.delete(studyCards);
  await db.delete(studyPresets);
  await db.delete(drugs);
  await db.delete(tags);
  await db.delete(fieldDefs);
  await db.delete(userPreferences);
  await db.delete(siteSettings);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);
}

/** One drug carrying every kind of child row, so a round trip has to keep them all. */
async function seedContent() {
  await db.insert(users).values({ id: USER, email: EMAIL, role: 'admin' });
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);
  await db.insert(tags).values([
    { slug: 'top-drugs-2026', label: 'Top Drugs 2026', kind: 'top_list' },
    { slug: 'statins', label: 'Statins', kind: 'system' },
  ]);

  const [drug] = await db
    .insert(drugs)
    .values({
      slug: 'tirzepatide',
      genericName: 'Tirzepatide',
      drugClass: 'GLP-1 Receptor Agonist',
      needsPairingReview: true,
      fields: {
        moa: {
          value: 'GIP and GLP-1 receptor agonist', status: 'ok', source: 'lecture',
          updatedAt: '2026-11-02', updatedBy: USER,
        },
        bbw: {
          value: null, status: 'none', source: 'class sheet', updatedAt: '', updatedBy: null,
        },
      },
    })
    .returning({ id: drugs.id });

  const [other] = await db
    .insert(drugs)
    .values({ slug: 'alprazolam', genericName: 'Alprazolam', schedule: 'CIV' })
    .returning({ id: drugs.id });

  const [diabetes] = await db
    .insert(drugIndications)
    .values({ drugId: drug.id, text: 'Diabetes', sortOrder: 0 })
    .returning({ id: drugIndications.id });
  await db.insert(drugIndications).values({ drugId: drug.id, text: 'Weight management', sortOrder: 1 });

  const [mounjaro] = await db
    .insert(drugBrands)
    .values({
      drugId: drug.id, name: 'Mounjaro', family: 'Mounjaro', sortOrder: 0,
      dosingOverride: '2.5 mg weekly', route: 'Subcutaneous',
    })
    .returning({ id: drugBrands.id });
  await db.insert(brandIndications).values({ brandId: mounjaro.id, indicationId: diabetes.id });

  await db.insert(dosingRegimens).values({
    drugId: drug.id,
    sourceText: '2.5 mg subcutaneously once weekly',
    amounts: [{ low: 2.5, high: null, unit: 'mg', perKg: false, per: null, active: null }],
    routes: ['SC'],
    frequency: { kind: 'interval', low: 1, high: null, unit: 'week' },
    needsReview: false,
    reviewNotes: [],
    source: 'class sheet dosing text, parsed',
  });

  const tagRows = await db.select({ id: tags.id, slug: tags.slug }).from(tags);
  await db.insert(drugTags).values(
    tagRows.map((tag) => ({ drugId: drug.id, tagId: tag.id })),
  );

  await db.insert(siteSettings).values({ id: 1, siteName: 'Enkephalin' });
  await db.insert(userPreferences).values({ userId: USER, theme: 'dark', fieldVisibility: { bbw: false } });
  await db.insert(studyPresets).values({ userId: USER, name: 'P2 midterm', config: { maxCards: 40 } });
  await db.insert(studyCards).values({
    userId: USER,
    drugId: drug.id,
    cardKey: 'inclusive:drug_to_fields:moa',
    mode: 'inclusive',
    direction: 'drug_to_fields',
    fieldKeys: ['moa'],
    ease: 2.3,
    intervalDays: 6,
    dueAt: new Date('2026-11-20T00:00:00Z'),
    reviewCount: 4,
    lastResult: true,
  });

  return { drugId: drug.id, otherId: other.id };
}

beforeEach(async () => {
  await wipe();
  await seedContent();
});

describe('exportBackup', () => {
  it('carries the content keyed by slug, with no database ids in it', async () => {
    const backup = await exportBackup();

    expect(backup.version).toBe(BACKUP_VERSION);
    expect(backup.counts).toMatchObject({ drugs: 2, brands: 1, indications: 2, regimens: 1, tags: 2 });

    const json = JSON.stringify(backup);
    // A UUID anywhere would be an id that cannot mean anything in another
    // database, which is the thing a restore has to survive.
    expect(json).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);

    const tirzepatide = backup.drugs.find((drug) => drug.slug === 'tirzepatide')!;
    expect(tirzepatide.indications).toEqual(['Diabetes', 'Weight management']);
    expect(tirzepatide.brands[0]).toMatchObject({ name: 'Mounjaro', indications: ['Diabetes'] });
    expect(tirzepatide.tags.sort()).toEqual(['statins', 'top-drugs-2026']);
  });

  it('carries progress by email and no way to log in as anyone', async () => {
    const backup = await exportBackup();

    expect(backup.progress).toHaveLength(1);
    expect(backup.progress[0].email).toBe(EMAIL);
    expect(backup.progress[0].cards[0]).toMatchObject({ drugSlug: 'tirzepatide', reviewCount: 4 });
    expect(backup.progress[0].presets[0].name).toBe('P2 midterm');
    expect(backup.progress[0].preferences).toMatchObject({ theme: 'dark' });

    // No hashes, no tokens, no invite codes.
    const json = JSON.stringify(backup);
    expect(json).not.toContain('password');
    expect(json).not.toContain('accounts');
    expect(json).not.toContain('sessions');
  });
});

describe('restoreBackup', () => {
  it('puts everything back after the content is wiped', async () => {
    const backup = await exportBackup();

    await db.delete(drugs);
    await db.delete(tags);
    expect(await db.select().from(drugs)).toEqual([]);

    const result = await restoreBackup(backup, 'merge');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.report.drugsInserted).toBe(2);

    const after = await exportBackup();
    // Same content, and the same content when exported again -- which is the
    // only check that proves the two halves agree about the shape.
    expect(after.drugs).toEqual(backup.drugs);
    expect(after.progress).toEqual(backup.progress);
  });

  it('restores a study schedule onto the account with that email', async () => {
    const backup = await exportBackup();
    await db.delete(studyCards);

    await restoreBackup(backup, 'merge');

    const cards = await db.select().from(studyCards).where(eq(studyCards.userId, USER));
    expect(cards).toHaveLength(1);
    expect(cards[0].reviewCount).toBe(4);
    expect(cards[0].ease).toBeCloseTo(2.3, 5);
    expect(cards[0].dueAt.toISOString()).toBe('2026-11-20T00:00:00.000Z');
  });

  it('reports a person with no account rather than inventing one', async () => {
    const backup = await exportBackup();
    backup.progress[0].email = 'someone-else@example.test';

    const result = await restoreBackup(backup, 'merge');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.progressSkipped).toEqual(['someone-else@example.test']);
    expect(result.report.progressRestored).toEqual([]);
    // No account was created for them.
    expect(await db.select().from(users)).toHaveLength(1);
  });

  it('merge leaves a drug the file never mentions alone', async () => {
    const backup = await exportBackup();
    await db.insert(drugs).values({ slug: 'metformin', genericName: 'Metformin' });

    await restoreBackup(backup, 'merge');

    const slugs = (await db.select({ slug: drugs.slug }).from(drugs)).map((row) => row.slug).sort();
    expect(slugs).toEqual(['alprazolam', 'metformin', 'tirzepatide']);
  });

  it('replace deletes what the file does not contain, and says how many', async () => {
    const backup = await exportBackup();
    await db.insert(drugs).values({ slug: 'metformin', genericName: 'Metformin' });

    const result = await restoreBackup(backup, 'replace');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.report.drugsDeleted).toBe(1);
    const slugs = (await db.select({ slug: drugs.slug }).from(drugs)).map((row) => row.slug).sort();
    expect(slugs).toEqual(['alprazolam', 'tirzepatide']);
  });

  it('takes a drug’s children wholesale, so a deleted brand stays deleted', async () => {
    const backup = await exportBackup();

    // Someone adds a brand after the backup was taken, then restores it.
    const [drug] = await db.select({ id: drugs.id }).from(drugs).where(eq(drugs.slug, 'tirzepatide'));
    await db.insert(drugBrands).values({ drugId: drug.id, name: 'Zepbound', family: 'Zepbound', sortOrder: 9 });

    await restoreBackup(backup, 'merge');

    const brands = await db.select({ name: drugBrands.name }).from(drugBrands).where(eq(drugBrands.drugId, drug.id));
    expect(brands.map((row) => row.name)).toEqual(['Mounjaro']);
  });

  it('refuses a file that is not a backup, before touching anything', async () => {
    for (const bad of [null, 42, 'a string', {}, { version: 'one' }] as unknown[]) {
      const result = await restoreBackup(bad, 'replace');
      expect(result.ok).toBe(false);
    }
    // Nothing was deleted by the replace mode of a refused file.
    expect(await db.select().from(drugs)).toHaveLength(2);
  });

  it('refuses a version it does not read', async () => {
    const backup = { ...(await exportBackup()), version: 99 } as Backup;
    const result = await restoreBackup(backup, 'replace');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('version 99');
    expect(await db.select().from(drugs)).toHaveLength(2);
  });

  it('refuses a drug with no slug rather than importing half the file', async () => {
    const backup = await exportBackup();
    // Deliberately malformed, the way a hand-edited file ends up.
    backup.drugs[1].slug = '';

    const result = await restoreBackup(backup, 'replace');
    expect(result.ok).toBe(false);
    expect(await db.select().from(drugs)).toHaveLength(2);
  });
});
