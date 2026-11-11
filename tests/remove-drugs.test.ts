import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { drugTags, drugVariantValues, drugs, tags, users } from '@/db/schema';
import { deleteDrug } from '@/lib/drugs/merge';
import { setDrugTags } from '@/lib/drugs/mutations';
import {
  clearVariantLayer, patchVariantLayer, pointTagsAtVariant, variantLayerFor, variantScope,
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
 * The four assertions about memberships are the rule `clearVariantLayer`
 * answers for: **a version goes out with the scope it arrived with** -- its own
 * class or exam tag and any other scope pointed at it -- while a list, and a
 * class with wording of its own, keep their place and lose only the pointer.
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

/** Which lists, classes and exams the drug is on, by slug. */
const slugsTagged = async (drugSlug: string) => {
  const rows = await db
    .select({ slug: tags.slug })
    .from(drugTags)
    .innerJoin(tags, eq(tags.id, drugTags.tagId))
    .innerJoin(drugs, eq(drugs.id, drugTags.drugId))
    .where(eq(drugs.slug, drugSlug));
  return rows.map((row) => row.slug).sort();
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

  it('deletes a version with its tag, and leaves the drug and its other versions alone', async () => {
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
    expect(result).toEqual({ ok: true, untagged: ['heme-onc-exam-3'] });

    // The wording **and** the membership, because an import writes the two
    // together: it tags the drug with the lecture's scope and words it under
    // the narrowest of them. Leaving the tag behind left a tag with nothing to
    // read, and a tag with nothing to read is read as the drug's own words --
    // so a lecture deleted off a drug went on claiming that the drug's own
    // profile is what that exam teaches.
    expect(await variantLayerFor(drug.id, 'heme-onc-exam-3')).toBeNull();
    expect(await db.select().from(drugVariantValues)).toHaveLength(1);
    // The other version survives, membership and all: one lecture being wrong
    // says nothing about another, and this is the fix that deleting the drug
    // cannot make. Nothing pointed at the version that went, so nothing else
    // on this drug was part of it.
    expect((await variantLayerFor(drug.id, 'phrm-535'))?.fields.moa.value)
      .toBe('What the class said');
    expect(await slugsTagged('prednisone')).toEqual(['phrm-535']);
    const [after] = await db.select().from(drugs).where(eq(drugs.slug, 'prednisone'));
    expect(after.fields.moa.value).toBe('Its own wording');
  });

  it('takes the rest of the lecture’s scope with it', async () => {
    // The shape `applyDrugImport` writes: a file scoped to a class and an exam
    // words the drug under the exam and points the class at it. Both tags are
    // that one lecture, so undoing the lecture is both of them -- see
    // `pointTagsAtVariant` for the half of this that puts them there.
    await seedTag('phrm-535', 'PHRM 535', 'course');
    await seedTag('heme-onc-exam-3', 'Heme/Onc Exam 3', 'exam');
    const drug = await seedDrug('cefuroxime', 'Cefuroxime');
    await setDrugTags('cefuroxime', ['phrm-535', 'heme-onc-exam-3'], ME);
    await wordedBy(drug.id, 'heme-onc-exam-3', 'What the exam said');
    expect(await pointTagsAtVariant({
      drugId: drug.id, variantSlug: 'heme-onc-exam-3', tagSlugs: ['phrm-535'],
    })).toBe(1);

    const result = await clearVariantLayer({
      drugSlug: 'cefuroxime', variantSlug: 'heme-onc-exam-3',
    });
    expect(result).toEqual({ ok: true, untagged: ['heme-onc-exam-3', 'phrm-535'] });

    // Nothing of the lecture is left on the drug: not its wording, not the
    // exam it was worded under, and not the class that was reading it.
    expect(await slugsTagged('cefuroxime')).toEqual([]);
    expect(await db.select().from(drugVariantValues)).toEqual([]);
    // The tags themselves stay. Other drugs are in that class, and a deletion
    // on one drug is not a decision about the vocabulary.
    expect((await db.select().from(tags)).map((tag) => tag.slug).sort())
      .toEqual(['heme-onc-exam-3', 'phrm-535']);
  });

  it('keeps a list on the drug, and only forgets which version it read', async () => {
    // A curated list is not a lecture's scope. `pointTagsAtVariant` will point
    // one at a version and would never put a drug on one, so deleting the
    // version must not take the drug off Top Drugs 2026: the membership is
    // still true, and only the reading is gone.
    await seedTag('top-drugs-2026', 'Top Drugs 2026', 'top_list');
    await seedTag('heme-onc-exam-3', 'Heme/Onc Exam 3', 'exam');
    const drug = await seedDrug('prednisone', 'Prednisone');
    await setDrugTags('prednisone', ['top-drugs-2026', 'heme-onc-exam-3'], ME);
    await wordedBy(drug.id, 'heme-onc-exam-3', 'What the exam said');
    await pointTagsAtVariant({
      drugId: drug.id, variantSlug: 'heme-onc-exam-3', tagSlugs: ['top-drugs-2026'],
    });

    const result = await clearVariantLayer({
      drugSlug: 'prednisone', variantSlug: 'heme-onc-exam-3',
    });
    expect(result).toEqual({ ok: true, untagged: ['heme-onc-exam-3'] });

    expect(await slugsTagged('prednisone')).toEqual(['top-drugs-2026']);
    const [list] = await db
      .select({ named: drugTags.variantTagId })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId))
      .where(eq(tags.slug, 'top-drugs-2026'));
    expect(list.named).toBeNull();
  });

  it('keeps a class that words the drug itself, and only drops its pointer', async () => {
    // Two lectures: the class has wording of its own as well as a pointer at
    // the exam's, which happens when one import points what a later one
    // writes to. Dropping its membership would leave its layer stored and
    // unreachable -- `variantOptionsFor` only offers a layer the drug is still
    // tagged with -- so it stays, and only the pointer goes.
    await seedTag('phrm-535', 'PHRM 535', 'course');
    await seedTag('heme-onc-exam-3', 'Heme/Onc Exam 3', 'exam');
    const drug = await seedDrug('prednisone', 'Prednisone');
    await setDrugTags('prednisone', ['phrm-535', 'heme-onc-exam-3'], ME);
    await wordedBy(drug.id, 'heme-onc-exam-3', 'What the exam said');
    await pointTagsAtVariant({
      drugId: drug.id, variantSlug: 'heme-onc-exam-3', tagSlugs: ['phrm-535'],
    });
    await wordedBy(drug.id, 'phrm-535', 'What the class said');

    const result = await clearVariantLayer({
      drugSlug: 'prednisone', variantSlug: 'heme-onc-exam-3',
    });
    expect(result).toEqual({ ok: true, untagged: ['heme-onc-exam-3'] });

    expect(await slugsTagged('prednisone')).toEqual(['phrm-535']);
    expect((await variantLayerFor(drug.id, 'phrm-535'))?.fields.moa.value)
      .toBe('What the class said');
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

  it('says beforehand exactly what clearing a version will take', async () => {
    /*
     * `variantScope` is what the panel draws and `clearVariantLayer` is what
     * the button does, and the two are the same rule written twice -- once in
     * TypeScript, once in SQL. So they are run against one fixture and
     * compared: the screen promised nothing about which class went out with
     * which version, you pressed delete to find out, and a drug came off a
     * list nobody was undoing.
     *
     * The fixture is the shape an import leaves, with one of everything: the
     * exam that holds the wording, a class pointed at it, a class with wording
     * of its own, and a curated list.
     */
    const course = await seedTag('phrm-535', 'PHRM 535', 'course');
    const exam = await seedTag('heme-onc-exam-3', 'Heme/Onc Exam 3', 'exam');
    const list = await seedTag('top-drugs-2026', 'Top Drugs 2026', 'top_list');
    const other = await seedTag('phrm-540', 'PHRM 540', 'course');
    const drug = await seedDrug('prednisone', 'Prednisone');
    await setDrugTags('prednisone', ['phrm-535', 'heme-onc-exam-3', 'top-drugs-2026', 'phrm-540'], ME);
    await wordedBy(drug.id, 'heme-onc-exam-3', 'What the exam said');
    await wordedBy(drug.id, 'phrm-540', 'What the other class said');
    await pointTagsAtVariant({
      drugId: drug.id,
      variantSlug: 'heme-onc-exam-3',
      tagSlugs: ['phrm-535', 'top-drugs-2026', 'phrm-540'],
    });

    const members = await db
      .select({
        tagId: drugTags.tagId, kind: tags.kind, readsVariant: drugTags.variantTagId,
      })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId))
      .where(eq(drugTags.drugId, drug.id));
    const layerTagIds = new Set([exam.id, other.id]);

    const planned = variantScope(exam.id, members, layerTagIds);
    // The exam itself and the class reading it; the list and the class with
    // its own wording keep their place.
    expect(planned.takes.sort()).toEqual([course.id, exam.id].sort());
    expect(planned.keeps.sort()).toEqual([list.id, other.id].sort());

    const result = await clearVariantLayer({
      drugSlug: 'prednisone', variantSlug: 'heme-onc-exam-3',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const slugOf = new Map(
        (await db.select({ id: tags.id, slug: tags.slug }).from(tags)).map((t) => [t.id, t.slug]),
      );
      // What the panel said it would take is what the mutation took.
      expect(result.untagged).toEqual(planned.takes.map((id) => slugOf.get(id)).sort());
    }
    expect(await slugsTagged('prednisone')).toEqual(['phrm-540', 'top-drugs-2026']);
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

/* ------------------------------------------------- finding what to delete -- */

/**
 * The panel's tag filter, which is a filter and not a list of lists.
 *
 * An import tags what it touches with a course and an exam, so those are the
 * tags undoing one has to be able to filter by -- and the first cut offered a
 * single select labelled *On a list*, which told anyone looking for PHRM 535
 * that it was not there. It was: the facet is built from every membership. The
 * label and the shape were the whole bug.
 *
 * Static, because the filtering is client state and there is no DOM in this
 * suite. What is worth pinning is not that it works -- `matchesTags` is tested
 * against real rows in `browse.test.ts` -- but that this screen keeps using the
 * shared rule. A deletion list quietly filtering by *any* while the drug list
 * filters by *all* would mean ticking every drug shown and taking more than
 * was meant.
 */
describe('the deletion panel filters by tag the way the drug list does', () => {
  const form = readFileSync('app/admin/remove/remove-form.tsx', 'utf8');
  const page = readFileSync('app/admin/remove/page.tsx', 'utf8');

  it('asks the shared rule rather than writing its own', () => {
    expect(form).toContain("matchesTags(held, tagPicks, tagsAny ? 'any' : 'all')");
    expect(form).toContain("from '@/lib/tags/constants'");
  });

  it('takes several tags, and narrows by default', () => {
    // `all` is the default both here and on the drug list: see `matchesTags`.
    expect(form).toContain('const [tagPicks, setTagPicks] = useState<string[]>([]);');
    expect(form).toContain('const [tagsAny, setTagsAny] = useState(false);');
  });

  it('groups every kind of tag, a class beside a list', () => {
    expect(form).toContain('TAG_KIND_GROUPS');
    // No kind is left out of the facet: the course and exam an import creates
    // are the two it most has to offer.
    expect(page).not.toMatch(/tags\.kind\s*,\s*'/);
    expect(page).toContain('kind: tags.kind');
  });

  /*
   * The three guards that exist because this panel deleted Prednisone -- a
   * Top Drugs 2026 drug a heme/onc lecture had worded -- when what was meant
   * was its version. Static for the same reason as the rest of this block, and
   * worth pinning because every one of them is invisible when it works.
   */
  it('sends the ticks the filter is hiding', () => {
    // A checkbox is a DOM field, so a ticked row the filter has removed
    // contributes nothing to `new FormData` -- while the count beside the
    // button counts it. Hidden inputs are what keep the two the same.
    expect(form).toContain('hiddenDrugs.map');
    expect(form).toContain('hiddenLayers.map');
    expect(form).toMatch(/type="hidden" name="drug"/);
    expect(form).toMatch(/type="hidden" name="layer"/);
  });

  it('forgets the ticks once they have been sent', () => {
    // They used to survive the press, so the next one carried them.
    expect(form).toMatch(/send\(event\);\s+setDrugPicks\(\[\]\);\s+setLayerPicks\(\[\]\);/);
  });

  it('names what is about to go, and draws each tag on its own version', () => {
    // A count is a number nobody can check. The names, the curated lists a
    // deletion would take a drug off, and the escalation from version to whole
    // drug are all said before the button, not reported after it.
    expect(form).toContain('nameOf(slug)');
    expect(form).toContain('curatedGoing');
    expect(form).toContain('goingAnyway.length > 0');
    // Per version, from the shared rule rather than one row of pills on top.
    expect(form).toContain('variant.takes.map');
    expect(page).toContain('variantScope(layer.tagId, scoped, layerTagIds)');
  });
});
