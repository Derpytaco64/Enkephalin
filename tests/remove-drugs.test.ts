import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { drugTags, drugVariantValues, drugs, tags, users } from '@/db/schema';
import { deleteDrug } from '@/lib/drugs/merge';
import {
  clearVariantLayer, overriddenKeys, patchVariantLayer, variantLayerFor,
} from '@/lib/drugs/variants';

/**
 * The two deletions a bad import needs, and the rule that orders them.
 *
 * The screen is at `/admin/remove`; what is tested here is the pair of
 * mutations behind it and the one decision the action makes on its own --
 * **a layer whose drug is going too is not cleared separately**, because
 * deleting the drug takes its layers with it and clearing one of those is a
 * write racing its own cascade.
 *
 * `clearVariantLayer` existed for months with nothing calling it. That is why
 * these assertions are about behaviour rather than about being called: an
 * unexercised mutation is a mutation nobody has checked.
 */
const ME = 'remove-admin';

const seedTag = async (slug: string, label: string, kind: 'course' | 'exam' | 'top_list') => {
  const [tag] = await db.insert(tags).values({ slug, label, kind }).returning();
  return tag;
};

const seedDrug = async (slug: string, generic: string) => {
  const [drug] = await db.insert(drugs).values({
    slug,
    genericName: generic,
    fields: {
      moa: {
        value: 'Its own wording', status: 'ok', source: 'the sheet',
        updatedAt: new Date().toISOString(), updatedBy: ME,
      },
    },
  }).returning();
  return drug;
};

const wordedBy = async (drugId: string, variantSlug: string, value: string) => {
  const result = await patchVariantLayer({
    drugId,
    variantSlug,
    values: {
      moa: {
        value, status: 'ok', source: 'the lecture',
        updatedAt: new Date().toISOString(), updatedBy: ME,
      },
    },
    note: 'a lecture',
    userId: ME,
  });
  if (!result.ok) throw new Error(result.message);
};

describe('undoing a bad import', () => {
  beforeEach(async () => {
    await db.delete(drugs);
    await db.delete(tags);
    await db.delete(users);
    await db.insert(users).values({ id: ME, email: 'remove@example.test', role: 'admin' });
  });

  it('clears one version and leaves the drug and its other versions alone', async () => {
    const course = await seedTag('phrm-535', 'PHRM 535', 'course');
    const exam = await seedTag('heme-onc-exam-3', 'Heme/Onc Exam 3', 'exam');
    const drug = await seedDrug('prednisone', 'Prednisone');
    await db.insert(drugTags).values([
      { drugId: drug.id, tagId: course.id },
      { drugId: drug.id, tagId: exam.id },
    ]);
    await wordedBy(drug.id, 'phrm-535', 'What the class said');
    await wordedBy(drug.id, 'heme-onc-exam-3', 'What the exam said');

    const result = await clearVariantLayer({
      drugSlug: 'prednisone', variantSlug: 'heme-onc-exam-3',
    });
    expect(result.ok).toBe(true);

    // The wording is gone and the *membership* is not, which is the right
    // split: `variantLayerFor` answers for any class the drug is in, with
    // nothing in it. Clearing a bad lecture must not also drop the drug off the
    // exam -- membership and wording are two facts, and only one was wrong.
    const cleared = await variantLayerFor(drug.id, 'heme-onc-exam-3');
    expect(cleared).not.toBeNull();
    expect(overriddenKeys(cleared!.fields)).toEqual([]);
    expect(await db.select().from(drugVariantValues)).toHaveLength(1);
    // The other version survives: one lecture being wrong says nothing about
    // another, and this is the fix that deleting the drug cannot make.
    expect((await variantLayerFor(drug.id, 'phrm-535'))?.fields.moa.value)
      .toBe('What the class said');
    const [after] = await db.select().from(drugs).where(eq(drugs.slug, 'prednisone'));
    expect(after.fields.moa.value).toBe('Its own wording');
  });

  it('takes a drug’s versions with it, so clearing them first is needless', async () => {
    const exam = await seedTag('heme-onc-exam-3', 'Heme/Onc Exam 3', 'exam');
    const drug = await seedDrug('nivolumab', 'Nivolumab');
    await db.insert(drugTags).values({ drugId: drug.id, tagId: exam.id });
    await wordedBy(drug.id, 'heme-onc-exam-3', 'What the exam said');

    const result = await deleteDrug('nivolumab', ME);
    expect(result.ok).toBe(true);

    // The reason the action skips a ticked layer whose drug is also ticked.
    expect(await db.select().from(drugVariantValues)).toEqual([]);
    expect(await db.select().from(drugs).where(eq(drugs.slug, 'nivolumab'))).toEqual([]);
    // And the class itself stays: deleting drugs is not deleting a course.
    expect((await db.select().from(tags)).map((tag) => tag.slug)).toEqual(['heme-onc-exam-3']);
  });

  it('deletes only what it was given, one drug at a time', async () => {
    await seedDrug('ipilimumab', 'Ipilimumab');
    await seedDrug('dabrafenib', 'Dabrafenib');
    await seedDrug('warfarin', 'Warfarin');

    for (const slug of ['ipilimumab', 'dabrafenib']) {
      expect((await deleteDrug(slug, ME)).ok).toBe(true);
    }

    expect((await db.select().from(drugs)).map((drug) => drug.slug)).toEqual(['warfarin']);
  });

  it('says so rather than throwing when something is already gone', async () => {
    // Two admins on the screen at once, or a double-submit: the second pass
    // finds nothing and has to report that, because the action runs a list and
    // one stale row must not abandon the rest of it.
    await seedDrug('warfarin', 'Warfarin');
    expect((await deleteDrug('warfarin', ME)).ok).toBe(true);

    const again = await deleteDrug('warfarin', ME);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.message).toContain('no longer exists');

    const layer = await clearVariantLayer({
      drugSlug: 'warfarin', variantSlug: 'heme-onc-exam-3',
    });
    expect(layer.ok).toBe(false);
  });

  it('refuses a version slug that is not a class or an exam', async () => {
    await seedTag('top-drugs-2026', 'Top Drugs 2026', 'top_list');
    await seedDrug('warfarin', 'Warfarin');

    // A top list cannot word a drug differently, so it cannot have a layer to
    // clear -- and a refusal here is better than a delete that matches nothing
    // and reports success.
    const result = await clearVariantLayer({
      drugSlug: 'warfarin', variantSlug: 'top-drugs-2026',
    });
    expect(result.ok).toBe(false);
  });
});
