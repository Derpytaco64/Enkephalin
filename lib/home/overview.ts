/**
 * What the home page knows about you.
 *
 * Every figure here is counted, not estimated, and each one exists because it
 * answers a question you would otherwise have to open a page to ask: is there
 * anything due, am I getting better, and what am I worst at. The last of those
 * is the only one that is also an instruction -- it carries the field key, so
 * the page can link straight to a quiz on it.
 *
 * Deliberately one function with one round of parallel queries. A home page
 * that fans out a dozen sequential counts is a home page that feels slow, and
 * these are all cheap: four counts, two aggregates and one grouped scan over
 * the signed-in user's own answers.
 */
import { and, count, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import { db } from '@/db';
import { drugBrands, drugs, quizAnswers, quizAttempts, studyCards } from '@/db/schema';

export type Overview = {
  catalogue: { drugs: number; brands: number; classes: number };
  deck: {
    /** Cards this user has a schedule for; 0 before their first deck. */
    tracked: number;
    dueNow: number;
    reviews: number;
  };
  quiz: {
    attempts: number;
    answered: number;
    /** All-time, 0--1. Null before a single question has been answered. */
    accuracy: number | null;
    last: { score: number; total: number; at: Date } | null;
  };
  /**
   * The field with the worst record, over enough answers to mean something.
   * Null when nothing clears the floor -- which is most of a first week.
   */
  weakest: { fieldKey: string; asked: number; right: number } | null;
  /** Consecutive days with any study activity, counting back from today. */
  streak: number;
};

/**
 * How many answers a field needs before it can be called your weakest.
 *
 * Without a floor the answer is whatever you got wrong once, and the page
 * would send you to a quiz about a single unlucky guess.
 */
const WEAKEST_FLOOR = 8;

/** How far back a streak is looked for. A longer one is not worth the row. */
const STREAK_WINDOW_DAYS = 400;

export async function overviewFor(userId: string): Promise<Overview> {
  const [catalogue, deck, quiz, last, weakest, days] = await Promise.all([
    catalogueCounts(),
    deckCounts(userId),
    quizTotals(userId),
    lastAttempt(userId),
    weakestField(userId),
    activeDays(userId),
  ]);

  return { catalogue, deck, quiz: { ...quiz, last }, weakest, streak: streakFrom(days) };
}

async function catalogueCounts(): Promise<Overview['catalogue']> {
  const [row] = await db
    .select({
      drugs: count(drugs.id),
      classes: sql<number>`count(distinct ${drugs.drugClass})`.mapWith(Number),
    })
    .from(drugs);
  const [brandRow] = await db.select({ brands: count(drugBrands.id) }).from(drugBrands);

  return { drugs: row.drugs, brands: brandRow.brands, classes: row.classes };
}

async function deckCounts(userId: string): Promise<Overview['deck']> {
  const [row] = await db
    .select({
      tracked: count(studyCards.id),
      // Summed over the user's cards rather than counted from a log: there is
      // no review log, the count lives on the card.
      reviews: sql<number>`coalesce(sum(${studyCards.reviewCount}), 0)`.mapWith(Number),
    })
    .from(studyCards)
    .where(eq(studyCards.userId, userId));

  const [dueRow] = await db
    .select({ dueNow: count(studyCards.id) })
    .from(studyCards)
    .where(and(eq(studyCards.userId, userId), lte(studyCards.dueAt, new Date())));

  return { tracked: row.tracked, dueNow: dueRow.dueNow, reviews: row.reviews };
}

/**
 * Attempts and accuracy.
 *
 * Accuracy is read off `quiz_answers` rather than off the attempts' scores,
 * because an abandoned attempt has a score of 0 over a total of 0 and would
 * drag an average down for nothing. An answer row either was answered or was
 * not, and only answered rows count.
 */
async function quizTotals(userId: string): Promise<Omit<Overview['quiz'], 'last'>> {
  const [attemptRow] = await db
    .select({ attempts: count(quizAttempts.id) })
    .from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), isNotNull(quizAttempts.finishedAt)));

  const [answerRow] = await db
    .select({
      answered: count(quizAnswers.id),
      right: sql<number>`count(*) filter (where ${quizAnswers.wasCorrect})`.mapWith(Number),
    })
    .from(quizAnswers)
    .innerJoin(quizAttempts, eq(quizAttempts.id, quizAnswers.attemptId))
    .where(and(eq(quizAttempts.userId, userId), isNotNull(quizAnswers.wasCorrect)));

  return {
    attempts: attemptRow.attempts,
    answered: answerRow.answered,
    accuracy: answerRow.answered === 0 ? null : answerRow.right / answerRow.answered,
  };
}

async function lastAttempt(userId: string): Promise<Overview['quiz']['last']> {
  const [row] = await db
    .select({
      score: quizAttempts.score,
      total: quizAttempts.total,
      at: quizAttempts.startedAt,
    })
    .from(quizAttempts)
    .where(and(eq(quizAttempts.userId, userId), isNotNull(quizAttempts.finishedAt)))
    .orderBy(desc(quizAttempts.startedAt))
    .limit(1);

  return row ?? null;
}

/**
 * The worst field, by accuracy, over at least `WEAKEST_FLOOR` answers.
 *
 * Per-drug questions key their `field_key` as the whole selection joined with
 * a plus, which would make "Dosing + Mechanism" a field of its own here. They
 * are excluded rather than split: a bundle's record is not either field's
 * record, since getting the bundle wrong says only that one of them was.
 */
async function weakestField(userId: string): Promise<Overview['weakest']> {
  const asked = count(quizAnswers.id);
  const right = sql<number>`count(*) filter (where ${quizAnswers.wasCorrect})`.mapWith(Number);

  const rows = await db
    .select({ fieldKey: quizAnswers.fieldKey, asked, right })
    .from(quizAnswers)
    .innerJoin(quizAttempts, eq(quizAttempts.id, quizAnswers.attemptId))
    .where(and(
      eq(quizAttempts.userId, userId),
      isNotNull(quizAnswers.wasCorrect),
      isNotNull(quizAnswers.fieldKey),
      sql`position('+' in ${quizAnswers.fieldKey}) = 0`,
    ))
    .groupBy(quizAnswers.fieldKey)
    .having(sql`count(${quizAnswers.id}) >= ${WEAKEST_FLOOR}`);

  const ranked = rows
    .filter((row): row is { fieldKey: string; asked: number; right: number } => row.fieldKey !== null)
    // Worst first, and the one with more evidence first among ties.
    .sort((a, b) => (a.right / a.asked) - (b.right / b.asked) || b.asked - a.asked);

  // A field you have never missed is not a weak field, and naming it would be
  // a strange thing for the page to suggest studying.
  const worst = ranked[0];
  return worst !== undefined && worst.right < worst.asked ? worst : null;
}

/**
 * Every day this user did anything, newest first, as `YYYY-MM-DD`.
 *
 * Dates are taken in the server's own zone rather than in UTC, since a streak
 * is about the reader's evenings: a quiz at 8pm on the US east coast is
 * already tomorrow in UTC and would otherwise split one evening into two days
 * and break the run. Self-hosted, so the server's zone is the reader's.
 */
async function activeDays(userId: string): Promise<string[]> {
  const rows = await db.execute<{ day: string }>(sql`
    select day::text as day from (
      select distinct ${quizAttempts.startedAt}::date as day
        from ${quizAttempts}
        where ${quizAttempts.userId} = ${userId}
      union
      select distinct ${studyCards.lastReviewedAt}::date as day
        from ${studyCards}
        where ${studyCards.userId} = ${userId}
          and ${studyCards.lastReviewedAt} is not null
    ) as days
    where day > current_date - ${STREAK_WINDOW_DAYS}::integer
    order by day desc`);

  return [...rows].map((row) => row.day);
}

/**
 * The run of days ending today or yesterday.
 *
 * Yesterday counts so that opening the page in the morning does not report the
 * streak as broken before the day's session; today's work extends it rather
 * than starting it over.
 *
 * Walks local midday rather than midnight, so that adding a day cannot land on
 * a daylight-saving boundary and skip or repeat one.
 */
export function streakFrom(days: string[], today = new Date()): number {
  const set = new Set(days);
  const stamp = (date: Date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

  const cursor = new Date(today);
  cursor.setHours(12, 0, 0, 0);

  if (!set.has(stamp(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(stamp(cursor))) return 0;
  }

  let run = 0;
  while (set.has(stamp(cursor))) {
    run += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return run;
}
