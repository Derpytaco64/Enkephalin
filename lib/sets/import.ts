/**
 * Writing a parsed set into the database.
 *
 * **Re-import is a merge keyed by slug**, with the backup's two named modes
 * rather than a flag -- `merge` leaves what the file does not mention alone,
 * `replace` deletes what the file lacks. A word you have to choose beats a
 * checkbox that defaults on, for the same reason it does one module over.
 *
 * The policy that makes this more than an upsert is that **sets are editable
 * after import** (owner's call), so a re-import has to decide what happens to
 * what a person changed in the meantime. The rule is the one `sync.ts` already
 * follows for the sheet: `updatedBy` answers *has a human touched this*, and if
 * they have, the file does not get to overwrite it. The file supplies content;
 * it does not own it after the first import.
 *
 * Nothing here parses. `format.ts` has already refused anything malformed, so
 * everything below is about reconciling two good states.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, setFields, setItems, sets, type FieldValue } from '@/db/schema';
import type { ParsedField, ParsedItem, ParsedSet } from './format';

export type ImportMode = 'merge' | 'replace';

export type ColumnReport = {
  key: string;
  label: string;
  /** How many distinct answers the set holds for this column. */
  distinct: number;
  /** Rows with nothing in this column. */
  blank: number;
  /** Four distinct answers is the floor for a four-option question. */
  quizzable: boolean;
  asks: boolean;
};

export type ImportReport = {
  slug: string;
  name: string;
  mode: ImportMode;
  created: boolean;
  itemsInserted: number;
  itemsUpdated: number;
  itemsDeleted: number;
  /** Rows the file mentions that a person had edited, so the file was ignored. */
  itemsKept: string[];
  fieldsInserted: number;
  fieldsUpdated: number;
  /** Columns a person edited, so the file's version was ignored. */
  fieldsKept: string[];
  /** Columns a person had deleted, which `merge` leaves deleted. */
  fieldsLeftDeleted: string[];
  columns: ColumnReport[];
  /** Judgements rather than refusals -- worth saying, not worth stopping for. */
  warnings: string[];
};

export type ImportResult =
  | { ok: true; report: ImportReport }
  | { ok: false; message: string };

/** The floor for a four-option question, which is the only arithmetic here. */
export const MIN_DISTINCT = 4;

function valueOf(text: string): FieldValue {
  return {
    value: text,
    status: 'ok',
    // Provenance, as every stored value in this database carries. The file is
    // the source; the person who ran the import is not the author.
    source: 'imported set',
    updatedAt: new Date().toISOString(),
    // Deliberately null: an imported value has not been touched by a human, and
    // that is exactly what lets the next re-import overwrite it.
    updatedBy: null,
  };
}

/**
 * What the set can and cannot be quizzed on, counted at import time.
 *
 * A column needs four distinct answers across the set before it can make a
 * four-option question, so a 40-row set with a three-value class column is a
 * fine flashcard column and a guessable quiz column. That is a fact about the
 * file, it is cheap to count, and saying it while somebody is looking at the
 * import result is worth more than a short quiz six weeks later.
 */
export function reportColumns(parsed: ParsedSet): ColumnReport[] {
  return parsed.fields.map((field) => {
    const answers = parsed.items
      .map((item) => item.values[field.key])
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '');

    // Compared case-insensitively, because "Hyperthyroidism" and
    // "hyperthyroidism" are one answer and counting them as two would promise
    // a question the builder cannot actually make.
    const distinct = new Set(answers.map((value) => value.toLowerCase())).size;

    return {
      key: field.key,
      label: field.label,
      distinct,
      blank: parsed.items.length - answers.length,
      quizzable: field.asks && distinct >= MIN_DISTINCT,
      asks: field.asks,
    };
  });
}

/**
 * Warnings, which are judgements rather than refusals.
 *
 * The shape tell is the useful one: a column whose answers are wildly
 * different lengths is usually a column holding two different sorts of thing,
 * and that makes questions answerable by shape alone. It is a guess, so it
 * never stops an import.
 */
function warningsFor(parsed: ParsedSet, columns: ColumnReport[]): string[] {
  const warnings: string[] = [];

  for (const column of columns) {
    if (!column.asks) continue;
    if (column.distinct === 0) {
      warnings.push(`${column.label} is empty in every row, so nothing will ask about it.`);
      continue;
    }
    if (!column.quizzable) {
      warnings.push(
        `${column.label} has only ${column.distinct} distinct answer${
          column.distinct === 1 ? '' : 's'}, so it will flashcard but not make a ${
          MIN_DISTINCT}-option question.`,
      );
    }
    if (column.blank > 0 && column.blank === parsed.items.length - 1) {
      warnings.push(`${column.label} is filled in for only one row.`);
    }
  }

  const sequences = new Set(parsed.items.map((item) => item.sequence).filter(Boolean));
  for (const sequence of sequences) {
    const members = parsed.items.filter((item) => item.sequence === sequence);
    if (members.length < 3) {
      warnings.push(
        `The sequence "${sequence}" has ${members.length} step${members.length === 1 ? '' : 's'}; ` +
        'a sequence draws its wrong answers only from its own steps, so it needs four to be asked.',
      );
    }
  }

  if (parsed.items.length < MIN_DISTINCT) {
    warnings.push(
      `${parsed.items.length} rows is below the ${MIN_DISTINCT} a four-option question needs, ` +
      'so this set will import as flashcards.',
    );
  }

  return warnings;
}

export async function importSet(
  parsed: ParsedSet,
  actorId: string,
  mode: ImportMode,
): Promise<ImportResult> {
  const columns = reportColumns(parsed);

  const [existing] = await db
    .select({ id: sets.id })
    .from(sets)
    .where(eq(sets.slug, parsed.slug));

  const scope = {
    name: parsed.name,
    course: parsed.course,
    exam: parsed.exam,
    unit: parsed.unit,
    topic: parsed.topic,
    sourceFile: parsed.sourceFile,
    sourcePages: parsed.sourcePages,
    identityKey: parsed.identityKey,
    identityLabel: parsed.identityLabel,
    identityKind: parsed.identityKind,
    groupKey: parsed.groupKey,
    kinds: parsed.kinds,
  };

  const report: ImportReport = {
    slug: parsed.slug,
    name: parsed.name,
    mode,
    created: !existing,
    itemsInserted: 0,
    itemsUpdated: 0,
    itemsDeleted: 0,
    itemsKept: [],
    fieldsInserted: 0,
    fieldsUpdated: 0,
    fieldsKept: [],
    fieldsLeftDeleted: [],
    columns,
    warnings: warningsFor(parsed, columns),
  };

  let setId: string;

  if (existing) {
    setId = existing.id;

    // A column whose type changed under it is a refusal, not a coercion. The
    // stored cells are one shape or the other, and quietly reinterpreting them
    // is how a parser earns distrust. Checked before anything is written.
    const stored = await db
      .select({ key: setFields.key, dataType: setFields.dataType, label: setFields.label })
      .from(setFields)
      .where(and(eq(setFields.setId, setId), isNull(setFields.deletedAt)));

    const byKey = new Map(stored.map((row) => [row.key, row]));
    for (const field of parsed.fields) {
      const found = byKey.get(field.key);
      if (found && found.dataType !== field.dataType) {
        return {
          ok: false,
          message: `"${found.label}" is stored as ${found.dataType} and the file now says `
            + `${field.dataType}. Change the column in the editor first, or re-import as replace — `
            + 'nothing was written.',
        };
      }
    }

    await db.update(sets).set(scope).where(eq(sets.id, setId));
  } else {
    const [row] = await db
      .insert(sets)
      .values({ slug: parsed.slug, ...scope, importedBy: actorId })
      .returning({ id: sets.id });
    setId = row.id;
  }

  await syncFields(setId, parsed.fields, mode, report);
  await syncItems(setId, parsed, mode, report);

  await db.insert(auditLog).values({
    actorId,
    action: existing ? 'set.reimport' : 'set.import',
    targetType: 'set',
    targetId: setId,
    diff: {
      slug: parsed.slug,
      mode,
      items: {
        inserted: report.itemsInserted,
        updated: report.itemsUpdated,
        deleted: report.itemsDeleted,
        kept: report.itemsKept.length,
      },
      fields: {
        inserted: report.fieldsInserted,
        updated: report.fieldsUpdated,
        kept: report.fieldsKept.length,
      },
    },
  });

  return { ok: true, report };
}

/**
 * The columns.
 *
 * Three rules, and the middle one is the resurrection problem `npm run seed`
 * has with drugs one table over:
 *
 * - A column a person edited keeps their version. The file supplies columns; it
 *   does not own them after the first import.
 * - A column a person **deleted** stays deleted in `merge`. Soft-deleted, and
 *   the importer skips a key it finds already soft-deleted rather than reviving
 *   it. `replace` revives it, which is what `replace` is for.
 * - A column the file no longer mentions is soft-deleted in `replace` and left
 *   alone in `merge`. Soft, because a retired column keeps its stored cells.
 */
async function syncFields(
  setId: string,
  fields: ParsedField[],
  mode: ImportMode,
  report: ImportReport,
) {
  const stored = await db
    .select()
    .from(setFields)
    .where(eq(setFields.setId, setId));
  const byKey = new Map(stored.map((row) => [row.key, row]));

  for (const field of fields) {
    const found = byKey.get(field.key);

    if (!found) {
      await db.insert(setFields).values({ setId, ...field });
      report.fieldsInserted += 1;
      continue;
    }

    if (found.deletedAt && mode === 'merge') {
      report.fieldsLeftDeleted.push(found.label);
      continue;
    }

    if (found.updatedBy && mode === 'merge') {
      report.fieldsKept.push(found.label);
      continue;
    }

    await db
      .update(setFields)
      .set({ ...field, deletedAt: null })
      .where(eq(setFields.id, found.id));
    report.fieldsUpdated += 1;
  }

  if (mode === 'replace') {
    const wanted = new Set(fields.map((field) => field.key));
    const orphans = stored.filter((row) => !wanted.has(row.key) && !row.deletedAt);
    if (orphans.length > 0) {
      await db
        .update(setFields)
        .set({ deletedAt: new Date() })
        .where(inArray(setFields.id, orphans.map((row) => row.id)));
    }
  }
}

/**
 * The rows.
 *
 * A row a person edited keeps their version of **every** cell, not a cell-wise
 * merge. Mixing one row's stored cells with the file's would produce a row that
 * neither the file nor the person wrote, which is the worst of the three
 * possible answers.
 */
async function syncItems(
  setId: string,
  parsed: ParsedSet,
  mode: ImportMode,
  report: ImportReport,
) {
  const stored = await db
    .select({
      id: setItems.id,
      slug: setItems.slug,
      name: setItems.name,
      updatedBy: setItems.updatedBy,
    })
    .from(setItems)
    .where(eq(setItems.setId, setId));
  const bySlug = new Map(stored.map((row) => [row.slug, row]));

  for (const item of parsed.items) {
    const found = bySlug.get(item.slug);
    const values: Record<string, FieldValue> = {};
    for (const [key, text] of Object.entries(item.values)) {
      values[key] = valueOf(text);
    }

    const row = {
      name: item.name,
      kind: item.kind,
      aliases: item.aliases,
      sequence: item.sequence,
      sequenceOrder: item.sequenceOrder,
      recallOnly: item.recallOnly,
      values,
      sortOrder: item.sortOrder,
    };

    if (!found) {
      await db.insert(setItems).values({ setId, slug: item.slug, ...row });
      report.itemsInserted += 1;
      continue;
    }

    if (found.updatedBy && mode === 'merge') {
      report.itemsKept.push(found.name);
      continue;
    }

    await db.update(setItems).set(row).where(eq(setItems.id, found.id));
    report.itemsUpdated += 1;
  }

  if (mode === 'replace') {
    const wanted = new Set(parsed.items.map((item) => item.slug));
    const orphans = stored.filter((row) => !wanted.has(row.slug));
    if (orphans.length > 0) {
      // Hard delete, unlike a column: a row that is gone from the file in
      // replace mode is gone, and its study cards cascade with it. That is
      // what makes `replace` the word you have to choose.
      await db.delete(setItems).where(inArray(setItems.id, orphans.map((row) => row.id)));
      report.itemsDeleted = orphans.length;
    }
  }
}

/** Every set, newest first, for the admin list. */
export async function listSets() {
  return db
    .select({
      id: sets.id,
      slug: sets.slug,
      name: sets.name,
      course: sets.course,
      exam: sets.exam,
      unit: sets.unit,
      topic: sets.topic,
      importedAt: sets.importedAt,
      items: sql<number>`(select count(*)::int from ${setItems} where ${setItems.setId} = ${sets.id})`,
      fields: sql<number>`(
        select count(*)::int from ${setFields}
        where ${setFields.setId} = ${sets.id} and ${setFields.deletedAt} is null
      )`,
    })
    .from(sets)
    .orderBy(sql`${sets.importedAt} desc`);
}
