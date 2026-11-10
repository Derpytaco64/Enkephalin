/**
 * Client-safe half of the field definitions: no database imports, so a client
 * component can read these without dragging the postgres driver into the
 * browser bundle. mutations.ts holds everything that touches the database.
 */

export type FieldDataType = 'text' | 'markdown' | 'enum' | 'list' | 'number' | 'bool';

export const FIELD_DATA_TYPES: FieldDataType[] = ['text', 'markdown', 'enum', 'list', 'number', 'bool'];
export const YEAR_LEVELS = ['P1', 'P2', 'P3'] as const;

/**
 * Keys are the identity of a field: they key drugs.fields and appear in prompt
 * templates, so they are lower snake_case and never change once created.
 * Renaming is a label change.
 */
export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{1,40}$/;

/**
 * The three booleans a field carries, with the words for them.
 *
 * In one place because two screens ask about them: the field editor, where
 * there is room for the whole sentence, and the field list, where there is
 * room for one word and a tooltip. Two copies of this copy is how a checkbox
 * ends up meaning something subtly different depending on where it was ticked.
 *
 * `short` is the list's label, `label` the editor's, `hint` the explanation
 * under it. `on` is what a new field gets.
 */
export const FIELD_FLAGS = [
  {
    key: 'blankMeansNone',
    short: 'none',
    label: 'Blank means none',
    hint: 'Tick where empty is the answer rather than a gap, as with a drug that has no black '
      + 'box warning. Unticked, an empty value reads as “not recorded yet”.',
    on: false,
  },
  {
    key: 'isQuizzable',
    short: 'quiz',
    label: 'Can be quizzed',
    hint: 'Unticked, the field still shows on a profile but no card or quiz question asks it.',
    on: true,
  },
  {
    key: 'defaultVisible',
    short: 'empty',
    label: 'Show on profiles even when empty',
    hint: 'Ticked, the field has a row on every drug, including the ones with nothing in it — '
      + 'which is how a gap gets noticed and filled. Unticked, it appears only on the drugs that '
      + 'have something to say, so the rest are not padded with rows reading “not recorded '
      + 'yet”. Either way a drug with a value shows it.',
    on: true,
  },
] as const;

export type FieldFlag = (typeof FIELD_FLAGS)[number]['key'];

export const isFieldFlag = (value: string): value is FieldFlag =>
  FIELD_FLAGS.some((flag) => flag.key === value);

export type Result = { ok: true } | { ok: false; message: string };

export type FieldDefInput = {
  label: string;
  group?: string | null;
  dataType: FieldDataType;
  enumOptions?: string[] | null;
  sortOrder?: number;
  yearLevels?: string[];
  blankMeansNone?: boolean;
  isQuizzable?: boolean;
  defaultVisible?: boolean;
  helpText?: string | null;
  promptTemplate?: string | null;
};
