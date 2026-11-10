import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  drugVariantValues, drugTags, drugs, fieldDefs, studyCards, tags, users, type FieldValue,
} from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import {
  variantLayerFor,
  variantOptionsFor,
  variantSlugsAmong,
  overlayFields,
  overridable,
  overriddenKeys,
  saveVariantLayer,
} from '@/lib/drugs/variants';
import { getDrugProfile } from '@/lib/drugs/profile';
import { loadCardSources } from '@/lib/study/sources';
import { DEFAULT_CONFIG, cardKey, normalizeConfig, type StudyConfig } from '@/lib/study/config';
import { loadDeck } from '@/lib/study/session';

/**
 * A class's or an exam's own version of a drug profile.
 *
 * **A layer, not a copy**, and that is what nearly every test here is about: a
 * class says a few things differently and says nothing about the rest, so the
 * rest has to keep coming from the drug -- including after the drug changes.
 * A copy would pass a shallower version of these tests and then quietly rot.
 *
 * The other half is the thing that must *not* happen: a second schedule. A
 * mechanism studied through a class is the same card as the drug's own, because
 * `card_key` is built from field keys. The alternative is a second kind of
 * study subject, which this database had and dropped in migration 0013.
 */

const ME = 'admin-id';
const COURSE = 'psci-413';
const EXAM = 'heme-onc-exam-3';
const SECOND = 'phrm-535';

const value = (text: string, source = 'class sheet'): FieldValue => ({
  value: text, status: 'ok', source, updatedAt: '', updatedBy: null,
});

beforeEach(async () => {
  await db.delete(studyCards);
  await db.delete(drugs);
  await db.delete(tags);
  await db.delete(fieldDefs);
  await db.delete(users);

  await db.insert(users).values({ id: ME, email: 'me@example.test', role: 'admin' });
  // The sheet's own field set, which already carries `moa` and `bbw` -- the
  // two this file differs on.
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);

  await db.insert(drugs).values({
    slug: 'levothyroxine',
    genericName: 'Levothyroxine',
    drugClass: 'Thyroid hormone',
    fields: { moa: value('Replaces T4'), bbw: value('Thyrotoxicosis in weight loss') },
  });

  await db.insert(tags).values([
    { slug: COURSE, label: 'PSCI 413', kind: 'course' },
    { slug: EXAM, label: 'Heme/Onc Exam 3', kind: 'exam' },
    { slug: SECOND, label: 'PHRM 535', kind: 'course' },
    { slug: 'top-drugs-2026', label: 'Top Drugs 2026', kind: 'top_list' },
  ]);

  const [drug] = await db.select({ id: drugs.id }).from(drugs);
  const tagRows = await db.select({ id: tags.id, slug: tags.slug }).from(tags);
  await db.insert(drugTags).values(tagRows.map((tag) => ({ drugId: drug.id, tagId: tag.id })));
});

const drugId = async () => (await db.select({ id: drugs.id }).from(drugs))[0].id;

/* ------------------------------------------------------- the reading rule -- */

describe('the overlay rule', () => {
  it('falls through to the drug for anything the class does not mention', () => {
    const merged = overlayFields(
      { moa: value('Replaces T4'), bbw: value('Thyrotoxicosis in weight loss') },
      { moa: value('T4 analogue; converted peripherally to T3', 'PSCI 413') },
    );

    expect(merged.moa.value).toBe('T4 analogue; converted peripherally to T3');
    expect(merged.moa.source).toBe('PSCI 413');
    // The whole point: unmentioned is *the same*, not blank.
    expect(merged.bbw.value).toBe('Thyrotoxicosis in weight loss');
  });

  it('never lets a class override a core field', () => {
    // A class claiming a different generic name is a different drug.
    const merged = overlayFields(
      { generic: value('Levothyroxine') },
      { generic: value('Thyroxine', 'PSCI 413') },
    );

    expect(merged.generic.value).toBe('Levothyroxine');
    expect(overridable('generic')).toBe(false);
    expect(overridable('moa')).toBe(true);
  });

  it('does not let a blank in a layer erase the drug\'s value', () => {
    const merged = overlayFields(
      { moa: value('Replaces T4') },
      { moa: { value: null, status: 'ok', source: 'PSCI 413', updatedAt: '', updatedBy: null } },
    );

    expect(merged.moa.value).toBe('Replaces T4');
  });

  it('lets a class record "none to record", which is an answer rather than a gap', () => {
    const merged = overlayFields(
      { bbw: value('Thyrotoxicosis in weight loss') },
      { bbw: { value: null, status: 'none', source: 'PSCI 413', updatedAt: '', updatedBy: null } },
    );

    expect(merged.bbw.status).toBe('none');
  });

  it('applies layers in order, so the last one given wins', () => {
    const merged = overlayFields(
      { moa: value('Replaces T4') },
      { moa: value('First', 'A') },
      { moa: value('Second', 'B') },
    );

    expect(merged.moa.value).toBe('Second');
  });

  it('counts only the keys a layer really speaks about', () => {
    expect(overriddenKeys({
      moa: value('x'),
      generic: value('y'),
      bbw: { value: null, status: 'ok', source: null, updatedAt: '', updatedBy: null },
    })).toEqual(['moa']);
  });
});

/* -------------------------------------------------------------- the store -- */

describe('saving a variant layer', () => {
  it('stores only what was filled in, and counts it', async () => {
    const result = await saveVariantLayer({
      drugSlug: 'levothyroxine',
      variantSlug: COURSE,
      values: { moa: 'T4 analogue, converted peripherally', bbw: '' },
      source: 'PSCI 413 — 14.Thyroid.pdf',
      note: 'Exam 3 covers the thioamides only.',
      userId: ME,
    });

    expect(result).toEqual({ ok: true, overrides: 1 });

    const [stored] = await db.select().from(drugVariantValues);
    expect(Object.keys(stored.fields)).toEqual(['moa']);
    expect(stored.fields.moa.source).toBe('PSCI 413 — 14.Thyroid.pdf');
    expect(stored.note).toBe('Exam 3 covers the thioamides only.');
  });

  it('defaults the source to the tag\'s own name', async () => {
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: 'Its own wording' }, source: '  ', note: '', userId: ME,
    });

    const [stored] = await db.select().from(drugVariantValues);
    expect(stored.fields.moa.source).toBe('PSCI 413');
  });

  it('clears one field when its box is emptied', async () => {
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: 'Its own wording', bbw: 'Its own list' }, source: '', note: 'kept', userId: ME,
    });
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: 'Its own wording', bbw: '' }, source: '', note: 'kept', userId: ME,
    });

    const [stored] = await db.select().from(drugVariantValues);
    expect(Object.keys(stored.fields)).toEqual(['moa']);
  });

  it('removes the row when the class ends up saying nothing at all', async () => {
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: 'Its own wording' }, source: '', note: '', userId: ME,
    });
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: '' }, source: '', note: '', userId: ME,
    });

    // So the pill row stops offering a layer that holds nothing.
    expect(await db.select().from(drugVariantValues)).toHaveLength(0);
  });

  it('keeps the row while it still carries a note', async () => {
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: '' }, source: '', note: 'Not examined this year.', userId: ME,
    });

    const [stored] = await db.select().from(drugVariantValues);
    expect(stored.note).toBe('Not examined this year.');
    expect(stored.fields).toEqual({});
  });

  it('leaves an unchanged value\'s own timestamp alone', async () => {
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: 'Its own wording' }, source: 'slides', note: '', userId: ME,
    });
    const [first] = await db.select().from(drugVariantValues);

    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: 'Its own wording', bbw: 'New' }, source: 'slides', note: '', userId: ME,
    });
    const [second] = await db.select().from(drugVariantValues);

    // `updatedAt` on a value means when *that value* changed, not when the
    // form was last submitted.
    expect(second.fields.moa.updatedAt).toBe(first.fields.moa.updatedAt);
    expect(second.fields.bbw.updatedAt).not.toBe('');
  });

  it('refuses a drug the tag is not on, and writes nothing', async () => {
    await db.insert(drugs).values({ slug: 'metformin', genericName: 'Metformin' });

    const result = await saveVariantLayer({
      drugSlug: 'metformin', variantSlug: COURSE,
      values: { moa: 'Whatever' }, source: '', note: '', userId: ME,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain(COURSE);
    expect(await db.select().from(drugVariantValues)).toHaveLength(0);
  });

  it('refuses a tag that cannot carry a variant', async () => {
    const result = await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: 'top-drugs-2026',
      values: { moa: 'Whatever' }, source: '', note: '', userId: ME,
    });

    // A drug list is not a class. Membership is the same table, so this is the
    // one thing the kind has to be checked for.
    expect(result.ok).toBe(false);
  });

  it('refuses a core field rather than quietly dropping it', async () => {
    const result = await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { generic: 'Thyroxine', moa: 'Its own wording' }, source: '', note: '', userId: ME,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('generic');
    // Nothing saved: a core key in the payload is a bug in the form, not a typo.
    expect(await db.select().from(drugVariantValues)).toHaveLength(0);
  });
});

describe('reading a variant back', () => {
  it('lists the variants a drug is in, with how much each says of its own', async () => {
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: 'Its own wording' }, source: '', note: '', userId: ME,
    });

    const options = await variantOptionsFor(await drugId());
    // Both classes, then the exam -- kind first, label inside a kind, so the
    // two courses sort between themselves and the narrower exam lands last.
    // Not the drug list, which is not something a drug can have a version for.
    expect(options).toEqual([
      { tagId: expect.any(String), slug: SECOND, label: 'PHRM 535', kind: 'course', overrides: 0 },
      { tagId: expect.any(String), slug: COURSE, label: 'PSCI 413', kind: 'course', overrides: 1 },
      { tagId: expect.any(String), slug: EXAM, label: 'Heme/Onc Exam 3', kind: 'exam', overrides: 0 },
    ]);
  });

  it('offers a variant the drug is in even before it says anything', async () => {
    const options = await variantOptionsFor(await drugId());
    expect(options.map((option) => option.overrides)).toEqual([0, 0, 0]);
  });

  it('has no layer for a drug that has left the class', async () => {
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: 'Its own wording' }, source: '', note: '', userId: ME,
    });

    const [course] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, COURSE));
    await db
      .delete(drugTags)
      .where(and(eq(drugTags.drugId, await drugId()), eq(drugTags.tagId, course.id)));

    // The stored row is still there; it is simply not a profile anyone can
    // ask for, which keeps the picker and the browse filter in agreement.
    expect(await variantLayerFor(await drugId(), COURSE)).toBeNull();
  });

  it('tells a variant slug from a drug list slug', async () => {
    expect(await variantSlugsAmong([COURSE, 'top-drugs-2026', 'nothing'])).toEqual([COURSE]);
    expect(await variantSlugsAmong([])).toEqual([]);
  });

  it('returns them in overlay order however they were asked for', async () => {
    // The order is the function's whole job: narrowest last, so an exam's
    // wording wins over the exam's, which wins over the class's.
    // Two classes sort between themselves by label -- PHRM 535 before PSCI
    // 413 -- and the exam, being narrower than either, lands last.
    expect(await variantSlugsAmong([EXAM, COURSE, SECOND])).toEqual([SECOND, COURSE, EXAM]);
  });
});

/* ------------------------------------------------------------ the profile -- */

describe('the profile, read through a variant', () => {
  beforeEach(async () => {
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: 'T4 analogue, converted peripherally to T3' },
      source: 'PSCI 413 — 14.Thyroid.pdf', note: '', userId: ME,
    });
  });

  it('reads the drug\'s own values with no variant asked for', async () => {
    const profile = await getDrugProfile('levothyroxine', ME);
    expect(profile?.drug.fields.moa.value).toBe('Replaces T4');
    expect(profile?.variant).toBeNull();
    expect(profile?.overridden.size).toBe(0);
    // The picker is offered either way, because the tags exist.
    expect(profile?.variants).toHaveLength(3);
  });

  it('reads the class\'s wording where it has one, and the drug\'s elsewhere', async () => {
    const profile = await getDrugProfile('levothyroxine', ME, COURSE);

    expect(profile?.drug.fields.moa.value).toBe('T4 analogue, converted peripherally to T3');
    expect(profile?.drug.fields.moa.source).toBe('PSCI 413 — 14.Thyroid.pdf');
    expect(profile?.drug.fields.bbw.value).toBe('Thyrotoxicosis in weight loss');
    expect([...(profile?.overridden ?? [])]).toEqual(['moa']);
  });

  it('shows the drug\'s own improvements through the class that did not mention them', async () => {
    // The argument for a layer over a copy, as a test: fix the base, and every
    // class's view of it is fixed too.
    await db.update(drugs).set({
      fields: { moa: value('Replaces T4'), bbw: value('Thyrotoxicosis; not for obesity') },
    }).where(eq(drugs.slug, 'levothyroxine'));

    const profile = await getDrugProfile('levothyroxine', ME, COURSE);
    expect(profile?.drug.fields.bbw.value).toBe('Thyrotoxicosis; not for obesity');
  });

  it('ignores a variant the drug is not in', async () => {
    await db.insert(tags).values({ slug: 'other-class', label: 'Other', kind: 'course' });

    const profile = await getDrugProfile('levothyroxine', ME, 'other-class');
    expect(profile?.variant).toBeNull();
    expect(profile?.drug.fields.moa.value).toBe('Replaces T4');
  });
});

/* -------------------------------------------------------------- studying -- */

describe('studying a variant', () => {
  beforeEach(async () => {
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: 'T4 analogue, converted peripherally to T3' },
      source: 'PSCI 413', note: '', userId: ME,
    });
  });

  it('asks the drug\'s own wording when no variant is in scope', async () => {
    const [source] = await loadCardSources();
    expect(source.values.moa?.value).toBe('Replaces T4');
  });

  it('asks the class\'s wording when the class is in scope', async () => {
    const [source] = await loadCardSources([COURSE]);
    expect(source.values.moa?.value).toBe('T4 analogue, converted peripherally to T3');
    // Everything the class is silent about is still the drug's.
    expect(source.values.bbw?.value).toBe('Thyrotoxicosis in weight loss');
  });

  const config = (partial: Partial<StudyConfig> = {}): StudyConfig => normalizeConfig({
    ...DEFAULT_CONFIG,
    fields: ['moa'],
    sessionMode: 'cram',
    ...partial,
  });

  it('builds the deck from the class\'s wording when the class is the scope', async () => {
    const deck = await loadDeck(ME, config({
      scope: { ...DEFAULT_CONFIG.scope, tags: [COURSE] },
    }));

    expect(deck.cards).toHaveLength(1);
    expect(deck.cards[0].faces[0].text).toBe('T4 analogue, converted peripherally to T3');
  });

  it('is one card and one schedule either way', async () => {
    const own = await loadDeck(ME, config());
    const through = await loadDeck(ME, config({
      scope: { ...DEFAULT_CONFIG.scope, tags: [COURSE] },
    }));

    // The thing that must not happen: a second schedule per class. `card_key`
    // is built from field keys, so the class changes the words and not the
    // card -- and the alternative is a second kind of study subject, which
    // migration 0013 took out of this database.
    expect(through.cards[0].cardKey).toBe(own.cards[0].cardKey);
    const plain = config();
    expect(through.cards[0].cardKey).toBe(cardKey({
      mode: plain.mode, direction: plain.direction, fieldKeys: ['moa'],
    }));
  });

  it('studies a drug list without reaching for any class\'s wording', async () => {
    const deck = await loadDeck(ME, config({
      scope: { ...DEFAULT_CONFIG.scope, tags: ['top-drugs-2026'] },
    }));

    expect(deck.cards[0].faces[0].text).toBe('Replaces T4');
  });
});

/* -------------------------------------------------------- a class, an exam -- */

describe('the two kinds of variant', () => {
  it('lets a class and an exam each hold their own wording', async () => {
    for (const [variantSlug, text] of [[EXAM, 'Exam 3 wording'], [SECOND, 'The other class']]) {
      const result = await saveVariantLayer({
        drugSlug: 'levothyroxine', variantSlug,
        values: { moa: text }, source: '', note: '', userId: ME,
      });
      expect(result.ok).toBe(true);
    }

    expect(await db.select().from(drugVariantValues)).toHaveLength(2);
    const exam = await variantLayerFor(await drugId(), EXAM);
    expect(exam?.kind).toBe('exam');
    expect(exam?.fields.moa.value).toBe('Exam 3 wording');
    // The source defaults to the tag's own label, which for an exam is the
    // exam's name rather than a course's.
    expect(exam?.fields.moa.source).toBe('Heme/Onc Exam 3');
  });

  it('lets the narrowest one in scope win, and the widest fill the gaps', async () => {
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: COURSE,
      values: { moa: 'What the class says', bbw: 'What the class says about the warning' },
      source: '', note: '', userId: ME,
    });
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: EXAM,
      values: { moa: 'What the exam says' }, source: '', note: '', userId: ME,
    });

    // Asked in the wrong order on purpose: the loader takes the order from
    // `variantSlugsAmong`, so the exam wins wherever it speaks and the class
    // still answers everything the exam is silent about.
    const order = await variantSlugsAmong([EXAM, COURSE]);
    const [source] = await loadCardSources(order);

    expect(source.values.moa?.value).toBe('What the exam says');
    expect(source.values.bbw?.value).toBe('What the class says about the warning');
  });

  it('is still one card and one schedule, whichever kinds are in scope', async () => {
    await saveVariantLayer({
      drugSlug: 'levothyroxine', variantSlug: EXAM,
      values: { moa: 'What the exam says' }, source: '', note: '', userId: ME,
    });

    const plain = normalizeConfig({ ...DEFAULT_CONFIG, fields: ['moa'], sessionMode: 'cram' });
    const through = await loadDeck(ME, normalizeConfig({
      ...plain,
      scope: { ...DEFAULT_CONFIG.scope, tags: [EXAM] },
    }));

    expect(through.cards[0].cardKey).toBe(cardKey({
      mode: plain.mode, direction: plain.direction, fieldKeys: ['moa'],
    }));
  });
});
