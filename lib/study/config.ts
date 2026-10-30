/**
 * The one config flashcards and the quiz both read, so the two modes are built
 * once. Client-safe: no database imports.
 */

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
  /** Only cards the schedule says are due. */
  dueOnly: boolean;
};

export type StudyConfig = {
  scope: StudyScope;
  yearLevel: YearLevel | null;
  fields: string[];
  mode: StudyMode;
  direction: StudyDirection;
  /** 0 turns blocks off and the session is one flat pass. */
  blockSize: number;
  grading: GradingScale;
};

export const DEFAULT_CONFIG: StudyConfig = {
  scope: { tags: [], classes: [], schedules: [], routes: [], verifiedOnly: false, dueOnly: false },
  yearLevel: null,
  fields: [],
  mode: 'exclusive',
  direction: 'drug_to_fields',
  blockSize: 20,
  // Two buttons by default: the question the night before an exam is whether
  // you knew it, not how comfortably.
  grading: 'binary',
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
  return {
    ...DEFAULT_CONFIG,
    ...partial,
    scope: { ...DEFAULT_CONFIG.scope, ...partial.scope },
    blockSize: Math.max(0, Math.floor(partial.blockSize ?? DEFAULT_CONFIG.blockSize)),
    fields: partial.fields ?? [],
  };
}
