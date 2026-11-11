import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { drugs, users } from '@/db/schema';
import {
  classColumns,
  forgetResolvedNames,
  ingredients,
  lookUpDrugClass,
  readClasses,
  spellings,
  type FetchJson,
} from '@/lib/drugs/class-lookup';
import { createDrug } from '@/lib/drugs/mutations';

/**
 * The class a drug is created with, looked up rather than typed.
 *
 * All of it against a stub. The 236 drugs the library came with were classed by
 * `scripts/fetch-drug-classes.py` against RxNav, and this is that script's logic
 * moved into the app so a drug added later is classed the same way -- so what is
 * worth pinning is the *reasoning*, every piece of which was a bug in the
 * original run: an EPC taken from the wrong vocabulary, a combination asked by
 * product name, an adjuvant leading its own product. None of that needs the
 * National Library of Medicine to be up, and a suite that asked it would be
 * slow, flaky and offline-hostile. `DRUG_CLASS_LOOKUP=off` in
 * `vitest.config.mts` keeps every other test away from it entirely.
 */

const ME = 'class-lookup-admin';

/** An RxNav stand-in: names it knows, and the classes it answers with. */
function rxnav(known: Record<string, { rxcui: string; rows: unknown[] }>): FetchJson {
  return async (path, params) => {
    if (path === 'rxcui.json') {
      const found = known[(params.name ?? '').toLowerCase()];
      return found ? { idGroup: { rxnormId: [found.rxcui] } } : { idGroup: {} };
    }
    const entry = Object.values(known).find((row) => row.rxcui === params.rxcui);
    return { rxclassDrugInfoList: { rxclassDrugInfo: entry?.rows ?? [] } };
  };
}

/** One RxClass row, as the API shapes it. */
const row = (className: string, classType: string, relaSource: string) => ({
  rxclassMinConceptItem: { className, classType },
  relaSource,
});

const epc = (name: string) => row(name, 'EPC', 'FDASPL');

beforeEach(() => {
  // The process-wide name cache would otherwise carry one test's stub into the
  // next, which is the point of it in production and a lie in here.
  forgetResolvedNames();
  process.env.DRUG_CLASS_LOOKUP = 'on';
});

afterEach(() => {
  process.env.DRUG_CLASS_LOOKUP = 'off';
});

describe('reading an RxClass answer', () => {
  it('takes the EPC off the FDA label and nothing else', () => {
    // Dabrafenib's real answer, trimmed: the MEDRT row is the slide's own
    // wording -- "BRAF Serine/Threonine Kinase Inhibitors" -- beside an EPC of
    // "Kinase Inhibitor", and taking the familiar one is how the class axis
    // ends up with two names for one group.
    const classes = readClasses({
      rxclassDrugInfoList: {
        rxclassDrugInfo: [
          row('Protein Kinase Inhibitors', 'MOA', 'FDASPL'),
          row('BRAF Serine/Threonine Kinase Inhibitors', 'MOA', 'MEDRT'),
          row('Kinase Inhibitor', 'EPC', 'FDASPL'),
          row('Kinase Inhibitor', 'EPC', 'DAILYMED'),
          row('ANTINEOPLASTIC,OTHER', 'VA', 'VA'),
        ],
      },
    });

    expect(classes.epc).toEqual(['Kinase Inhibitor']);
    expect(classes.moa).toEqual(['Protein Kinase Inhibitors']);
    expect(classes.va).toEqual(['ANTINEOPLASTIC,OTHER']);
  });

  it('is empty rather than throwing on a shape it does not know', () => {
    expect(readClasses({})).toEqual({ epc: [], atc: [], moa: [], va: [] });
    expect(readClasses(null)).toEqual({ epc: [], atc: [], moa: [], va: [] });
  });
});

describe('the spellings a name is tried as', () => {
  it('drops a parenthetical route, a form and a salt', () => {
    expect(spellings('Prednisolone Acetate (Ophthalmic)')).toContain('Prednisolone Acetate');
    expect(spellings('Metoprolol Succinate ER')).toContain('Metoprolol');
    expect(spellings('Clonidine ER')).toContain('Clonidine');
  });

  it('closes a word the sheet wrapped without a hyphen', () => {
    // The PDF column broke mid-word, and RxNorm recognising the closed-up
    // spelling is what confirms the fix.
    expect(spellings('Hydrochlorothiazi de')).toContain('Hydrochlorothiazide');
  });

  it('splits a combination three ways, because the material writes it three ways', () => {
    expect(ingredients('Amoxicillin/ Clavulanate')).toEqual(['Amoxicillin', 'Clavulanate']);
    expect(ingredients('Codeine phosphate with Guaifenesin')).toEqual(['Codeine', 'Guaifenesin']);
    expect(ingredients('Butalbital, Acetaminophen and Caffeine'))
      .toEqual(['Butalbital', 'Acetaminophen', 'Caffeine']);
  });
});

describe('looking up one drug', () => {
  it('finds the EPC for a name RxNorm knows as written', async () => {
    const found = await lookUpDrugClass('dabrafenib', rxnav({
      dabrafenib: { rxcui: '1424911', rows: [epc('Kinase Inhibitor')] },
    }));

    expect(found).toMatchObject({
      drugClass: 'Kinase Inhibitor', rxcui: '1424911', path: 'direct', matchedAs: 'dabrafenib',
    });
  });

  it('says so when the FDA gives the drug no class', async () => {
    // Buspirone, which is one of the twenty the library leaves null: a MEDRT
    // mechanism and a VA category, and no EPC anywhere.
    const found = await lookUpDrugClass('buspirone', rxnav({
      buspirone: {
        rxcui: '1827',
        rows: [row('Serotonin Agonists', 'MOA', 'MEDRT'), row('SEDATIVES/HYPNOTICS,OTHER', 'VA', 'VA')],
      },
    }));

    expect(found.drugClass).toBeNull();
    // `direct`, not `no-classes`: RxNorm knew the name as written and the VA
    // answered. Only the FDA's EPC was missing, which is the whole question.
    expect(found.path).toBe('direct');
    // The vocabularies it would not promote are kept for whoever looks later.
    expect(classColumns(found)).toEqual({
      drugClass: null,
      rxcui: '1827',
      classCandidates: ['SEDATIVES/HYPNOTICS,OTHER'],
      needsClassReview: true,
    });
  });

  it('asks a combination ingredient by ingredient, and will not let the adjuvant lead', async () => {
    // The real shape of this one: the product name resolves to nothing at all,
    // and tazobactam's only class is the one that must never be the answer.
    const found = await lookUpDrugClass('Piperacillin/ Tazobactam', rxnav({
      piperacillin: { rxcui: '8339', rows: [epc('Penicillin-class Antibacterial')] },
      tazobactam: { rxcui: '82122', rows: [epc('beta Lactamase Inhibitor')] },
    }));

    expect(found.path).toBe('components');
    expect(found.drugClass).toBe('Penicillin-class Antibacterial');
    // Kept, behind it: it is true of the product and useless as its heading.
    expect(found.candidates.epc).toEqual(['Penicillin-class Antibacterial', 'beta Lactamase Inhibitor']);
  });

  it('leads with the ingredient the product is named for first', async () => {
    // Codeine/Guaifenesin classed as an Expectorant is a cough syrup whose
    // heading says the opposite of the point of it.
    const found = await lookUpDrugClass('Codeine phosphate with Guaifenesin', rxnav({
      codeine: { rxcui: '2670', rows: [epc('Opioid Agonist')] },
      guaifenesin: { rxcui: '4910', rows: [epc('Expectorant')] },
    }));

    expect(found.drugClass).toBe('Opioid Agonist');
  });

  it('retries a salt as the moiety, and says the name was normalized', async () => {
    const found = await lookUpDrugClass('Metoprolol Succinate ER', rxnav({
      metoprolol: { rxcui: '6918', rows: [epc('beta-Adrenergic Blocker')] },
    }));

    expect(found).toMatchObject({
      drugClass: 'beta-Adrenergic Blocker', path: 'normalized', matchedAs: 'Metoprolol',
    });
  });

  it('reports a name RxNorm does not know, rather than inventing one', async () => {
    const found = await lookUpDrugClass('vusolimogene oderparepvec', rxnav({}));
    expect(found).toMatchObject({ drugClass: null, rxcui: null, path: 'unresolved' });
  });

  it('survives an endpoint that is down, and claims nothing', async () => {
    const found = await lookUpDrugClass('dabrafenib', async () => {
      throw new Error('getaddrinfo ENOTFOUND rxnav.nlm.nih.gov');
    });

    expect(found).toMatchObject({ drugClass: null, path: 'unavailable' });
    // Unreachable is not evidence of anything, so it does not raise the flag
    // that means "somebody should pick a class for this".
    expect(classColumns(found).needsClassReview).toBe(false);
  });

  it('does nothing at all when it is switched off', async () => {
    process.env.DRUG_CLASS_LOOKUP = 'off';
    let asked = 0;
    const found = await lookUpDrugClass('dabrafenib', async () => { asked += 1; return {}; });

    expect(asked).toBe(0);
    expect(found.path).toBe('off');
  });
});

describe('creating a drug', () => {
  beforeEach(async () => {
    await db.delete(drugs);
    await db.delete(users);
    await db.insert(users).values({ id: ME, email: 'class@example.test', role: 'admin' });
  });

  const classOf = async (slug: string) => {
    const [drug] = await db
      .select({
        drugClass: drugs.drugClass,
        rxcui: drugs.rxcui,
        candidates: drugs.classCandidates,
        needsReview: drugs.needsClassReview,
      })
      .from(drugs)
      .where(eq(drugs.slug, slug));
    return drug;
  };

  const blank = {
    drugClass: '', schedule: '', scheduleNote: '', brands: '', indications: '',
    dosing: '', dosingUnique: false, tagSlugs: [] as string[],
  };

  it('looks the class up when the file or the form gives none', async () => {
    const result = await createDrug(
      { ...blank, genericName: 'Dabrafenib' },
      ME,
      {
        lookUpClass: async () => ({
          drugClass: 'Kinase Inhibitor',
          rxcui: '1424911',
          matchedAs: 'dabrafenib',
          path: 'direct',
          candidates: { epc: ['Kinase Inhibitor'], atc: [], moa: [], va: [] },
        }),
      },
    );
    expect(result.ok).toBe(true);

    expect(await classOf('dabrafenib')).toEqual({
      drugClass: 'Kinase Inhibitor', rxcui: '1424911', candidates: [], needsReview: false,
    });
  });

  it('keeps the class it was given, and does not look one up', async () => {
    // A lecture that names the class outranks the lookup, the same way the
    // class is filled and never corrected: see `docs/drug-import.md`.
    let asked = false;
    const result = await createDrug(
      { ...blank, genericName: 'Relatlimab', drugClass: 'LAG-3 Blocking Antibody' },
      ME,
      { lookUpClass: async () => { asked = true; throw new Error('should not be called'); } },
    );

    expect(result.ok).toBe(true);
    expect(asked).toBe(false);
    expect((await classOf('relatlimab')).drugClass).toBe('LAG-3 Blocking Antibody');
  });

  it('leaves a drug with no EPC uncategorized, with the candidates kept', async () => {
    const result = await createDrug(
      { ...blank, genericName: 'Buspirone' },
      ME,
      {
        lookUpClass: async () => ({
          drugClass: null,
          rxcui: '1827',
          matchedAs: 'buspirone',
          path: 'no-classes',
          candidates: { epc: [], atc: [], moa: ['Serotonin Agonists'], va: ['SEDATIVES/HYPNOTICS,OTHER'] },
        }),
      },
    );
    expect(result.ok).toBe(true);

    const drug = await classOf('buspirone');
    expect(drug.drugClass).toBeNull();
    expect(drug.needsReview).toBe(true);
    expect(drug.candidates).toEqual(['SEDATIVES/HYPNOTICS,OTHER', 'Serotonin Agonists']);
  });

  it('still creates the drug when the lookup is unreachable', async () => {
    const result = await createDrug(
      { ...blank, genericName: 'Nivolumab' },
      ME,
      {
        lookUpClass: async () => ({
          drugClass: null, rxcui: null, matchedAs: null, path: 'unavailable',
          candidates: { epc: [], atc: [], moa: [], va: [] },
        }),
      },
    );

    expect(result.ok).toBe(true);
    const drug = await classOf('nivolumab');
    expect(drug.drugClass).toBeNull();
    // Nothing was established, so nothing is claimed -- including the flag.
    expect(drug.needsReview).toBe(false);
  });
});
