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
