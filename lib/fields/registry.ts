import { asc, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { fieldDefs } from '@/db/schema';

export type FieldDef = typeof fieldDefs.$inferSelect;

/**
 * Read per request rather than cached in module scope: a field added in the
 * admin editor has to appear on profiles and in the field picker without a
 * restart, which a process-lifetime cache would break.
 */
export async function listFieldDefs(options: { includeDeleted?: boolean } = {}) {
  return db
    .select()
    .from(fieldDefs)
    .where(options.includeDeleted ? undefined : isNull(fieldDefs.deletedAt))
    .orderBy(asc(fieldDefs.sortOrder), asc(fieldDefs.label));
}

/** Groups in sort order, each with its fields, for rendering a profile. */
export function groupFieldDefs(defs: FieldDef[]) {
  const groups = new Map<string, FieldDef[]>();
  for (const def of defs) {
    const name = def.group ?? 'Other';
    const existing = groups.get(name);
    if (existing) existing.push(def);
    else groups.set(name, [def]);
  }
  return [...groups.entries()];
}
