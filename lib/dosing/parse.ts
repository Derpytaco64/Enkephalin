import {
  emptyRegimen,
  type Amount,
  type Duration,
  type Modifier,
  type Regimen,
  type RouteCode,
  type Site,
  type UnitCode,
} from './model';

/**
 * Prose -> components, for the one-time backfill and for the drug editor.
 *
 * The parser's job is not to succeed. It is to be honest about failing: a
 * dosing it half-understands, written confidently into the database, is worse
 * than one it declined, because the quiz will then build options against a
 * fact nobody checked.
 *
 * So every component it recognises is *consumed* from a working copy of the
 * text, and whatever is left over at the end is reported. Residue means the
 * parse dropped meaning -- it read "0.5 mg" out of "0.5 mg/kg" and left "kg"
 * behind -- and a row with residue is refused rather than stored.
 *
 * See PLAN.md, "Dosing is stored twice: prose to read, structure to compare".
 */

export type ParseStatus =
  /** Every token accounted for; safe to use in multiple choice. */
  | 'parsed'
  /** Understood, but something about it wants a human before it is quizzed. */
  | 'needs_review'
  /** Meaning was left on the floor. Nothing is stored; the prose still shows. */
  | 'refused';

export type ParseResult = {
  status: ParseStatus;
  regimens: Regimen[];
  /** False where multiple choice cannot ask this honestly. */
  quizzable: boolean;
  /** Why it needs review, or why it was refused. Shown in the queue. */
  notes: string[];
  /** The tokens the parse could not account for. */
  unconsumed: string[];
};

/* ------------------------------------------------------------ lexicon ----- */

/**
 * Written units, longest spelling first so "inhalations" is matched before a
 * shorter pattern can claim part of it.
 */
const UNIT_WORDS: [RegExp, UnitCode][] = [
  [/\binhalations?\b|\bpuffs?\b/i, 'inhalation'],
  [/\bcapsules?\b|\bcaps?\b/i, 'capsule'],
  [/\btablets?\b|\btabs?\b/i, 'tablet'],
  [/\bpatch(?:es)?\b/i, 'patch'],
  [/\bsprays?\b/i, 'spray'],
  [/\bdrops?\b|\bgtts?\b/i, 'drop'],
  [/\bmcg\b|\bmicrograms?\b/i, 'mcg'],
  [/\bmEq\b/i, 'mEq'],
  [/\bmg\b|\bmilligrams?\b/i, 'mg'],
  [/\bng\b/i, 'ng'],
  [/\bmL\b|\bml\b/i, 'mL'],
  [/\bunits?\b/i, 'unit'],
  [/\bg\b|\bgrams?\b/i, 'g'],
];

const ROUTE_WORDS: [RegExp, RouteCode][] = [
  [/\bby mouth\b|\borally\b|\boral\b|\bPO\b/i, 'PO'],
  [/\bintravenous(?:ly)?\b|\bIV\b/i, 'IV'],
  [/\bintramuscular(?:ly)?\b|\bIM\b/i, 'IM'],
  [/\bsubcutaneous(?:ly)?\b|\bsub-?Q\b|\bSQ\b|\bSC\b/i, 'SC'],
  [/\bnebuli(?:z|s)(?:ed|er)\b/i, 'NEB'],
  [/\binhal(?:ed|ation|er)\b/i, 'INH'],
  [/\bophthalmic\b/i, 'OPH'],
  [/\botic\b/i, 'OTIC'],
  [/\bintranasal(?:ly)?\b|\bnasal(?:ly)?\b/i, 'NAS'],
  [/\btransdermal(?:ly)?\b/i, 'TD'],
  [/\bsublingual(?:ly)?\b|\bSL\b/i, 'SL'],
  [/\brectal(?:ly)?\b|\bPR\b/i, 'PR'],
  [/\bvaginal(?:ly)?\b|\bPV\b/i, 'PV'],
  [/\btopical(?:ly)?\b/i, 'TOP'],
];

const MODIFIER_WORDS: [RegExp, Modifier][] = [
  [/\bas needed\b|\bPRN\b|\bprn\b/i, 'PRN'],
  [/\bat bedtime\b|\bbedtime\b|\bHS\b/i, 'HS'],
  [/\bbefore meals\b|\bAC\b/i, 'AC'],
  [/\bafter meals\b|\bPC\b/i, 'PC'],
  [/\bin the morning\b/i, 'AM'],
  [/\bin the evening\b/i, 'PM'],
  [/\bwith (?:food|meals|a meal|(?:morning|evening) meal)\b/i, 'WITH_FOOD'],
];

/** The site patterns, each carrying whether the sheet said "each" or "affected". */
const SITE_WORDS: [RegExp, Site['region'], Site['basis']][] = [
  [/\b(?:in|into|per)?\s*each eye\b/i, 'eye', 'each'],
  [/\baffected eye\(s\)|\baffected eyes?\b/i, 'eye', 'affected'],
  [/\b(?:in|into|per)?\s*each nostril\b|\bper nostril\b/i, 'nostril', 'each'],
  [/\baffected nostril\b/i, 'nostril', 'affected'],
  [/\b(?:in|into|per)?\s*each ear\b/i, 'ear', 'each'],
  [/\baffected ear\b/i, 'ear', 'affected'],
  [/\baffected area\b/i, 'skin', 'affected'],
];

/**
 * Words with no component meaning: grammar, and instruction verbs that say
 * only "give it". Treated as consumed so they do not count as residue.
 *
 * Deliberately excludes every noun that carries meaning -- no "day", "dose" or
 * "hour" here, because those appearing in the residue is exactly the signal
 * that a frequency or duration was missed.
 */
const FILLER = new RegExp(
  '\\b(?:' +
  'a|an|the|of|by|to|in|into|on|at|per|as|for|and|or|with|is|are|be|may|up|' +
  'apply|applied|take|taken|instill|instilled|administer|administered|give|given|use|used|' +
  'inject|injected|infuse|infused|infusion|bolus|swallow|placed|swish|rinse|' +
  'divided|regimen|consisting|total|dose|doses' +
  ')\\b',
  'gi',
);

/** Qualifiers that make a row unfit for multiple choice however well it parses. */
const NOT_QUIZZABLE = /\btitrat\w*|\bindividuali(?:z|s)ed\b|\bvariable\b|\bproduct dependent\b|\bvaries\b|\bper protocol\b/i;

/* ------------------------------------------------------- the consumer ----- */

const NUM = String.raw`\d+(?:\.\d+)?`;

/** The sheet writes small counts as words as often as digits. */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 10, ten: 10, twelve: 12, twenty: 20,
};
const WORD_NUM = Object.keys(WORD_NUMBERS).join('|');
/** Either spelling, for patterns that take a count. */
const COUNT = `${NUM}|${WORD_NUM}`;

function count(token: string): number {
  return WORD_NUMBERS[token.toLowerCase()] ?? Number(token);
}

/**
 * Wording that restates or decorates a component without adding a fact the
 * comparison needs: the release form, the delivery device, and phrasings that
 * repeat a frequency already read ("three times daily 8 hours apart").
 *
 * These become qualifiers rather than residue -- kept and shown, never
 * compared -- because refusing a row over "ER" would bury the real refusals.
 */
const DECORATION: { pattern: RegExp; note?: string }[] = [
  { pattern: /\b(?:ER|XR|SR|XL|DR|IR|CR|MDI|HFA|DPI)\b/ },
  { pattern: /\b\d+\s*(?:hours?|minutes?)\s*(?:apart|intervals?)\b/i },
  { pattern: /\bat \d+\s*hours?\s*intervals?\b/i },
  { pattern: /\bover \d+\s*(?:seconds?|minutes?|hours?)\b/i },
  { pattern: /\bfor \d+\s*seconds?\b/i },
  // "every 4 hours for 5 doses/day" -- the second half restates the first.
  { pattern: /\bfor \d+\s*doses?\s*\/\s*day\b/i },
  { pattern: /\b\d+\s*minutes?\s*(?=before|after)/i },
  { pattern: /\bmay repeat(?: dose)?[^,.]*/i },
  { pattern: /\bmay require[^,.]*/i },
  { pattern: /\bif [^,.]*/i },
  { pattern: /\bdiskus\b/i },
  { pattern: /\bon an empty stomach\b/i },
  // "200 mg/25 mg capsule by mouth": a bare form noun standing before the
  // route names the product, and is not a second dose.
  { pattern: /\b(?:capsules?|tablets?|caps?|tabs?)\b(?=\s+(?:by mouth|orally|PO)\b)/i },
  /**
   * "4 grams daily in 1 or 2 doses", "50 mg daily in single or divided doses".
   * Not decoration at all, once a frequency has also been read: a daily total
   * split in two is BID, not QD. The frequency is genuinely ambiguous, so the
   * row wants a human rather than a confident "QD".
   */
  {
    pattern: /\b(?:in|as)\s+(?:a\s+)?(?:single|\d+(?:\s*or\s*\d+)?)\s*(?:or\s+divided\s+)?doses?\b/i,
    note: 'The source gives a daily total without saying how it is divided, so the frequency is ambiguous.',
  },
  {
    pattern: /\bin divided doses\b/i,
    note: 'The source gives a daily total without saying how it is divided, so the frequency is ambiguous.',
  },
];

/**
 * Holds the text being read and blanks out each span it gives up, so the
 * residue at the end is precisely what nothing claimed.
 */
class Reader {
  text: string;

  constructor(text: string) {
    this.text = text;
  }

  /** Matches, blanks the match out, and hands back the groups. */
  take(pattern: RegExp): RegExpMatchArray | null {
    const match = this.text.match(pattern);
    if (!match || match.index === undefined) return null;
    this.blank(match.index, match[0].length);
    return match;
  }

  /** Every match, left to right, each one consumed. */
  takeAll(pattern: RegExp): RegExpMatchArray[] {
    const found: RegExpMatchArray[] = [];
    for (;;) {
      const match = this.take(pattern);
      if (!match) break;
      found.push(match);
    }
    return found;
  }

  blank(index: number, length: number) {
    this.text = this.text.slice(0, index) + ' '.repeat(length) + this.text.slice(index + length);
  }

  /** What nothing claimed, filler and punctuation aside. */
  residue(): string[] {
    return this.text
      .replace(FILLER, ' ')
      .replace(/[(),.;:/+–—-]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  }
}

/* ----------------------------------------------------------- helpers ------ */

function normalize(prose: string): string {
  return prose
    .replace(/[–—]/g, '-')
    .replace(/’/g, "'")
    // The sheet wraps mid-range: "every 4- 6 hours".
    .replace(/(\d)\s*-\s*(\d)/g, '$1-$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function unitFrom(reader: Reader, near: string): UnitCode | null {
  for (const [pattern, code] of UNIT_WORDS) {
    if (pattern.test(near)) {
      reader.take(pattern);
      return code;
    }
  }
  return null;
}

/**
 * Reads amounts. The slash is the trap here: it means a combination in
 * "500/125 mg", per-weight in "0.5 mg/kg", per-time in "mcg/kg/min", and a
 * choice of routes in "IV/IM/subQ". Each is matched by what sits on both
 * sides of it rather than by the character alone, most specific first.
 */
function readAmounts(reader: Reader, qualifiers: string[]): Amount[] {
  const amounts: Amount[] = [];

  // "1 inhalation of 100/25 mcg", "2 sprays of 50 mcg". The dose is the count
  // of actuations; the figure after "of" is the product's strength, which is a
  // fact about the product and not the amount given. Reading the strength as
  // the dose -- which a plain amount pass does -- is wrong, not merely
  // incomplete, so this runs first.
  const actuated = reader.take(
    new RegExp(
      `(${COUNT})\\s*(inhalations?|puffs?|sprays?|drops?|tablets?|capsules?)\\s+of\\s+([\\d.\\s/]+\\s*(?:mcg|mg|g))`,
      'i',
    ),
  );
  if (actuated) {
    const unit = unitFrom(new Reader(actuated[2]), actuated[2]);
    qualifiers.push(`${actuated[3].replace(/\s+/g, ' ').trim()} per ${actuated[2].replace(/s$/, '')}`);
    if (unit) {
      amounts.push({ low: count(actuated[1]), high: null, unit, perKg: false, per: null, active: null });
      return amounts;
    }
  }

  // Rate: 2-5 mcg/kg/minute. Must run before the plain amount, which would
  // otherwise take "2-5 mcg" and abandon "/kg/minute" as residue.
  const rate = reader.take(
    new RegExp(`(${NUM})(?:\\s*-\\s*(${NUM}))?\\s*(mcg|mg|ng|units?)\\s*/\\s*kg(?:\\s*/\\s*(min(?:ute)?|hour|h|day))?`, 'i'),
  );
  if (rate) {
    const per = rate[4]?.toLowerCase();
    amounts.push({
      low: Number(rate[1]),
      high: rate[2] ? Number(rate[2]) : null,
      unit: rate[3].toLowerCase().startsWith('unit') ? 'unit' : (rate[3].toLowerCase() as UnitCode),
      perKg: true,
      per: per ? (per.startsWith('min') ? 'minute' : per === 'h' ? 'hour' : (per as 'hour' | 'day')) : null,
      active: null,
    });
    return amounts;
  }

  // Combination with each half's unit spelled out: "200 mg/25 mg capsule",
  // "160 mcg/4.5 mcg". Before the shared-unit form, which would otherwise take
  // the first number and leave the second half as residue.
  const spelled = reader.take(
    new RegExp(`(${NUM})\\s*(mcg|mg|g)\\s*/\\s*(${NUM})\\s*(mcg|mg|g)\\b`, 'i'),
  );
  if (spelled) {
    amounts.push(
      { low: Number(spelled[1]), high: null, unit: spelled[2].toLowerCase() as UnitCode, perKg: false, per: null, active: null },
      { low: Number(spelled[3]), high: null, unit: spelled[4].toLowerCase() as UnitCode, perKg: false, per: null, active: null },
    );
    return amounts;
  }

  // Combination strength: 500/125 mg, 25/100 mg, 50/300/40 mg. Digits on both
  // sides of the slash, which "mg/kg" cannot satisfy.
  const combination = reader.take(
    new RegExp(`(${NUM})\\s*/\\s*(${NUM})(?:\\s*/\\s*(${NUM}))?\\s*(mcg|mg|g)\\b`, 'i'),
  );
  if (combination) {
    const unit = combination[4].toLowerCase() as UnitCode;
    for (const value of [combination[1], combination[2], combination[3]]) {
      if (value === undefined) continue;
      amounts.push({ low: Number(value), high: null, unit, perKg: false, per: null, active: null });
    }
    return amounts;
  }

  // Plain amount, with or without a range: 10 mg, 200-300 mg, 1-2 tablets,
  // "One tablet" -- the sheet writes small counts as words as often as digits.
  for (;;) {
    const match = reader.take(new RegExp(`(${COUNT})(?:\\s*-\\s*(${COUNT}))?\\s*([A-Za-z]+)`, 'i'));
    if (!match) break;

    const unit = unitFrom(new Reader(match[3]), match[3]);
    if (!unit) {
      // The number belonged to something else -- a frequency, a duration -- so
      // put the text back for the pass that owns it.
      reader.text = reader.text.slice(0, match.index!) + match[0] + reader.text.slice(match.index! + match[0].length);
      break;
    }

    reader.take(new RegExp(`\\b${match[3]}\\b`));
    amounts.push({
      low: count(match[1]),
      high: match[2] ? count(match[2]) : null,
      unit,
      perKg: false,
      per: null,
      active: null,
    });
    break;
  }

  return amounts;
}

function readFrequency(reader: Reader): Regimen['frequency'] {
  // "a day", "daily", "per day" and "each day" are one phrasing in four.
  const DAY = String.raw`(?:a day|daily|per day|each day|a d)`;

  const perDayWords: [RegExp, number][] = [
    [new RegExp(`\\bfour times ${DAY}\\b|\\bQID\\b`, 'i'), 4],
    [new RegExp(`\\bthree times? ${DAY}\\b|\\bTID\\b`, 'i'), 3],
    [new RegExp(`\\btwo times? ${DAY}\\b|\\btwice ${DAY}\\b|\\bBID\\b`, 'i'), 2],
    [new RegExp(`\\bonce ${DAY}\\b|\\bone time ${DAY}\\b|\\bQD\\b`, 'i'), 1],
  ];
  for (const [pattern, times] of perDayWords) {
    if (reader.take(pattern)) return { kind: 'per_day', times, timesHigh: null };
  }

  // A count that is itself a range: "2-3 times a day", "1-2 times per day".
  const ranged = reader.take(new RegExp(`(${COUNT})\\s*-\\s*(${COUNT})\\s*times? ${DAY}`, 'i'));
  if (ranged) {
    return { kind: 'per_day', times: count(ranged[1]), timesHigh: count(ranged[2]) };
  }

  const counted = reader.take(new RegExp(`(${COUNT})\\s*times? ${DAY}`, 'i'));
  if (counted) return { kind: 'per_day', times: count(counted[1]), timesHigh: null };

  if (reader.take(/\bevery other day\b|\bQOD\b/i)) {
    return { kind: 'interval', low: 2, high: null, unit: 'day' };
  }

  // "once weekly", "once a week", "once per month".
  const onceEvery = reader.take(/\bonce (?:a |per |every )?(week|month|day)(?:ly)?\b|\bQWK\b/i);
  if (onceEvery) {
    const unit = (onceEvery[1] ?? 'week') as 'week' | 'month' | 'day';
    return unit === 'day'
      ? { kind: 'per_day', times: 1, timesHigh: null }
      : { kind: 'interval', low: 1, high: null, unit };
  }

  const interval = reader.take(
    new RegExp(`\\bevery (${COUNT})(?:\\s*-\\s*(${COUNT}))?\\s*(minutes?|hours?|days?|weeks?|months?)\\b`, 'i'),
  );
  if (interval) {
    const unit = interval[3].toLowerCase().replace(/s$/, '') as 'minute' | 'hour' | 'day' | 'week' | 'month';
    return { kind: 'interval', low: count(interval[1]), high: interval[2] ? count(interval[2]) : null, unit };
  }

  const short = reader.take(/\bq(\d+)h\b/i);
  if (short) return { kind: 'interval', low: Number(short[1]), high: null, unit: 'hour' };

  if (reader.take(/\bcontinuous(?: infusion)?\b/i)) return { kind: 'continuous' };

  // "daily" on its own, only after the compound phrases above have had their
  // turn, so "once daily" is never read as a bare "daily".
  if (reader.take(/\bdaily\b|\bevery day\b/i)) return { kind: 'per_day', times: 1, timesHigh: null };
  if (reader.take(/\bonce\b/i)) return { kind: 'once' };

  return { kind: 'unspecified' };
}

function readDuration(reader: Reader): Duration | null {
  const cycle = reader.take(new RegExp(`\\bevery (${NUM})[- ]day cycle\\b`, 'i'));
  const span = reader.take(
    new RegExp(`\\bfor (?:a maximum of )?(${NUM})(?:\\s*-\\s*(${NUM}))?\\s*(doses?|days?|weeks?|months?)\\b`, 'i'),
  );

  if (!span && !cycle) return null;
  if (!span) {
    return { low: 0, high: null, unit: 'day', cycleDays: Number(cycle![1]) };
  }

  return {
    low: Number(span[1]),
    high: span[2] ? Number(span[2]) : null,
    unit: span[3].toLowerCase().replace(/s$/, '') as Duration['unit'],
    cycleDays: cycle ? Number(cycle[1]) : null,
  };
}

function readCeiling(reader: Reader): Amount | null {
  const match = reader.take(
    new RegExp(
      `\\b(?:MAX(?:IMUM)?(?: total)?|not to exceed|up to)\\s*(${NUM})\\s*(mcg|mg|g|mL|units?)\\s*(?:/|per )?\\s*(day|24 hours)?`,
      'i',
    ),
  );
  if (!match) return null;

  return {
    low: Number(match[1]),
    high: null,
    unit: match[2].toLowerCase().startsWith('unit') ? 'unit' : (match[2] as UnitCode),
    perKg: false,
    per: match[3] ? 'day' : null,
    active: null,
  };
}

function readSite(reader: Reader): Site | null {
  for (const [pattern, region, basis] of SITE_WORDS) {
    const match = reader.take(pattern);
    if (match) return { region, basis, note: null };
  }
  return null;
}

/**
 * Splits the prose into the regimens it actually describes: alternatives on
 * "OR", and sequences on "then" or "followed by". Each becomes its own row,
 * which is why dosing is a table rather than a single field.
 */
function segment(prose: string): { text: string; step: number; label: string | null; alternative: number }[] {
  // Uppercase OR is how the sheet separates alternatives. A lowercase "or"
  // starts a new regimen only when a dose follows, so "in 1 or 2 doses" and
  // "single or divided doses" stay inside the one regimen they describe.
  const alternatives = prose.split(
    /\s+OR\s+|\s+or\s+(?=\d+(?:\.\d+)?\s*(?:mg|mcg|g|mL|gram|unit))/,
  );
  const segments: { text: string; step: number; label: string | null; alternative: number }[] = [];

  alternatives.forEach((alternative, index) => {
    // A sequence is written three ways: joined by "then", introduced by a
    // labelled phase ("Continuous infusion:"), or simply comma-separated with
    // each step naming its own days, as azithromycin does.
    const steps = alternative.split(
      new RegExp(
        [
          String.raw`,?\s+(?:then|followed by)\s+`,
          String.raw`,\s*(?=(?:Continuous|Maintenance|Initial|Load|IV bolus)\b)`,
          String.raw`,\s*(?=\d+(?:\.\d+)?\s*(?:mg|mcg|g|mL)\b)`,
        ].join('|'),
        'i',
      ),
    );

    steps.forEach((step, order) => {
      let text = step;
      let label: string | null = null;

      const phase = text.match(/^\s*(Load(?:ing dose)?|Initial(?: dose)?|Maintenance|IV bolus|Continuous infusion)\s*:?\s*/i);
      if (phase) {
        label = phase[1];
        text = text.slice(phase[0].length);
      }

      // Or trailing, as in "200 mg by mouth initially then ...".
      const trailing = text.match(/\s+\b(initially|first|to start)\b/i);
      if (trailing) {
        label = label ?? 'Initial';
        text = text.replace(trailing[0], ' ');
      }

      // "on day 1", "on days 2-5" -- the step's own place in the course.
      const days = text.match(/\s*\bon days?\s*(\d+(?:\s*-\s*\d+)?)\b/i);
      if (days) {
        label = `Day${days[1].includes('-') ? 's' : ''} ${days[1].replace(/\s+/g, '')}`;
        text = text.replace(days[0], ' ');
      }

      if (!label && steps.length > 1 && order > 0) label = 'then';

      segments.push({ text, step: order, label, alternative: index });
    });
  });

  return segments;
}

/** Reads one segment into one regimen, and reports what it could not place. */
function readRegimen(text: string, step: number, label: string | null): {
  regimen: Regimen;
  residue: string[];
  qualifiers: string[];
  ambiguities: string[];
} {
  const reader = new Reader(normalize(text));
  const qualifiers: string[] = [];
  const ambiguities: string[] = [];

  // Parentheticals first. A ceiling hiding in one is a component; anything
  // else is wording we keep but never compare -- "(90mcg HFA)", "(XR)",
  // "(dose is combination of ampicillin and sulbactam)".
  for (const match of reader.takeAll(/\(([^)]*)\)/)) {
    const inner = match[1].trim();
    if (!inner) continue;

    const ceiling = new Reader(inner);
    if (readCeiling(ceiling)) {
      // Put it back unparenthesised so the ceiling pass below claims it.
      reader.text += ` ${inner}`;
      continue;
    }
    qualifiers.push(inner);
  }

  // Decoration next: wording that restates a component or names the product
  // form. Kept as a qualifier so it neither skews the comparison nor looks
  // like a dropped fact.
  for (const { pattern, note } of DECORATION) {
    const match = reader.take(pattern);
    if (!match) continue;
    qualifiers.push(match[0].trim());
    if (note) ambiguities.push(note);
  }

  const regimen: Regimen = { ...emptyRegimen(), step, label };

  regimen.ceiling = readCeiling(reader);
  regimen.duration = readDuration(reader);
  regimen.amounts = readAmounts(reader, qualifiers);
  regimen.site = readSite(reader);

  for (const [pattern, code] of ROUTE_WORDS) {
    if (reader.take(pattern)) regimen.routes.push(code);
  }

  regimen.frequency = readFrequency(reader);

  for (const [pattern, modifier] of MODIFIER_WORDS) {
    if (reader.take(pattern)) regimen.modifiers.push(modifier);
  }

  // A route the dose form implies rather than names. Each of these is a fact
  // about the form, not a guess: a dose counted in inhalations is inhaled, and
  // drops into the eye are ophthalmic.
  if (regimen.routes.length === 0) {
    const unit = regimen.amounts[0]?.unit;
    if (unit === 'inhalation') regimen.routes.push('INH');
    else if (regimen.site?.region === 'eye') regimen.routes.push('OPH');
    else if (regimen.site?.region === 'ear') regimen.routes.push('OTIC');
    else if (regimen.site?.region === 'nostril') regimen.routes.push('NAS');
    else if (regimen.site?.region === 'skin') regimen.routes.push('TOP');
  }

  // "5-10 mg by mouth at bedtime" states a frequency, in the way a pharmacist
  // reads it: a bedtime dose is one dose a day. Same for a morning or evening
  // dose. This is a reading of the sig conventions rather than a guess at a
  // number the sheet withheld.
  if (regimen.frequency.kind === 'unspecified'
      && regimen.modifiers.some((modifier) => ['HS', 'AM', 'PM'].includes(modifier))) {
    regimen.frequency = { kind: 'per_day', times: 1, timesHigh: null };
  }

  const leftover = reader.residue();
  // Qualifier prose that survived outside parentheses, e.g. a trailing
  // "titrated to clinical effect", is wording rather than residue.
  const qualifierTail = leftover.join(' ');
  if (NOT_QUIZZABLE.test(qualifierTail)) {
    qualifiers.push(qualifierTail);
    regimen.qualifiers = qualifiers;
    return { regimen, residue: [], qualifiers, ambiguities };
  }

  regimen.qualifiers = qualifiers;
  return { regimen, residue: leftover, qualifiers, ambiguities };
}

/**
 * Parses a dosing string into the regimens it describes.
 *
 * `actives` is the generic name split on its own separators, used only to
 * label a combination's amounts. The counts must match exactly or the labels
 * are left off: assigning 125 to the amoxicillin would be worse than not
 * saying which is which.
 */
export function parseDosing(prose: string, actives: string[] = []): ParseResult {
  const text = (prose ?? '').trim();
  if (!text) {
    return { status: 'refused', regimens: [], quizzable: false, notes: ['No dosing text.'], unconsumed: [] };
  }

  const notes: string[] = [];
  const regimens: Regimen[] = [];
  const unconsumed: string[] = [];
  // Tracked apart from `notes`, because the two say different things: a note
  // asks a human to look, while this says multiple choice must not ask at all.
  let unquizzable = false;

  for (const piece of segment(text)) {
    const { regimen, residue, qualifiers, ambiguities } = readRegimen(piece.text, piece.step, piece.label);
    regimens.push(regimen);
    unconsumed.push(...residue);
    notes.push(...ambiguities);
    if (qualifiers.some((qualifier) => NOT_QUIZZABLE.test(qualifier))) {
      notes.push('Dosing is individualised or titrated, so multiple choice cannot ask it.');
      unquizzable = true;
    }
  }

  // The sheet states the route once and lets it stand for the rest of the
  // string: "10 mg orally once daily OR 70 mg once weekly" is oral twice, and
  // alteplase's second step runs by the same line as its first.
  let carried: RouteCode[] = [];
  for (const regimen of regimens) {
    if (regimen.routes.length > 0) carried = regimen.routes;
    else if (carried.length > 0) regimen.routes = [...carried];
  }

  if (regimens.some((regimen) => regimen.routes.length === 0 && regimen.amounts.length > 0)) {
    // Not an error -- blank means unsaid here as everywhere -- but a sig with
    // no route is an incomplete sig, so a human should fill it in.
    notes.push('The source never gives a route.');
  }

  // Label a combination's amounts, or say nothing at all.
  for (const regimen of regimens) {
    if (regimen.amounts.length < 2) continue;
    if (actives.length === regimen.amounts.length) {
      regimen.amounts.forEach((amount, index) => { amount.active = actives[index]; });
    } else if (actives.length > 1) {
      notes.push(
        `The name gives ${actives.length} actives and the dosing ${regimen.amounts.length} amounts, so which number belongs to which drug is unconfirmed.`,
      );
    }
  }

  const nothingRead = regimens.every(
    (regimen) => regimen.amounts.length === 0
      && regimen.routes.length === 0
      && regimen.site === null
      && regimen.frequency.kind === 'unspecified',
  );
  if (nothingRead) {
    return {
      status: 'refused',
      regimens: [],
      quizzable: false,
      notes: [...notes, 'Nothing could be read from this dosing.'],
      unconsumed,
    };
  }

  // An amount the sheet never gives -- "apply to affected area" -- leaves the
  // rest of the regimen perfectly good, and a dose question unaskable.
  if (regimens.some((regimen) => regimen.amounts.length === 0)) {
    notes.push('The source never gives an amount.');
    unquizzable = true;
  }

  if (unconsumed.length > 0) {
    return {
      status: 'refused',
      regimens: [],
      quizzable: false,
      notes: [...notes, `Left unread: ${unconsumed.join(' ')}. Parsing it would drop part of the meaning.`],
      unconsumed,
    };
  }

  // A frequency the sheet never fixed cannot be a multiple-choice answer
  // either: there is nothing to be right about.
  const noFrequency = regimens.some((regimen) => regimen.frequency.kind === 'unspecified');
  if (noFrequency) {
    notes.push('The source never gives a frequency.');
    unquizzable = true;
  }

  return {
    status: notes.length > 0 ? 'needs_review' : 'parsed',
    regimens,
    quizzable: !unquizzable,
    notes,
    unconsumed: [],
  };
}
