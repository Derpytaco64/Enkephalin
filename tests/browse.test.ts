import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  brandIndications, drugBrands, drugIndications, drugTags, drugs, fieldDefs, tags, users,
} from '@/db/schema';
import { syncDrugs, type SeedDrug } from '@/lib/content/sync';
import { getDrugIndex } from '@/lib/drugs/browse';
import { saveVariantLayer } from '@/lib/drugs/variants';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { matchesTags, tagList } from '@/lib/tags/constants';
import {
  filterParams, filtersFrom, isFiltered, placeInList, selectDrugs,
  EMPTY_FILTERS, type DrugFilters,
} from '@/lib/drugs/filter';

beforeEach(async () => {
  await db.delete(brandIndications);
  await db.delete(drugTags);
  await db.delete(drugBrands);
  await db.delete(drugIndications);
  await db.delete(drugs);
  await db.delete(tags);
  await db.delete(fieldDefs);
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);

  const seed: SeedDrug[] = [
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
    {
      slug: 'lisinopril',
      generic: 'Lisinopril',
      drug_class: 'ACE Inhibitor',
      dosing: '10 mg by mouth once a day',
      // No mechanism recorded: a genuine gap.
      moa: '',
      bbw: '',
      bbw_status: 'none',
      brands: [{ id: 'l--b0', name: 'Zestril', family: 'Zestril' }],
      indications: [{ id: 'l--i0', text: 'Hypertension' }],
    },
    {
      slug: 'enalapril',
      generic: 'Enalapril',
      drug_class: 'ACE Inhibitor',
      dosing: '5 mg by mouth once a day',
      moa: 'ACE inhibition',
      bbw: '',
      bbw_status: 'none',
      needs_class_review: true,
      brands: [],
      indications: [],
    },
  ];

  await syncDrugs(seed);
});

async function rowFor(slug: string) {
  const { rows } = await getDrugIndex();
  return rows.find((row) => row.slug === slug)!;
}

describe('getDrugIndex', () => {
  it('reads the route out of the dosing text during the import', async () => {
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'alprazolam'));
    expect(drug.fields.route).toMatchObject({ value: 'Oral', source: 'the sheet dosing text' });
  });

  it('returns one row per drug with its brands, class and schedule', async () => {
    const { rows } = await getDrugIndex();

    expect(rows).toHaveLength(3);
    // Ordered by generic name, which is the order the page shows unfiltered.
    expect(rows.map((row) => row.slug)).toEqual(['alprazolam', 'enalapril', 'lisinopril']);

    const alprazolam = rows[0];
    expect(alprazolam.brands).toEqual(['Xanax']);
    expect(alprazolam.drugClass).toBe('Benzodiazepine');
    expect(alprazolam.schedule).toBe('CIV');
    expect(alprazolam.tags).toEqual(['top-drugs-2026']);
  });

  it('counts a gap as missing but an affirmed absence as not missing', async () => {
    // Lisinopril has no mechanism recorded and no black box warning. Only the
    // first is a gap: 147 drugs genuinely have no warning, and listing them as
    // missing one would bury the real work.
    const lisinopril = await rowFor('lisinopril');
    expect(lisinopril.missing).toEqual(['moa']);

    const alprazolam = await rowFor('alprazolam');
    expect(alprazolam.missing).toEqual([]);
  });

  it('calls a drug complete when every stored field has a value', async () => {
    // Nothing waits to be verified any more, so a filled profile is simply
    // complete: the rollup is about gaps and doubts, not signatures.
    expect((await rowFor('alprazolam')).review).toBe('ok');
  });

  it('reports gaps when a stored field has no value', async () => {
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'lisinopril'));
    expect(drug.fields.moa?.value ?? null).toBeNull();

    const row = await rowFor('lisinopril');
    expect(row.missing).toContain('moa');
    expect(row.review).toBe('gaps');
  });

  it('a flagged field outranks a gap in the rollup', async () => {
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'lisinopril'));
    await db
      .update(drugs)
      .set({ fields: { ...drug.fields, dosing: { ...drug.fields.dosing!, status: 'flagged' } } })
      .where(eq(drugs.id, drug.id));

    // A wrong answer in a deck costs more than a missing one, which simply
    // makes no card.
    expect((await rowFor('lisinopril')).review).toBe('flagged');
  });

  it('counts an affirmed absence as answered rather than as a gap', async () => {
    // Enalapril has dosing and moa filled and no warning at all.
    const enalapril = await rowFor('enalapril');
    expect(enalapril.missing).toEqual([]);
    expect(enalapril.review).toBe('ok');
  });

  it('surfaces the review queue as a flag on the row', async () => {
    expect((await rowFor('enalapril')).needsReview).toBe(true);
    expect((await rowFor('alprazolam')).needsReview).toBe(false);
  });

  it('carries the indications each drug treats, for the indication filter', async () => {
    expect((await rowFor('alprazolam')).indications).toEqual(['Anxiety']);
    expect((await rowFor('lisinopril')).indications).toEqual(['Hypertension']);
    expect((await rowFor('enalapril')).indications).toEqual([]);
  });

  it('sorts facets the way a person reads them, not by ASCII', async () => {
    // A default sort puts every lower-case initial after every upper-case one,
    // so "beta2-Adrenergic Agonist" would land past "Xanthine Oxidase
    // Inhibitor" in a list that is supposed to be alphabetical.
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'enalapril'));
    await db.update(drugs).set({ drugClass: 'beta2-Adrenergic Agonist' }).where(eq(drugs.id, drug.id));

    const { facets } = await getDrugIndex();
    expect(facets.classes).toEqual(['ACE Inhibitor', 'Benzodiazepine', 'beta2-Adrenergic Agonist']);
  });

  it('builds facets from what the data actually contains', async () => {
    const { facets } = await getDrugIndex();

    expect(facets.classes).toEqual(['ACE Inhibitor', 'Benzodiazepine']);
    expect(facets.indications).toEqual(['Anxiety', 'Hypertension']);
    expect(facets.schedules).toEqual(['CIV']);
    expect(facets.tags.map((tag) => tag.slug)).toEqual(['top-drugs-2026']);
    // Only the stored fields can be missing, so core fields stay out of the
    // missing-field filter.
    expect(facets.fields.map((field) => field.key))
      .toEqual(['route', 'dosing', 'regimen', 'moa', 'bbw']);
  });

  it('leaves a soft-deleted field out of the facets and the gap count', async () => {
    await db.update(fieldDefs).set({ deletedAt: new Date() }).where(eq(fieldDefs.key, 'moa'));

    const { rows, facets } = await getDrugIndex();
    expect(facets.fields.map((field) => field.key)).toEqual(['route', 'dosing', 'regimen', 'bbw']);
    expect(rows.find((row) => row.slug === 'lisinopril')!.missing).toEqual([]);
  });

});

/* ------------------------------------------- what a class words differently -- */

describe('a class’s own wording in the index', () => {
  const CLASS = 'phrm-535';
  const ME = 'admin-id';

  beforeEach(async () => {
    await db.delete(users);
    await db.insert(users).values({ id: ME, email: 'me@example.test', role: 'admin' });

    const [tag] = await db
      .insert(tags)
      .values({ slug: CLASS, label: 'PHRM 535', kind: 'course' })
      .returning({ id: tags.id });
    const [alprazolam] = await db.select().from(drugs).where(eq(drugs.slug, 'alprazolam'));
    await db.insert(drugTags).values({ drugId: alprazolam.id, tagId: tag.id });

    await saveVariantLayer({
      drugSlug: 'alprazolam',
      variantSlug: CLASS,
      values: { moa: 'Enhances GABAergic inhibition, causing **pyrexia** rarely' },
      source: '',
      note: '',
      userId: ME,
    });
  });

  it('carries the layer’s text, so the search box can reach it', async () => {
    const { rows } = await getDrugIndex();
    const [alprazolam] = rows.filter((row) => row.slug === 'alprazolam');

    expect(alprazolam.variants).toHaveLength(1);
    const [variant] = alprazolam.variants;
    // V-2: the first class with wording of its own is the drug's second
    // version, the drug's own profile being V-1.
    expect(variant).toMatchObject({ slug: CLASS, label: 'PHRM 535', n: 2 });
    // Flattened by the same `formatFieldValue` and `flatten` the drug's own
    // values go through, markdown markers and all -- so a word is findable
    // whoever wrote it, and neither is findable across a `**`.
    expect(variant.values.moa).toContain('pyrexia');
    expect(variant.values.moa).toBe('Enhances GABAergic inhibition, causing **pyrexia** rarely');
  });

  it('carries only the fields that version words its own way', async () => {
    const { rows } = await getDrugIndex();
    const [variant] = rows.filter((row) => row.slug === 'alprazolam')[0].variants;

    // The class said nothing about the black box warning, so the layer holds
    // nothing for it -- an absent key is "the same as the drug's", and copying
    // the drug's text in would make every search hit look like the class's.
    expect(Object.keys(variant.values)).toEqual(['moa']);
    expect(rows.filter((row) => row.slug === 'alprazolam')[0].values.bbw)
      .toContain('concomitant opioid');
  });

  it('leaves the drug’s own values alone', async () => {
    const { rows } = await getDrugIndex();
    const [alprazolam] = rows.filter((row) => row.slug === 'alprazolam');

    // The whole promise of a layer: the drug still says what it said, so a
    // search for the curated wording still finds it as the drug's own.
    expect(alprazolam.values.moa).toBe('GABA-A positive allosteric modulator');
  });

  it('gives a drug with no versions an empty list rather than nothing', async () => {
    const { rows } = await getDrugIndex();
    expect(rows.filter((row) => row.slug === 'lisinopril')[0].variants).toEqual([]);
  });
});

describe('filtering the list by several tags', () => {
  const TOP = 'top-drugs-2026';
  const CLASS = 'phrm-535';
  const EXAM = 'heme-onc-exam-3';

  it('reads two tags as the drugs on both', () => {
    // The ask, in the owner's words: "top drugs 2026 && heme/onc".
    expect(matchesTags([TOP, EXAM], [TOP, EXAM])).toBe(true);
    expect(matchesTags([TOP], [TOP, EXAM])).toBe(false);
    expect(matchesTags([EXAM], [TOP, EXAM])).toBe(false);
  });

  it('takes either when asked for any of them', () => {
    expect(matchesTags([TOP], [TOP, EXAM], 'any')).toBe(true);
    expect(matchesTags([EXAM], [TOP, EXAM], 'any')).toBe(true);
    expect(matchesTags([CLASS], [TOP, EXAM], 'any')).toBe(false);
  });

  it('means the same thing either way with one tag picked', () => {
    // Which is what lets the default stay unspelled in the URL: every `?tag=x`
    // link written before the axis went multiple still means what it did.
    for (const mode of ['all', 'any'] as const) {
      expect(matchesTags([TOP, CLASS], [TOP], mode)).toBe(true);
      expect(matchesTags([CLASS], [TOP], mode)).toBe(false);
    }
  });

  it('matches every drug when nothing is picked', () => {
    expect(matchesTags([], [])).toBe(true);
    expect(matchesTags([TOP], [], 'any')).toBe(true);
  });

  it('reads the comma spelling the URL carries, and tolerates its edges', () => {
    expect(tagList(`${TOP},${EXAM}`)).toEqual([TOP, EXAM]);
    expect(tagList(TOP)).toEqual([TOP]);
    // An empty parameter and a trailing comma both arrive from the rail as a
    // tag is removed, and neither is a filter.
    expect(tagList('')).toEqual([]);
    expect(tagList(`,${TOP},`)).toEqual([TOP]);
  });

  it('agrees with the index rows it filters', async () => {
    // The predicate is only right if the slugs it compares are the slugs the
    // rows actually carry, so this one goes through the real index rather than
    // trusting two string arrays.
    const { rows } = await getDrugIndex();
    const tagged = rows.filter((row) => row.tags.length > 0);
    expect(tagged.length).toBeGreaterThan(0);

    for (const row of tagged) {
      expect(matchesTags(row.tags, row.tags)).toBe(true);
      expect(matchesTags(row.tags, [...row.tags, 'a-tag-nothing-carries'])).toBe(false);
      expect(matchesTags(row.tags, [...row.tags, 'a-tag-nothing-carries'], 'any')).toBe(true);
    }
  });
});

/**
 * Paging from one drug to the next one in the list you were looking at.
 *
 * *Filter to an exam, open the third drug, then page to the second and the
 * fourth* -- the owner's ask, 2026-11-16. The reason this is the rail's own
 * filter function rather than a query of its own: a second idea of "which
 * drugs are showing" would page through a slightly different list than the one
 * that was clicked.
 */
describe('paging through the filtered list', () => {
  const filters = (partial: Partial<DrugFilters> = {}): DrugFilters =>
    ({ ...EMPTY_FILTERS, ...partial });

  it('walks the filtered list, and says where in it you are', async () => {
    const { rows } = await getDrugIndex();
    // The two ACE inhibitors, alphabetically: enalapril then lisinopril.
    const picked = filters({ drugClass: 'ACE' });

    expect(selectDrugs(rows, picked).map((row) => row.slug))
      .toEqual(['enalapril', 'lisinopril']);

    const first = placeInList(rows, picked, 'enalapril');
    expect(first).toMatchObject({
      at: 1,
      total: 2,
      prev: null,
      next: { slug: 'lisinopril', generic: 'Lisinopril' },
    });

    const second = placeInList(rows, picked, 'lisinopril');
    expect(second).toMatchObject({
      at: 2,
      total: 2,
      prev: { slug: 'enalapril', generic: 'Enalapril' },
      next: null,
    });
  });

  it('does not wrap around at either end', () => {
    // Arriving back at the first drug after the last reads as a bug the first
    // time it happens, and the ends of a list are information: *this is the
    // last one* is worth knowing when you are working through an exam.
    expect(placeInList([], filters({ drugClass: 'ACE' }), 'enalapril')).toBeNull();
  });

  it('refuses to place a drug the filter does not select', async () => {
    // A link can be edited and a drug can be untagged after the link was made.
    // A pager claiming *4 of 90* on a drug that is not one of the 90 would be
    // worse than no pager at all.
    const { rows } = await getDrugIndex();
    expect(placeInList(rows, filters({ drugClass: 'ACE' }), 'alprazolam')).toBeNull();
  });

  it('has nothing to page through in a list of one', async () => {
    const { rows } = await getDrugIndex();
    expect(placeInList(rows, filters({ schedule: 'CIV' }), 'alprazolam')).toBeNull();
  });

  it('is off entirely when no filter is on', () => {
    // All 523 drugs in alphabetical order is not a list somebody chose, so the
    // profile does not offer to page through it -- and does not pay for the
    // index read either.
    expect(isFiltered(filters())).toBe(false);
    expect(isFiltered(filters({ tag: 'top-drugs-2026' }))).toBe(true);
  });

  it('survives the round trip through a URL, which is where it travels', () => {
    const picked = filters({ tag: 'top-drugs-2026,heme-onc-exam-3', q: 'ace', tagsAny: '1' });
    const params = filterParams(picked);

    expect(params.get('tag')).toBe('top-drugs-2026,heme-onc-exam-3');
    expect(params.get('tagsany')).toBe('1');
    // Unset filters leave nothing behind, which is what keeps a row link short
    // and a bookmark readable.
    expect(params.has('class')).toBe(false);
    expect(filtersFrom((param) => params.get(param))).toEqual(picked);
  });

  it('walks the list the rail drew, search ranking included', async () => {
    // The invariant the whole thing rests on, asserted over every position
    // rather than at one of them: a search *ranks* its results, so the pager
    // has to step through that ranking and not a tidier alphabetical one. Any
    // disagreement here is an arrow that goes somewhere the screen did not.
    const { rows } = await getDrugIndex();
    const picked = filters({ q: 'ACE' });
    const list = selectDrugs(rows, picked);

    expect(list.length).toBeGreaterThan(1);
    list.forEach((row, at) => {
      const place = placeInList(rows, picked, row.slug)!;
      expect(place.at).toBe(at + 1);
      expect(place.total).toBe(list.length);
      expect(place.prev?.slug ?? null).toBe(list[at - 1]?.slug ?? null);
      expect(place.next?.slug ?? null).toBe(list[at + 1]?.slug ?? null);
    });
  });
});
