import { and, eq, isNull, not } from 'drizzle-orm';
import { db } from '@/db';
import { fieldDefs } from '@/db/schema';
import { isUniqueViolation } from '@/lib/db-errors';
import { FIELD_DATA_TYPES, FIELD_KEY_PATTERN, YEAR_LEVELS, type FieldDefInput, type Result } from './constants';

export * from './constants';

function validate(input: FieldDefInput): string | null {
  if (!input.label.trim()) return 'Give the field a label.';
  if (!FIELD_DATA_TYPES.includes(input.dataType)) return 'Pick a valid data type.';
  if (input.dataType === 'enum' && !(input.enumOptions ?? []).length) {
    return 'An enum field needs at least one option.';
  }
  if ((input.yearLevels ?? []).some((year) => !YEAR_LEVELS.includes(year as (typeof YEAR_LEVELS)[number]))) {
    return 'Year levels must be P1, P2 or P3.';
  }
  return null;
}

function normalize(input: FieldDefInput) {
  return {
    label: input.label.trim(),
    group: input.group?.trim() || null,
    dataType: input.dataType,
    enumOptions: input.dataType === 'enum' ? (input.enumOptions ?? []).map((o) => o.trim()).filter(Boolean) : null,
    sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
    yearLevels: input.yearLevels ?? [],
    blankMeansNone: input.blankMeansNone ?? false,
    isQuizzable: input.isQuizzable ?? true,
    defaultVisible: input.defaultVisible ?? true,
    helpText: input.helpText?.trim() || null,
    promptTemplate: input.promptTemplate?.trim() || null,
  };
}

export async function createFieldDef(key: string, input: FieldDefInput): Promise<Result> {
  const normalizedKey = key.trim().toLowerCase();
  if (!FIELD_KEY_PATTERN.test(normalizedKey)) {
    return { ok: false, message: 'Key must be lower snake_case, starting with a letter.' };
  }

  const invalid = validate(input);
  if (invalid) return { ok: false, message: invalid };

  try {
    await db.insert(fieldDefs).values({ key: normalizedKey, ...normalize(input) });
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Including a soft-deleted one: the key is still taken, and its stored
      // values are still sitting under it.
      return { ok: false, message: `A field with the key "${normalizedKey}" already exists.` };
    }
    throw err;
  }

  return { ok: true };
}

/** Everything but the key, which stays put so stored values keep matching. */
export async function updateFieldDef(id: string, input: FieldDefInput): Promise<Result> {
  const invalid = validate(input);
  if (invalid) return { ok: false, message: invalid };

  await db.update(fieldDefs).set(normalize(input)).where(eq(fieldDefs.id, id));
  return { ok: true };
}

/**
 * Soft delete, so values stay in drugs.fields and come back on undelete.
 * Core fields are refused: they are backed by their own column or table, and
 * "deleting" one would only hide a drug's generic name or class from profiles
 * while the data stayed exactly where it was.
 */
export async function softDeleteFieldDef(id: string): Promise<Result> {
  const [deleted] = await db
    .update(fieldDefs)
    .set({ deletedAt: new Date() })
    .where(and(eq(fieldDefs.id, id), isNull(fieldDefs.deletedAt), not(fieldDefs.isCore)))
    .returning({ id: fieldDefs.id });

  if (deleted) return { ok: true };

  const [row] = await db.select().from(fieldDefs).where(eq(fieldDefs.id, id));
  if (!row) return { ok: false, message: 'That field no longer exists.' };
  if (row.isCore) return { ok: false, message: `"${row.label}" is a core field and cannot be removed.` };
  return { ok: true };
}

export async function restoreFieldDef(id: string): Promise<Result> {
  await db.update(fieldDefs).set({ deletedAt: null }).where(eq(fieldDefs.id, id));
  return { ok: true };
}
