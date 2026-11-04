import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  auditLog, dosingRegimens, drugBrands, drugIndications, drugs, fieldDefs, indications,
  quizAnswers, quizAttempts, sessions, users,
} from '@/db/schema';
import { benchCounts, benchQueue, BENCH_KINDS, BENCH_LABELS, splitDrugs } from '@/lib/dosing/bench';
import { createDrug, rebuildRegimens, setDosingUnique } from '@/lib/drugs/mutations';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';

/**
 * The dosing review bench.
 *
 * The one queue in this app that has ever had real work in it: 76 of 252
 * regimens carry a reading the parser would not stand behind, and until this
 * screen existed nothing listed them -- known and unreachable at the same
 * time, which is the worst state for a to-do.
 */

const ADMIN = 'user-admin';
const NL = String.fromCharCode(10);

beforeEach(async () => {
  await db.delete(quizAnswers);
  await db.delete(quizAttempts);
  await db.delete(auditLog);
  await db.delete(dosingRegimens);
  await db.delete(drugBrands);
  await db.delete(drugIndications);
  await db.delete(indications);
  await db.delete(drugs);
  await db.delete(fieldDefs);
  await db.delete(sessions);
  await db.delete(users);

  await db.insert(users).values({ id: ADMIN, email: 'admin@example.test', role: 'admin' });
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);
});

/** A drug with the dosing prose given, read into regimens as the editor would. */
async function drug(generic: string, dosing: string, options: {
  indications?: string;
  drugClass?: string;
} = {}) {
  const created = await createDrug({
    genericName: generic,
    drugClass: options.drugClass ?? 'Test class',
    schedule: '',
    scheduleNote: '',
    brands: '',
    indications: options.indications ?? 'Anxiety',
    dosing,
    dosingUnique: false,
    tagSlugs: [],
  }, ADMIN);
  if (!created.ok || created.value === undefined) throw new Error(`fixture failed: ${generic}`);

  const [row] = await db.select().from(drugs).where(eq(drugs.slug, created.value));
  return row;
}

describe('what lands in the queue', () => {
  it('leaves out a dosing that read cleanly', async () => {
    await drug('Clean', '20 mg by mouth three times a day');
    expect(await benchQueue()).toEqual([]);
  });

  it('holds a dosing nothing could be read from', async () => {
    await drug('Vague', 'as directed');
    const queue = await benchQueue();
    expect(queue.map((row) => row.generic)).toEqual(['Vague']);
    expect(queue[0].kind).toBe('no-sig');
    expect(queue[0].regimens[0].sig).toBeNull();
  });

  it('holds a dosing that read with a caveat, and prints the sig it got', async () => {
    // Read, but the source never says how often -- so the components are there
    // and a human still has to decide whether that is the answer.
    await drug('Caveat', '50 mg by mouth');
    const [row] = await benchQueue();
    expect(row.kind).toBe('needs-look');
    expect(row.regimens[0].sig).toBe('50 mg PO');
    expect(row.regimens[0].readback).toContain('50 mg');
    expect(row.regimens[0].notes.join(' ')).toContain('frequency');
  });

  it('puts an unrecognised indication ahead of everything', async () => {
    // A typo in a heading is somebody's slip and takes seconds to fix, so it
    // leads -- and it is the only kind where the *data* is wrong rather than
    // merely unread.
    await drug('Vague', 'as directed');
    const split = await drug('Split', 'Anxiety: 1 mg by mouth once a day', {
      indications: 'Anxiety',
    });
    await rebuildRegimens(
      split.id, split.genericName,
      `Anxiety: 1 mg by mouth once a day${NL}Hair loss: 1 mg by mouth once a day`,
      ADMIN,
    );

    const queue = await benchQueue();
    expect(queue[0].generic).toBe('Split');
    expect(queue[0].kind).toBe('unresolved-indication');
    expect(queue[0].regimens.some((regimen) => regimen.orphaned)).toBe(true);
  });

  it('drops out once somebody says the source is like that', async () => {
    const row = await drug('Vague', 'as directed');
    expect(await benchQueue()).toHaveLength(1);

    await setDosingUnique(row.slug, true, ADMIN);
    expect(await benchQueue()).toEqual([]);
  });

  it('comes back if that is undone', async () => {
    const row = await drug('Vague', 'as directed');
    await setDosingUnique(row.slug, true, ADMIN);
    await setDosingUnique(row.slug, false, ADMIN);
    expect(await benchQueue()).toHaveLength(1);
  });

  it('groups a drug once, however many rows it has', async () => {
    // The prose is one field, so the queue is worked a drug at a time: two bad
    // rows on one drug are one piece of work, not two. (Two alternatives, each
    // missing a frequency -- a *refused* prose stores one row carrying the lot,
    // so it would not have shown this.)
    await drug('Pair', '50 mg by mouth OR 100 mg by mouth');
    const queue = await benchQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].regimens.length).toBeGreaterThan(1);
  });
});

describe('the order the work comes in', () => {
  it('leads with what has actually been asked of somebody', async () => {
    // The flagged queue's rule, one table over: a bad reading that has already
    // reached a person costs more than one that has not.
    const quiet = await drug('Aaa Quiet', 'as directed');
    const asked = await drug('Zzz Asked', 'per protocol');

    const [attempt] = await db
      .insert(quizAttempts)
      .values({ userId: ADMIN, config: {}, score: 0, total: 1 })
      .returning({ id: quizAttempts.id });
    await db.insert(quizAnswers).values({
      attemptId: attempt.id,
      drugId: asked.id,
      questionKey: 'drug_to_fields:dosing',
      prompt: {},
      choices: [],
      chosenIndex: 0,
      correctIndex: 0,
      wasCorrect: false,
    });

    const queue = await benchQueue();
    expect(queue.map((row) => row.generic)).toEqual(['Zzz Asked', 'Aaa Quiet']);
    expect(queue[0].asked).toBe(1);
    expect(queue[1].asked).toBe(0);

    // And the quiet one is only behind on that count, not on the alphabet.
    expect(quiet.genericName < asked.genericName).toBe(true);
  });

  it('falls back to alphabetical, which is where the queue starts life', async () => {
    await drug('Charlie', 'as directed');
    await drug('Alpha', 'as directed');
    await drug('Bravo', 'as directed');
    expect((await benchQueue()).map((row) => row.generic)).toEqual(['Alpha', 'Bravo', 'Charlie']);
  });

  it('only counts dosing questions towards that', async () => {
    const row = await drug('Asked', 'as directed');
    const [attempt] = await db
      .insert(quizAttempts)
      .values({ userId: ADMIN, config: {}, score: 0, total: 1 })
      .returning({ id: quizAttempts.id });
    await db.insert(quizAnswers).values({
      attemptId: attempt.id,
      drugId: row.id,
      // A mechanism question says nothing about whether the dosing is trusted.
      questionKey: 'drug_to_fields:moa',
      prompt: {},
      choices: [],
      chosenIndex: 0,
      correctIndex: 0,
      wasCorrect: true,
    });
    expect((await benchQueue())[0].asked).toBe(0);
  });

  it('counts a branch-keyed dosing question too', async () => {
    const row = await drug('Asked', 'as directed');
    const [attempt] = await db
      .insert(quizAttempts)
      .values({ userId: ADMIN, config: {}, score: 0, total: 1 })
      .returning({ id: quizAttempts.id });
    await db.insert(quizAnswers).values({
      attemptId: attempt.id,
      drugId: row.id,
      questionKey: 'drug_to_fields:dosing:erectile-dysfunction',
      prompt: {},
      choices: [],
      chosenIndex: 0,
      correctIndex: 0,
      wasCorrect: false,
    });
    expect((await benchQueue())[0].asked).toBe(1);
  });
});

describe('filtering', () => {
  it('narrows to one kind', async () => {
    await drug('Vague', 'as directed');
    await drug('Caveat', '50 mg by mouth');

    expect((await benchQueue('no-sig')).map((row) => row.generic)).toEqual(['Vague']);
    expect((await benchQueue('needs-look')).map((row) => row.generic)).toEqual(['Caveat']);
    expect((await benchQueue('unresolved-indication'))).toEqual([]);
  });

  it('has a title and a blurb for every kind, so no pill renders a raw value', () => {
    for (const kind of BENCH_KINDS) {
      expect(BENCH_LABELS[kind].title, kind).toBeTruthy();
      expect(BENCH_LABELS[kind].blurb.length, kind).toBeGreaterThan(40);
    }
  });
});

describe('the counts beside the queue', () => {
  it('says how much of the whole is left', async () => {
    await drug('Clean', '20 mg by mouth three times a day');
    await drug('Vague', 'as directed');

    const counts = await benchCounts();
    expect(counts.total).toBe(2);
    expect(counts.regimens).toBe(1);
    expect(counts.drugs).toBe(1);
    expect(counts.byKind['no-sig']).toBe(1);
    expect(counts.byKind['needs-look']).toBe(0);
  });

  it('lists the drugs whose dosing is split by indication', async () => {
    await drug('Clean', '20 mg by mouth three times a day');
    const split = await drug('Split', '1 mg by mouth once a day', {
      indications: `Anxiety${NL}Insomnia`,
    });
    await rebuildRegimens(
      split.id, split.genericName,
      `Anxiety: 1 mg by mouth once a day${NL}Insomnia: 2 mg by mouth once a day`,
      ADMIN,
    );

    expect(await splitDrugs()).toEqual([
      { slug: 'split', generic: 'Split', branches: 2 },
    ]);
  });
});

describe('the bench writes nothing of its own', () => {
  const actions = readFileSync('app/admin/dosing/actions.ts', 'utf8');

  it('goes through the drug editor’s own writers', () => {
    // One parser, one writer, one audit trail, whichever screen you came from.
    // A bench with its own insert would be a second way for dosing to reach
    // the database, and the two would drift.
    expect(actions).toContain("from '@/lib/drugs/mutations'");
    expect(actions).toContain('setDrugField(');
    expect(actions).toContain('rebuildRegimens(');
    expect(actions).toContain('setDosingUnique(');
    expect(actions).not.toContain('db.insert');
    expect(actions).not.toContain('db.update');
  });

  it('re-checks the role in every action', () => {
    const guards = actions.match(/await requireAdmin\(\)/g) ?? [];
    const exported = actions.match(/export async function/g) ?? [];
    expect(guards.length).toBe(exported.length);
  });

  it('revalidates the drug’s own pages, not just the queue', () => {
    // The dosing shows on three screens; a save that only refreshed this one
    // would leave the other two disagreeing with it.
    for (const path of ['/admin/dosing', '/drugs/${slug}', '/drugs']) {
      expect(actions, path).toContain(path);
    }
  });

  it('is read-only in the query layer', () => {
    const bench = readFileSync('lib/dosing/bench.ts', 'utf8');
    expect(bench).not.toContain('db.insert');
    expect(bench).not.toContain('db.update');
    expect(bench).not.toContain('db.delete');
  });
});
