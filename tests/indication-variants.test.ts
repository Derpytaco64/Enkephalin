import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  drugIndications, drugTags, drugs, fieldDefs, indications, tags, users,
  type FieldValue,
} from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { setDrugIndicationLinks, drugIndicationsByVariant } from '@/lib/drugs/indication-store';
import { setDrugIndications } from '@/lib/drugs/mutations';
import { getDrugProfile } from '@/lib/drugs/profile';
import { saveVariantLayer, setBaseVariant } from '@/lib/drugs/variants';
import { loadCardSources } from '@/lib/study/sources';
import { exportBackup, restoreBackup } from '@/lib/data/backup';

/**
 * An indication belongs to the version that taught it.
 *
 * The bug this is all about: `drug_indications` had no variant dimension, so
 * five lectures importing doxycycline all appended to one list and the drug
 * came out for 26 conditions at once while each of the five versions held
 * none. Every test here is one half of the fix -- a write that stays inside
 * its own version, and a reading that shows one version's answer rather than
 * the union of five.
 */

const ME = 'admin-id';
const EXAM = 'infectious-disease-exam-3';
const OTHER = 'infectious-disease-exam-4';
const LIST = 'top-drugs-2026';

const value = (text: string, source = 'class sheet'): FieldValue => ({
  value: text, status: 'ok', source, updatedAt: '', updatedBy: null,
});

beforeEach(async () => {
  await db.delete(drugs);
  await db.delete(tags);
  await db.delete(indications);
  await db.delete(fieldDefs);
  await db.delete(users);

  await db.insert(users).values({ id: ME, email: 'me@example.test', role: 'admin' });
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);

  await db.insert(drugs).values({
    slug: 'doxycycline',
    genericName: 'Doxycycline',
    drugClass: 'Tetracycline',
    fields: { moa: value('Binds the 30S ribosomal subunit') },
  });

  await db.insert(tags).values([
    { slug: EXAM, label: 'Infectious Disease Exam 3', kind: 'exam' },
    { slug: OTHER, label: 'Infectious Disease Exam 4', kind: 'exam' },
    { slug: LIST, label: 'Top Drugs 2026', kind: 'top_list' },
  ]);

  const [drug] = await db.select({ id: drugs.id }).from(drugs);
  const tagRows = await db.select({ id: tags.id }).from(tags);
  await db.insert(drugTags).values(tagRows.map((tag) => ({ drugId: drug.id, tagId: tag.id })));
});

const drugId = async () => (await db.select({ id: drugs.id }).from(drugs))[0].id;
const tagId = async (slug: string) =>
  (await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)))[0].id;

/* --------------------------------------------------------------- writing -- */

describe('writing one version\'s indications', () => {
  it('leaves the drug\'s own alone', async () => {
    const id = await drugId();
    await setDrugIndicationLinks(id, ['Bacterial infections']);
    await setDrugIndicationLinks(id, ['Impetigo', 'Folliculitis'], await tagId(EXAM));

    const byVariant = await drugIndicationsByVariant(id);
    expect(byVariant.get(null)).toEqual(['Bacterial infections']);
    expect(byVariant.get(EXAM)).toEqual(['Impetigo', 'Folliculitis']);
  });

  it('leaves another version\'s alone', async () => {
    const id = await drugId();
    await setDrugIndicationLinks(id, ['Impetigo'], await tagId(EXAM));
    await setDrugIndicationLinks(id, ['Chlamydia'], await tagId(OTHER));

    const byVariant = await drugIndicationsByVariant(id);
    expect(byVariant.get(EXAM)).toEqual(['Impetigo']);
    expect(byVariant.get(OTHER)).toEqual(['Chlamydia']);
  });

  it('lets two versions teach the drug for the same condition', async () => {
    // The old unique index was (drug, indication), so the second of these was
    // refused -- and Exam 1 and Exam 3 really do both teach doxycycline for
    // community-acquired pneumonia, in their own wording.
    const id = await drugId();
    await setDrugIndicationLinks(id, ['Pneumonia'], await tagId(EXAM));
    await setDrugIndicationLinks(id, ['Pneumonia'], await tagId(OTHER));

    const rows = await db.select().from(drugIndications).where(eq(drugIndications.drugId, id));
    expect(rows).toHaveLength(2);
  });

  it('still refuses the same condition twice in one version', async () => {
    const id = await drugId();
    await setDrugIndicationLinks(id, ['Pneumonia', 'Pneumonia'], await tagId(EXAM));

    const rows = await db.select().from(drugIndications).where(eq(drugIndications.drugId, id));
    expect(rows).toHaveLength(1);
  });

  it('clears a version\'s list without touching the drug\'s', async () => {
    const id = await drugId();
    await setDrugIndicationLinks(id, ['Bacterial infections']);
    await setDrugIndicationLinks(id, ['Impetigo'], await tagId(EXAM));
    await setDrugIndicationLinks(id, [], await tagId(EXAM));

    const byVariant = await drugIndicationsByVariant(id);
    expect(byVariant.get(null)).toEqual(['Bacterial infections']);
    expect(byVariant.has(EXAM)).toBe(false);
  });

  it('coalesces the version in the unique index, so the drug\'s own is still constrained', async () => {
    // Nulls are distinct in Postgres, so indexing the bare column would stop
    // constraining the null case -- which is most of the table and is what the
    // index was added for in migration 0005.
    const [row] = await db.execute<{ indexdef: string }>(sql`
      select indexdef from pg_indexes where indexname = 'drug_indications_unique'`);

    const indexdef = row.indexdef.toLowerCase();
    expect(indexdef).toContain('coalesce');
    expect(indexdef).toContain('variant_tag_id');
  });

  it('cascades away with the class, rather than being left on the drug', async () => {
    // `set null` would be the wrong answer here and is the right one for
    // `drug_tags.variant_tag_id`: that column is a pointer at a class's
    // wording, this is the wording. Deleting the class should take what the
    // class taught, not move 262 indications onto the drugs' own profiles.
    const id = await drugId();
    await setDrugIndicationLinks(id, ['Bacterial infections']);
    await setDrugIndicationLinks(id, ['Impetigo'], await tagId(EXAM));

    await db.delete(tags).where(eq(tags.slug, EXAM));

    const byVariant = await drugIndicationsByVariant(id);
    expect(byVariant.get(null)).toEqual(['Bacterial infections']);
    expect(byVariant.has(EXAM)).toBe(false);
  });
});

describe('the writer a screen calls', () => {
  it('refuses a version that cannot hold wording', async () => {
    // A list is not a version: only a course or an exam can be one.
    const refused = await setDrugIndications('doxycycline', 'Impetigo', ME, LIST);

    expect(refused.ok).toBe(false);
    const rows = await db.select().from(drugIndications);
    expect(rows).toHaveLength(0);
  });

  it('refuses the class the drug\'s own profile already belongs to', async () => {
    // There is nothing for a class to say differently from itself, which is
    // the same answer `variantLayerFor` gives the field editor.
    await setBaseVariant({ drugSlug: 'doxycycline', variantSlug: EXAM });

    const refused = await setDrugIndications('doxycycline', 'Impetigo', ME, EXAM);
    expect(refused.ok).toBe(false);
  });

  it('names the version in the audit line', async () => {
    await setDrugIndications('doxycycline', 'Impetigo', ME, EXAM);

    const [row] = await db.execute<{ diff: { variant?: string } }>(sql`
      select diff from audit_log where action = 'drug.indications' limit 1`);
    expect(row.diff.variant).toBe(EXAM);
  });
});

/* --------------------------------------------------------------- reading -- */

describe('reading a profile', () => {
  beforeEach(async () => {
    const id = await drugId();
    await setDrugIndicationLinks(id, ['Bacterial infections']);
    await setDrugIndicationLinks(id, ['Impetigo', 'Folliculitis'], await tagId(EXAM));
    await setBaseVariant({ drugSlug: 'doxycycline', variantSlug: LIST });
  });

  it('shows the drug only its own, not every version\'s', async () => {
    // The reported bug, as an assertion: 26 indications from five lectures
    // under one heading, with nothing saying whose they were.
    const profile = await getDrugProfile('doxycycline', ME);

    expect(profile!.coreValues.indication).toBe('Bacterial infections');
    expect(profile!.indications).toEqual(['Bacterial infections']);
  });

  it('shows a version its own, read strictly', async () => {
    const profile = await getDrugProfile('doxycycline', ME, EXAM);

    expect(profile!.strict).toBe(true);
    expect(profile!.coreValues.indication).toBe('Impetigo\nFolliculitis');
    // And the field is shown at all, which needs `indication` to count as a
    // key this version words.
    expect(profile!.overridden.has('indication')).toBe(true);
    expect(profile!.defs.some((def) => def.key === 'indication')).toBe(true);
  });

  it('shows a version nothing where it teaches none, read strictly', async () => {
    const profile = await getDrugProfile('doxycycline', ME, OTHER);

    expect(profile!.coreValues.indication).toBe('');
    expect(profile!.overridden.has('indication')).toBe(false);
  });

  it('falls through to the drug\'s own when the reading is layered', async () => {
    const profile = await getDrugProfile('doxycycline', ME, OTHER, { layered: true });

    expect(profile!.coreValues.indication).toBe('Bacterial infections');
  });

  it('keeps a version\'s own even when the reading is layered', async () => {
    // All or nothing, like every other key: a version either words the field
    // or falls through. Mixing the two lists is the pile-up again.
    const profile = await getDrugProfile('doxycycline', ME, EXAM, { layered: true });

    expect(profile!.coreValues.indication).toBe('Impetigo\nFolliculitis');
  });
});

describe('a study card', () => {
  beforeEach(async () => {
    const id = await drugId();
    await setDrugIndicationLinks(id, ['Bacterial infections']);
    await setDrugIndicationLinks(id, ['Impetigo', 'Folliculitis'], await tagId(EXAM));
    await setBaseVariant({ drugSlug: 'doxycycline', variantSlug: LIST });
  });

  it('asks the scope\'s indications, not the union', async () => {
    const [source] = await loadCardSources([EXAM]);

    expect(source.values.indication!.value).toBe('Impetigo\nFolliculitis');
  });

  it('names the version that taught them, so the card wears its pill', async () => {
    const [source] = await loadCardSources([EXAM]);

    expect(source.wordedBy!.indication.slug).toBe(EXAM);
    // And the question is admissible in a scoped session, which is what
    // `askOnly` decides.
    expect(source.askOnly!.has('indication')).toBe(true);
  });

  it('asks the drug\'s own outside any version', async () => {
    const [source] = await loadCardSources([]);

    expect(source.values.indication!.value).toBe('Bacterial infections');
  });

  it('still finds the drug by any version\'s indication', async () => {
    // The scope array is a search: ticking a condition should find every drug
    // any lecture teaches for it, whichever version is being read.
    const [source] = await loadCardSources([]);

    expect(source.indications).toContain('impetigo');
    expect(source.indications).toContain('bacterial-infections');
  });
});

/* ---------------------------------------------------------------- backup -- */

describe('a backup', () => {
  it('carries each version\'s indications and restores them there', async () => {
    const id = await drugId();
    await setDrugIndicationLinks(id, ['Bacterial infections']);
    await setDrugIndicationLinks(id, ['Impetigo'], await tagId(EXAM));
    await saveVariantLayer({
      drugSlug: 'doxycycline', variantSlug: EXAM,
      values: { moa: 'Bacteriostatic' }, source: 'from Exam 3', note: '', userId: ME,
    });

    const file = await exportBackup();
    const drug = file.drugs.find((row) => row.slug === 'doxycycline')!;
    expect(drug.indications).toEqual(['Bacterial infections']);
    expect(drug.variants!.find((row) => row.variant === EXAM)!.indications).toEqual(['Impetigo']);

    await db.delete(drugIndications).where(eq(drugIndications.drugId, id));
    const result = await restoreBackup(file, 'merge');
    expect(result.ok).toBe(true);

    const byVariant = await drugIndicationsByVariant(await drugId());
    expect(byVariant.get(null)).toEqual(['Bacterial infections']);
    expect(byVariant.get(EXAM)).toEqual(['Impetigo']);
  });

  it('exports a version that has indications and no field layer at all', async () => {
    // Ten drugs in the live data are mentioned by a lecture only to say what it
    // treats them for. Building `variants` from the layer rows alone would
    // drop those silently, which is the worst kind of backup bug.
    await setDrugIndicationLinks(await drugId(), ['Impetigo'], await tagId(EXAM));

    const file = await exportBackup();
    const drug = file.drugs.find((row) => row.slug === 'doxycycline')!;
    const layer = drug.variants!.find((row) => row.variant === EXAM)!;

    expect(layer.fields).toEqual({});
    expect(layer.indications).toEqual(['Impetigo']);
  });

  it('keeps an older file\'s indications as the drug\'s own', async () => {
    // A file written before this column has the union under `indications` and
    // no `variants` entry for it. That restores as the drug's own -- the state
    // it was exported from, which is what a restore is for.
    const file = await exportBackup();
    const drug = file.drugs.find((row) => row.slug === 'doxycycline')!;
    drug.indications = ['Bacterial infections', 'Impetigo'];
    delete drug.variants;

    await restoreBackup(file, 'merge');

    const byVariant = await drugIndicationsByVariant(await drugId());
    expect(byVariant.get(null)).toEqual(['Bacterial infections', 'Impetigo']);
  });

  it('keeps the labels on the drug when the version named cannot hold them', async () => {
    const file = await exportBackup();
    const drug = file.drugs.find((row) => row.slug === 'doxycycline')!;
    drug.variants = [{ variant: LIST, fields: {}, note: null, indications: ['Impetigo'] }];

    const result = await restoreBackup(file, 'merge');

    expect(result.ok).toBe(true);
    const own = await db
      .select({ label: indications.label })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
      .where(and(eq(drugIndications.drugId, await drugId()), isNull(drugIndications.variantTagId)));
    expect(own.map((row) => row.label)).toContain('Impetigo');
  });
});
