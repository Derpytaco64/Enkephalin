/**
 * The components a dosing statement decomposes into.
 *
 * The sheet's prose stays the stored truth for display. This is the comparable
 * form, and the canonical sig string is *printed* from it rather than stored
 * alongside it, so the two can never drift: "100 mg QD PO" and "100 mg PO QD"
 * are one fact and two strings, and only components compare exactly.
 *
 * See PLAN.md, "Dosing is stored twice: prose to read, structure to compare".
 */

/**
 * Units never compare across classes and are never converted. 15 mg and 15 mL
 * are different facts, and a syrup dosed by volume has no mass to weigh against
 * a tablet dosed by mass. Carrying the class on the unit makes that structural
 * rather than a rule every caller has to remember.
 */
export type UnitClass = 'mass' | 'volume' | 'count' | 'activity';

export type UnitCode =
  | 'mg' | 'mcg' | 'g' | 'ng'
  | 'mL'
  | 'tablet' | 'capsule' | 'drop' | 'spray' | 'inhalation' | 'patch'
  | 'unit' | 'mEq';

/** `sig` is the prescription abbreviation; `plural` is for the English readback. */
export const UNITS: Record<UnitCode, { sig: string; label: string; plural: string; class: UnitClass }> = {
  mg: { sig: 'mg', label: 'mg', plural: 'mg', class: 'mass' },
  mcg: { sig: 'mcg', label: 'mcg', plural: 'mcg', class: 'mass' },
  g: { sig: 'g', label: 'g', plural: 'g', class: 'mass' },
  ng: { sig: 'ng', label: 'ng', plural: 'ng', class: 'mass' },
  mL: { sig: 'mL', label: 'mL', plural: 'mL', class: 'volume' },
  tablet: { sig: 'tab', label: 'tablet', plural: 'tablets', class: 'count' },
  capsule: { sig: 'cap', label: 'capsule', plural: 'capsules', class: 'count' },
  drop: { sig: 'gtt', label: 'drop', plural: 'drops', class: 'count' },
  spray: { sig: 'spray', label: 'spray', plural: 'sprays', class: 'count' },
  inhalation: { sig: 'inh', label: 'inhalation', plural: 'inhalations', class: 'count' },
  patch: { sig: 'patch', label: 'patch', plural: 'patches', class: 'count' },
  unit: { sig: 'unit', label: 'unit', plural: 'units', class: 'activity' },
  mEq: { sig: 'mEq', label: 'mEq', plural: 'mEq', class: 'activity' },
};

export type RouteCode =
  | 'PO' | 'IV' | 'IM' | 'SC' | 'INH' | 'NEB'
  | 'OPH' | 'OTIC' | 'NAS' | 'TOP' | 'TD' | 'SL' | 'PR' | 'PV';

export const ROUTES: Record<RouteCode, { sig: string; label: string }> = {
  PO: { sig: 'PO', label: 'by mouth' },
  IV: { sig: 'IV', label: 'intravenously' },
  IM: { sig: 'IM', label: 'intramuscularly' },
  SC: { sig: 'subQ', label: 'subcutaneously' },
  INH: { sig: 'INH', label: 'by inhalation' },
  NEB: { sig: 'NEB', label: 'by nebulizer' },
  OPH: { sig: 'OPH', label: 'into the eye' },
  OTIC: { sig: 'OTIC', label: 'into the ear' },
  NAS: { sig: 'NAS', label: 'into the nose' },
  TOP: { sig: 'TOP', label: 'topically' },
  TD: { sig: 'TD', label: 'transdermally' },
  SL: { sig: 'SL', label: 'sublingually' },
  PR: { sig: 'PR', label: 'rectally' },
  PV: { sig: 'PV', label: 'vaginally' },
};

/**
 * Where it goes, and whether the amount is per site or in total: "2 sprays per
 * nostril" is two each and four altogether, which is the distinction a general
 * dosing actually carries.
 *
 * Laterality is deliberately absent. Right versus left is a property of the
 * patient, not of the drug, and no row in this data set states one -- the sheet
 * writes "affected eye(s)", declining to pick a side. If per-side dosing ever
 * matters it belongs to the per-route variant subsystem, which is additive.
 */
export type SiteRegion = 'eye' | 'ear' | 'nostril' | 'skin' | 'mouth' | 'rectum' | 'vagina';
export type SiteBasis = 'each' | 'affected';

export type Site = {
  region: SiteRegion;
  basis: SiteBasis;
  /** Narrows the region without being compared: diclofenac's "upper extremity". */
  note: string | null;
};

export const SITE_LABELS: Record<SiteRegion, { one: string; many: string }> = {
  eye: { one: 'eye', many: 'eyes' },
  ear: { one: 'ear', many: 'ears' },
  nostril: { one: 'nostril', many: 'nostrils' },
  skin: { one: 'area', many: 'areas' },
  mouth: { one: 'mouth', many: 'mouth' },
  rectum: { one: 'rectum', many: 'rectum' },
  vagina: { one: 'vagina', many: 'vagina' },
};

/**
 * How often. `unspecified` is a real answer: "10-100 mg in divided doses"
 * never says how many, and inventing a number would be the guess this whole
 * system exists to refuse.
 */
export type Frequency =
  /**
   * `timesHigh` makes the count itself a range: nystatin is "2-3 times a day"
   * and clozapine "1-2 times a day", which is not the same claim as either
   * endpoint alone.
   */
  | { kind: 'per_day'; times: number; timesHigh: number | null }
  | { kind: 'interval'; low: number; high: number | null; unit: 'minute' | 'hour' | 'day' | 'week' | 'month' }
  | { kind: 'once' }
  /** An infusion: the rate on the amount carries the schedule. */
  | { kind: 'continuous' }
  | { kind: 'unspecified' };

/**
 * The shorthand for a count per day, and the letter for an interval.
 *
 * Here rather than inside the printer because the editor's glossary reads the
 * same tables: a code shown to a person and a code written into a sig that
 * came from two lists would eventually disagree, and the one place that is
 * guaranteed not to notice is the glossary.
 *
 * Counts above four have no code -- there is no abbreviation meaning "five
 * times a day" -- and neither does a range of counts, so both are spelled out.
 */
export const PER_DAY_CODES: Record<number, { sig: string; label: string }> = {
  1: { sig: 'QD', label: 'once a day' },
  2: { sig: 'BID', label: 'twice a day' },
  3: { sig: 'TID', label: 'three times a day' },
  4: { sig: 'QID', label: 'four times a day' },
};

export const INTERVAL_LETTERS: Record<'minute' | 'hour' | 'day' | 'week' | 'month', string> = {
  minute: 'MIN', hour: 'H', day: 'D', week: 'WK', month: 'MO',
};

/**
 * Modifiers are orthogonal to frequency and combine freely, which is the whole
 * reason they are not frequency values: "three times a day as needed" is TID
 * *and* PRN, and 12 drugs in this data set are written that way.
 */
export type Modifier = 'PRN' | 'HS' | 'AC' | 'PC' | 'AM' | 'PM' | 'WITH_FOOD';

export const MODIFIERS: Record<Modifier, { sig: string; label: string }> = {
  PRN: { sig: 'PRN', label: 'as needed' },
  HS: { sig: 'HS', label: 'at bedtime' },
  AC: { sig: 'AC', label: 'before meals' },
  PC: { sig: 'PC', label: 'after meals' },
  AM: { sig: 'AM', label: 'in the morning' },
  PM: { sig: 'PM', label: 'in the evening' },
  WITH_FOOD: { sig: 'with food', label: 'with food' },
};

/**
 * An amount, which may be a range and may be per kilogram and per unit time.
 * `low` alone is a fixed dose; `high` set makes it an interval, and an interval
 * compares as an interval rather than by its endpoints.
 */
export type Amount = {
  low: number;
  high: number | null;
  unit: UnitCode;
  perKg: boolean;
  per: 'minute' | 'hour' | 'day' | null;
  /**
   * Which active this amount belongs to, for a combination product:
   * carbidopa/levodopa 25/100 mg is 25 of the carbidopa and 100 of the
   * levodopa. Without it the order carries the meaning implicitly and a
   * reordering would silently change the fact.
   *
   * Null where the sheet gives one active, and null where it names more
   * actives than it gives numbers -- the backfill matches the generic name's
   * own order against the amounts and declines when the counts disagree,
   * rather than assigning a number to the wrong drug.
   */
  active: string | null;
};

export type Duration = {
  low: number;
  high: number | null;
  unit: 'dose' | 'day' | 'week' | 'month';
  /** Progesterone's "for 12 days every 28 day cycle". */
  cycleDays: number | null;
};

/**
 * One step of one regimen. A drug gets several rows where the sheet gives
 * alternatives ("10 mg daily OR 70 mg once weekly" -- two regimens) or a
 * sequence ("200 mg initially then 100 mg every 12 hours" -- two steps).
 */
export type Regimen = {
  /**
   * The slice of the sheet's wording this regimen was read from. Kept so a
   * stored row is auditable against its source without re-deriving the split,
   * and so the drug editor can show prose, sig and readback side by side.
   */
  sourceText: string;
  /** Which OR-branch of the statement this is. */
  alternative: number;
  /** 0 unless the sheet gives a sequence; ordering is the sheet's own. */
  step: number;
  /** "Load", "Maintenance", "Day 1" -- the sheet's word for this step. */
  label: string | null;
  /**
   * The indication this dose belongs to, **as the prose wrote it**, or null
   * for "this is the drug's dose".
   *
   * The written wording rather than a slug or an id, because this type is the
   * parser's output and the parser has no database. Resolving it to one of the
   * drug's own indication rows happens where the row is stored; an indication
   * that does not resolve becomes review work rather than a silent drop.
   *
   * Sildenafil is why it exists: 20 mg three times a day for pulmonary
   * hypertension, 50 mg an hour before sex for erectile dysfunction, and the
   * two sold as Revatio and Viagra.
   */
  indication: string | null;
  /** More than one only for combination products: carbidopa/levodopa 25/100 mg. */
  amounts: Amount[];
  /** More than one where the sheet offers a choice: naloxone IV/IM/subQ. */
  routes: RouteCode[];
  site: Site | null;
  frequency: Frequency;
  modifiers: Modifier[];
  duration: Duration | null;
  /** Clozapine's "(MAX 900 mg/day)". A ceiling is a limit, never a dose. */
  ceiling: Amount | null;
  /**
   * Prose the components do not carry, kept so nothing is lost and rendered
   * after the sig -- but never compared, since wording is not a fact.
   */
  qualifiers: string[];
};

/** An empty regimen, so builders and the parser start from one shape. */
export function emptyRegimen(): Regimen {
  return {
    sourceText: '',
    alternative: 0,
    step: 0,
    label: null,
    indication: null,
    amounts: [],
    routes: [],
    site: null,
    frequency: { kind: 'unspecified' },
    modifiers: [],
    duration: null,
    ceiling: null,
    qualifiers: [],
  };
}
