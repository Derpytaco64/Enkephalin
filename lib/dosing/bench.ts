/**
 * The dosing review queue: the regimens the parser could not fully read, with
 * enough context to settle each one.
 *
 * 76 of 252 rows, across 72 drugs, and until now no screen listed them. They
 * are not *missing* -- a refused dosing is still stored, still shown on a
 * profile and still asked as free recall -- but a dosing with no components
 * cannot be a multiple-choice answer, so each one is a question the quiz
 * cannot ask until somebody looks.
 *
 * The queue is read, never written to. Everything actionable goes through the
 * same two functions the drug editor uses (`rebuildRegimens` by way of
 * `setDrugField`, and `setDosingUnique`), so the bench cannot become a second
 * way for dosing to get into the database.
 */
import { and, asc, count, eq, isNotNull, like, sql } from 'drizzle-orm';
import { db } from '@/db';
import {
  dosingRegimens, drugIndications, drugs, indications, quizAnswers,
} from '@/db/schema';
import { toEnglish, toSig } from '@/lib/dosing/sig';

/**
 * What is wrong with a row, worst first.
 *
 * Three kinds because the work is different in each. An unresolved indication
 * is a typo somebody can fix in seconds; a dosing with no components needs a
 * decision about wording; and a row that read with notes may need nothing at
 * all beyond somebody saying so.
 */
export type BenchKind = 'unresolved-indication' | 'no-sig' | 'needs-look';

export const BENCH_KINDS: BenchKind[] = ['unresolved-indication', 'no-sig', 'needs-look'];

export const BENCH_LABELS: Record<BenchKind, { title: string; blurb: string }> = {
  'unresolved-indication': {
    title: 'Indication not recognised',
    blurb: 'A dosing line names a condition this drug is not recorded as being for. '
      + 'Correct the heading, or add the indication to the drug.',
  },
  'no-sig': {
    title: 'No sig at all',
    blurb: 'Nothing machine-readable came out of the wording, so multiple choice cannot ask it. '
      + 'Still shown on the profile and still asked as free recall.',
  },
  'needs-look': {
    title: 'Read, with a caveat',
    blurb: 'The components came out, but the parser noted something about them. '
      + 'Often the answer is that the source really is like that.',
  },
};

export type BenchRegimen = {
  id: string;
  /** The indication this dose is for, or null for the drug as a whole. */
  indication: string | null;
  /** Set where the prose named an indication the drug does not have. */
  orphaned: boolean;
  label: string | null;
  sourceText: string;
  /** Null where there are no components to print one from. */
  sig: string | null;
  /** The sig turned back into English -- where a mis-read shows up as nonsense. */
  readback: string | null;
  notes: string[];
};

export type BenchRow = {
  /** Carried because `rebuildRegimens` takes an id, not a slug. */
  drugId: string;
  slug: string;
  generic: string;
  drugClass: string | null;
  /** The prose, which is the thing to edit. */
  prose: string | null;
  /** Somebody has already said this sig is simply like that. */
  dosingUnique: boolean;
  /** Dosing questions actually answered about this drug, across everyone. */
  asked: number;
  kind: BenchKind;
  regimens: BenchRegimen[];
};

export type BenchCounts = {
  /** Rows needing review, and the drugs they belong to. */
  regimens: number;
  drugs: number;
  /** Every regimen there is, so the queue can say what share it is. */
  total: number;
  byKind: Record<BenchKind, number>;
};

/**
 * Which problem a drug's worst row has.
 *
 * One kind per drug rather than per row, because the queue is worked a drug at
 * a time -- the prose is one field and editing it re-reads every row.
 */
function kindOf(regimens: BenchRegimen[]): BenchKind {
  if (regimens.some((regimen) => regimen.orphaned)) return 'unresolved-indication';
  if (regimens.some((regimen) => regimen.sig === null)) return 'no-sig';
  return 'needs-look';
}

export async function benchCounts(): Promise<BenchCounts> {
  const [[reviewed], [total], rows] = await Promise.all([
    db
      .select({ regimens: count(dosingRegimens.id), drugs: sql<number>`count(distinct ${dosingRegimens.drugId})`.mapWith(Number) })
      .from(dosingRegimens)
      .where(eq(dosingRegimens.needsReview, true)),
    db.select({ total: count(dosingRegimens.id) }).from(dosingRegimens),
    benchQueue(),
  ]);

  const byKind = { 'unresolved-indication': 0, 'no-sig': 0, 'needs-look': 0 } as Record<BenchKind, number>;
  for (const row of rows) byKind[row.kind] += 1;

  return { regimens: reviewed.regimens, drugs: reviewed.drugs, total: total.total, byKind };
}

/**
 * The queue, worst first.
 *
 * Ordered by **what it costs to leave wrong**, which is the same rule the
 * flagged queue uses: a dosing that has actually been asked of somebody leads,
 * because that is where a bad reading has already reached a person. Everything
 * untouched falls back to alphabetical, which is where the queue starts life.
 */
export async function benchQueue(kind?: BenchKind): Promise<BenchRow[]> {
  const rows = await db
    .select({
      id: dosingRegimens.id,
      drugId: dosingRegimens.drugId,
      slug: drugs.slug,
      generic: drugs.genericName,
      drugClass: drugs.drugClass,
      prose: sql<string | null>`${drugs.fields} -> 'dosing' ->> 'value'`,
      dosingUnique: drugs.dosingUnique,
      indicationId: dosingRegimens.indicationId,
      indication: indications.label,
      label: dosingRegimens.label,
      sourceText: dosingRegimens.sourceText,
      amounts: dosingRegimens.amounts,
      routes: dosingRegimens.routes,
      site: dosingRegimens.site,
      frequency: dosingRegimens.frequency,
      modifiers: dosingRegimens.modifiers,
      duration: dosingRegimens.duration,
      ceiling: dosingRegimens.ceiling,
      qualifiers: dosingRegimens.qualifiers,
      notes: dosingRegimens.reviewNotes,
    })
    .from(dosingRegimens)
    .innerJoin(drugs, eq(drugs.id, dosingRegimens.drugId))
    .leftJoin(drugIndications, eq(drugIndications.id, dosingRegimens.indicationId))
    .leftJoin(indications, eq(indications.id, drugIndications.indicationId))
    .where(eq(dosingRegimens.needsReview, true))
    .orderBy(asc(drugs.genericName), asc(dosingRegimens.alternative), asc(dosingRegimens.step));

  // One query for the whole queue rather than one per drug: a dosing question
  // is keyed `<direction>:dosing` or `<direction>:dosing:<branch>`, so a LIKE
  // on the key is the honest way to ask "has this been asked of anyone".
  const askedRows = await db
    .select({ drugId: quizAnswers.drugId, asked: count(quizAnswers.id) })
    .from(quizAnswers)
    .where(like(quizAnswers.questionKey, '%dosing%'))
    .groupBy(quizAnswers.drugId);
  const askedByDrug = new Map(askedRows.map((row) => [row.drugId, row.asked]));

  const byDrug = new Map<string, BenchRow>();
  for (const row of rows) {
    const held = byDrug.get(row.slug) ?? {
      drugId: row.drugId,
      slug: row.slug,
      generic: row.generic,
      drugClass: row.drugClass,
      prose: row.prose,
      dosingUnique: row.dosingUnique,
      asked: askedByDrug.get(row.drugId) ?? 0,
      kind: 'needs-look' as BenchKind,
      regimens: [],
    };
    byDrug.set(row.slug, held);

    const printable = {
      alternative: 0,
      step: 0,
      label: row.label,
      amounts: row.amounts,
      routes: row.routes,
      site: row.site,
      frequency: row.frequency,
      modifiers: row.modifiers,
      duration: row.duration,
      ceiling: row.ceiling,
      qualifiers: row.qualifiers,
    };

    held.regimens.push({
      id: row.id,
      indication: row.indication,
      // A row whose notes say the heading was not recognised. Read off the
      // note rather than re-derived, so the bench says exactly what the writer
      // said, and cannot disagree with it.
      orphaned: row.indicationId === null
        && row.notes.some((note) => note.includes('is not one of this drug')),
      label: row.label,
      sourceText: row.sourceText,
      sig: row.amounts.length > 0 ? toSig(printable) : null,
      readback: row.amounts.length > 0 ? toEnglish(printable) : null,
      notes: row.notes,
    });
  }

  const queue = [...byDrug.values()].map((row) => ({ ...row, kind: kindOf(row.regimens) }));
  const filtered = kind === undefined ? queue : queue.filter((row) => row.kind === kind);

  return filtered.sort((a, b) => {
    const rank = BENCH_KINDS.indexOf(a.kind) - BENCH_KINDS.indexOf(b.kind);
    if (rank !== 0) return rank;
    if (a.asked !== b.asked) return b.asked - a.asked;
    return a.generic.localeCompare(b.generic);
  });
}

/** Branch-scoped doses, for the one count worth showing beside the queue. */
export async function splitDrugs(): Promise<{ generic: string; slug: string; branches: number }[]> {
  const rows = await db
    .select({
      slug: drugs.slug,
      generic: drugs.genericName,
      branches: sql<number>`count(distinct ${dosingRegimens.indicationId})`.mapWith(Number),
    })
    .from(dosingRegimens)
    .innerJoin(drugs, eq(drugs.id, dosingRegimens.drugId))
    .where(and(isNotNull(dosingRegimens.indicationId)))
    .groupBy(drugs.slug, drugs.genericName)
    .orderBy(asc(drugs.genericName));
  return rows;
}
