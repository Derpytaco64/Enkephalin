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
  tags: string[];
  classes: string[];
  schedules: string[];
  routes: string[];
  /** Only values an admin has checked against a source. */
  verifiedOnly: boolean;
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
  scope: { tags: [], classes: [], schedules: [], routes: [], verifiedOnly: false, dueOnly: true },
  yearLevel: null,
  fields: [],
  mode: 'exclusive',
  direction: 'drug_to_fields',
  blockSize: 20,
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
 */
export function cardKey(input: {
  mode: StudyMode;
  direction: StudyDirection;
  fieldKeys: string[];
}) {
  const fields = [...input.fieldKeys].sort().join(',');
  return `${input.mode}:${input.direction}:${fields}`;
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
    fields: partial.fields ?? [],
    // Switching mode without saying how to grade gets that mode's buttons.
    grading: partial.grading ?? defaultGradingFor(sessionMode),
  };
}
