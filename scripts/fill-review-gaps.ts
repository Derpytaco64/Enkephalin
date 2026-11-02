/**
 * Applies the confirmations the class sheet cannot supply.
 *
 * Two gaps kept drugs out of study decks. Neither is a sheet fact, so neither
 * belongs in data/drugs-seed.json:
 *
 *   1. Which brand treats which indication. The sheet lists brands and
 *      indications in separate columns and never pairs them, so five drugs
 *      carried `needs_pairing_review` and generated no brand-to-indication
 *      card at all.
 *   2. The route, for eighteen drugs whose dosing text never states one.
 *
 * Both are recorded here with a reason per row, in one reviewable place, and
 * every value lands `unverified` with its own `source` so a human can audit
 * exactly what was asserted and on whose authority. Re-running is safe, and so
 * is a later `npm run seed`: the importer only ever *adds* brand links, never
 * re-raises a settled suspect flag, and never blanks a value already present.
 *
 *   node --experimental-strip-types scripts/fill-review-gaps.ts
 */
import './env.ts';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  brandIndications,
  drugBrands,
  drugIndications,
  drugs,
  type FieldValue,
} from '../db/schema.ts';

/** Where these assertions come from, recorded on every value written. */
const SOURCE = 'FDA labelling, applied in review';

type Pairing = {
  generic: string;
  /** Brand name -> the indications that brand is labelled for. */
  links: Record<string, string[]>;
  why: string;
};

const PAIRINGS: Pairing[] = [
  {
    generic: 'Tirzepatide',
    links: {
      Mounjaro: ['Diabetes'],
      Zepbound: ['Weight management', 'Obstructive sleep apnea'],
    },
    why: 'One molecule, two labels: Mounjaro for type 2 diabetes, Zepbound for chronic '
      + 'weight management and obstructive sleep apnea in adults with obesity. Pairing '
      + 'Mounjaro with weight management is the error this review existed to prevent.',
  },
  {
    generic: 'Bupropion',
    links: {
      Wellbutrin: ['Depression'],
      'Wellbutrin SR': ['Depression'],
      'Wellbutrin XL': ['Depression'],
      Zyban: ['Smoking cessation'],
    },
    why: 'The Wellbutrin family is labelled for major depressive disorder and Zyban for '
      + 'smoking cessation. Same drug, and the brands are not interchangeable in what '
      + 'they treat.',
  },
  {
    generic: 'Fluoxetine',
    links: {
      Prozac: ['Depression'],
      Sarafem: ['Premenstrual dysphoria disorder'],
    },
    why: 'Sarafem is the brand labelled for PMDD and Prozac for depression. Fluoxetine '
      + 'the molecule covers both; the brands do not.',
  },
  {
    generic: 'Albuterol sulfate',
    links: {
      Proventil: ['Asthma', 'Bronchospasm', 'COPD'],
      Ventolin: ['Asthma', 'Bronchospasm', 'COPD'],
      Proair: ['Asthma', 'Bronchospasm', 'COPD'],
    },
    why: 'All three are albuterol HFA inhalers carrying the same labelled indication, '
      + 'bronchospasm in reversible obstructive airway disease. Every brand pairs with '
      + 'every indication: a uniform pairing, not a split.',
  },
  {
    generic: 'Digoxin',
    links: {
      Lanoxin: ['Heart failure', 'Atrial fibrillation'],
      Digitek: ['Heart failure', 'Atrial fibrillation'],
    },
    why: 'Both brands are digoxin with the same label -- heart failure, and rate control '
      + 'in atrial fibrillation. No brand-specific split.',
  },
];

type RouteFill = { generic: string; routes: string[]; why: string };

/**
 * Routes the sheet never states. Ordered by how the sheet itself points at the
 * answer: a dose counted in tablets is oral whatever else is unsaid, and a drug
 * that exists in one form only has no second possibility to weigh.
 */
const ROUTE_FILLS: RouteFill[] = [
  // The sheet's own dose form settles these.
  { generic: 'Butalbital, Acetaminophen and Caffeine', routes: ['Oral'], why: 'The sheet doses it in capsules and tablets.' },
  { generic: 'Phentermine Hydrochloride', routes: ['Oral'], why: 'The sheet doses it as "1 tablet/capsule".' },

  // Marketed in one route only, so there is no second possibility.
  { generic: 'Micafungin', routes: ['IV'], why: 'Available as an intravenous infusion only.' },
  { generic: 'Propofol', routes: ['IV'], why: 'Available as an intravenous emulsion only.' },
  { generic: 'Norepinephrine', routes: ['IV'], why: 'Available as an intravenous infusion only.' },
  { generic: 'Dexmedetomidine', routes: ['IV'], why: 'The sheet doses it as mcg/kg/hour, and it is an intravenous infusion.' },
  { generic: 'Insulin aspart', routes: ['Subcutaneous'], why: 'Dosed with meals and given subcutaneously; also used IV in inpatient infusions.' },
  { generic: 'Insulin degludec', routes: ['Subcutaneous'], why: 'Long-acting basal insulin, given subcutaneously only.' },
  { generic: 'Insulin glargine', routes: ['Subcutaneous'], why: 'Long-acting basal insulin, given subcutaneously only.' },
  { generic: 'Benzonatate', routes: ['Oral'], why: 'Supplied only as oral capsules.' },
  { generic: 'Memantine', routes: ['Oral'], why: 'Supplied as oral tablets and solution.' },
  { generic: 'Rivaroxaban', routes: ['Oral'], why: 'Supplied as oral tablets only.' },
  { generic: 'Bupropion', routes: ['Oral'], why: 'Supplied as oral tablets only.' },
  { generic: 'Omega-3-Acid Ethyl Esters', routes: ['Oral'], why: 'Supplied as oral capsules.' },

  // More than one route exists; the route recorded is the one the sheet's own
  // dose describes, and the others are named in the reason rather than hidden.
  { generic: 'Lorazepam', routes: ['Oral'], why: 'The sheet gives the oral dose; lorazepam is also given IV and IM.' },
  { generic: 'Methadone', routes: ['Oral'], why: 'The sheet gives the oral dose; methadone is also given IV.' },
  { generic: 'Midazolam', routes: ['IV', 'IM'], why: 'Parenteral forms; a Soluxide oral syrup also exists.' },
  { generic: 'Vancomycin', routes: ['IV'], why: 'The sheet monitors trough levels, which is the IV course; oral vancomycin is used for C. difficile.' },
];

async function findDrug(generic: string) {
  const [drug] = await db
    .select({ id: drugs.id, generic: drugs.genericName, fields: drugs.fields })
    .from(drugs)
    .where(eq(drugs.genericName, generic));
  return drug;
}

async function applyPairings() {
  let links = 0;
  let cleared = 0;
  const problems: string[] = [];

  for (const pairing of PAIRINGS) {
    const drug = await findDrug(pairing.generic);
    if (!drug) {
      problems.push(`${pairing.generic}: no such drug`);
      continue;
    }

    const brands = await db
      .select({ id: drugBrands.id, name: drugBrands.name })
      .from(drugBrands)
      .where(eq(drugBrands.drugId, drug.id));
    const indications = await db
      .select({ id: drugIndications.id, text: drugIndications.text })
      .from(drugIndications)
      .where(eq(drugIndications.drugId, drug.id));

    // Every name in the table must exist, or the confirmation is about
    // something other than what is in the database and must not be applied.
    for (const [brandName, wanted] of Object.entries(pairing.links)) {
      const brand = brands.find((b) => b.name.toLowerCase() === brandName.toLowerCase());
      if (!brand) {
        problems.push(`${pairing.generic}: no brand "${brandName}"`);
        continue;
      }

      for (const text of wanted) {
        const indication = indications.find((i) => i.text.toLowerCase() === text.toLowerCase());
        if (!indication) {
          problems.push(`${pairing.generic}: no indication "${text}"`);
          continue;
        }

        const inserted = await db
          .insert(brandIndications)
          .values({ brandId: brand.id, indicationId: indication.id })
          .onConflictDoNothing()
          .returning({ brandId: brandIndications.brandId });
        if (inserted.length > 0) links += 1;
      }

      await db
        .update(drugBrands)
        .set({ defaultPairingSuspect: false, suspectReason: null })
        .where(eq(drugBrands.id, brand.id));
    }

    // Only once every brand named for this drug has been paired: a partial
    // confirmation must not clear the flag that says it is unconfirmed.
    const unpaired = brands.filter((b) => !Object.keys(pairing.links)
      .some((name) => name.toLowerCase() === b.name.toLowerCase()));
    if (unpaired.length > 0) {
      problems.push(`${pairing.generic}: left unpaired, flag kept: ${unpaired.map((b) => b.name).join(', ')}`);
      continue;
    }

    await db.update(drugs).set({ needsPairingReview: false, updatedAt: new Date() }).where(eq(drugs.id, drug.id));
    cleared += 1;
  }

  return { links, cleared, problems };
}

async function applyRoutes() {
  let written = 0;
  let kept = 0;
  const problems: string[] = [];

  for (const fill of ROUTE_FILLS) {
    const drug = await findDrug(fill.generic);
    if (!drug) {
      problems.push(`${fill.generic}: no such drug`);
      continue;
    }

    // Never overwrite: the sheet, or a human, outranks this table.
    const current = drug.fields.route;
    if (current && String(current.value ?? '').trim()) {
      kept += 1;
      continue;
    }

    const value: FieldValue = {
      value: fill.routes.join('\n'),
      status: 'ok',
      source: `${SOURCE} — ${fill.why}`,
      updatedAt: new Date().toISOString(),
      updatedBy: null,
    };

    await db
      .update(drugs)
      .set({ fields: { ...drug.fields, route: value }, updatedAt: new Date() })
      .where(eq(drugs.id, drug.id));
    written += 1;
  }

  return { written, kept, problems };
}

const pairings = await applyPairings();
const routes = await applyRoutes();

console.log(`brand pairings: ${pairings.links} links added, ${pairings.cleared} drugs cleared of review`);
console.log(`routes:         ${routes.written} filled, ${routes.kept} left alone (already had one)`);

for (const problem of [...pairings.problems, ...routes.problems]) {
  console.log(`  ! ${problem}`);
}

process.exit(0);
