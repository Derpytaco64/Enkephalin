/**
 * The FDA class for one drug, looked up rather than typed.
 *
 * The 236 drugs the library came with were classed this way --
 * `scripts/fetch-drug-classes.py`, one bulk run against RxNav -- and a drug
 * created since got whatever the person or the lecture happened to write, or
 * nothing. That is the inconsistency this closes: *a classification is a fact
 * to be looked up rather than prose to be written*, which is the reason the
 * project allows this one lookup at all, and it did not stop being true the day
 * the seed stopped running.
 *
 * **This is a port of that script, not a new idea**, because the script's logic
 * is mostly scar tissue and none of it is obvious:
 *
 * - **EPC only, from the FDA's own label.** `relaSource` of `FDASPL` or
 *   `DAILYMED`. ATC, VA and MOA rows are recorded as candidates for a human and
 *   never promoted: they classify by product or by mechanism, and mixing
 *   vocabularies on an axis that drives colour coding, the browse filter and
 *   same-class distractor sampling puts two spellings of one idea in the filter.
 * - **A combination is asked ingredient by ingredient.** RxClass gives
 *   Piperacillin/Tazobactam only *beta Lactamase Inhibitor*, losing the
 *   antibacterial, and the product name often resolves to nothing at all. So
 *   the ingredients are always consulted and unioned with whatever the product
 *   itself returned.
 * - **An adjuvant never leads.** Tazobactam protects its penicillin; carbidopa
 *   protects levodopa. Naming order alone classed Carbidopa/Levodopa as a
 *   decarboxylase inhibitor, which tells a student the drug's purpose is the
 *   opposite of what it is.
 * - **Salts and release qualifiers come off.** The class belongs to the active
 *   moiety, and the salt is a different RxCUI that often carries no class at
 *   all: *Codeine phosphate* resolves cleanly, has no EPC, and let a cough syrup
 *   be classed an Expectorant rather than an Opioid Agonist.
 *
 * **It never decides anything a person wrote.** The caller looks this up only
 * where no class was given -- an import that names the class keeps it, because
 * the class is filled and never corrected -- and a drug with no EPC stays null,
 * which the app reads as *Uncategorized*. Null is the honest answer and 20 of
 * the originals have it.
 *
 * **And it never fails a creation.** No network, a slow endpoint, a self-hosted
 * box with no route out: every one of those returns a result saying so, and the
 * drug is created without a class. `DRUG_CLASS_LOOKUP=off` turns it off
 * outright, which is what the test suite does -- a unit test must not depend on
 * the National Library of Medicine being up.
 */

/** Where a class came from, or why there is not one. */
export type ClassPath =
  /** The generic name resolved as written. */
  | 'direct'
  /** A salt, form or wrapped spelling had to come off first. */
  | 'normalized'
  /** A combination, classed from its ingredients. */
  | 'components'
  /**
   * RxNorm knows the drug and **no** vocabulary classes it at all.
   *
   * Not the only way to come back without a class: a drug can resolve
   * `direct` and still have a null `drugClass`, where the FDA label gives no
   * EPC but ATC or VA has something. That is buspirone, and it is why
   * `classColumns` keys the review flag off the class being null rather than
   * off this path.
   */
  | 'no-classes'
  /** RxNorm does not know the name. */
  | 'unresolved'
  /** The lookup is switched off. */
  | 'off'
  /** The lookup was tried and could not be reached. */
  | 'unavailable';

export type ClassLookup = {
  /** The EPC to store, or null to leave the drug uncategorized. */
  drugClass: string | null;
  rxcui: string | null;
  /** The spelling RxNorm actually matched, for the audit entry. */
  matchedAs: string | null;
  path: ClassPath;
  /** Every vocabulary's answer, for a human deciding what null should become. */
  candidates: { epc: string[]; atc: string[]; moa: string[]; va: string[] };
};

type Candidates = ClassLookup['candidates'];

const NONE: Candidates = { epc: [], atc: [], moa: [], va: [] };

const empty = (path: ClassPath): ClassLookup => ({
  drugClass: null, rxcui: null, matchedAs: null, path, candidates: { ...NONE },
});

const API = 'https://rxnav.nlm.nih.gov/REST';

/** RxNav asks for no more than 20 requests a second. */
const PAUSE_MS = 60;

/** Long enough for a slow day, short enough not to hold a form open. */
const TIMEOUT_MS = 6000;

const SALTS = /\b(sulfate|sodium|hydrochloride|hcl|tartrate|succinate|besylate|maleate|potassium|calcium|fumarate|mesylate|citrate|acetate|bromide|furoate|propionate|valerate|phosphate|nitrate|salts)\b/gi;

/**
 * Release, route and form qualifiers a name carries. RxNorm indexes the
 * ingredient, so "Clonidine ER" and "Fentanyl Transdermal Patch" only resolve
 * once these come off.
 */
const FORMS = /\b(ER|XR|SR|CR|DR|LA|XL|oral|topical|vaginal|nasal|ophthalmic|otic|rectal|transdermal|parenteral|injection|patch|inhaled|inhalation|cream|ointment|solution|suspension|tablet|capsule)\b/gi;

/**
 * Classes that describe a pharmacokinetic adjuvant rather than a therapy, and
 * so must never lead a combination however the product is named.
 */
const ADJUVANT = new Set([
  'beta Lactamase Inhibitor',
  'Aromatic Amino Acid Decarboxylation Inhibitor',
]);

/** Whether to ask the network at all. */
export function lookupEnabled(): boolean {
  return (process.env.DRUG_CLASS_LOOKUP ?? '').trim().toLowerCase() !== 'off';
}

/** One GET against RxNav, with a timeout and no exceptions of its own. */
export type FetchJson = (path: string, params: Record<string, string>) => Promise<unknown>;

const rxnav: FetchJson = async (path, params) => {
  const url = `${API}/${path}?${new URLSearchParams(params).toString()}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { accept: 'application/json' },
    // A classification changes about never, and Next would otherwise cache
    // this in the data cache keyed by a URL nobody revalidates.
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`RxNav answered ${response.status}`);
  return response.json();
};

/* ------------------------------------------------------------- spelling --- */

/**
 * Spellings to try, best first.
 *
 * Covers what a name arrives carrying: a parenthetical route, a salt, a release
 * qualifier, and -- from the sheet extraction -- a word the PDF wrapped without
 * a hyphen, so "Hydrochlorothiazi de" has to be retried with the space closed.
 * RxNorm recognising a candidate is what confirms it.
 */
export function spellings(name: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const tidy = value.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
    if (tidy && !seen.has(tidy.toLowerCase())) {
      seen.add(tidy.toLowerCase());
      out.push(tidy);
    }
  };

  add(name);
  const base = name.replace(/\s*\([^)]*\)/g, '').replace(/\s*\/\s*/g, '/');
  add(base);
  // Close a wrap that split a word: "...thiazi de" -> "...thiazide".
  for (const match of base.matchAll(/(?<=[a-z]) (?=[a-z]{1,3}\b)/g)) {
    if (match.index !== undefined) add(base.slice(0, match.index) + base.slice(match.index + 1));
  }
  const stripped = base.replace(FORMS, '');
  add(stripped);
  add(stripped.replace(SALTS, ''));
  add(base.replace(SALTS, ''));
  // "Cyanocobalamin Vitamin B-12" -> the leading ingredient token.
  add(base.split(/\s+/)[0] ?? base);

  return out;
}

/**
 * The ingredients of a combination product.
 *
 * Written three ways by the material this reads: `Amoxicillin/ Clavulanate`,
 * `Codeine phosphate with Guaifenesin`, and `Butalbital, Acetaminophen and
 * Caffeine`.
 */
export function ingredients(name: string): string[] {
  return name
    .replace(/\s*\([^)]*\)/g, '')
    .split(/\s*\/\s*|\s+with\s+|\s*,\s*|\s+and\s+/i)
    .map((part) => part.replace(FORMS, '').replace(SALTS, '').trim())
    .filter((part) => part.length > 2);
}

/* ------------------------------------------------------------- the call --- */

type RxClassRow = {
  rxclassMinConceptItem?: { className?: string; classType?: string };
  relaSource?: string;
};

/** The four vocabularies, sorted and deduplicated, out of one RxClass answer. */
export function readClasses(payload: unknown): Candidates {
  const rows = (payload as { rxclassDrugInfoList?: { rxclassDrugInfo?: RxClassRow[] } })
    ?.rxclassDrugInfoList?.rxclassDrugInfo ?? [];
  const out: Candidates = { epc: [], atc: [], moa: [], va: [] };

  for (const row of rows) {
    const name = row.rxclassMinConceptItem?.className;
    const kind = row.rxclassMinConceptItem?.classType;
    const from = row.relaSource;
    if (!name) continue;

    // The FDA's own label for EPC and MOA. MEDRT carries the same ideas in the
    // slide's wording and is deliberately not read: it is where "BRAF
    // Serine/Threonine Kinase Inhibitors" comes from, beside an EPC of
    // "Kinase Inhibitor", and taking the familiar one is how the axis ends up
    // with two names for one group.
    if (kind === 'EPC' && (from === 'FDASPL' || from === 'DAILYMED')) out.epc.push(name);
    else if (kind === 'ATC1-4' && from === 'ATC') out.atc.push(name);
    else if (kind === 'MOA' && (from === 'FDASPL' || from === 'DAILYMED')) out.moa.push(name);
    else if (kind === 'VA' && from === 'VA') out.va.push(name);
  }

  return {
    epc: [...new Set(out.epc)].sort(),
    atc: [...new Set(out.atc)].sort(),
    moa: [...new Set(out.moa)].sort(),
    va: [...new Set(out.va)].sort(),
  };
}

const pause = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Names already resolved, for the life of the process.
 *
 * A lecture import asks about the same ingredient across several combinations,
 * and an FDA classification does not change between two drugs in one file. Not
 * bounded, deliberately: the key space is the names of drugs somebody has
 * added, which is hundreds over the life of a container.
 */
const resolved = new Map<string, { rxcui: string; matchedAs: string } | null>();

/** Forget what has been resolved, so a test can drive the same name twice. */
export function forgetResolvedNames(): void {
  resolved.clear();
}


/**
 * The class for one generic name.
 *
 * `fetchJson` is injectable so the tests can drive every path without the
 * network; nothing else passes it.
 */
export async function lookUpDrugClass(
  generic: string,
  fetchJson: FetchJson = rxnav,
): Promise<ClassLookup> {
  const name = generic.trim();
  if (!name) return empty('unresolved');
  if (!lookupEnabled()) return empty('off');

  const resolveCui = async (candidate: string) => {
    const key = candidate.toLowerCase();
    const found = resolved.get(key);
    if (found !== undefined) return found;

    let answer: { rxcui: string; matchedAs: string } | null = null;
    for (const spelling of spellings(candidate)) {
      // search=2 is RxNorm's normalized match, search=1 its exact one. The
      // looser is tried first on purpose: it is what recognises a name the
      // sheet spelled its own way.
      for (const search of ['2', '1']) {
        await pause(PAUSE_MS);
        const payload = await fetchJson('rxcui.json', { name: spelling, search });
        const ids = (payload as { idGroup?: { rxnormId?: string[] } })?.idGroup?.rxnormId ?? [];
        if (ids.length > 0) {
          answer = { rxcui: ids[0], matchedAs: spelling };
          break;
        }
      }
      if (answer) break;
    }
    resolved.set(key, answer);
    return answer;
  };

  const classesOf = async (rxcui: string) => {
    await pause(PAUSE_MS);
    return readClasses(await fetchJson('rxclass/class/byRxcui.json', { rxcui }));
  };

  try {
    const product = await resolveCui(name);
    const direct = product ? await classesOf(product.rxcui) : { ...NONE };
    const parts = ingredients(name);

    if (parts.length > 1) {
      const merged: Candidates = { epc: [], atc: [], moa: [], va: [] };
      const cuis = product ? [product.rxcui] : [];
      const names = product ? [product.matchedAs] : [];

      // In the product's own order, so the ingredient it is named for first
      // leads. Sorting alphabetically instead made Codeine/Guaifenesin an
      // Expectorant and Dipyridamole/Aspirin an NSAID, each naming the adjunct
      // over the point of the drug.
      for (const part of parts) {
        const found = await resolveCui(part);
        if (!found) continue;
        cuis.push(found.rxcui);
        names.push(found.matchedAs);
        const some = await classesOf(found.rxcui);
        for (const key of ['epc', 'atc', 'moa', 'va'] as const) merged[key].push(...some[key]);
      }

      // Anything the product knew that its ingredients did not, kept at the
      // back rather than dropped.
      for (const key of ['epc', 'atc', 'moa', 'va'] as const) merged[key].push(...direct[key]);

      if (Object.values(merged).some((list) => list.length > 0)) {
        const ordered: Candidates = {
          epc: [...new Set(merged.epc)],
          atc: [...new Set(merged.atc)],
          moa: [...new Set(merged.moa)],
          va: [...new Set(merged.va)],
        };
        ordered.epc.sort((a, b) => Number(ADJUVANT.has(a)) - Number(ADJUVANT.has(b)));
        return {
          drugClass: ordered.epc[0] ?? null,
          // The product keeps its own RxCUI where it has one: a lookup provider
          // needs a real identifier, and "214182+5489+161" is not one.
          rxcui: product?.rxcui ?? null,
          matchedAs: names.join(' / ') || null,
          path: 'components',
          candidates: ordered,
        };
      }
    }

    if (product && Object.values(direct).some((list) => list.length > 0)) {
      return {
        drugClass: direct.epc[0] ?? null,
        rxcui: product.rxcui,
        matchedAs: product.matchedAs,
        path: product.matchedAs.toLowerCase() === name.toLowerCase() ? 'direct' : 'normalized',
        candidates: direct,
      };
    }

    return {
      drugClass: null,
      rxcui: product?.rxcui ?? null,
      matchedAs: product?.matchedAs ?? null,
      path: product ? 'no-classes' : 'unresolved',
      candidates: direct,
    };
  } catch {
    // Unreachable, slow, or answering something unexpected. A drug is still a
    // drug without a class, and the person adding one is not the person who
    // can fix the National Library of Medicine.
    return empty('unavailable');
  }
}

/**
 * What the lookup found, as the columns a drug carries.
 *
 * `class_candidates` holds the vocabularies that were *not* used, so a human
 * deciding what an uncategorized drug should be has the same material the
 * original review file gave them -- and `needs_class_review` marks the drugs
 * that question is open for. Both are exactly what the seed wrote.
 */
export function classColumns(found: ClassLookup): {
  drugClass: string | null;
  rxcui: string | null;
  classCandidates: string[];
  needsClassReview: boolean;
} {
  const others = [...new Set([
    ...found.candidates.va, ...found.candidates.atc, ...found.candidates.moa,
  ])].sort();
  return {
    drugClass: found.drugClass,
    rxcui: found.rxcui,
    classCandidates: found.drugClass === null ? others : [],
    // Only where the lookup actually ran and came back without one. A lookup
    // that is off or unreachable has not established anything, and a review
    // flag that means "nobody asked yet" is a flag nobody can clear.
    //
    // Keyed off the class rather than the path, because resolving the name and
    // having no EPC are not the same question: buspirone comes back `direct`,
    // with a VA category and no class. Listing the paths that mean "asked and
    // found nothing" instead left it unflagged with its candidates thrown away.
    needsClassReview: found.drugClass === null
      && found.path !== 'off' && found.path !== 'unavailable',
  };
}
