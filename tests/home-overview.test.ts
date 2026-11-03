import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  accounts, drugBrands, drugs, quizAnswers, quizAttempts, sessions, studyCards, users,
} from '@/db/schema';
import { overviewFor, streakFrom } from '@/lib/home/overview';

const ME = 'user-home';
const SOMEONE_ELSE = 'user-other';

let atorvastatin: string;
let lisinopril: string;

beforeEach(async () => {
  await db.delete(quizAnswers);
  await db.delete(quizAttempts);
  await db.delete(studyCards);
  await db.delete(drugBrands);
  await db.delete(drugs);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);

  await db.insert(users).values([
    { id: ME, email: 'me@example.test' },
    { id: SOMEONE_ELSE, email: 'other@example.test' },
  ]);

  const rows = await db.insert(drugs).values([
    { slug: 'atorvastatin', genericName: 'Atorvastatin', drugClass: 'HMG-CoA Reductase Inhibitor' },
    { slug: 'simvastatin', genericName: 'Simvastatin', drugClass: 'HMG-CoA Reductase Inhibitor' },
    { slug: 'lisinopril', genericName: 'Lisinopril', drugClass: 'ACE Inhibitor' },
    // No class at all, which is the case `count(distinct)` has to not count.
    { slug: 'mystery', genericName: 'Mystery' },
  ]).returning({ id: drugs.id, slug: drugs.slug });

  atorvastatin = rows.find((row) => row.slug === 'atorvastatin')!.id;
  lisinopril = rows.find((row) => row.slug === 'lisinopril')!.id;

  await db.insert(drugBrands).values([
    { drugId: atorvastatin, name: 'Lipitor', family: 'Lipitor' },
    { drugId: lisinopril, name: 'Zestril', family: 'Zestril' },
    { drugId: lisinopril, name: 'Prinivil', family: 'Prinivil' },
  ]);
});

/** One finished attempt, with the answers given against it. */
async function attempt(
  userId: string,
  answers: { drugId: string; fieldKey: string | null; wasCorrect: boolean | null }[],
  startedAt = new Date(),
) {
  const right = answers.filter((answer) => answer.wasCorrect === true).length;
  const [row] = await db.insert(quizAttempts).values({
    userId,
    config: {},
    score: right,
    total: answers.length,
    startedAt,
    finishedAt: startedAt,
  }).returning({ id: quizAttempts.id });

  if (answers.length > 0) {
    await db.insert(quizAnswers).values(answers.map((answer, index) => ({
      attemptId: row.id,
      drugId: answer.drugId,
      questionKey: `q${index}`,
      fieldKey: answer.fieldKey,
      prompt: {},
      choices: ['a', 'b', 'c', 'd'],
      correctIndex: 0,
      chosenIndex: answer.wasCorrect === null ? null : 0,
      wasCorrect: answer.wasCorrect,
      answeredAt: answer.wasCorrect === null ? null : startedAt,
    })));
  }
  return row.id;
}

const ago = (days: number) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date;
};

describe('overviewFor — catalogue', () => {
  it('counts drugs, brand names and the classes that exist', async () => {
    const overview = await overviewFor(ME);
    expect(overview.catalogue).toEqual({ drugs: 4, brands: 3, classes: 2 });
  });
});

describe('overviewFor — deck', () => {
  it('is all zeroes before a first deck, rather than null', async () => {
    const overview = await overviewFor(ME);
    expect(overview.deck).toEqual({ tracked: 0, dueNow: 0, reviews: 0 });
  });

  it('counts only this user, and only what is due now', async () => {
    const future = new Date(Date.now() + 86_400_000);
    await db.insert(studyCards).values([
      {
        userId: ME, drugId: atorvastatin, cardKey: 'k1', mode: 'exclusive',
        direction: 'drug_to_fields', fieldKeys: ['moa'], dueAt: ago(1), reviewCount: 3,
      },
      {
        userId: ME, drugId: lisinopril, cardKey: 'k1', mode: 'exclusive',
        direction: 'drug_to_fields', fieldKeys: ['moa'], dueAt: future, reviewCount: 1,
      },
      {
        userId: SOMEONE_ELSE, drugId: atorvastatin, cardKey: 'k1', mode: 'exclusive',
        direction: 'drug_to_fields', fieldKeys: ['moa'], dueAt: ago(1), reviewCount: 9,
      },
    ]);

    const overview = await overviewFor(ME);
    expect(overview.deck).toEqual({ tracked: 2, dueNow: 1, reviews: 4 });
  });
});

describe('overviewFor — quiz', () => {
  it('withholds accuracy until a question has been answered', async () => {
    const overview = await overviewFor(ME);
    // Null rather than 0, because a new account has no record and printing
    // one reads as a verdict on it.
    expect(overview.quiz.accuracy).toBeNull();
    expect(overview.quiz).toMatchObject({ attempts: 0, answered: 0, last: null });
  });

  it('reads accuracy off the answers, skipping the unanswered ones', async () => {
    await attempt(ME, [
      { drugId: atorvastatin, fieldKey: 'moa', wasCorrect: true },
      { drugId: lisinopril, fieldKey: 'moa', wasCorrect: false },
      // Never answered -- the quiz was abandoned at this question. It is not
      // a wrong answer and must not count as one.
      { drugId: lisinopril, fieldKey: 'dosing', wasCorrect: null },
    ]);

    const overview = await overviewFor(ME);
    expect(overview.quiz.answered).toBe(2);
    expect(overview.quiz.accuracy).toBe(0.5);
    expect(overview.quiz.attempts).toBe(1);
  });

  it('counts nobody else’s answers', async () => {
    await attempt(SOMEONE_ELSE, [{ drugId: atorvastatin, fieldKey: 'moa', wasCorrect: false }]);
    const overview = await overviewFor(ME);
    expect(overview.quiz.answered).toBe(0);
    expect(overview.quiz.accuracy).toBeNull();
  });

  it('reports the most recent attempt as the last one', async () => {
    await attempt(ME, [{ drugId: atorvastatin, fieldKey: 'moa', wasCorrect: true }], ago(5));
    await attempt(ME, [
      { drugId: atorvastatin, fieldKey: 'moa', wasCorrect: true },
      { drugId: lisinopril, fieldKey: 'moa', wasCorrect: true },
    ], ago(1));

    const overview = await overviewFor(ME);
    expect(overview.quiz.last).toMatchObject({ score: 2, total: 2 });
  });
});

describe('overviewFor — weakest field', () => {
  const many = (fieldKey: string, right: number, wrong: number) => [
    ...Array.from({ length: right }, () => ({ drugId: atorvastatin, fieldKey, wasCorrect: true })),
    ...Array.from({ length: wrong }, () => ({ drugId: lisinopril, fieldKey, wasCorrect: false })),
  ];

  it('says nothing until a field has enough answers to judge', async () => {
    // Seven answers, all wrong, and still not enough: without a floor the
    // answer is whatever you got wrong once.
    await attempt(ME, many('moa', 0, 7));
    expect((await overviewFor(ME)).weakest).toBeNull();
  });

  it('picks the worst field by accuracy, not by wrong answers', async () => {
    await attempt(ME, [
      ...many('moa', 2, 6),          // 25%, 8 answers
      ...many('dosing', 10, 10),     // 50%, 20 answers -- more wrong, better record
    ]);

    const overview = await overviewFor(ME);
    expect(overview.weakest).toEqual({ fieldKey: 'moa', asked: 8, right: 2 });
  });

  it('ignores a per-drug bundle, whose key is several fields joined', async () => {
    // A bundle's record is not either field's record: getting it wrong says
    // only that one of them was.
    await attempt(ME, many('moa+dosing', 0, 12));
    expect((await overviewFor(ME)).weakest).toBeNull();
  });

  it('does not nominate a field you have never missed', async () => {
    await attempt(ME, many('moa', 12, 0));
    expect((await overviewFor(ME)).weakest).toBeNull();
  });
});

describe('overviewFor — streak', () => {
  it('counts consecutive days of either kind of study', async () => {
    await attempt(ME, [{ drugId: atorvastatin, fieldKey: 'moa', wasCorrect: true }], ago(0));
    await attempt(ME, [{ drugId: atorvastatin, fieldKey: 'moa', wasCorrect: true }], ago(1));
    // Yesterday again, which must not count twice, and a deck review the day
    // before -- the two sources are unioned, not added.
    await db.insert(studyCards).values({
      userId: ME, drugId: lisinopril, cardKey: 'k1', mode: 'exclusive',
      direction: 'drug_to_fields', fieldKeys: ['moa'], dueAt: ago(1), lastReviewedAt: ago(2),
    });

    expect((await overviewFor(ME)).streak).toBe(3);
  });

  it('is zero for an account that has done nothing', async () => {
    expect((await overviewFor(ME)).streak).toBe(0);
  });
});

describe('streakFrom', () => {
  const day = (offset: number) => {
    const date = new Date(2026, 10, 3, 12);
    date.setDate(date.getDate() + offset);
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
  };
  const today = new Date(2026, 10, 3, 9, 30);

  it('counts back from today', () => {
    expect(streakFrom([day(0), day(-1), day(-2)], today)).toBe(3);
  });

  it('stops at the first missing day', () => {
    expect(streakFrom([day(0), day(-1), day(-3)], today)).toBe(2);
  });

  it('still counts a run that ends yesterday', () => {
    // Opening the page in the morning must not report the streak as broken
    // before the day's session.
    expect(streakFrom([day(-1), day(-2)], today)).toBe(2);
  });

  it('is zero once two days have been missed', () => {
    expect(streakFrom([day(-2), day(-3)], today)).toBe(0);
  });

  it('crosses a month boundary', () => {
    const first = new Date(2026, 11, 1, 9);
    expect(streakFrom(['2026-12-01', '2026-11-30', '2026-11-29'], first)).toBe(3);
  });
});
