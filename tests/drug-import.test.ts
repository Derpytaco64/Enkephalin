import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  drugBrands, drugIndications, drugTags, drugVariantValues, drugs, fieldDefs, indications,
  tags, users, type FieldValue,
} from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import {
  applyFieldMap, IMPORT_FORMAT, parseDrugImport, regimenFieldFor, renderRegimen,
  TARGET_DRUG, TARGET_UNDECIDED, type ImportValue,
} from '@/lib/drugs/import-format';
import { formatFieldValue } from '@/lib/fields/format';
import { applyDrugImport, planDrugImport } from '@/lib/drugs/import';
import {
  membershipVariants, numberedVariantsByDrug, variantLayerFor, variantOptionsFor,
} from '@/lib/drugs/variants';

/**
 * Importing what a lecture says about drugs.
 *
 * Two halves, and they are tested as two: the format refuses what it cannot
 * read without touching the database, and the importer decides where a value
 * goes by what the database already holds.
 *
 * The thing most of these are really about is the promise on the screen:
 * **nothing is overwritten**. A lecture fills gaps on the drug itself, and
 * where it disagrees with what is already recorded it says so as *what this
 * class says* -- which is a variant layer, not a replacement. A file that
 * quietly rewrote a curated profile would be worse than no importer.
 */

const ME = 'admin-id';

/** A minimal valid file, with whatever this test needs merged over it. */
function file(partial: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: IMPORT_FORMAT,
    scope: { course: 'PHRM 535', exam: 'Heme/Onc Exam 3' },
    source: { file: '16.Melanoma.pdf' },
    drugs: [{ generic: 'nivolumab' }],
    ...partial,
  });
}

/** Parses, and fails loudly rather than returning a union the test has to narrow. */
function read(text: string) {
  const parsed = parseDrugImport(text);
  if (!parsed.ok) throw new Error(`refused: ${JSON.stringify(parsed.problems)}`);
  return parsed.file;
}

function problems(text: string) {
  const parsed = parseDrugImport(text);
  if (parsed.ok) throw new Error('expected a refusal');
  return parsed.problems.map((problem) => `${problem.where}: ${problem.message}`).join(' | ');
}

/* ------------------------------------------------------------- the format -- */

describe('reading a file', () => {
  it('refuses a format it does not know', () => {
    expect(problems(JSON.stringify({ format: 'enkephalin.set/1' }))).toContain(IMPORT_FORMAT);
  });

  it('refuses text that is not JSON at all', () => {
    expect(problems('# Melanoma\n\nNivolumab is a PD-1 inhibitor')).toContain('not valid JSON');
  });

  it('refuses a file with nowhere to put anything', () => {
    expect(problems(file({ scope: {} }))).toContain('nowhere to land');
    expect(problems(file({ drugs: [] }))).toContain('nothing to import');
  });

  it('reads the scope widest first, however it was written', () => {
    const read1 = read(file({ scope: { exam: 'Exam 3', course: 'PHRM 535' } }));
    // Class then exam is the overlay order, and the file's key order is not
    // allowed to change it -- the narrowest has to end up last.
    expect(read1.scope).toEqual([
      { kind: 'course', label: 'PHRM 535' },
      { kind: 'exam', label: 'Exam 3' },
    ]);
  });

  it('refuses a topic scope rather than dropping it', () => {
    // An author working from an older copy of the guide would otherwise watch
    // a scope they wrote disappear without a word. What a lecture is *about*
    // is an indication, which is already a field.
    const refusal = problems(file({ scope: { course: 'PHRM 535', topic: 'Melanoma' } }));
    expect(refusal).toContain('indications');
  });

  it('tells absent, none and blank apart', () => {
    const parsed = read(file({
      drugs: [{ generic: 'nivolumab', fields: { bbw: null, moa: 'PD-1 inhibitor' } }],
    }));

    // Omitted: not in `fields` at all, so the importer never speaks about it.
    expect(parsed.drugs[0].fields.dosing).toBeUndefined();
    // null: the deck says there is none, which is an answer.
    expect(parsed.drugs[0].fields.bbw).toEqual({ value: null, status: 'none', source: null });
    expect(parsed.drugs[0].fields.moa.value).toBe('PD-1 inhibitor');

    // An empty string is neither, and is the one shape that would be read as a
    // fact if it were allowed through.
    expect(problems(file({ drugs: [{ generic: 'nivolumab', fields: { moa: '' } }] })))
      .toContain('neither "none" nor "not said"');
  });

  it('keeps a flagged value, and refuses a status it does not know', () => {
    const parsed = read(file({
      drugs: [{ generic: 'nivolumab', fields: { dosing: { value: '240 mg IV q2w', status: 'flagged' } } }],
    }));
    expect(parsed.drugs[0].fields.dosing.status).toBe('flagged');

    expect(problems(file({
      drugs: [{ generic: 'nivolumab', fields: { dosing: { value: 'x', status: 'unsure' } } }],
    }))).toContain('not a status');
  });

  it('sends a core field to the key that owns it', () => {
    const refusal = problems(file({
      drugs: [{ generic: 'nivolumab', fields: { brand: 'Opdivo', indication: 'melanoma' } }],
    }));
    expect(refusal).toContain(`Use the drug's "brands" key`);
    expect(refusal).toContain(`Use the drug's "indications" key`);
  });

  it('refuses two entries for one drug', () => {
    expect(problems(file({ drugs: [{ generic: 'nivolumab' }, { generic: 'Nivolumab' }] })))
      .toContain('appears 2 times');
  });

  it('refuses a drug with no name, and a regimen with one member', () => {
    expect(problems(file({ drugs: [{ brands: ['Opdivo'] }] }))).toContain('needs a generic name');
    expect(problems(file({
      regimens: [{ name: 'Nivolumab alone', components: [{ drug: 'nivolumab' }] }],
    }))).toContain('at least two components');
  });

  it('refuses a declared field whose key could not key anything', () => {
    expect(problems(file({ declare: [{ key: 'Adverse Effects', label: 'AE', type: 'markdown' }] })))
      .toContain('snake_case');
    expect(problems(file({ declare: [{ key: 'ae', label: 'AE', type: 'prose' }] })))
      .toContain('not a field type');
    // "boolean" is the plausible wrong spelling, and the guide used to print
    // it. The refusal lists the real types, so the fix is in the message.
    const said = problems(file({ declare: [{ key: 'ae', label: 'AE', type: 'boolean' }] }));
    expect(said).toContain('not a field type');
    expect(said).toContain('bool');
  });
});

/* --- a list-typed field, which the file may write either way --- */

/** The one drug, with whatever this test puts in `route`. */
const withRoute = (route: unknown) =>
  file({ drugs: [{ generic: 'nivolumab', fields: { route } }] });

const routeOf = (text: string) => read(text).drugs[0].fields.route;

describe('a route, written as a string or as a list', () => {
  // `route` is list-typed, and it is the only list-typed field that lives in
  // `fields` -- `brand` and `indication` are columns of their own, which the
  // file has always taken as arrays at the drug level. So this is the one place
  // the two spellings could disagree, and the reason they no longer do.

  it('takes a single route as a plain string', () => {
    expect(routeOf(withRoute('IV'))).toEqual({ value: 'IV', status: 'ok', source: null });
  });

  it('takes a single route as a one-item list, and stores the same bytes', () => {
    // Which is what lets a file be rewritten from one spelling to the other
    // without the next import reporting an override. Identical, not merely
    // equivalent.
    expect(routeOf(withRoute(['IV']))).toEqual(routeOf(withRoute('IV')));
  });

  it('folds several routes into the one string the column holds', () => {
    // Newline, because that is what the drug form writes when a person types a
    // list by hand -- so an imported route and an authored one are the same
    // value and the textarea shows it back unchanged.
    expect(routeOf(withRoute(['IV', 'PO'])).value).toBe('IV\nPO');
  });

  it('reads back as a list of items either way', () => {
    const def = { key: 'route', dataType: 'list', blankMeansNone: false } as never;
    const shown = (value: ImportValue) =>
      formatFieldValue(def, { ...value, updatedAt: '', updatedBy: null });

    expect(shown(routeOf(withRoute(['IV', 'PO'])))).toEqual({ kind: 'list', items: ['IV', 'PO'] });
    expect(shown(routeOf(withRoute('IV; PO')))).toEqual({ kind: 'list', items: ['IV', 'PO'] });
  });

  it('still says a drug has no route at all', () => {
    expect(routeOf(withRoute(null))).toEqual({ value: null, status: 'none', source: null });
  });

  it('takes a list inside the envelope, with its status and source', () => {
    expect(routeOf(withRoute({ value: ['IV', 'PO'], status: 'flagged', source: 'slide 12' })))
      .toEqual({ value: 'IV\nPO', status: 'flagged', source: 'slide 12' });
  });

  it('refuses a type it cannot use, naming the drug and what arrived', () => {
    // The refusal has to name the drug: a file holds twenty of them and "a
    // value is the wrong type" would send the author looking through all of it.
    for (const bad of [42, true]) {
      const said = problems(withRoute(bad));
      expect(said).toContain('(nivolumab).fields.route');
      expect(said).toContain('a list of strings');
    }
    expect(problems(withRoute(42))).toContain('This is a number.');
    expect(problems(withRoute({ value: 42 }))).toContain('(nivolumab).fields.route');
  });

  it('refuses an item that is not a string, saying which item', () => {
    expect(problems(withRoute(['IV', 7]))).toContain('Item 2 of this list is a number');
    expect(problems(withRoute(['IV', '  ']))).toContain('Item 2 of this list is an empty string');
    expect(problems(withRoute(['IV', null]))).toContain('Item 2 of this list is null');
  });

  it('refuses an empty list the same way it refuses an empty string', () => {
    // Both say neither "none" nor "not said", and the whole field system turns
    // on telling those apart.
    expect(problems(withRoute([]))).toContain('neither "none" nor "not said"');
    expect(problems(withRoute(''))).toContain('neither "none" nor "not said"');
  });

  it('refuses a type it cannot use rather than dropping the field', () => {
    // The point of the refusal: a bad route must not leave a file that imports
    // cleanly with the route missing from every drug in it.
    const parsed = parseDrugImport(withRoute(42));
    expect(parsed.ok).toBe(false);
  });
});

/* ----------------------------------------------------------- the regimens -- */

describe('writing a regimen out', () => {
  const regimen = {
    name: 'Ipilimumab + nivolumab',
    when: 'Stage IV initial therapy, NCCN preferred.',
    components: [
      { drug: 'ipilimumab', dose: '3 mg/kg IV q3w x 4', role: 'component' as const },
      { drug: 'nivolumab', dose: '1 mg/kg IV q3w x 4, then 240 mg q2w', role: 'component' as const },
    ],
    flow: '- BRAF V600E?\n  - No -> ICI',
    notes: '72.1 month median OS.',
    source: null,
  };

  it('marks the drug whose profile it is on', () => {
    const text = renderRegimen(regimen, 'nivolumab');

    expect(text).toContain('### Ipilimumab + nivolumab');
    expect(text).toContain('- nivolumab — 1 mg/kg IV q3w x 4, then 240 mg q2w ← this drug');
    expect(text).toContain('- ipilimumab — 3 mg/kg IV q3w x 4');
    expect(text).not.toContain('ipilimumab — 3 mg/kg IV q3w x 4 ← this drug');
    // The decision that chooses it, kept as the nested list it was written as.
    expect(text).toContain('- BRAF V600E?\n  - No -> ICI');
  });

  it('names a role that is not just being a component', () => {
    const text = renderRegimen({
      ...regimen,
      components: [
        { drug: 'cyclophosphamide', dose: '60 mg/kg x 2 days', role: 'lymphodepletion' as const },
        { drug: 'lifileucel', dose: 'one infusion', role: 'component' as const },
      ],
    }, 'cyclophosphamide');

    expect(text).toContain('- cyclophosphamide — 60 mg/kg x 2 days — (lymphodepletion) ← this drug');
  });

  it('puts the drug’s own regimen text first, and leaves a drug in none alone', () => {
    const drug = {
      generic: 'nivolumab', aliases: [], brands: [], indications: [],
      drugClass: null, schedule: null, source: null,
      fields: { regimen: { value: 'Given alone as well.', status: 'ok' as const, source: null } },
    };

    const composed = regimenFieldFor(drug, [regimen]);
    expect(composed?.indexOf('Given alone as well.')).toBe(0);
    expect(composed).toContain('### Ipilimumab + nivolumab');

    // A drug in no regimen keeps whatever it said, and a drug with nothing to
    // say gets nothing written -- blank means "in no named protocol" here.
    expect(regimenFieldFor({ ...drug, generic: 'metformin' }, [regimen]))
      .toBe('Given alone as well.');
    expect(regimenFieldFor({ ...drug, generic: 'metformin', fields: {} }, [regimen])).toBeNull();
  });
});

/* ------------------------------------------------------------ the writing -- */

const value = (text: string): FieldValue => ({
  value: text, status: 'ok', source: 'class sheet', updatedAt: '', updatedBy: null,
});

beforeEach(async () => {
  await db.delete(drugTags);
  await db.delete(drugBrands);
  await db.delete(drugIndications);
  await db.delete(drugVariantValues);
  await db.delete(drugs);
  await db.delete(indications);
  await db.delete(tags);
  await db.delete(fieldDefs);
  await db.delete(users);

  await db.insert(users).values({ id: ME, email: 'me@example.test', role: 'admin' });
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);

  // One drug the app already knows, as the sheet left it: a mechanism recorded
  // and no black box warning either way.
  const [existing] = await db.insert(drugs).values({
    slug: 'dacarbazine',
    genericName: 'Dacarbazine',
    drugClass: 'Alkylating agent',
    fields: { moa: value('Alkylates DNA') },
  }).returning({ id: drugs.id });

  await db.insert(drugBrands).values({
    drugId: existing.id, name: 'DTIC-Dome', family: 'DTIC-Dome', sortOrder: 0,
  });
  const [list] = await db
    .insert(tags)
    .values({ slug: 'top-drugs-2026', label: 'Top Drugs 2026', kind: 'top_list' })
    .returning({ id: tags.id });
  await db.insert(drugTags).values({ drugId: existing.id, tagId: list.id });
});

const apply = async (text: string, map: Record<string, string> = {}) => {
  // The map is what the import screen's dropdowns send: a declared field going
  // to one the app already has. Applied before the planner sees the file, so
  // the import is simply an import of a file with the right keys in it.
  const mapped = applyFieldMap(read(text), map);
  if (!mapped.ok) throw new Error(`refused: ${JSON.stringify(mapped.problems)}`);

  const result = await applyDrugImport(mapped.file, ME);
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.problems)}`);
  return result.report;
};

describe('a drug the app has never held', () => {
  it('is created, with its brands, its indications and the scope’s tags', async () => {
    const report = await apply(file({
      drugs: [{
        generic: 'nivolumab',
        brands: ['Opdivo'],
        indications: ['Unresectable or metastatic melanoma'],
        class: 'PD-1 blocking antibody',
        fields: { moa: 'PD-1 inhibitor', bbw: null },
      }],
    }));

    expect(report.created).toEqual(['nivolumab']);
    expect(report.tagsCreated).toEqual(['phrm-535', 'heme-onc-exam-3']);

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'nivolumab'));
    expect(drug.drugClass).toBe('PD-1 blocking antibody');
    // Everything a new drug brings is its own: there is nothing to differ from,
    // and a new drug whose mechanism lived only in a class layer would read as
    // an empty profile.
    expect(drug.fields.moa.value).toBe('PD-1 inhibitor');
    expect(drug.fields.moa.source).toBe('from PHRM 535 content');
    // null in the file is "there is none", which is an answer and is quizzed.
    expect(drug.fields.bbw).toEqual(expect.objectContaining({ value: null, status: 'none' }));

    const brands = await db.select().from(drugBrands).where(eq(drugBrands.drugId, drug.id));
    expect(brands.map((brand) => brand.name)).toEqual(['Opdivo']);

    const tagSlugs = (await db
      .select({ slug: tags.slug })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId))
      .where(eq(drugTags.drugId, drug.id))).map((row) => row.slug);
    expect(tagSlugs.sort()).toEqual(['heme-onc-exam-3', 'phrm-535']);
  });

  it('is matched by a brand name rather than created twice', async () => {
    const plan = await planDrugImport(read(file({
      drugs: [{ generic: 'DTIC-Dome', fields: { moa: 'Alkylates DNA' } }],
    })));

    expect(plan.drugs[0].exists).toBe(true);
    expect(plan.drugs[0].generic).toBe('Dacarbazine');
  });
});

describe('a drug the app already holds', () => {
  it('fills a gap on the drug itself', async () => {
    const report = await apply(file({
      drugs: [{ generic: 'dacarbazine', fields: { dosing: '850 mg/m2 IV every 3 weeks' } }],
    }));

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'dacarbazine'));
    expect(drug.fields.dosing.value).toBe('850 mg/m2 IV every 3 weeks');
    expect(report.toDrug).toBe(1);
    expect(report.toVariant).toBe(0);
  });

  it('never overwrites a value it disagrees with — that becomes what the class says', async () => {
    const report = await apply(file({
      drugs: [{ generic: 'dacarbazine', fields: { moa: 'Prodrug; methylates DNA at O6-guanine' } }],
    }));

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'dacarbazine'));
    // The promise on the screen, as a test.
    expect(drug.fields.moa.value).toBe('Alkylates DNA');
    expect(report.toVariant).toBe(1);

    // The narrowest scope holds it: an exam's wording beats the class's, and
    // the file named both.
    const layer = await variantLayerFor(drug.id, 'heme-onc-exam-3');
    expect(layer?.fields.moa.value).toBe('Prodrug; methylates DNA at O6-guanine');
    // The class and nothing else: this line is read once per field, and
    // fourteen copies of a file name is noise shaped like information.
    expect(layer?.fields.moa.source).toBe('from PHRM 535 content');
    // The file name is not lost, it is recorded once -- on the layer.
    expect(layer?.note).toContain('16.Melanoma.pdf');
  });

  it('counts a value it already holds word for word, and writes nothing', async () => {
    const report = await apply(file({
      drugs: [{ generic: 'dacarbazine', fields: { moa: 'Alkylates DNA' } }],
    }));

    expect(report.unchanged).toBe(1);
    expect(report.toDrug).toBe(0);
    expect(await db.select().from(drugVariantValues)).toHaveLength(0);
  });

  it('overwrites only when the file says base, which is how the app is corrected', async () => {
    await apply(file({
      write: 'base',
      drugs: [{ generic: 'dacarbazine', fields: { moa: 'Prodrug; methylates DNA' } }],
    }));

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'dacarbazine'));
    expect(drug.fields.moa.value).toBe('Prodrug; methylates DNA');
    expect(await db.select().from(drugVariantValues)).toHaveLength(0);
  });

  it('puts everything in the layer when the file says variant', async () => {
    await apply(file({
      write: 'variant',
      drugs: [{ generic: 'dacarbazine', fields: { dosing: '850 mg/m2 IV q3w' } }],
    }));

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'dacarbazine'));
    // A gap on the drug stays a gap: `variant` means this reading is the
    // class's, not the app's.
    expect(drug.fields.dosing).toBeUndefined();
    expect((await variantLayerFor(drug.id, 'heme-onc-exam-3'))?.fields.dosing.value)
      .toBe('850 mg/m2 IV q3w');
  });

  it('keeps the tags it already had', async () => {
    await apply(file({ drugs: [{ generic: 'dacarbazine' }] }));

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'dacarbazine'));
    const tagSlugs = (await db
      .select({ slug: tags.slug })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId))
      .where(eq(drugTags.drugId, drug.id))).map((row) => row.slug);

    // The union, not the scope: an import must not take a drug off a drug list
    // for being in a lecture.
    expect(tagSlugs.sort()).toEqual(['heme-onc-exam-3', 'phrm-535', 'top-drugs-2026']);
  });

  it('leaves another lecture’s layer values alone', async () => {
    // Both in `variant` mode, so both writes land in the layer: the second
    // file speaks about one field and says nothing at all about the first's.
    await apply(file({
      write: 'variant',
      drugs: [{ generic: 'dacarbazine', fields: { moa: 'What this class says' } }],
    }));
    await apply(file({
      write: 'variant',
      drugs: [{ generic: 'dacarbazine', fields: { dosing: '850 mg/m2 IV q3w' } }],
    }));

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'dacarbazine'));
    const layer = await variantLayerFor(drug.id, 'heme-onc-exam-3');
    // A patch, not a replacement: the second import spoke about one field and
    // must not clear the first one's.
    expect(layer?.fields.moa.value).toBe('What this class says');
    expect(layer?.fields.dosing.value).toBe('850 mg/m2 IV q3w');
  });
});

describe('what a lecture needs that the app has not got', () => {
  it('declares a field and writes to it in one pass', async () => {
    const report = await apply(file({
      declare: [{
        key: 'ae', label: 'Adverse effects', type: 'markdown', group: 'Clinical',
        prompt: 'What are the notable adverse effects of {{generic}}?',
      }],
      drugs: [{ generic: 'nivolumab', fields: { ae: '- Diarrhoea 19%\n- Rash 26%' } }],
    }));

    expect(report.fieldsDeclared).toEqual(['ae']);
    const [def] = await db.select().from(fieldDefs).where(eq(fieldDefs.key, 'ae'));
    expect(def.label).toBe('Adverse effects');
    // A lecture's field is not one of the sheet's columns, so no program year
    // is responsible for it and no year preset should tick it.
    expect(def.yearLevels).toEqual([]);

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'nivolumab'));
    expect(drug.fields.ae.value).toContain('Diarrhoea 19%');
  });

  it('refuses a field key nobody declared, and writes nothing at all', async () => {
    const result = await applyDrugImport(read(file({
      drugs: [
        { generic: 'nivolumab', fields: { moa: 'PD-1 inhibitor' } },
        { generic: 'ipilimumab', fields: { toxicity: 'Colitis' } },
      ],
    })), ME);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].message).toContain('No field has that key');
    // Not one drug of the two: half an import is the state nobody can reason
    // about afterwards.
    expect(await db.select().from(drugs)).toHaveLength(1);
  });

  it('refuses a regimen naming a drug it has never heard of', async () => {
    const plan = await planDrugImport(read(file({
      drugs: [{ generic: 'nivolumab' }],
      regimens: [{
        name: 'Nivolumab + relatlimab',
        components: [{ drug: 'nivolumab' }, { drug: 'relatlimab' }],
      }],
    })));

    expect(plan.problems[0].message).toContain('neither in this file nor in the app');
  });
});

describe('a regimen across the drugs in it', () => {
  it('lands on every member, with each one’s own dose marked', async () => {
    await apply(file({
      drugs: [{ generic: 'dabrafenib' }, { generic: 'trametinib' }],
      regimens: [{
        name: 'Dabrafenib + trametinib',
        when: 'BRAF V600E positive.',
        components: [
          { drug: 'dabrafenib', dose: '150 mg PO twice daily' },
          { drug: 'trametinib', dose: '2 mg PO daily' },
        ],
        flow: '- BRAF V600E?\n  - No -> an ICI instead',
      }],
    }));

    const rows = await db.select().from(drugs);
    const dabrafenib = rows.find((row) => row.slug === 'dabrafenib');
    const trametinib = rows.find((row) => row.slug === 'trametinib');

    expect(dabrafenib?.fields.regimen.value).toContain('150 mg PO twice daily ← this drug');
    expect(dabrafenib?.fields.regimen.value).toContain('BRAF V600E positive.');
    expect(trametinib?.fields.regimen.value).toContain('2 mg PO daily ← this drug');
    // The same protocol on both, so searching its name finds either -- which
    // is the trade for composing it rather than storing it once.
    expect(trametinib?.fields.regimen.value).toContain('### Dabrafenib + trametinib');
  });
});

describe('the preview', () => {
  it('says where each value would go before anything is written', async () => {
    const plan = await planDrugImport(read(file({
      drugs: [{
        generic: 'dacarbazine',
        fields: { moa: 'Prodrug; methylates DNA', dosing: '850 mg/m2 IV q3w' },
      }],
    })));

    expect(plan.provenance).toBe('from PHRM 535 content');
    expect(plan.variant).toEqual({ slug: 'heme-onc-exam-3', label: 'Heme/Onc Exam 3' });
    expect(plan.drugs[0].writes).toEqual([
      // What it would replace, which is the one question a preview answers.
      expect.objectContaining({ key: 'moa', to: 'variant', from: 'Alkylates DNA' }),
      expect.objectContaining({ key: 'dosing', to: 'drug', from: null }),
    ]);

    // And it wrote nothing.
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'dacarbazine'));
    expect(drug.fields.dosing).toBeUndefined();
  });
});

/* -------------------------------------------------- where a new field goes -- */

describe('a field the file asks for', () => {
  /** The declaration the melanoma deck actually needs. */
  const asking = (key: string, label: string) => ({
    declare: [{ key, label, type: 'markdown' }],
    drugs: [{ generic: 'dacarbazine', fields: { [key]: 'Myelosuppression, nausea' } }],
  });

  it('suggests the existing field whose name looks like it', async () => {
    await db.insert(fieldDefs).values({
      key: 'adverse_effects', label: 'Adverse effects', dataType: 'markdown',
      sortOrder: 90, group: 'Clinical',
    });

    const plan = await planDrugImport(read(file(asking('ae', 'Adverse effects'))));
    const [asked] = plan.declare;

    expect(asked).toEqual({
      key: 'ae', label: 'Adverse effects', exists: false, suggest: 'adverse_effects',
    });
    // And the whole field set is offered, so the suggestion can be overruled.
    expect(plan.assignable.map((field) => field.key)).toContain('adverse_effects');
  });

  it('suggests nothing when nothing resembles it', async () => {
    const plan = await planDrugImport(read(file(asking('ae', 'Adverse effects'))));
    expect(plan.declare[0].suggest).toBeNull();
  });

  it('sends its values to the field it is mapped onto, and declares nothing', async () => {
    await db.insert(fieldDefs).values({
      key: 'adverse_effects', label: 'Adverse effects', dataType: 'markdown',
      sortOrder: 90, group: 'Clinical',
    });

    const mapped = applyFieldMap(read(file(asking('ae', 'Adverse effects'))), {
      ae: 'adverse_effects',
    });
    if (!mapped.ok) throw new Error(JSON.stringify(mapped.problems));

    // The request is gone -- the field exists already -- and the values moved.
    expect(mapped.file.declare).toEqual([]);
    expect(mapped.file.drugs[0].fields.ae).toBeUndefined();
    expect(mapped.file.drugs[0].fields.adverse_effects.value).toBe('Myelosuppression, nausea');

    const report = await apply(file(asking('ae', 'Adverse effects')), { ae: 'adverse_effects' });
    expect(report.fieldsDeclared).toEqual([]);

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'dacarbazine'));
    expect(drug.fields.adverse_effects.value).toBe('Myelosuppression, nausea');
    expect(drug.fields.ae).toBeUndefined();
  });

  it('creates it when it is not mapped anywhere', async () => {
    const report = await apply(file(asking('ae', 'Adverse effects')));

    expect(report.fieldsDeclared).toEqual(['ae']);
    const [def] = await db.select().from(fieldDefs).where(eq(fieldDefs.key, 'ae'));
    expect(def.label).toBe('Adverse effects');
  });

  it('refuses a map onto a core field', () => {
    const mapped = applyFieldMap(read(file(asking('ae', 'Adverse effects'))), { ae: 'brand' });

    expect(mapped.ok).toBe(false);
    if (mapped.ok) return;
    expect(mapped.problems[0].message).toContain('core field');
  });

  it('refuses two of its fields onto one', () => {
    const asked = read(file({
      declare: [
        { key: 'ae', label: 'Adverse effects', type: 'markdown' },
        { key: 'tox', label: 'Toxicity', type: 'markdown' },
      ],
      drugs: [{ generic: 'dacarbazine', fields: { ae: 'Nausea', tox: 'Myelosuppression' } }],
    }));

    const mapped = applyFieldMap(asked, { ae: 'moa', tox: 'moa' });
    expect(mapped.ok).toBe(false);
    if (mapped.ok) return;
    expect(mapped.problems[0].message).toContain('overwrite the other');
  });

  it('refuses a map from a key the file never declared', () => {
    const mapped = applyFieldMap(read(file(asking('ae', 'Adverse effects'))), { toxicity: 'moa' });

    expect(mapped.ok).toBe(false);
    if (mapped.ok) return;
    expect(mapped.problems[0].message).toContain('not declared');
  });
});

/* ----------------------------------------------- running the same file twice -- */

describe('the same lecture imported again', () => {
  /**
   * The recovery path, and the reason it is tested rather than assumed.
   *
   * `applyDrugImport` is not one transaction: it creates the fields, then the
   * tags, then writes the drugs one at a time. Everything that can be refused
   * is refused during planning, before any write, so a stop halfway needs an
   * infrastructure fault rather than a bad file -- but if one happens, the fix
   * is to run the same file again. That only works if a second run is a no-op
   * over what the first one already wrote, which is what these assert.
   */
  const lecture = () => file({
    write: 'variant',
    declare: [{ key: 'ae', label: 'Adverse effects', type: 'markdown' }],
    drugs: [
      { generic: 'nivolumab', brands: ['Opdivo'], indications: ['Melanoma'], fields: { moa: 'PD-1 inhibitor', ae: 'Pruritus' } },
      { generic: 'dabrafenib', fields: { moa: 'BRAF inhibitor' } },
      // Named by the regimen below, so the file has to declare it -- which the
      // format refuses to let us forget.
      { generic: 'trametinib' },
    ],
    regimens: [{
      name: 'Dabrafenib + trametinib',
      components: [{ drug: 'dabrafenib', dose: '150 mg PO BID' }, { drug: 'trametinib', dose: '2 mg PO daily' }],
    }],
  });

  it('writes nothing the second time', async () => {
    const first = await apply(lecture());
    expect(first.created.sort()).toEqual(['dabrafenib', 'nivolumab', 'trametinib']);
    expect(first.fieldsDeclared).toEqual(['ae']);
    // `write: 'variant'` and yet every value landed on the drug, which is
    // right and worth pinning: these drugs exist *because* of this lecture, so
    // there is no curated profile for them to differ from. A layer here would
    // leave the drug itself blank. Layers appear where the app already knew
    // the drug and the lecture disagreed -- see the `fill` tests above.
    expect(first.toDrug).toBe(5);
    expect(first.toVariant).toBe(0);

    const second = await apply(lecture());
    // Nothing new: the drugs exist, the field exists, the tags exist, and
    // every value already reads exactly as the file says it should.
    expect(second.created).toEqual([]);
    expect(second.fieldsDeclared).toEqual([]);
    expect(second.tagsCreated).toEqual([]);
    expect(second.toDrug).toBe(0);
    // And emphatically not five writes into the class's layer: a value the
    // drug already holds word for word is not that class's own wording, so
    // re-running a lecture must not invent a version that says nothing.
    expect(second.toVariant).toBe(0);
    expect(second.unchanged).toBe(first.toDrug + first.toVariant);
    expect(second.updated.sort()).toEqual(['dabrafenib', 'nivolumab', 'trametinib']);
  });

  it('does not duplicate the brands, the indications or the regimen', async () => {
    await apply(lecture());
    await apply(lecture());

    const [nivolumab] = await db.select().from(drugs).where(eq(drugs.slug, 'nivolumab'));
    const brands = await db.select().from(drugBrands).where(eq(drugBrands.drugId, nivolumab.id));
    const links = await db.select().from(drugIndications).where(eq(drugIndications.drugId, nivolumab.id));

    expect(brands.map((brand) => brand.name)).toEqual(['Opdivo']);
    expect(links).toHaveLength(1);

    // The regimen is one rendered block on the field, so a second run must
    // replace it rather than append a second copy of the same protocol.
    const [dabrafenib] = await db.select().from(drugs).where(eq(drugs.slug, 'dabrafenib'));
    const text = dabrafenib.fields.regimen?.value ?? '';
    expect(text.match(/Dabrafenib \+ trametinib/g) ?? []).toHaveLength(1);
  });

  it('fills a gap the first run could not, without disturbing the rest', async () => {
    await apply(lecture());

    // The second reading of the same deck adds a mechanism nobody had.
    const report = await apply(file({
      write: 'variant',
      drugs: [{ generic: 'trametinib', fields: { moa: 'MEK inhibitor' } }],
    }));

    expect(report.created).toEqual([]);
    // The layer, not the drug: `variant` means *make an alternate profile and
    // only that*, so it does not reach the drug's own even to fill a gap. That
    // is the difference between the two modes, and the reason the screen makes
    // somebody choose -- `fill` would have put this on the drug.
    expect(report.toVariant).toBe(1);
    expect(report.toDrug).toBe(0);

    const [trametinib] = await db.select().from(drugs).where(eq(drugs.slug, 'trametinib'));
    expect(trametinib.fields.moa).toBeUndefined();
    // The narrowest scope in the file, which is the exam rather than the
    // class: the exam is the more specific claim about whose words these are.
    const layer = await variantLayerFor(trametinib.id, 'heme-onc-exam-3');
    expect(layer?.fields.moa.value).toBe('MEK inhibitor');
  });
});

describe('a lecture scoped to a class and its exam', () => {
  /**
   * One lecture is one version of a drug, and the file's two scope tags are
   * **that version's tags** -- not two versions, one per tag.
   *
   * The layer lands on the narrowest scope, which is right and deliberate. What
   * was missing is the other half: the class the lecture belongs to has to read
   * the same wording, or the same import teaches two different things depending
   * on whether you study PHRM 535 or Heme/Onc Exam 3.
   */
  const pointerFor = async (drugSlug: string, listSlug: string) => {
    const [row] = await db
      .select({ variantTagId: drugTags.variantTagId })
      .from(drugTags)
      .innerJoin(drugs, eq(drugs.id, drugTags.drugId))
      .innerJoin(tags, eq(tags.id, drugTags.tagId))
      .where(and(eq(drugs.slug, drugSlug), eq(tags.slug, listSlug)));
    if (!row?.variantTagId) return null;
    const [variant] = await db.select({ slug: tags.slug }).from(tags)
      .where(eq(tags.id, row.variantTagId));
    return variant?.slug ?? null;
  };

  /** The drug exists already and says something the lecture disagrees with. */
  const seeded = async () => {
    await db.insert(drugs).values({
      slug: 'prednisone',
      genericName: 'prednisone',
      fields: {
        moa: {
          value: 'Glucocorticoid receptor agonist', status: 'ok', source: 'the sheet',
          updatedAt: new Date().toISOString(), updatedBy: ME,
        },
      },
    });
  };

  it('points the class at the exam’s layer, so both read the lecture', async () => {
    await seeded();
    const report = await apply(file({
      drugs: [{ generic: 'prednisone', fields: { moa: 'Lympholytic at high dose' } }],
    }));

    expect(report.toVariant).toBe(1);
    // The layer itself is on the narrowest scope, unchanged.
    expect(await variantLayerFor(
      (await db.select().from(drugs).where(eq(drugs.slug, 'prednisone')))[0].id,
      'heme-onc-exam-3',
    )).not.toBeNull();
    // And the class now reads it.
    expect(await pointerFor('prednisone', 'phrm-535')).toBe('heme-onc-exam-3');
    expect(report.listsPointed).toBe(1);
  });

  it('studies the same wording whether the class or the exam is in scope', async () => {
    // The whole point of the pointer, asserted through the thing that consumes
    // it rather than through the column.
    await seeded();
    await apply(file({
      drugs: [{ generic: 'prednisone', fields: { moa: 'Lympholytic at high dose' } }],
    }));

    const byList = await membershipVariants(['phrm-535']);
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'prednisone'));
    expect(byList.get(drug.id)).toEqual(['heme-onc-exam-3']);
  });

  it('converges on a second import, which writes no values at all', async () => {
    // A pointer set only alongside a fresh write would never reach a drug
    // imported before this existed, because the second run finds every value
    // identical and writes nothing.
    await seeded();
    const text = file({
      drugs: [{ generic: 'prednisone', fields: { moa: 'Lympholytic at high dose' } }],
    });
    await apply(text);
    await db.update(drugTags).set({ variantTagId: null });

    const again = await apply(text);
    // The layer is rewritten with the same value, because `unchanged` compares
    // against the drug's *own* wording and the lecture still disagrees with it.
    // Nothing actually changes -- `patchVariantLayer` keeps the envelope of a
    // value whose text is the same -- so the count is the report overstating a
    // no-op, not a write. What matters here is that the pointer is restored
    // either way: it is not set alongside the write, it is set because the
    // layer exists.
    expect(again.toVariant).toBe(1);
    expect(await pointerFor('prednisone', 'phrm-535')).toBe('heme-onc-exam-3');
  });

  it('leaves a drug the lecture worded no differently with no version at all', async () => {
    // The symptom the owner reported: ipilimumab came back as two copies, one
    // per scope tag, where the lecture had said nothing of its own about it.
    const report = await apply(file({
      drugs: [{ generic: 'ipilimumab', fields: { moa: 'CTLA-4 inhibitor' } }],
    }));

    expect(report.toVariant).toBe(0);
    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, 'ipilimumab'));

    // Tagged with both, as it should be -- membership is a fact.
    const member = await db.select({ slug: tags.slug }).from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId))
      .where(eq(drugTags.drugId, drug.id));
    expect(member.map((row) => row.slug).sort()).toEqual(['heme-onc-exam-3', 'phrm-535']);

    // And no version: nothing was worded differently, so there is nothing to
    // be another version of.
    expect(await numberedVariantsByDrug()).toEqual(new Map());
    expect((await variantOptionsFor(drug.id)).every((option) => option.n === null)).toBe(true);
    expect(report.listsPointed).toBe(0);
    expect(await pointerFor('ipilimumab', 'phrm-535')).toBeNull();
  });

  it('does not overwrite a pointer somebody set by hand', async () => {
    // A pointer on the tag screen is a curation decision about how one list
    // reads, and re-running a lecture must not quietly undo it.
    await seeded();
    const text = file({
      drugs: [{ generic: 'prednisone', fields: { moa: 'Lympholytic at high dose' } }],
    });
    await apply(text);

    const [course] = await db.select().from(tags).where(eq(tags.slug, 'phrm-535'));
    await db.update(drugTags).set({ variantTagId: course.id });
    const again = await apply(text);

    expect(again.listsPointed).toBe(0);
    expect(await pointerFor('prednisone', 'phrm-535')).toBe('phrm-535');
  });
});

describe('correcting a version rather than the drug', () => {
  /**
   * *Correct the drug itself* had nothing to say about a drug with versions: it
   * wrote over the drug, and a class's own wording went on outranking the
   * correction wherever it had any -- so the profile looked fixed while
   * studying that class still taught the old value. The screen now says which
   * thing is wrong.
   */
  const seeded = async () => {
    const [drug] = await db.insert(drugs).values({
      slug: 'prednisone',
      genericName: 'Prednisone',
      drugClass: 'Corticosteroid',
      fields: {
        moa: {
          value: 'Glucocorticoid receptor agonist', status: 'ok', source: 'the sheet',
          updatedAt: new Date().toISOString(), updatedBy: ME,
        },
      },
    }).returning();
    return drug;
  };

  /** The same correction, aimed wherever the screen says. */
  const aimed = (target: string, moa: string) => ({
    ...read(file({
      write: 'base',
      drugs: [{ generic: 'Prednisone', class: 'Glucocorticoid', fields: { moa } }],
    })),
    target,
  });

  const applyWith = async (target: string, moa: string) => {
    const result = await applyDrugImport(aimed(target, moa), ME);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.problems)}`);
    return result.report;
  };

  /**
   * A wrong reading the class recorded for itself, put there the way one
   * actually gets there: a `fill` import of the lecture, which sends a value
   * disagreeing with the drug to the narrowest scope's layer. Going through the
   * importer also means the tags exist, which is what a correction aimed at one
   * of them needs.
   */
  const classSaid = async (drugId: string, value: string) => {
    const report = await apply(file({
      drugs: [{ generic: 'Prednisone', fields: { moa: value } }],
    }));
    expect(report.toVariant).toBe(1);
    const layer = await variantLayerFor(drugId, 'heme-onc-exam-3');
    expect(layer?.fields.moa.value).toBe(value);
  };

  it('writes over the drug when the drug is what it is aimed at', async () => {
    await seeded();
    const plan = await planDrugImport(aimed(TARGET_DRUG, 'Lympholytic at high dose'));

    expect(plan.correcting).toBe(false);
    expect(plan.drugs[0].writes.map((write) => write.to)).toEqual(['drug']);

    await applyWith(TARGET_DRUG, 'Lympholytic at high dose');
    const [after] = await db.select().from(drugs).where(eq(drugs.slug, 'prednisone'));
    expect(after.fields.moa.value).toBe('Lympholytic at high dose');
  });

  it('writes over the version, and leaves the drug exactly as it was', async () => {
    const drug = await seeded();
    await classSaid(drug.id, 'Cytotoxic to lymphocytes');

    const report = await applyWith('heme-onc-exam-3', 'Lympholytic at high dose');
    expect(report.toVariant).toBe(1);
    expect(report.toDrug).toBe(0);

    const layer = await variantLayerFor(drug.id, 'heme-onc-exam-3');
    expect(layer?.fields.moa.value).toBe('Lympholytic at high dose');

    // Untouched, which is the whole point: the drug was not the thing wrong.
    const [after] = await db.select().from(drugs).where(eq(drugs.slug, 'prednisone'));
    expect(after.fields.moa.value).toBe('Glucocorticoid receptor agonist');
  });

  it('shows what the version said, not what the drug says', async () => {
    const drug = await seeded();
    await classSaid(drug.id, 'Cytotoxic to lymphocytes');

    const plan = await planDrugImport(aimed('heme-onc-exam-3', 'Lympholytic at high dose'));
    expect(plan.correcting).toBe(true);
    expect(plan.variant?.slug).toBe('heme-onc-exam-3');
    // `from` is what is being written over. Printing the drug's own value here
    // would make the preview describe a write that is not the one happening.
    expect(plan.drugs[0].writes[0]).toMatchObject({
      to: 'variant', from: 'Cytotoxic to lymphocytes', value: 'Lympholytic at high dose',
    });
  });

  it('falls back to the drug own value where the version has none', async () => {
    await seeded();
    const plan = await planDrugImport(aimed('heme-onc-exam-3', 'Lympholytic at high dose'));
    // Nothing stored for that class yet, so what it reads as today *is* the
    // drug's own -- which is the honest thing to show as replaced.
    expect(plan.drugs[0].writes[0].from).toBe('Glucocorticoid receptor agonist');
  });

  it('never corrects the drug identity through a version', async () => {
    await seeded();
    const plan = await planDrugImport(aimed('heme-onc-exam-3', 'Lympholytic at high dose'));
    // A class cannot differ about what a drug *is*, so a correction aimed at
    // its wording is not a licence to rewrite the drug's class.
    expect(plan.drugs[0].identity.drugClass).toBeNull();

    const atDrug = await planDrugImport(aimed(TARGET_DRUG, 'Lympholytic at high dose'));
    expect(atDrug.drugs[0].identity.drugClass).toBe('Glucocorticoid');
  });

  it('refuses a version this file is not scoped to, and writes nothing', async () => {
    await seeded();
    const plan = await planDrugImport(aimed('cardio-301', 'Lympholytic at high dose'));
    expect(plan.problems.map((problem) => problem.message).join(' '))
      .toContain('not one of this file');

    const result = await applyDrugImport(aimed('cardio-301', 'Lympholytic at high dose'), ME);
    expect(result.ok).toBe(false);
    const [after] = await db.select().from(drugs).where(eq(drugs.slug, 'prednisone'));
    expect(after.fields.moa.value).toBe('Glucocorticoid receptor agonist');
  });

  /* ------------------------------------------- and until somebody says so -- */

  it('will not import an overwrite until what it replaces is decided', async () => {
    await seeded();
    const plan = await planDrugImport(aimed(TARGET_UNDECIDED, 'Lympholytic at high dose'));
    expect(plan.undecidedTarget).toBe(true);

    // Not a problem, on purpose: the preview is how the choice gets made, and
    // a problem hides it. There has to be something to decide with.
    expect(plan.problems).toEqual([]);
    expect(plan.drugs[0].writes.length).toBeGreaterThan(0);

    const result = await applyDrugImport(aimed(TARGET_UNDECIDED, 'Lympholytic at high dose'), ME);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0].where).toBe('what to correct');
    expect(result.problems[0].message).toContain('Heme/Onc Exam 3');

    const [after] = await db.select().from(drugs).where(eq(drugs.slug, 'prednisone'));
    expect(after.fields.moa.value).toBe('Glucocorticoid receptor agonist');
  });

  it('asks nothing when there is nothing to replace', async () => {
    // Every drug new, so the target changes nothing -- a first load of two
    // hundred drugs should not be stopped to answer a question with one
    // possible answer.
    const plan = await planDrugImport(aimed(TARGET_UNDECIDED, 'Lympholytic at high dose'));
    expect(plan.undecidedTarget).toBe(false);

    const result = await applyDrugImport(aimed(TARGET_UNDECIDED, 'Lympholytic at high dose'), ME);
    expect(result.ok).toBe(true);
  });

  it('always has a version to choose between, because a file must name one', () => {
    // Why the question is only ever about whether there is something to
    // replace: a file naming neither a course nor an exam never reaches the
    // planner at all.
    expect(problems(file({ scope: {} }))).toContain('Neither course nor exam');
  });

  it('asks the other two modes nothing, and does not read unasked as a bad scope', async () => {
    await seeded();
    const filling = {
      ...read(file({ drugs: [{ generic: 'Prednisone', fields: { moa: 'Cytotoxic' } }] })),
      target: TARGET_UNDECIDED,
    };

    const plan = await planDrugImport(filling);
    expect(plan.undecidedTarget).toBe(false);
    // An empty target is a question nobody asked, not a slug that failed to
    // match: `fill` sends what differs to the narrowest scope either way.
    expect(plan.problems).toEqual([]);
    expect(plan.variant?.slug).toBe('heme-onc-exam-3');

    const result = await applyDrugImport(filling, ME);
    expect(result.ok).toBe(true);
  });

  it('still gives a drug the app has never held everything as its own', async () => {
    // There is no version of a drug that does not exist yet, and a new drug
    // whose mechanism lived only in a class layer reads as an empty profile.
    const plan = await planDrugImport(aimed('heme-onc-exam-3', 'Lympholytic at high dose'));
    expect(plan.drugs[0].exists).toBe(false);
    expect(plan.drugs[0].writes.map((write) => write.to)).toEqual(['drug']);
  });
});
