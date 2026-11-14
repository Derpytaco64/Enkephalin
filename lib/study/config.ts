/**
 * The one config flashcards and the quiz both read, so the two modes are built
 * once. Client-safe: no database imports.
 */

/**
 * How a session runs, after the Obsidian spaced-repetition plugin's two.
 *
 * `review` is the schedule doing its job: only what is due, graded on the full
 * scale, and the answer moves the card's next date.
 *
 * `cram` is the night before: everything in scope whether due or not, two
 * buttons, and the schedule left exactly where it was. Those three go together
 * -- a cram pass that quietly rescheduled would flatten weeks of spacing into
 * one evening, which is why this is one choice rather than three.
 */
export type SessionMode = 'review' | 'cram';

export type StudyMode = 'inclusive' | 'exclusive';
export type StudyDirection = 'drug_to_fields' | 'fields_to_drug' | 'field_to_field';
export type GradingScale = 'binary' | 'four-point';
export type YearLevel = 'P1' | 'P2' | 'P3';

export type StudyScope = {
  /** Drug lists, such as the sheet edition: `top-drugs-2026`. */
  tags: string[];
  /**
   * Whether a drug must be on **every** list picked rather than any of them.
   *
   * Default false, which is the rule every other axis follows and the one that
   * can never return nothing. True is the intersection -- *Top Drugs 2026 and
   * PHRM 535* -- which is a question only this axis raises, because only this
   * axis holds several kinds of list at once. See `ScopePicker`'s `all`.
   */
  tagsAll: boolean;
  /**
   * Therapeutic categories -- anticonvulsants, beta blockers -- held as tags
   * of kind `system` and so drawn from the same `drug_tags` table as the
   * lists above.
   *
   * Its own axis rather than more entries in `tags`, because the two combine
   * differently: picking two lists means either list, but picking a list and
   * a category means the drugs in both. "Top Drugs 2026 + Anticonvulsants" is
   * the anticonvulsants *within* that list, which one OR-ed array cannot say.
   */
  categories: string[];
  /**
   * What the drugs are used for, as indication slugs (see
   * `lib/drugs/indications.ts`). The third axis for the same reason as the
   * second: "the antihypertensives" and "the drugs used for hypertension"
   * overlap but are not the same question, and a drug has several indications
   * the way it has several categories.
   *
   * Narrows like the others -- several indications mean any of them, and a
   * list or category still applies on top.
   */
  indications: string[];
  /**
   * The FDA class, far more granular than a category: 80 of its 119 values
   * name a single drug. Kept as a filter and as the axis same-class distractors
   * are drawn along; `categories` is what you study by.
   */
  classes: string[];
  schedules: string[];
  routes: string[];
  /** Only cards the schedule says are due. Ignored while cramming. */
  dueOnly: boolean;
};

export type StudyConfig = {
  sessionMode: SessionMode;
  scope: StudyScope;
  yearLevel: YearLevel | null;
  fields: string[];
  mode: StudyMode;
  direction: StudyDirection;
  /** 0 turns blocks off and the session is one flat pass. */
  blockSize: number;
  /**
   * The most cards this session will hand you. 0 means the whole deck, which
   * is the default and what the control shows when untouched.
   *
   * Above this, the deck is *sampled at random* rather than truncated. Taking
   * the first 50 of 236 would be the first 50 alphabetically every time, so
   * you would learn the start of the sheet and never reach the end of it.
   */
  maxCards: number;
  grading: GradingScale;
};

/** Review grades on the full scale; cram is two buttons. Either can be changed. */
export function defaultGradingFor(mode: SessionMode): GradingScale {
  return mode === 'cram' ? 'binary' : 'four-point';
}

/**
 * What the mode settles, in one place, so no caller has to keep three
 * correlated flags in step.
 */
export function sessionRules(config: StudyConfig) {
  const cramming = config.sessionMode === 'cram';
  return {
    /** Cram takes everything in scope: waiting for due dates is the thing it exists to skip. */
    dueOnly: cramming ? false : config.scope.dueOnly,
    reschedules: !cramming,
    grading: config.grading,
  };
}

export const DEFAULT_CONFIG: StudyConfig = {
  sessionMode: 'review',
  scope: {
    tags: [], tagsAll: false,
    categories: [], indications: [], classes: [], schedules: [], routes: [],
    dueOnly: true,
  },
  yearLevel: null,
  fields: [],
  // One card per drug by default: a field set over 236 drugs runs to
  // thousands of cards per fact, which is a deck nobody finishes.
  mode: 'inclusive',
  direction: 'drug_to_fields',
  blockSize: 10,
  // No cap: the session is the deck until you say otherwise.
  maxCards: 0,
  grading: 'four-point',
};

/**
 * yearLevel is a shortcut over `fields`, not a separate mechanism: picking P2
 * selects exactly the fields the sheet makes P2 responsible for, and the list
 * stays hand-adjustable afterwards.
 */
export function fieldsForYear(
  defs: { key: string; yearLevels: string[]; isQuizzable: boolean }[],
  year: YearLevel,
) {
  return defs.filter((def) => def.isQuizzable && def.yearLevels.includes(year)).map((def) => def.key);
}

/**
 * Identifies a card's schedule across sessions. Built from the sorted field
 * set and the direction, so changing the selection and changing back lands on
 * the same key rather than orphaning the card's history.
 *
 * Exclusive cards name their single field; inclusive cards name the whole set,
 * because "MOA alone" and "MOA plus dosing together" are different things to
 * recall and deserve separate schedules.
 *
 * `part` is for a field asked one named piece at a time -- a regimen, where
 * each heading is a protocol and each protocol is its own card. Built from the
 * **name** rather than the position, so reordering the protocols in the field
 * does not shuffle every schedule along with them.
 */
export function cardKey(input: {
  mode: StudyMode;
  direction: StudyDirection;
  fieldKeys: string[];
  part?: string;
}) {
  const fields = [...input.fieldKeys].sort().join(',');
  const key = `${input.mode}:${input.direction}:${fields}`;
  return input.part ? `${key}#${input.part}` : key;
}

/**
 * A named piece of a field, as a card key can carry it.
 *
 * Its own spelling rather than `tagSlug`: that one lives beside the database
 * writes and this file is imported by the browser. The rule is the same, and
 * it has to stay that way for no better reason than that it is the rule --
 * nothing joins these two slugs together.
 */
export function partSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export function normalizeConfig(partial: Partial<StudyConfig> | null | undefined): StudyConfig {
  if (!partial) return DEFAULT_CONFIG;

  const sessionMode = partial.sessionMode ?? DEFAULT_CONFIG.sessionMode;
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    sessionMode,
    scope: { ...DEFAULT_CONFIG.scope, ...partial.scope },
    blockSize: Math.max(0, Math.floor(partial.blockSize ?? DEFAULT_CONFIG.blockSize)),
    maxCards: Math.max(0, Math.floor(partial.maxCards ?? DEFAULT_CONFIG.maxCards)),
    fields: partial.fields ?? [],
    // Switching mode without saying how to grade gets that mode's buttons.
    grading: partial.grading ?? defaultGradingFor(sessionMode),
  };
}
