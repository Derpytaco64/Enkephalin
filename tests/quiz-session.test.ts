import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { accounts, drugs, fieldDefs, quizAnswers, quizAttempts, sessions, tags, users } from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { DEFAULT_CONFIG } from '@/lib/study/config';
import { loadQuiz, recentAttempts, recordAttempt, weakestFields } from '@/lib/study/quiz-session';

const USER = 'user-student';

beforeEach(async () => {
  await db.delete(quizAnswers);
  await db.delete(quizAttempts);
  await db.delete(drugs);
  await db.delete(tags);
  await db.delete(fieldDefs);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);

  await db.insert(users).values({ id: USER, email: 'student@example.test' });
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);

  const field = (value: string) => ({
    value, status: 'ok' as const, source: 'test', updatedAt: '', updatedBy: null,
  });
  await db.insert(drugs).values([
    {
      slug: 'atorvastatin', genericName: 'Atorvastatin', drugClass: 'HMG-CoA Reductase Inhibitor',
      fields: { moa: field('HMG-CoA reductase inhibition'), dosing: field('10 mg by mouth once a day') },
    },
    {
      slug: 'simvastatin', genericName: 'Simvastatin', drugClass: 'HMG-CoA Reductase Inhibitor',
      fields: { moa: field('HMG-CoA reductase inhibition, prodrug'), dosing: field('20 mg by mouth at bedtime') },
    },
    {
      slug: 'lisinopril', genericName: 'Lisinopril', drugClass: 'ACE Inhibitor',
      fields: { moa: field('ACE inhibition'), dosing: field('10 mg by mouth once a day') },
    },
    {
      slug: 'metformin', genericName: 'Metformin', drugClass: 'Biguanide',
      fields: { moa: field('Hepatic gluconeogenesis inhibition'), dosing: field('500 mg by mouth twice a day') },
    },
  ]);
});

const config = { ...DEFAULT_CONFIG, fields: ['moa'], maxCards: 0, scope: { ...DEFAULT_CONFIG.scope, dueOnly: false } };

describe('loadQuiz', () => {
  it('builds a paper from the database and says what it drew from', async () => {
    const paper = await loadQuiz(config);

    expect(paper.available).toBe(4);
    expect(paper.questions).toHaveLength(4);
    for (const question of paper.questions) {
      expect(question.options).toHaveLength(4);
      expect(question.fieldKey).toBe('moa');
    }
  });

  it('caps the paper, reporting the pool it came from', async () => {
    const paper = await loadQuiz({ ...config, maxCards: 2 });

    expect(paper.questions).toHaveLength(2);
    expect(paper.available).toBe(4);
  });

  it('gives each draw its own id, so a re-render cannot pass for the same quiz', async () => {
    // The runner is keyed on this. Two loads of the same filters are two
    // different quizzes -- the questions are drawn at random -- and conflating
    // them is what scored a finished quiz 0 of 83 against questions nobody was
    // asked.
    const one = await loadQuiz(config);
    const two = await loadQuiz(config);

    expect(one.id).not.toBe(two.id);
    expect(one.id).toBeTruthy();
  });
});

describe('recordAttempt', () => {
  it('scores the paper and keeps the options as they were shown', async () => {
    const paper = await loadQuiz(config);
    const answers = paper.questions.map((question, index) => ({
      questionId: question.id,
      // Right for the first two, wrong for the rest.
      chosenIndex: index < 2 ? question.correctIndex : (question.correctIndex + 1) % 4,
    }));

    const result = await recordAttempt({ userId: USER, config, questions: paper.questions, answers });

    expect(result).toMatchObject({ score: 2, total: 4 });

    const [attempt] = await db.select().from(quizAttempts).where(eq(quizAttempts.userId, USER));
    expect(attempt.score).toBe(2);
    expect(attempt.total).toBe(4);
    expect(attempt.finishedAt).not.toBeNull();

    const rows = await db.select().from(quizAnswers).where(eq(quizAnswers.attemptId, attempt.id));
    expect(rows).toHaveLength(4);
    expect(rows.filter((row) => row.wasCorrect)).toHaveLength(2);
    // The options are stored rather than recomputed: they were random, and a
    // review that re-rolled them would show a question nobody answered.
    for (const row of rows) expect(row.choices).toHaveLength(4);
  });

  it('records a question left unanswered as wrong but unanswered', async () => {
    const paper = await loadQuiz(config);
    const answers = paper.questions.map((question) => ({ questionId: question.id, chosenIndex: null }));

    const result = await recordAttempt({ userId: USER, config, questions: paper.questions, answers });
    expect(result.score).toBe(0);

    const rows = await db.select().from(quizAnswers);
    expect(rows.every((row) => row.chosenIndex === null)).toBe(true);
    expect(rows.every((row) => row.wasCorrect === false)).toBe(true);
    // Not answered is not the same as answered wrongly, and the timestamp is
    // what tells them apart later.
    expect(rows.every((row) => row.answeredAt === null)).toBe(true);
  });
});

describe('history', () => {
  it('breaks an attempt down by field, so a weak area is visible', async () => {
    const paper = await loadQuiz({ ...config, fields: ['moa', 'dosing'] });
    const answers = paper.questions.map((question) => ({
      questionId: question.id,
      // Every mechanism right, every dose wrong.
      chosenIndex: question.fieldKey === 'moa'
        ? question.correctIndex
        : (question.correctIndex + 1) % question.options.length,
    }));
    await recordAttempt({ userId: USER, config, questions: paper.questions, answers });

    const [attempt] = await recentAttempts(USER);
    const moa = attempt.byField.find((field) => field.fieldKey === 'moa')!;
    const dosing = attempt.byField.find((field) => field.fieldKey === 'dosing')!;

    expect(moa.right).toBe(moa.asked);
    expect(dosing.right).toBe(0);

    const weakest = await weakestFields(USER);
    expect(weakest[0].fieldKey).toBe('dosing');
    expect(weakest[0].rate).toBe(0);
  });

  it('lists the newest papers first', async () => {
    const paper = await loadQuiz(config);
    for (let run = 0; run < 3; run += 1) {
      await recordAttempt({
        userId: USER,
        config,
        questions: paper.questions.slice(0, run + 1),
        answers: paper.questions.slice(0, run + 1).map((question) => ({
          questionId: question.id, chosenIndex: question.correctIndex,
        })),
      });
    }

    const attempts = await recentAttempts(USER, 2);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].total).toBe(3);
    expect(attempts[0].score).toBe(3);
  });

  it('has nothing to say before the first paper', async () => {
    expect(await recentAttempts(USER)).toEqual([]);
    expect(await weakestFields(USER)).toEqual([]);
  });
});
