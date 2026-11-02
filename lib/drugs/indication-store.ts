/**
 * Reading and writing the indication vocabulary.
 *
 * Kept apart from `lib/drugs/indications.ts`, which stays client-safe so the
 * pickers and the quiz can derive a slug without pulling in the database.
 *
 * Every writer in the app comes through `resolveIndications`, which is what
 * makes the vocabulary a vocabulary: type a wording that exists and you join
 * it, type one that does not and you have deliberately added a word. Nothing
 * else inserts into `indications`.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { auditLog, drugIndications, indications } from '../../db/schema.ts';
import { canonicalIndication, indicationSlug } from './indications.ts';

export type IndicationRow = { id: string; slug: string; label: string };

/**
 * Turns wording into indication rows, creating only what is genuinely new.
 *
 * Matching is by slug rather than by label, so "Panic Disorder" finds "Panic
 * disorder" instead of making a second one -- the kind of near-duplicate that
 * free text accumulated without anyone deciding to.
 */
export async function resolveIndications(
  texts: string[],
): Promise<{ rows: IndicationRow[]; created: IndicationRow[] }> {
  const wanted = new Map<string, string>();
  for (const text of texts) {
    const label = canonicalIndication(text);
    const slug = indicationSlug(label);
    if (slug && !wanted.has(slug)) wanted.set(slug, label);
  }
  if (wanted.size === 0) return { rows: [], created: [] };

  const existing = await db
    .select()
    .from(indications)
    .where(inArray(indications.slug, [...wanted.keys()]));
  const bySlug = new Map(existing.map((row) => [row.slug, row]));

  const missing = [...wanted].filter(([slug]) => !bySlug.has(slug));
  const created: IndicationRow[] = [];
  if (missing.length > 0) {
    const inserted = await db
      .insert(indications)
      .values(missing.map(([slug, label]) => ({ slug, label })))
      // A concurrent writer may have just made it; take theirs.
      .onConflictDoNothing()
      .returning();
    created.push(...inserted);
    for (const row of inserted) bySlug.set(row.slug, row);

    const stillMissing = missing.filter(([slug]) => !bySlug.has(slug)).map(([slug]) => slug);
    if (stillMissing.length > 0) {
      const raced = await db.select().from(indications).where(inArray(indications.slug, stillMissing));
      for (const row of raced) bySlug.set(row.slug, row);
    }
  }

  // Back in the order they were given, which is the order a profile shows.
  const rows = [...wanted.keys()]
    .map((slug) => bySlug.get(slug))
    .filter((row): row is IndicationRow => Boolean(row));

  return { rows, created };
}

/**
 * Points one drug at exactly the indications named, in the order given.
 *
 * Rows that stay keep their ids, which matters more than it looks: a
 * `brand_indications` pairing hangs off the link row, so rewriting the list
 * wholesale would quietly unpair every brand that was paired to an indication
 * the drug still has. The diff is by indication id rather than by wording, so
 * a rename in the vocabulary cannot look like a different indication here.
 */
export async function setDrugIndicationLinks(
  drugId: string,
  texts: string[],
): Promise<{ labels: string[]; created: IndicationRow[] }> {
  const { rows, created } = await resolveIndications(texts);

  const existing = await db
    .select()
    .from(drugIndications)
    .where(eq(drugIndications.drugId, drugId));
  const byIndication = new Map(existing.map((row) => [row.indicationId, row]));

  const keep = new Set<string>();
  for (const [sortOrder, indication] of rows.entries()) {
    const found = byIndication.get(indication.id);
    if (found) {
      keep.add(found.id);
      if (found.sortOrder !== sortOrder) {
        await db.update(drugIndications).set({ sortOrder }).where(eq(drugIndications.id, found.id));
      }
      continue;
    }
    const [inserted] = await db
      .insert(drugIndications)
      .values({ drugId, indicationId: indication.id, sortOrder })
      .returning({ id: drugIndications.id });
    keep.add(inserted.id);
  }

  const gone = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
  if (gone.length > 0) {
    await db.delete(drugIndications).where(inArray(drugIndications.id, gone));
  }

  return { labels: rows.map((row) => row.label), created };
}

/** The vocabulary with how many drugs carry each, for a picker or a list. */
export async function listIndications(): Promise<(IndicationRow & { drugs: number })[]> {
  const rows = await db
    .select({
      id: indications.id,
      slug: indications.slug,
      label: indications.label,
      drugs: sql<number>`count(${drugIndications.drugId})::int`,
    })
    .from(indications)
    .leftJoin(drugIndications, eq(drugIndications.indicationId, indications.id))
    .groupBy(indications.id, indications.slug, indications.label)
    .orderBy(asc(indications.label));

  return rows;
}

async function audit(input: {
  actorId: string;
  action: string;
  indicationId: string;
  diff?: Record<string, unknown>;
}) {
  await db.insert(auditLog).values({
    actorId: input.actorId,
    action: input.action,
    targetType: 'indication',
    targetId: input.indicationId,
    diff: input.diff ?? null,
  });
}

export type Result<T = undefined> = { ok: true; value?: T } | { ok: false; message: string };

/**
 * Renames one indication everywhere at once -- the thing free text could not
 * do. The slug stays: it is in saved study links, and the label is what is
 * read.
 */
export async function renameIndication(
  slug: string,
  label: string,
  actorId: string,
): Promise<Result> {
  const trimmed = canonicalIndication(label);
  if (!trimmed) return { ok: false, message: 'Give the indication a name.' };

  const [row] = await db.select().from(indications).where(eq(indications.slug, slug));
  if (!row) return { ok: false, message: 'That indication no longer exists.' };
  if (row.label === trimmed) return { ok: true };

  await db.update(indications).set({ label: trimmed }).where(eq(indications.id, row.id));
  await audit({ actorId, action: 'indication.rename', indicationId: row.id, diff: { from: row.label, to: trimmed } });
  return { ok: true };
}

/**
 * Folds one indication into another: every drug on the loser joins the winner,
 * and the loser goes. This is the repair for a typo noticed late, and for the
 * sheet's own near-duplicates that are not spelling but judgement -- the kind
 * `lib/drugs/indications.ts` deliberately refuses to decide.
 *
 * A drug already on both keeps one row rather than failing the merge.
 */
export async function mergeIndications(
  fromSlug: string,
  intoSlug: string,
  actorId: string,
): Promise<Result<{ moved: number }>> {
  if (fromSlug === intoSlug) return { ok: false, message: 'That is the same indication.' };

  const rows = await db
    .select()
    .from(indications)
    .where(inArray(indications.slug, [fromSlug, intoSlug]));
  const from = rows.find((row) => row.slug === fromSlug);
  const into = rows.find((row) => row.slug === intoSlug);
  if (!from || !into) return { ok: false, message: 'One of those indications no longer exists.' };

  const moved = await db
    .update(drugIndications)
    .set({ indicationId: into.id })
    .where(and(
      eq(drugIndications.indicationId, from.id),
      // Skip the drugs already on the winner, or the unique index refuses.
      sql`not exists (
        select 1 from ${drugIndications} as other
        where other.drug_id = ${drugIndications.drugId} and other.indication_id = ${into.id}
      )`,
    ))
    .returning({ id: drugIndications.id });

  // Whatever is left pointed at the loser was a drug on both.
  await db.delete(drugIndications).where(eq(drugIndications.indicationId, from.id));
  await db.delete(indications).where(eq(indications.id, from.id));

  await audit({
    actorId, action: 'indication.merge', indicationId: into.id,
    diff: { from: from.label, into: into.label, moved: moved.length },
  });
  return { ok: true, value: { moved: moved.length } };
}

/** Removes an indication nothing uses. One in use is a merge, not a delete. */
export async function deleteIndication(slug: string, actorId: string): Promise<Result> {
  const [row] = await db.select().from(indications).where(eq(indications.slug, slug));
  if (!row) return { ok: false, message: 'That indication no longer exists.' };

  const [used] = await db
    .select({ drugId: drugIndications.drugId })
    .from(drugIndications)
    .where(eq(drugIndications.indicationId, row.id))
    .limit(1);
  if (used) {
    return {
      ok: false,
      message: 'Drugs still carry that indication. Merge it into another one instead, which keeps them.',
    };
  }

  await db.delete(indications).where(eq(indications.id, row.id));
  await audit({ actorId, action: 'indication.delete', indicationId: row.id, diff: { slug, label: row.label } });
  return { ok: true };
}

/** Indications no drug carries -- typos and leftovers, safe to clear. */
export async function unusedIndications(): Promise<IndicationRow[]> {
  return db
    .select({ id: indications.id, slug: indications.slug, label: indications.label })
    .from(indications)
    .leftJoin(drugIndications, eq(drugIndications.indicationId, indications.id))
    .where(sql`${drugIndications.drugId} is null`)
    .orderBy(asc(indications.label));
}

