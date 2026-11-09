import { beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { drugs, quizAnswers, quizAttempts, users } from '@/db/schema';
import { BACKUP_VERSION, exportBackup, restoreBackup } from '@/lib/data/backup';

/**
 * The quiz history joining the backup, 2026-11-08.
 *
 * `study_cards` was carried and the history was not, so a restore brought back
 * *what is due* and lost every score, result and streak -- which made the
 * module's promise of "the progress you earned" half true.
 *
 * What is worth pinning: that an attempt's **answers stay with it and in order**
 * (they are nested precisely so no `attempt_id` has to be written down), that
 * the **score survives even when an answer cannot** (its drug may be gone), and
 * that the restore does not become a way to delete a history the file never
 * described.
 */

const ME = 'me-id';
const EMAIL = 'me@example.test';

beforeEach(async () => {
  await db.delete(quizAnswers);
  await db.delete(quizAttempts);
  await db.delete(drugs);
  await db.delete(users);
  await db.insert(users).values({ id: ME, email: EMAIL, role: 'admin' });
});

async function seedDrug(slug: string) {
  const [row] = await db.insert(drugs)
    .values({ slug, genericName: slug, fields: {} })
    .returning({ id: drugs.id });
  return row.id;
}

async function seedAttempt(input: {
  startedAt: string;
  finishedAt?: string | null;
  score?: number;
  total?: number;
  answers?: { drugId: string; answeredAt: string | null; fieldKey?: string; correct?: boolean }[];
}) {
  const [attempt] = await db.insert(quizAttempts).values({
    userId: ME,
    config: { mode: 'exclusive', fields: ['dosing'] },
    score: input.score ?? 0,
    total: input.total ?? 0,
  }).returning({ id: quizAttempts.id });

  await db.execute(sql`
    update ${quizAttempts}
    set started_at = ${input.startedAt}::timestamptz,
        finished_at = ${input.finishedAt ?? null}::timestamptz
    where id = ${attempt.id}`);

  for (const answer of input.answers ?? []) {
    const [row] = await db.insert(quizAnswers).values({
      attemptId: attempt.id,
      drugId: answer.drugId,
      questionKey: `fields_to_drug:${answer.fieldKey ?? 'dosing'}`,
      fieldKey: answer.fieldKey ?? 'dosing',
      prompt: { slug: 'x', text: 'Which drug?' },
      choices: ['A', 'B', 'C', 'D'],
      acceptable: ['A'],
      chosenIndex: 1,
      correctIndex: 0,
      wasCorrect: answer.correct ?? false,
    }).returning({ id: quizAnswers.id });

    await db.execute(sql`
      update ${quizAnswers} set answered_at = ${answer.answeredAt}::timestamptz
      where id = ${row.id}`);
  }

  return attempt.id;
}

const mine = (backup: Awaited<ReturnType<typeof exportBackup>>) =>
  backup.progress.find((person) => person.email === EMAIL)!;

describe('what the file carries', () => {
  it('nests the answers inside their attempt, with no ids at all', async () => {
    const drugId = await seedDrug('atenolol');
    await seedAttempt({
      startedAt: '2026-11-01T10:00:00.000000Z',
      finishedAt: '2026-11-01T10:05:00.000000Z',
      score: 1,
      total: 2,
      answers: [
        { drugId, answeredAt: '2026-11-01T10:01:00.000000Z', correct: true },
        { drugId, answeredAt: '2026-11-01T10:02:00.000000Z', correct: false },
      ],
    });

    const backup = await exportBackup();
    const person = mine(backup);
    expect(person.attempts).toHaveLength(1);

    const [attempt] = person.attempts;
    expect(attempt.score).toBe(1);
    expect(attempt.total).toBe(2);
    expect(attempt.answers).toHaveLength(2);
    expect(attempt.answers[0].drugSlug).toBe('atenolol');
    expect(attempt.answers.map((a) => a.wasCorrect)).toEqual([true, false]);

    // The format's whole promise.
    const blob = JSON.stringify(person.attempts);
    expect(blob).not.toContain(drugId);
    expect(blob).not.toContain(ME);
  });

  it('counts attempts and answers alongside everything else', async () => {
    const drugId = await seedDrug('atenolol');
    await seedAttempt({
      startedAt: '2026-11-01T10:00:00.000000Z',
      answers: [{ drugId, answeredAt: '2026-11-01T10:01:00.000000Z' }],
    });

    const counts = (await exportBackup()).counts;
    expect(counts.quizAttempts).toBe(1);
    expect(counts.quizAnswers).toBe(1);
  });

  it('is oldest first, and keeps answers in the order they were given', async () => {
    const drugId = await seedDrug('atenolol');
    await seedAttempt({ startedAt: '2026-06-01T10:00:00.000000Z', score: 9 });
    await seedAttempt({
      startedAt: '2026-01-01T10:00:00.000000Z',
      score: 1,
      answers: [
        { drugId, answeredAt: '2026-01-01T10:03:00.000000Z', fieldKey: 'third' },
        { drugId, answeredAt: '2026-01-01T10:01:00.000000Z', fieldKey: 'first' },
        { drugId, answeredAt: '2026-01-01T10:02:00.000000Z', fieldKey: 'second' },
      ],
    });

    const person = mine(await exportBackup());
    expect(person.attempts.map((a) => a.score)).toEqual([1, 9]);
    expect(person.attempts[0].answers.map((a) => a.fieldKey))
      .toEqual(['first', 'second', 'third']);
  });

  /** An abandoned attempt: `answered_at` is null and belongs at the end. */
  it('puts an unanswered question last rather than first', async () => {
    const drugId = await seedDrug('atenolol');
    await seedAttempt({
      startedAt: '2026-01-01T10:00:00.000000Z',
      finishedAt: null,
      answers: [
        { drugId, answeredAt: null, fieldKey: 'never' },
        { drugId, answeredAt: '2026-01-01T10:01:00.000000Z', fieldKey: 'answered' },
      ],
    });

    const [attempt] = mine(await exportBackup()).attempts;
    expect(attempt.finishedAt).toBeNull();
    expect(attempt.answers.map((a) => a.fieldKey)).toEqual(['answered', 'never']);
  });

  it('keeps a person in the file whose only progress is a quiz', async () => {
    await seedAttempt({ startedAt: '2026-01-01T10:00:00.000000Z', score: 3 });
    const backup = await exportBackup();
    expect(backup.progress.map((person) => person.email)).toContain(EMAIL);
    expect(mine(backup).cards).toHaveLength(0);
  });
});

describe('precision', () => {
  it('carries microseconds through a round trip', async () => {
    const drugId = await seedDrug('atenolol');
    await seedAttempt({
      startedAt: '2026-11-04T17:47:47.329008Z',
      answers: [{ drugId, answeredAt: '2026-11-04T17:47:49.123456Z' }],
    });

    const backup = await exportBackup();
    expect(mine(backup).attempts[0].startedAt).toBe('2026-11-04T17:47:47.329008Z');
    expect(mine(backup).attempts[0].answers[0].answeredAt).toBe('2026-11-04T17:47:49.123456Z');

    await restoreBackup(backup, 'replace');

    const [row] = await db.execute<{ started: string; answered: string }>(sql`
      select to_char(a.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as started,
             to_char(q.answered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as answered
      from ${quizAttempts} a join ${quizAnswers} q on q.attempt_id = a.id`);
    expect(row.started).toBe('2026-11-04T17:47:47.329008Z');
    expect(row.answered).toBe('2026-11-04T17:47:49.123456Z');
  });
});

describe('restoring it', () => {
  it('rebuilds the attempt and reattaches its answers', async () => {
    const drugId = await seedDrug('atenolol');
    await seedAttempt({
      startedAt: '2026-11-01T10:00:00.000000Z',
      score: 2,
      total: 3,
      answers: [
        { drugId, answeredAt: '2026-11-01T10:01:00.000000Z', correct: true },
        { drugId, answeredAt: '2026-11-01T10:02:00.000000Z', correct: true },
      ],
    });
    const backup = await exportBackup();

    // A different database: same slug, new uuid.
    await db.delete(quizAttempts);
    await db.delete(drugs);
    const freshId = await seedDrug('atenolol');
    expect(freshId).not.toBe(drugId);

    const result = await restoreBackup(backup, 'replace');
    expect(result.ok && result.report.quizAttemptsRestored).toBe(1);
    expect(result.ok && result.report.quizAnswersRestored).toBe(2);

    const [attempt] = await db.select().from(quizAttempts);
    expect(attempt.score).toBe(2);
    expect(attempt.userId).toBe(ME);

    const answers = await db.select().from(quizAnswers);
    expect(answers).toHaveLength(2);
    expect(answers.every((row) => row.drugId === freshId)).toBe(true);
    expect(answers.every((row) => row.attemptId === attempt.id)).toBe(true);
  });

  /**
   * The score is what a results screen shows and what a streak counts, so it
   * has to survive an answer that cannot be rebuilt.
   *
   * The drug is trimmed out of the *file*, not just out of the database --
   * a restore re-creates every drug the file describes, so deleting one here
   * first proves nothing. This is the shape the counter actually guards: a file
   * somebody edited, or a drug whose own row failed to land.
   */
  it('keeps the score when an answer has no drug to point at', async () => {
    const keep = await seedDrug('atenolol');
    const lose = await seedDrug('withdrawn');
    await seedAttempt({
      startedAt: '2026-11-01T10:00:00.000000Z',
      score: 2,
      total: 2,
      answers: [
        { drugId: keep, answeredAt: '2026-11-01T10:01:00.000000Z', correct: true },
        { drugId: lose, answeredAt: '2026-11-01T10:02:00.000000Z', correct: true },
      ],
    });

    const backup = await exportBackup();
    expect(backup.drugs.map((drug) => drug.slug).sort()).toEqual(['atenolol', 'withdrawn']);

    const trimmed = {
      ...backup,
      drugs: backup.drugs.filter((drug) => drug.slug !== 'withdrawn'),
    };

    await db.delete(quizAttempts);
    await db.delete(drugs).where(eq(drugs.slug, 'withdrawn'));

    const result = await restoreBackup(trimmed, 'merge');
    expect(result.ok && result.report.quizAnswersRestored).toBe(1);
    expect(result.ok && result.report.quizAnswersOrphaned).toBe(1);

    const [attempt] = await db.select().from(quizAttempts);
    expect(attempt.score).toBe(2);
    expect(attempt.total).toBe(2);
  });

  /**
   * And the ordinary case, which is the opposite: a drug deleted since the
   * backup is re-created by the restore, so its answers are not orphaned at
   * all. Worth pinning, because it is why the test above has to trim the file.
   */
  it('rebuilds a deleted drug, so its answers come back too', async () => {
    const drugId = await seedDrug('withdrawn');
    await seedAttempt({
      startedAt: '2026-11-01T10:00:00.000000Z',
      score: 1,
      total: 1,
      answers: [{ drugId, answeredAt: '2026-11-01T10:01:00.000000Z', correct: true }],
    });
    const backup = await exportBackup();

    await db.delete(quizAttempts);
    await db.delete(drugs).where(eq(drugs.slug, 'withdrawn'));

    const result = await restoreBackup(backup, 'merge');
    expect(result.ok && result.report.quizAnswersRestored).toBe(1);
    expect(result.ok && result.report.quizAnswersOrphaned).toBe(0);
    expect(await db.select().from(quizAnswers)).toHaveLength(1);
  });

  it('replaces a person history rather than doubling it', async () => {
    const drugId = await seedDrug('atenolol');
    await seedAttempt({
      startedAt: '2026-11-01T10:00:00.000000Z',
      answers: [{ drugId, answeredAt: '2026-11-01T10:01:00.000000Z' }],
    });
    const backup = await exportBackup();

    // Restoring the same file twice must not leave two of everything.
    await restoreBackup(backup, 'merge');
    await restoreBackup(backup, 'merge');

    expect(await db.select().from(quizAttempts)).toHaveLength(1);
    expect(await db.select().from(quizAnswers)).toHaveLength(1);
  });

  /**
   * "Describes no attempts" and "does not describe attempts" are different
   * files, and only the first means *delete what is here*.
   */
  it('leaves a history alone when the file does not describe one', async () => {
    const drugId = await seedDrug('atenolol');
    await seedAttempt({
      startedAt: '2026-11-01T10:00:00.000000Z',
      answers: [{ drugId, answeredAt: '2026-11-01T10:01:00.000000Z' }],
    });

    const backup = await exportBackup();
    const trimmed = {
      ...backup,
      progress: backup.progress.map((person) => ({ ...person, attempts: undefined })),
    };

    const result = await restoreBackup(trimmed, 'merge');
    expect(result.ok).toBe(true);
    expect(await db.select().from(quizAttempts)).toHaveLength(1);
  });

  it('clears a history when the file says there is none', async () => {
    const drugId = await seedDrug('atenolol');
    await seedAttempt({
      startedAt: '2026-11-01T10:00:00.000000Z',
      answers: [{ drugId, answeredAt: '2026-11-01T10:01:00.000000Z' }],
    });

    const backup = await exportBackup();
    const emptied = {
      ...backup,
      progress: backup.progress.map((person) => ({ ...person, attempts: [] })),
    };

    await restoreBackup(emptied, 'replace');
    expect(await db.select().from(quizAttempts)).toHaveLength(0);
  });
});

describe('the version', () => {
  it('is bumped again, because the shape changed again', () => {
    expect(BACKUP_VERSION).toBe(3);
  });

  it('refuses a version 2 file rather than restoring it with no history', async () => {
    const backup = await exportBackup();
    const result = await restoreBackup({ ...backup, version: 2 }, 'replace');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('version 2');
  });
});
