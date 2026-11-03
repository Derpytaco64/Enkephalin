/**
 * Deleting a drug, and folding one drug into another.
 *
 * Both are irreversible and both reach further than they look: a drug is
 * referenced by its brands, its indication links, its tags, its dosing
 * regimens, every SRS schedule anyone holds for it and every quiz answer
 * anyone has given about it. Every one of those is `on delete cascade`, which
 * is right for a delete and wrong for a merge -- a merge says *these were
 * always the same drug*, so the history belongs to the survivor.
 *
 * So each has a preview that counts what is about to happen, and the page
 * shows it before the button does anything. The counts come from the same
 * queries the write uses, not from an estimate of them.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  auditLog,
  brandIndications,
  dosingRegimens,
  drugBrands,
  drugIndications,
  drugTags,
  drugs,
  indications,
  quizAnswers,
  studyCards,
} from '@/db/schema';
import type { Result } from './mutations';

export type DeletePreview = {
  slug: string;
  generic: string;
  brands: number;
  indications: number;
  tags: number;
  regimens: number;
  /** SRS schedules, across every account. */
  cards: number;
  /** Answered quiz questions, across every account. */
  answers: number;
};

export type MergePreview = {
  from: { slug: string; generic: string };
  into: { slug: string; generic: string };
  brands: { moved: string[]; dropped: string[] };
  indications: { moved: string[]; dropped: string[] };
  tags: { moved: number; dropped: number };
  /** Dosing moves only into a drug that has none; otherwise it is dropped. */
  dosing: { moved: number; dropped: number };
  /** Field keys the survivor has no value for, which the loser can fill. */
  fieldsFilled: string[];
  /** Columns the survivor has empty, which the loser can fill. */
  columnsFilled: string[];
  cards: { moved: number; dropped: number };
  answers: number;
};

async function bySlug(slug: string) {
  const [drug] = await db.select().from(drugs).where(eq(drugs.slug, slug));
  return drug ?? null;
}

/* ------------------------------------------------------------- delete ---- */

export async function previewDelete(slug: string): Promise<DeletePreview | null> {
  const drug = await bySlug(slug);
  if (drug === null) return null;

  const tally = async (
    table: typeof drugBrands | typeof drugIndications | typeof drugTags
      | typeof dosingRegimens | typeof studyCards | typeof quizAnswers,
  ) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(table)
      .where(eq(table.drugId, drug.id));
    return row?.n ?? 0;
  };

  const [brands, indicationLinks, tags, regimens, cards, answers] = await Promise.all([
    tally(drugBrands), tally(drugIndications), tally(drugTags),
    tally(dosingRegimens), tally(studyCards), tally(quizAnswers),
  ]);

  return {
    slug: drug.slug, generic: drug.genericName,
    brands, indications: indicationLinks, tags, regimens, cards, answers,
  };
}

/**
 * Gone, with everything that hung off it.
 *
 * A hard delete rather than a `deleted_at` flag, deliberately. A soft-deleted
 * drug would have to be filtered out of browse, search, every study scope, the
 * card builder and the quiz pool -- six places where forgetting one means a
 * deleted drug quietly still being asked about. The safety net is
 * `/admin/data`, which exports the whole database as one file.
 */
export async function deleteDrug(slug: string, actorId: string): Promise<Result<DeletePreview>> {
  const preview = await previewDelete(slug);
  if (preview === null) return { ok: false, message: 'That drug no longer exists.' };

  const drug = await bySlug(slug);
  if (drug === null) return { ok: false, message: 'That drug no longer exists.' };

  await db.delete(drugs).where(eq(drugs.id, drug.id));
  await db.insert(auditLog).values({
    actorId,
    action: 'drug.delete',
    targetType: 'drug',
    targetId: drug.id,
    // The row is gone, so the audit entry is the only remaining record of
    // what it was and how much went with it.
    diff: { ...preview, drugClass: drug.drugClass, schedule: drug.schedule },
  });

  return { ok: true, value: preview };
}

/* -------------------------------------------------------------- merge ---- */

/** Case-insensitive, because "Zocor" and "ZOCOR" are one brand. */
const fold = (value: string) => value.trim().toLowerCase();

type Pair = { from: typeof drugs.$inferSelect; into: typeof drugs.$inferSelect };

async function pair(fromSlug: string, intoSlug: string): Promise<Result<Pair>> {
  if (fromSlug === intoSlug) return { ok: false, message: 'That is the same drug.' };

  const rows = await db.select().from(drugs).where(inArray(drugs.slug, [fromSlug, intoSlug]));
  const from = rows.find((row) => row.slug === fromSlug);
  const into = rows.find((row) => row.slug === intoSlug);
  if (!from || !into) return { ok: false, message: 'One of those drugs no longer exists.' };

  return { ok: true, value: { from, into } };
}

/** Everything the survivor is missing that the loser could supply. */
function gaps(from: typeof drugs.$inferSelect, into: typeof drugs.$inferSelect) {
  const fieldsFilled = Object.entries(from.fields)
    .filter(([key, value]) => {
      const mine = into.fields[key];
      const theirs = value?.value?.trim() ?? '';
      return theirs !== '' && (mine?.value ?? '').trim() === '';
    })
    .map(([key]) => key);

  const columnsFilled: string[] = [];
  if (into.drugClass === null && from.drugClass !== null) columnsFilled.push('drug_class');
  if (into.schedule === null && from.schedule !== null) columnsFilled.push('controlled');
  if (into.rxcui === null && from.rxcui !== null) columnsFilled.push('rxcui');

  return { fieldsFilled, columnsFilled };
}

export async function previewMerge(fromSlug: string, intoSlug: string): Promise<Result<MergePreview>> {
  const found = await pair(fromSlug, intoSlug);
  if (!found.ok) return found;
  const { from, into } = found.value!;

  const [fromBrands, intoBrands, fromInds, intoInds, fromTags, intoTags,
    fromRegimens, intoRegimens, fromCards, intoCards, answers] = await Promise.all([
    db.select({ name: drugBrands.name }).from(drugBrands).where(eq(drugBrands.drugId, from.id)),
    db.select({ name: drugBrands.name }).from(drugBrands).where(eq(drugBrands.drugId, into.id)),
    db.select({ id: drugIndications.indicationId }).from(drugIndications).where(eq(drugIndications.drugId, from.id)),
    db.select({ id: drugIndications.indicationId }).from(drugIndications).where(eq(drugIndications.drugId, into.id)),
    db.select({ id: drugTags.tagId }).from(drugTags).where(eq(drugTags.drugId, from.id)),
    db.select({ id: drugTags.tagId }).from(drugTags).where(eq(drugTags.drugId, into.id)),
    db.select({ id: dosingRegimens.id }).from(dosingRegimens).where(eq(dosingRegimens.drugId, from.id)),
    db.select({ id: dosingRegimens.id }).from(dosingRegimens).where(eq(dosingRegimens.drugId, into.id)),
    db.select({ user: studyCards.userId, key: studyCards.cardKey }).from(studyCards).where(eq(studyCards.drugId, from.id)),
    db.select({ user: studyCards.userId, key: studyCards.cardKey }).from(studyCards).where(eq(studyCards.drugId, into.id)),
    db.select({ n: sql<number>`count(*)::int` }).from(quizAnswers).where(eq(quizAnswers.drugId, from.id)),
  ]);

  const heldBrands = new Set(intoBrands.map((row) => fold(row.name)));
  const heldInds = new Set(intoInds.map((row) => row.id));
  const heldTags = new Set(intoTags.map((row) => row.id));
  const heldCards = new Set(intoCards.map((row) => `${row.user}:${row.key}`));

  // Indication names rather than ids, since the preview is read by a person.
  const names = fromInds.length === 0 ? [] : await db
    .select({ id: drugIndications.indicationId, label: indications.label })
    .from(drugIndications)
    .innerJoin(indications, eq(indications.id, drugIndications.indicationId))
    .where(eq(drugIndications.drugId, from.id));
  const labelOf = new Map(names.map((row) => [row.id, row.label]));

  const movedTags = fromTags.filter((row) => !heldTags.has(row.id)).length;
  const movedCards = fromCards.filter((row) => !heldCards.has(`${row.user}:${row.key}`)).length;

  return {
    ok: true,
    value: {
      from: { slug: from.slug, generic: from.genericName },
      into: { slug: into.slug, generic: into.genericName },
      brands: {
        moved: fromBrands.filter((row) => !heldBrands.has(fold(row.name))).map((row) => row.name),
        dropped: fromBrands.filter((row) => heldBrands.has(fold(row.name))).map((row) => row.name),
      },
      indications: {
        moved: fromInds.filter((row) => !heldInds.has(row.id)).map((row) => labelOf.get(row.id) ?? '?'),
        dropped: fromInds.filter((row) => heldInds.has(row.id)).map((row) => labelOf.get(row.id) ?? '?'),
      },
      tags: { moved: movedTags, dropped: fromTags.length - movedTags },
      // All or nothing: half of one drug's regimens beside half of another's
      // would read as one contradictory schedule.
      dosing: intoRegimens.length === 0
        ? { moved: fromRegimens.length, dropped: 0 }
        : { moved: 0, dropped: fromRegimens.length },
      ...gaps(from, into),
      cards: { moved: movedCards, dropped: fromCards.length - movedCards },
      answers: answers[0]?.n ?? 0,
    },
  };
}

/**
 * Fold one drug into another and delete it.
 *
 * The survivor keeps everything it already has; the loser fills gaps and
 * contributes what the survivor lacks entirely. One rule, stated once, rather
 * than a per-field choice: a merge is for two rows that should never have been
 * two, and a dialogue about each value would be an editing session wearing a
 * merge's clothes.
 *
 * In a transaction, because a half-merge is worse than either outcome: brands
 * moved and history not, or the loser deleted with its indications stranded.
 */
export async function mergeDrugs(
  fromSlug: string,
  intoSlug: string,
  actorId: string,
): Promise<Result<MergePreview>> {
  const planned = await previewMerge(fromSlug, intoSlug);
  if (!planned.ok) return planned;

  const found = await pair(fromSlug, intoSlug);
  if (!found.ok) return found;
  const { from, into } = found.value!;

  await db.transaction(async (tx) => {
    /* Indications first, because `brand_indications` points at a
       `drug_indications` row rather than at the vocabulary: a brand that moves
       must find its pairing already pointing at the survivor's row. */
    const mine = await tx
      .select({ id: drugIndications.id, indicationId: drugIndications.indicationId })
      .from(drugIndications)
      .where(eq(drugIndications.drugId, into.id));
    const myRow = new Map(mine.map((row) => [row.indicationId, row.id]));

    const theirs = await tx
      .select({ id: drugIndications.id, indicationId: drugIndications.indicationId })
      .from(drugIndications)
      .where(eq(drugIndications.drugId, from.id));

    for (const row of theirs) {
      const already = myRow.get(row.indicationId);
      if (already === undefined) continue;

      // Both drugs were for this. Re-point the loser's brand pairings at the
      // survivor's row, then drop the duplicate link.
      await tx
        .update(brandIndications)
        .set({ indicationId: already })
        .where(and(
          eq(brandIndications.indicationId, row.id),
          sql`not exists (
            select 1 from ${brandIndications} as other
            where other.brand_id = ${brandIndications.brandId} and other.indication_id = ${already}
          )`,
        ));
      await tx.delete(brandIndications).where(eq(brandIndications.indicationId, row.id));
      await tx.delete(drugIndications).where(eq(drugIndications.id, row.id));
    }

    const [lastIndication] = await tx
      .select({ sortOrder: drugIndications.sortOrder })
      .from(drugIndications)
      .where(eq(drugIndications.drugId, into.id))
      .orderBy(sql`${drugIndications.sortOrder} desc`)
      .limit(1);

    await tx
      .update(drugIndications)
      .set({
        drugId: into.id,
        sortOrder: sql`${drugIndications.sortOrder} + ${(lastIndication?.sortOrder ?? 0) + 1}`,
      })
      .where(eq(drugIndications.drugId, from.id));

    /* Brands. A name the survivor already carries is dropped rather than
       duplicated; its pairings go with it. */
    const held = await tx
      .select({ name: drugBrands.name })
      .from(drugBrands)
      .where(eq(drugBrands.drugId, into.id));
    const heldNames = new Set(held.map((row) => fold(row.name)));

    const incoming = await tx
      .select({ id: drugBrands.id, name: drugBrands.name })
      .from(drugBrands)
      .where(eq(drugBrands.drugId, from.id));

    const duplicates = incoming.filter((row) => heldNames.has(fold(row.name))).map((row) => row.id);
    if (duplicates.length > 0) {
      await tx.delete(drugBrands).where(inArray(drugBrands.id, duplicates));
    }

    const [lastBrand] = await tx
      .select({ sortOrder: drugBrands.sortOrder })
      .from(drugBrands)
      .where(eq(drugBrands.drugId, into.id))
      .orderBy(sql`${drugBrands.sortOrder} desc`)
      .limit(1);

    await tx
      .update(drugBrands)
      .set({
        drugId: into.id,
        sortOrder: sql`${drugBrands.sortOrder} + ${(lastBrand?.sortOrder ?? 0) + 1}`,
      })
      .where(eq(drugBrands.drugId, from.id));

    /* Tags: the primary key is (drug, tag), so a tag on both would collide. */
    await tx
      .update(drugTags)
      .set({ drugId: into.id })
      .where(and(
        eq(drugTags.drugId, from.id),
        sql`not exists (
          select 1 from ${drugTags} as other
          where other.drug_id = ${into.id} and other.tag_id = ${drugTags.tagId}
        )`,
      ));

    /* Dosing, only into a drug that has none. */
    const [anyRegimen] = await tx
      .select({ id: dosingRegimens.id })
      .from(dosingRegimens)
      .where(eq(dosingRegimens.drugId, into.id))
      .limit(1);
    if (anyRegimen === undefined) {
      await tx.update(dosingRegimens).set({ drugId: into.id }).where(eq(dosingRegimens.drugId, from.id));
    }

    /* History. Schedules collide on (user, card key); the survivor's own
       progress is the one to keep, because it is the one the person has been
       answering against. */
    await tx
      .update(studyCards)
      .set({ drugId: into.id })
      .where(and(
        eq(studyCards.drugId, from.id),
        sql`not exists (
          select 1 from ${studyCards} as other
          where other.drug_id = ${into.id}
            and other.user_id = ${studyCards.userId}
            and other.card_key = ${studyCards.cardKey}
        )`,
      ));

    // No unique constraint on answers, so every one of them moves. They are
    // what the quiz weights "ask me this again" from, and the merged drug is
    // the same drug it was asked about.
    await tx.update(quizAnswers).set({ drugId: into.id }).where(eq(quizAnswers.drugId, from.id));

    /* Gaps in the survivor, filled from the loser. */
    const { fieldsFilled, columnsFilled } = gaps(from, into);
    const patch: Partial<typeof drugs.$inferInsert> = { updatedAt: new Date() };
    if (fieldsFilled.length > 0) {
      const merged = { ...into.fields };
      for (const key of fieldsFilled) merged[key] = from.fields[key];
      patch.fields = merged;
    }
    if (columnsFilled.includes('drug_class')) patch.drugClass = from.drugClass;
    if (columnsFilled.includes('controlled')) patch.schedule = from.schedule;
    if (columnsFilled.includes('rxcui')) patch.rxcui = from.rxcui;
    await tx.update(drugs).set(patch).where(eq(drugs.id, into.id));

    await tx.delete(drugs).where(eq(drugs.id, from.id));

    await tx.insert(auditLog).values({
      actorId,
      action: 'drug.merge',
      targetType: 'drug',
      targetId: into.id,
      diff: planned.value as unknown as Record<string, unknown>,
    });
  });

  return { ok: true, value: planned.value! };
}

/** Every other drug, for the picker. */
export async function mergeCandidates(slug: string) {
  return db
    .select({ slug: drugs.slug, generic: drugs.genericName, drugClass: drugs.drugClass })
    .from(drugs)
    .where(sql`${drugs.slug} <> ${slug}`)
    .orderBy(asc(drugs.genericName));
}
