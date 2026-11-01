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
  | { kind: 'per_day'; times: number }
  | { kind: 'interval'; low: number; high: number | null; unit: 'minute' | 'hour' | 'day' | 'week' | 'month' }
  | { kind: 'once' }
  /** An infusion: the rate on the amount carries the schedule. */
  | { kind: 'continuous' }
  | { kind: 'unspecified' };

/**
 * Modifiers are orthogonal to frequency and combine freely, which is the whole
 * reason they are not frequency values: "three times a day as needed" is TID
 * *and* PRN, and 12 drugs in this data set are written that way.
 */
export type Modifier = 'PRN' | 'HS' | 'AC' | 'PC' | 'AM' | 'PM' | 'EVENING' | 'WITH_FOOD';

export const MODIFIERS: Record<Modifier, { sig: string; label: string }> = {
  PRN: { sig: 'PRN', label: 'as needed' },
  HS: { sig: 'HS', label: 'at bedtime' },
  AC: { sig: 'AC', label: 'before meals' },
  PC: { sig: 'PC', label: 'after meals' },
  AM: { sig: 'AM', label: 'in the morning' },
  PM: { sig: 'PM', label: 'in the evening' },
  EVENING: { sig: 'in the evening', label: 'in the evening' },
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
  /** 0 unless the sheet gives a sequence; ordering is the sheet's own. */
  step: number;
  /** "Load", "Maintenance", "Day 1" -- the sheet's word for this step. */
  label: string | null;
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
    step: 0,
    label: null,
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
