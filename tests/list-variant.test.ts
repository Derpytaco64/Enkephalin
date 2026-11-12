import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  drugTags, drugVariantValues, drugs, fieldDefs, studyCards, tags, users,
} from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { membershipVariants, numberedVariantsByDrug, saveVariantLayer } from '@/lib/drugs/variants';
import { setTagDrugs } from '@/lib/tags/mutations';
import { setDrugTags } from '@/lib/drugs/mutations';
import { getDrugIndex } from '@/lib/drugs/browse';
import { loadCardSources } from '@/lib/study/sources';
import { lookupDrug } from '@/lib/study/lookup';
import { DEFAULT_CONFIG, normalizeConfig } from '@/lib/study/config';
import { loadDeck } from '@/lib/study/session';

/**
 * A list can say **which version of a drug it means**.
 *
 * Asked for 2026-11-09: *building flashcards and quizzes should default to the
 * profile added for a drug, and the tag drug adder should have options for each
 * drug variant origin.* So membership carries an optional pointer at a class or
 * exam, and studying the list reads that wording by default.
 *
 * Two things these tests are really guarding. One: the pointer is a *default*,
 * not a lock -- scoping deliberately to a class still wins over a standing
 * choice recorded in a list, for the same reason an exam beats its class. Two:
 * nothing about the choice is allowed to leak into the card's identity, so a
 * drug studied as its class words it is still one card with one schedule.
 */

const ME = 'admin-id';
const LIST = 'top-drugs-2026';
const CLASS = 'phrm-535';
const OTHER = 'psci-413';

let drugIds: Record<string, string>;

beforeEach(async () => {
  for (const table of [studyCards, drugVariantValues, drugTags, drugs, tags, fieldDefs, users]) {
    await db.delete(table);
  }

  await db.insert(users).values({ id: ME, email: 'me@example.test', role: 'admin' });
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);

  const rows = await db
    .insert(drugs)
    .values([
      {
        slug: 'amoxicillin',
        genericName: 'Amoxicillin',
        drugClass: 'Aminopenicillin',
        fields: {
          moa: { value: 'Inhibits cell wall synthesis', status: 'ok', source: 'class sheet', updatedAt: '', updatedBy: null },
        },
      },
      {
        slug: 'warfarin',
        genericName: 'Warfarin',
        fields: {
          moa: { value: 'Vitamin K antagonist', status: 'ok', source: 'class sheet', updatedAt: '', updatedBy: null },
        },
      },
    ])
    .returning({ id: drugs.id, slug: drugs.slug });
  drugIds = Object.fromEntries(rows.map((row) => [row.slug, row.id]));

  await db.insert(tags).values([
    { slug: LIST, label: 'Top Drugs 2026', kind: 'top_list' },
    { slug: CLASS, label: 'PHRM 535', kind: 'course' },
    { slug: OTHER, label: 'PSCI 413', kind: 'course' },
  ]);

  // Both drugs on the list; amoxicillin also in both classes, so it is the one
  // with versions to choose between.
  await setDrugTags('amoxicillin', [LIST, CLASS, OTHER], ME);
  await setDrugTags('warfarin', [LIST], ME);

  await saveVariantLayer({
    drugSlug: 'amoxicillin', variantSlug: CLASS,
    values: { moa: 'What PHRM 535 says' }, source: '', note: '', userId: ME,
  });
  await saveVariantLayer({
    drugSlug: 'amoxicillin', variantSlug: OTHER,
    values: { moa: 'What PSCI 413 says' }, source: '', note: '', userId: ME,
  });
});

/** The row for one drug on one list. */
async function membership(drugSlug: string, listSlug: string) {
  const [tag] = await db.select().from(tags).where(eq(tags.slug, listSlug));
  const [row] = await db
    .select()
    .from(drugTags)
    .where(eq(drugTags.drugId, drugIds[drugSlug]))
    .then((rows) => rows.filter((candidate) => candidate.tagId === tag.id));
  return row;
}

/* ------------------------------------------------------------- numbering -- */

describe('numbering a drug’s versions', () => {
  it('numbers them from V-2, the drug’s own being V-1', async () => {
    const byDrug = await numberedVariantsByDrug();

    // Both are classes, so they sort by label: PHRM 535 before PSCI 413. And
    // they start at 2 -- the drug's own profile is V-1 on every screen, so
    // *V-3* says there are three versions of this drug rather than four.
    expect(byDrug.get(drugIds.amoxicillin)).toEqual([
      { slug: CLASS, label: 'PHRM 535', kind: 'course', n: 2, overrides: 1 },
      { slug: OTHER, label: 'PSCI 413', kind: 'course', n: 3, overrides: 1 },
    ]);
    // A drug in no class has no versions, rather than an empty list of one.
    expect(byDrug.get(drugIds.warfarin)).toBeUndefined();
  });

  it('counts only the versions that say something of their own', async () => {
    // Tagged with a class that has written nothing: not another version of
    // anything, so offering it would be offering a choice that changes nothing.
    const [third] = await db
      .insert(tags)
      .values({ slug: 'phrm-536', label: 'PHRM 536', kind: 'course' })
      .returning({ id: tags.id });
    await db.insert(drugTags).values({ drugId: drugIds.amoxicillin, tagId: third.id });

    const byDrug = await numberedVariantsByDrug();
    expect(byDrug.get(drugIds.amoxicillin)?.map((variant) => variant.slug)).toEqual([CLASS, OTHER]);
  });

  it('is the same numbering the browse list shows as V-n', async () => {
    const { rows } = await getDrugIndex();
    const bySlug = Object.fromEntries(rows.map((row) => [row.slug, row]));

    expect(bySlug.amoxicillin.variants.map((variant) => [variant.n, variant.slug]))
      .toEqual([[2, CLASS], [3, OTHER]]);
    expect(bySlug.warfarin.variants).toEqual([]);
  });
});

/* ------------------------------------------------------------ the pointer -- */

describe('recording which version a list means', () => {
  it('stores it, and null means the drug’s own profile', async () => {
    const result = await setTagDrugs(LIST, [
      { drugId: drugIds.amoxicillin, variant: CLASS },
      { drugId: drugIds.warfarin, variant: null },
    ], ME);
    expect(result.ok).toBe(true);

    const [chosen] = await db.select().from(tags).where(eq(tags.slug, CLASS));
    expect((await membership('amoxicillin', LIST)).variantTagId).toBe(chosen.id);
    expect((await membership('warfarin', LIST)).variantTagId).toBeNull();
  });

  it('changes it on a drug that is already on the list', async () => {
    await setTagDrugs(LIST, [{ drugId: drugIds.amoxicillin, variant: CLASS }], ME);
    await setTagDrugs(LIST, [{ drugId: drugIds.amoxicillin, variant: OTHER }], ME);

    const [other] = await db.select().from(tags).where(eq(tags.slug, OTHER));
    expect((await membership('amoxicillin', LIST)).variantTagId).toBe(other.id);
  });

  it('clears it back to the drug’s own profile', async () => {
    await setTagDrugs(LIST, [{ drugId: drugIds.amoxicillin, variant: CLASS }], ME);
    await setTagDrugs(LIST, [{ drugId: drugIds.amoxicillin, variant: null }], ME);

    expect((await membership('amoxicillin', LIST)).variantTagId).toBeNull();
  });

  it('refuses a version that is not a class or an exam', async () => {
    const result = await setTagDrugs(LIST, [
      { drugId: drugIds.amoxicillin, variant: LIST },
    ], ME);

    expect(result).toEqual({ ok: false, message: expect.stringContaining('Not a class or exam') });
    // And wrote nothing, so the list is as it was.
    expect((await membership('amoxicillin', LIST)).variantTagId).toBeNull();
  });

  it('keeps a plain list of ids working', async () => {
    // Most callers only decide membership, and they should not have to say
    // "and no particular version" to do it.
    expect((await setTagDrugs(LIST, [drugIds.warfarin], ME)).ok).toBe(true);
    expect(await membership('amoxicillin', LIST)).toBeUndefined();
  });

  it('survives the drug editor, which is about membership only', async () => {
    await setTagDrugs(LIST, [{ drugId: drugIds.amoxicillin, variant: CLASS }], ME);

    // Re-saving the drug's tags from its own edit form, which has no version
    // control on it: the choice belongs to the list, so it has to persist.
    await setDrugTags('amoxicillin', [LIST, CLASS, OTHER], ME);

    const [chosen] = await db.select().from(tags).where(eq(tags.slug, CLASS));
    expect((await membership('amoxicillin', LIST)).variantTagId).toBe(chosen.id);
  });

  it('forgets it if the class itself is deleted, and keeps the drug on the list', async () => {
    await setTagDrugs(LIST, [{ drugId: drugIds.amoxicillin, variant: CLASS }], ME);
    await db.delete(tags).where(eq(tags.slug, CLASS));

    const row = await membership('amoxicillin', LIST);
    expect(row).toBeDefined();
    expect(row.variantTagId).toBeNull();
  });
});

/* ------------------------------------------------------------- studying it -- */

describe('studying a list that names a version', () => {
  beforeEach(async () => {
    await setTagDrugs(LIST, [
      { drugId: drugIds.amoxicillin, variant: CLASS },
      { drugId: drugIds.warfarin, variant: null },
    ], ME);
  });

  it('reads the chosen version per drug, and the drug’s own for the rest', async () => {
    const byDrug = await membershipVariants([LIST]);
    expect(byDrug.get(drugIds.amoxicillin)).toEqual([CLASS]);
    expect(byDrug.get(drugIds.warfarin)).toBeUndefined();

    const sources = await loadCardSources([], byDrug);
    const bySlug = Object.fromEntries(sources.map((source) => [source.slug, source]));

    expect(bySlug.amoxicillin.values.moa?.value).toBe('What PHRM 535 says');
    expect(bySlug.warfarin.values.moa?.value).toBe('Vitamin K antagonist');
  });

  it('ignores a choice recorded on a list that is not in scope', async () => {
    expect(await membershipVariants([OTHER])).toEqual(new Map());
    expect(await membershipVariants([])).toEqual(new Map());
  });

  it('lets a scoped class beat the list’s standing choice', async () => {
    // The list says PHRM 535; the session says PSCI 413. The session is a
    // decision made just now, so it wins -- and it wins by being applied last.
    const sources = await loadCardSources([OTHER], await membershipVariants([LIST]));
    const [amoxicillin] = sources.filter((source) => source.slug === 'amoxicillin');

    expect(amoxicillin.values.moa?.value).toBe('What PSCI 413 says');
  });

  it('is what a deck built from the list actually asks', async () => {
    const config = normalizeConfig({
      ...DEFAULT_CONFIG,
      fields: ['moa'],
      sessionMode: 'cram',
      scope: { ...DEFAULT_CONFIG.scope, tags: [LIST] },
    });
    const deck = await loadDeck(ME, config);
    // drug_to_fields, so the one face is the answer side.
    const answers = deck.cards.map((card) => card.faces[0].text);

    expect(answers).toContain('What PHRM 535 says');
    expect(answers).toContain('Vitamin K antagonist');
  });

  it('is still one card and one schedule', async () => {
    const plain = normalizeConfig({ ...DEFAULT_CONFIG, fields: ['moa'], sessionMode: 'cram' });
    const viaList = await loadDeck(ME, normalizeConfig({
      ...plain,
      scope: { ...DEFAULT_CONFIG.scope, tags: [LIST] },
    }));
    const direct = await loadDeck(ME, plain);

    const keyFor = (deck: typeof direct, slug: string) =>
      deck.cards.find((card) => card.slug === slug)?.cardKey;

    expect(keyFor(viaList, 'amoxicillin')).toBe(keyFor(direct, 'amoxicillin'));
  });
});

/* ---------------------------------------------- saying so on the card -- */

describe('telling you whose words you are studying', () => {
  beforeEach(async () => {
    await setTagDrugs(LIST, [
      { drugId: drugIds.amoxicillin, variant: CLASS },
      { drugId: drugIds.warfarin, variant: null },
    ], ME);
  });

  it('marks the fields a version worded, and only those', async () => {
    // The class rewords the mechanism and says nothing about anything else.
    const sources = await loadCardSources([], await membershipVariants([LIST]));
    const [amoxicillin] = sources.filter((source) => source.slug === 'amoxicillin');

    expect(amoxicillin.wordedBy?.moa).toEqual({ n: 2, label: 'PHRM 535', slug: CLASS });
    expect(amoxicillin.wordedBy?.bbw).toBeUndefined();
  });

  it('puts the version on the cards that ask about its wording', async () => {
    const config = normalizeConfig({
      ...DEFAULT_CONFIG,
      fields: ['moa'],
      sessionMode: 'cram',
      scope: { ...DEFAULT_CONFIG.scope, tags: [LIST] },
    });
    const deck = await loadDeck(ME, config);
    const bySlug = Object.fromEntries(deck.cards.map((card) => [card.slug, card]));

    expect(bySlug.amoxicillin.variants).toEqual([{ n: 2, label: 'PHRM 535', slug: CLASS }]);
    // The drug's own words, so there is nothing to say about whose they are.
    expect(bySlug.warfarin.variants).toEqual([]);
  });

  it('says nothing on a card whose fields the version never touched', async () => {
    // A class that rewords the mechanism has not reworded the warning, and a
    // pill on that card would be a lie told by a badge.
    //
    // The warning carries a real value rather than a `none`, because a field a
    // drug has none of now makes no card at all -- see `worthAsking`.
    await saveVariantLayer({
      drugSlug: 'amoxicillin', variantSlug: CLASS,
      values: { moa: 'What PHRM 535 says' }, source: '', note: '', userId: ME,
    });
    await db
      .update(drugs)
      .set({
        fields: {
          moa: { value: 'Inhibits cell wall synthesis', status: 'ok', source: 's', updatedAt: '', updatedBy: null },
          bbw: { value: 'Warning as the sheet words it', status: 'ok', source: 's', updatedAt: '', updatedBy: null },
        },
      })
      .where(eq(drugs.slug, 'amoxicillin'));

    const config = normalizeConfig({
      ...DEFAULT_CONFIG,
      fields: ['bbw'],
      mode: 'exclusive',
      sessionMode: 'cram',
      scope: { ...DEFAULT_CONFIG.scope, tags: [LIST] },
    });
    const deck = await loadDeck(ME, config);
    const [card] = deck.cards.filter((entry) => entry.slug === 'amoxicillin');

    expect(card.variants).toEqual([]);
  });

  it('shows the lookup panel the version the list points at', async () => {
    await saveVariantLayer({
      drugSlug: 'amoxicillin', variantSlug: CLASS,
      values: { moa: 'What PHRM 535 says' }, source: '', note: '', userId: ME,
    });

    // Scoped to the list, which is the ordinary way to study: the pointer is
    // the only thing saying to read the class's wording, and the panel has to
    // follow it or it contradicts the card that was just answered.
    const card = await lookupDrug('amoxicillin', ME, [LIST]);
    const moa = card!.groups.flatMap((group) => group.fields)
      .find((field) => field.key === 'moa')!;

    expect(moa.lines).toEqual(['What PHRM 535 says']);
    expect(moa.version).toEqual({ n: 2, label: 'PHRM 535', slug: CLASS });
    expect(card!.versions).toEqual([{ n: 2, label: 'PHRM 535', slug: CLASS }]);
  });

  it('never carries the drug’s name, which would give the answer away', async () => {
    const config = normalizeConfig({
      ...DEFAULT_CONFIG,
      fields: ['moa'],
      sessionMode: 'cram',
      direction: 'fields_to_drug',
      scope: { ...DEFAULT_CONFIG.scope, tags: [LIST] },
    });
    const deck = await loadDeck(ME, config);
    const [card] = deck.cards.filter((entry) => entry.slug === 'amoxicillin');

    // Asked this way round the drug is the answer, so the pill may say the
    // class and the number and nothing else.
    expect(card.variants).toEqual([{ n: 2, label: 'PHRM 535', slug: CLASS }]);
    for (const variant of card.variants) {
      expect(variant.label.toLowerCase()).not.toContain('amoxicillin');
    }
  });
});
