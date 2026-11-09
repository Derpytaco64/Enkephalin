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
import { db } from '../../db/index.ts';
import {
  auditLog, quizAnswers, setFields, setItems, sets, studyCards, type FieldValue,
} from '../../db/schema.ts';
import type { ParsedField, ParsedItem, ParsedSet } from './format.ts';

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
      // Table-qualified by hand, and it has to be. Drizzle renders a column
      // embedded in a `sql` template as a **bare** identifier, so
      // `${setItems.setId} = ${sets.id}` compiled to `"set_id" = "id"` -- and
      // since `set_items` has an `id` of its own, that is a correlation to the
      // wrong table that is always false. Every set read 0 rows, 0 columns.
      items: sql<number>`(
        select count(*)::int from set_items where set_items.set_id = sets.id
      )`,
      fields: sql<number>`(
        select count(*)::int from set_fields
        where set_fields.set_id = sets.id and set_fields.deleted_at is null
      )`,
    })
    .from(sets)
    .orderBy(sql`${sets.importedAt} desc`);
}

/* -------------------------------------------------------------- delete ---- */

/** What deleting a set would take with it. */
export type SetDeletePreview = {
  /** Rows, including any a person edited after the import. */
  items: number;
  /** Live columns. A soft-deleted one is already gone from view. */
  fields: number;
  /** SRS schedules anyone holds on those rows. */
  cards: number;
  /** Answers in papers anyone has sat. */
  answers: number;
};

export type SetDeleteReport = SetDeletePreview & { slug: string; name: string };

export type SetDeleteResult =
  | { ok: true; report: SetDeleteReport }
  | { ok: false; message: string };

/**
 * What each set would cost to delete, keyed by set id.
 *
 * Counted for the whole list in two grouped queries rather than per row,
 * because the admin page needs all of them at once and the drug section's
 * one-drug preview has no equivalent shape.
 *
 * The two numbers that matter are `cards` and `answers`: rows and columns are
 * the file, and the file is on disk somewhere. A schedule and a past answer are
 * the only things in a set that **nobody can re-import** -- they are the record
 * of somebody studying it.
 */
export async function setDeletePreviews(): Promise<Map<string, SetDeletePreview>> {
  const [counts, cards, answers] = await Promise.all([
    db
      .select({
        id: sets.id,
        // Qualified by hand for the reason `listSets` states.
        items: sql<number>`(
          select count(*)::int from set_items where set_items.set_id = sets.id
        )`,
        fields: sql<number>`(
          select count(*)::int from set_fields
          where set_fields.set_id = sets.id and set_fields.deleted_at is null
        )`,
      })
      .from(sets),
    db
      .select({ id: setItems.setId, n: sql<number>`count(${studyCards.id})::int` })
      .from(setItems)
      .innerJoin(studyCards, eq(studyCards.itemId, setItems.id))
      .groupBy(setItems.setId),
    db
      .select({ id: setItems.setId, n: sql<number>`count(${quizAnswers.id})::int` })
      .from(setItems)
      .innerJoin(quizAnswers, eq(quizAnswers.itemId, setItems.id))
      .groupBy(setItems.setId),
  ]);

  const cardsBySet = new Map(cards.map((row) => [row.id, row.n]));
  const answersBySet = new Map(answers.map((row) => [row.id, row.n]));

  return new Map(counts.map((row) => [row.id, {
    items: row.items,
    fields: row.fields,
    cards: cardsBySet.get(row.id) ?? 0,
    answers: answersBySet.get(row.id) ?? 0,
  }]));
}

/**
 * Deletes a set, its columns, its rows, and the study history on those rows.
 *
 * **One `delete` and four foreign keys do the work.** `set_fields` and
 * `set_items` cascade from `sets`, and `study_cards.item_id` and
 * `quiz_answers.item_id` cascade from `set_items` -- so the schedules and the
 * answers go without being named here, which is the behaviour to want: a
 * schedule pointing at a row that no longer exists is not recoverable state,
 * it is a dangling reference the database would refuse anyway.
 *
 * A past *attempt* survives with its score. Only the per-question rows that
 * pointed at this set's items go, so an old paper keeps saying 14 of 20 while
 * the questions themselves thin out. That is the honest reading -- the person
 * did sit it -- and the alternative, deleting attempts that touched the set,
 * would take a mixed paper's drug questions with it.
 *
 * The counts are read **before** the delete and inside the same transaction,
 * so the report says what actually went rather than what the page last drew.
 */
export async function deleteSet(slug: string, actorId: string): Promise<SetDeleteResult> {
  const trimmed = slug.trim();
  if (!trimmed) return { ok: false, message: 'Which set?' };

  return db.transaction(async (tx) => {
    const [found] = await tx
      .select({ id: sets.id, slug: sets.slug, name: sets.name })
      .from(sets)
      .where(eq(sets.slug, trimmed));

    if (!found) {
      return { ok: false, message: `No set called "${trimmed}". Somebody may have deleted it already.` };
    }

    const [[items], [fields], [cards], [answers]] = await Promise.all([
      tx.select({ n: sql<number>`count(*)::int` }).from(setItems).where(eq(setItems.setId, found.id)),
      tx
        .select({ n: sql<number>`count(*)::int` })
        .from(setFields)
        .where(and(eq(setFields.setId, found.id), isNull(setFields.deletedAt))),
      tx
        .select({ n: sql<number>`count(${studyCards.id})::int` })
        .from(setItems)
        .innerJoin(studyCards, eq(studyCards.itemId, setItems.id))
        .where(eq(setItems.setId, found.id)),
      tx
        .select({ n: sql<number>`count(${quizAnswers.id})::int` })
        .from(setItems)
        .innerJoin(quizAnswers, eq(quizAnswers.itemId, setItems.id))
        .where(eq(setItems.setId, found.id)),
    ]);

    const report: SetDeleteReport = {
      slug: found.slug,
      name: found.name,
      items: items?.n ?? 0,
      fields: fields?.n ?? 0,
      cards: cards?.n ?? 0,
      answers: answers?.n ?? 0,
    };

    await tx.delete(sets).where(eq(sets.id, found.id));

    // The id goes with the row, so the diff carries everything the audit
    // screen can still show about a set that no longer exists.
    await tx.insert(auditLog).values({
      actorId,
      action: 'set.delete',
      targetType: 'set',
      targetId: found.id,
      diff: {
        slug: report.slug,
        name: report.name,
        items: report.items,
        fields: report.fields,
        cards: report.cards,
        answers: report.answers,
      },
    });

    return { ok: true, report };
  });
}
