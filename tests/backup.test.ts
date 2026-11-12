import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  accounts,
  brandIndications,
  drugVariantValues,
  dosingRegimens,
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  fieldDefs,
  indications,
  sessions,
  siteSettings,
  studyCards,
  studyPresets,
  tags,
  userPreferences,
  users,
} from '@/db/schema';
import { BACKUP_VERSION, exportBackup, restoreBackup, type Backup } from '@/lib/data/backup';
import { asMegabytes, MAX_BACKUP_BYTES, SERVER_ACTION_BODY_LIMIT } from '@/lib/data/limits';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';

const USER = 'user-admin';
const EMAIL = 'admin@example.test';

async function wipe() {
  await db.delete(drugVariantValues);
  await db.delete(brandIndications);
  await db.delete(dosingRegimens);
  await db.delete(drugTags);
  await db.delete(drugBrands);
  await db.delete(drugIndications);
  await db.delete(indications);
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

  const words = await db
    .insert(indications)
    .values([
      { slug: 'diabetes', label: 'Diabetes' },
      { slug: 'weight-management', label: 'Weight management' },
    ])
    .returning({ id: indications.id, slug: indications.slug });
  const wordId = (slug: string) => words.find((row) => row.slug === slug)!.id;

  const [diabetes] = await db
    .insert(drugIndications)
    .values({ drugId: drug.id, indicationId: wordId('diabetes'), sortOrder: 0 })
    .returning({ id: drugIndications.id });
  await db
    .insert(drugIndications)
    .values({ drugId: drug.id, indicationId: wordId('weight-management'), sortOrder: 1 });

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

describe('what a class says differently', () => {
  /** The class tag, the membership, and one field this class says differently. */
  async function seedVariantLayer() {
    const [course] = await db
      .insert(tags)
      .values({ slug: 'psci-413', label: 'PSCI 413', kind: 'course' })
      .returning({ id: tags.id });
    const [drug] = await db.select({ id: drugs.id }).from(drugs).where(eq(drugs.slug, 'tirzepatide'));

    await db.insert(drugTags).values({ drugId: drug.id, tagId: course.id });
    await db.insert(drugVariantValues).values({
      drugId: drug.id,
      tagId: course.id,
      fields: {
        moa: {
          value: 'Dual GIP/GLP-1 agonist, as the class teaches it',
          status: 'ok', source: 'PSCI 413 — 09.Incretins.pdf',
          updatedAt: '2026-11-09T00:00:00.000Z', updatedBy: USER,
        },
      },
      note: 'Exam 2 only.',
    });
  }

  it('is carried in the file, keyed by the tag slug', async () => {
    await seedVariantLayer();
    const backup = await exportBackup();

    const entry = backup.drugs.find((drug) => drug.slug === 'tirzepatide');
    expect(entry?.variants).toEqual([{
      variant: 'psci-413',
      fields: {
        moa: {
          value: 'Dual GIP/GLP-1 agonist, as the class teaches it',
          status: 'ok', source: 'PSCI 413 — 09.Incretins.pdf',
          updatedAt: '2026-11-09T00:00:00.000Z', updatedBy: USER,
        },
      },
      note: 'Exam 2 only.',
    }]);
  });

  it('comes back on a restore, after the layer is gone', async () => {
    await seedVariantLayer();
    const backup = await exportBackup();

    await db.delete(drugVariantValues);
    await restoreBackup(backup, 'merge');

    const [layer] = await db.select().from(drugVariantValues);
    expect(layer.fields.moa.value).toBe('Dual GIP/GLP-1 agonist, as the class teaches it');
    expect(layer.note).toBe('Exam 2 only.');
  });

  it('leaves layers alone when the file predates them', async () => {
    await seedVariantLayer();
    const backup = await exportBackup();

    // A file written before profile variants existed says nothing about them,
    // and absent is not empty: restoring one must not wipe work typed since.
    const older = {
      ...backup,
      drugs: backup.drugs.map(({ variants: _ignored, ...drug }) => drug),
    } as Backup;

    await restoreBackup(older, 'merge');
    expect(await db.select().from(drugVariantValues)).toHaveLength(1);
  });

  it('clears them when the file says there are none', async () => {
    await seedVariantLayer();
    const backup = await exportBackup();
    const emptied = {
      ...backup,
      drugs: backup.drugs.map((drug) => ({ ...drug, variants: [] })),
    } as Backup;

    // An empty array *is* an instruction, unlike an absent key.
    await restoreBackup(emptied, 'merge');
    expect(await db.select().from(drugVariantValues)).toHaveLength(0);
  });
});

/**
 * Whose words the drug's **own** profile is.
 *
 * The field in this format a person is expected to type in: the live site's
 * drugs were imported before the column existed, so naming the class each base
 * came from means editing an export and restoring it. These are the checks that
 * stand behind doing that by hand.
 */
describe('whose words the drug itself holds', () => {
  /** The class, and the drug's membership of it -- no layer: the base is not one. */
  async function seedClass() {
    const [course] = await db
      .insert(tags)
      .values({ slug: 'psci-413', label: 'PSCI 413', kind: 'course' })
      .returning({ id: tags.id });
    const [drug] = await db.select({ id: drugs.id }).from(drugs).where(eq(drugs.slug, 'tirzepatide'));
    await db.insert(drugTags).values({ drugId: drug.id, tagId: course.id });
    return { courseId: course.id, drugId: drug.id };
  }

  const baseOf = async () => {
    const [row] = await db
      .select({ base: drugs.baseVariantTagId })
      .from(drugs)
      .where(eq(drugs.slug, 'tirzepatide'));
    return row.base;
  };

  it('travels as the tag slug, and as null where there is none', async () => {
    const { courseId, drugId } = await seedClass();

    const unset = await exportBackup();
    expect(unset.drugs.find((drug) => drug.slug === 'tirzepatide')?.baseVariant).toBeNull();

    await db.update(drugs).set({ baseVariantTagId: courseId }).where(eq(drugs.id, drugId));
    const set = await exportBackup();
    expect(set.drugs.find((drug) => drug.slug === 'tirzepatide')?.baseVariant).toBe('psci-413');
  });

  it('takes an attribution typed into the file by hand', async () => {
    const { courseId } = await seedClass();
    const backup = await exportBackup();

    // Exactly what editing a live export looks like: one key, one tag slug.
    const edited = {
      ...backup,
      drugs: backup.drugs.map((drug) => (
        drug.slug === 'tirzepatide' ? { ...drug, baseVariant: 'psci-413' } : drug
      )),
    } as Backup;

    const result = await restoreBackup(edited, 'merge');
    expect(result.ok).toBe(true);
    expect(await baseOf()).toBe(courseId);
  });

  it('leaves one alone when the file predates the field, and clears it on null', async () => {
    const { courseId, drugId } = await seedClass();
    await db.update(drugs).set({ baseVariantTagId: courseId }).where(eq(drugs.id, drugId));
    const backup = await exportBackup();

    // Absent is not null, the same rule `variants` follows: an older file says
    // nothing about the attribution and must not wipe one recorded since.
    const older = {
      ...backup,
      drugs: backup.drugs.map(({ baseVariant: _ignored, ...drug }) => drug),
    } as Backup;
    await restoreBackup(older, 'merge');
    expect(await baseOf()).toBe(courseId);

    // Null *is* an instruction, and says nobody in particular.
    const cleared = {
      ...backup,
      drugs: backup.drugs.map((drug) => ({ ...drug, baseVariant: null })),
    } as Backup;
    await restoreBackup(cleared, 'merge');
    expect(await baseOf()).toBeNull();
  });

  it('reports a slug that cannot be the base, and restores the drug anyway', async () => {
    await seedClass();
    const backup = await exportBackup();

    // A class the drug is not in -- the commonest slip when editing by hand,
    // and it must cost the attribution rather than the profile.
    const wrong = {
      ...backup,
      drugs: backup.drugs.map((drug) => (
        drug.slug === 'tirzepatide' ? { ...drug, baseVariant: 'statins' } : drug
      )),
    } as Backup;

    const result = await restoreBackup(wrong, 'merge');
    expect(result.ok).toBe(true);
    expect(result.ok && result.report.problems.join(' ')).toContain('baseVariant left unset');
    expect(await baseOf()).toBeNull();
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'tirzepatide'));
    expect(drug.genericName).toBe('Tirzepatide');
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

/* --------------------------------------------- a dose and its indication -- */

/**
 * A dose belongs to an indication, and the backup has to carry which.
 *
 * `dosing_regimens_unique` is over (drug, indication, route, population,
 * alternative, step), so **the indication is load-bearing in the key** -- and
 * the export left it out. Sildenafil is the drug that proved it: 20 mg three
 * times a day for pulmonary hypertension and 50 mg an hour beforehand for the
 * other thing, identical in every other column. Restoring that file made them
 * one key twice, Postgres refused the second, and the exception stopped the
 * restore two hundred drugs in -- on the live server, from the screen, with a
 * production digest for an explanation.
 *
 * Two tests, because there are two files in the world now: one that carries the
 * indication, and every one exported before 2026-11-10 that does not.
 */
describe('a dose keeps the indication it was filed under', () => {
  /** The drug `beforeEach` has already seeded, which carries two indications. */
  const seededDrugId = async () => {
    const [row] = await db.select({ id: drugs.id }).from(drugs).where(eq(drugs.slug, 'tirzepatide'));
    return row.id;
  };

  /** Two doses differing by nothing but what they are for. */
  const twoDoses = async (drugId: string) => {
    const links = await db
      .select({ id: drugIndications.id, label: indications.label })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .where(eq(drugIndications.drugId, drugId));
    const idOf = (label: string) => links.find((row) => row.label === label)!.id;

    await db.delete(dosingRegimens).where(eq(dosingRegimens.drugId, drugId));
    await db.insert(dosingRegimens).values([
      {
        drugId,
        indicationId: idOf('Diabetes'),
        sourceText: '2.5 mg subcutaneously once weekly',
        frequency: { kind: 'interval', low: 1, high: null, unit: 'week' },
        source: 'the sheet',
      },
      {
        drugId,
        indicationId: idOf('Weight management'),
        sourceText: '15 mg subcutaneously once weekly',
        frequency: { kind: 'interval', low: 1, high: null, unit: 'week' },
        source: 'the sheet',
      },
    ]);
  };

  /** Each dose with the indication it is filed under, for an assertion. */
  const dosesOf = async (slug: string) => {
    const rows = await db
      .select({ label: indications.label, text: dosingRegimens.sourceText, alternative: dosingRegimens.alternative })
      .from(dosingRegimens)
      .innerJoin(drugs, eq(drugs.id, dosingRegimens.drugId))
      .leftJoin(drugIndications, eq(drugIndications.id, dosingRegimens.indicationId))
      .leftJoin(indications, eq(indications.id, drugIndications.indicationId))
      .where(eq(drugs.slug, slug));
    return rows.sort((a, b) => a.text.localeCompare(b.text));
  };

  it('exports it, and restoring over the drug keeps both doses apart', async () => {
    await twoDoses(await seededDrugId());

    const backup = await exportBackup();
    const exported = backup.drugs.find((drug) => drug.slug === 'tirzepatide')!;
    // On the file as a label, which is how this format says everything: a
    // backup restores into a database whose rows are different objects.
    expect(exported.regimens.map((regimen) => regimen.indication).sort())
      .toEqual(['Diabetes', 'Weight management']);

    // Merge over a database that already has the drug, which is the restore
    // that failed: the children are deleted and written back.
    const result = await restoreBackup(backup, 'merge');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.problems).toEqual([]);
      expect(result.report.dosingRekeyed).toEqual([]);
    }

    expect(await dosesOf('tirzepatide')).toEqual([
      { label: 'Weight management', text: '15 mg subcutaneously once weekly', alternative: 0 },
      { label: 'Diabetes', text: '2.5 mg subcutaneously once weekly', alternative: 0 },
    ]);
  });

  it('keeps both doses of an older file that cannot say which is which', async () => {
    await twoDoses(await seededDrugId());

    // Every file exported before the label existed. Both doses are real and
    // the file has lost what told them apart, so the second is kept as another
    // alternative rather than dropped -- and never by throwing, which took the
    // rest of the drug list down with it.
    const backup = await exportBackup();
    for (const drug of backup.drugs) {
      for (const regimen of drug.regimens) delete regimen.indication;
    }

    const result = await restoreBackup(backup, 'merge');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.problems).toEqual([]);
      // Named, because it is a change to the data the file did not ask for.
      expect(result.report.dosingRekeyed).toEqual(['tirzepatide']);
    }

    // Both survive, unscoped, told apart by the one column left to do it.
    expect(await dosesOf('tirzepatide')).toEqual([
      { label: null, text: '15 mg subcutaneously once weekly', alternative: 1 },
      { label: null, text: '2.5 mg subcutaneously once weekly', alternative: 0 },
    ]);
  });
});

/* ------------------------------------------------ getting the file in -- */

/**
 * The size limits a restore has to get past, and the one that was never set.
 *
 * A backup travels to the server as a server-action body, so **three things
 * have an opinion about how big it may be**: the action, which checks the file
 * and names the limit in its refusal; the form, which can say so before the
 * upload; and Next's own body parser, which rejects the request before any of
 * this app's code runs and defaulted to 1 MB. The export passed a megabyte on
 * 2026-11-10 -- indentation is about four tenths of it -- and restoring one
 * stopped working, with nothing to read about why.
 *
 * So the number is shared, and this is the test that it stays shared. Nothing
 * here needs a database: the failure was two files disagreeing about a
 * constant, which is exactly what a unit test can hold still.
 */
describe('a backup is allowed to be as big as the app says it is', () => {
  it('lets the framework pass what the action accepts', () => {
    // Strictly looser, so the refusal a person reads is the app's own -- which
    // names the size and the limit -- rather than a framework rejection, which
    // says nothing and never reaches the action at all.
    expect(SERVER_ACTION_BODY_LIMIT).toBeGreaterThan(MAX_BACKUP_BYTES);
  });

  it('is the number next.config.ts actually uses', async () => {
    // Imported rather than matched as text: a config that had drifted back to
    // the default would still contain the word.
    const { default: config } = await import('../next.config.ts');
    expect(config.experimental?.serverActions?.bodySizeLimit).toBe(SERVER_ACTION_BODY_LIMIT);
  });

  it('is well clear of the export it has to carry', () => {
    // The whole database as JSON was 1.05 MB the day this was written. A limit
    // that is merely above today's export is the bug again in a year.
    expect(MAX_BACKUP_BYTES).toBeGreaterThan(16 * 1024 * 1024);
    expect(asMegabytes(MAX_BACKUP_BYTES)).toBe('24 MB');
  });
});
