import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  drugBrands, drugIndications, drugTags, drugVariantValues, drugs, fieldDefs, indications,
  tags, users, type FieldValue,
} from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import {
  applyFieldMap, IMPORT_FORMAT, parseDrugImport, regimenFieldFor, renderRegimen,
} from '@/lib/drugs/import-format';
import { applyDrugImport, planDrugImport } from '@/lib/drugs/import';
import { variantLayerFor } from '@/lib/drugs/variants';

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
