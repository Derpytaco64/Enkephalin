/**
 * Client-safe half of the field definitions: no database imports, so a client
 * component can read these without dragging the postgres driver into the
 * browser bundle. mutations.ts holds everything that touches the database.
 */
import { CORE_FIELD_DEFS } from './core-fields';

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

/**
 * The fields backed by their own column or table rather than by `drugs.fields`.
 *
 * `isCore`, not every entry of `CORE_FIELD_DEFS`: that is the whole sheet field
 * set -- mechanism, dosing, the black box warning -- and only five of its rows
 * are columns. Reading it as "all of these are core" is a quiet way to make
 * every field unoverridable, which is what it did once.
 *
 * Here rather than in `lib/drugs/variants.ts`, where it used to live, because
 * two places now ask the question and a field being core is a fact about the
 * field: `overridable` is the variant rule, and the study loader needs the same
 * set to decide which fields a version could possibly have worded. Client-safe,
 * like the rest of this file.
 */
export const CORE_FIELD_KEYS: ReadonlySet<string> = new Set(
  CORE_FIELD_DEFS.filter((def) => def.isCore).map((def) => def.key),
);

/**
 * Whether a field can carry a variant's own value.
 *
 * The core fields cannot, and not as an omission: `generic`, `brand`,
 * `indication`, `drug_class` and `controlled` are columns and link rows rather
 * than entries in `drugs.fields`, and a class claiming a different generic
 * name is not a variation of a drug, it is a different drug. Brands and
 * indications are entities with their own tables and their own pairing rules,
 * so a class wanting to differ on those is a bigger change than this one and
 * deliberately out of it.
 */
export function overridable(key: string): boolean {
  return !CORE_FIELD_KEYS.has(key);
}

/**
 * The fields whose headings are a **set** rather than a sequence, and so read
 * better in alphabetical order than in the order three lectures happened to
 * mention them.
 *
 * Dosing's headings are indications; a regimen's are protocol names.
 * Nineteen of either in arrival order is a list you read end to end to find
 * one entry. Everywhere else a heading can just as easily be a step, and
 * sorting "Induction, Consolidation, Maintenance" would tell a lie about the
 * order of treatment -- so this is a list of two and not a default.
 */
export const SECTIONS_SORTED: ReadonlySet<string> = new Set(['dosing', 'regimen']);
