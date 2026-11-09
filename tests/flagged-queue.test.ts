import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  auditLog, drugs, fieldDefs, quizAnswers, quizAttempts, users, type FieldValue,
} from '@/db/schema';
import { clearFlag, flaggedCounts, flaggedQueue } from '@/lib/admin/flagged';

/**
 * The flagged queue: the screen the browse filter's *Flagged* option never had.
 *
 * What is worth testing is the **ordering**, because that is the whole claim of
 * the screen -- a doubtful value that has already been asked of somebody
 * outranks one nobody has seen -- and `clearFlag`, because it must leave the
 * value untouched while removing the doubt. Those are the two ways this screen
 * can be quietly wrong.
 */

const ADMIN = 'user-admin';

function value(text: string, status: FieldValue['status'], source?: string): FieldValue {
  return {
    value: text,
    status,
    source: source ?? 'class sheet',
    updatedAt: new Date().toISOString(),
    updatedBy: null,
  };
}

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(quizAnswers);
  await db.delete(quizAttempts);
  await db.delete(drugs);
  await db.delete(fieldDefs);
  await db.delete(users);

  await db.insert(users).values({ id: ADMIN, email: 'admin@example.test', role: 'admin' });
  await db.insert(fieldDefs).values([
    { key: 'moa', label: 'Mechanism of action', dataType: 'markdown', isQuizzable: true },
    { key: 'dosing', label: 'Dosing', dataType: 'markdown', isQuizzable: true },
    { key: 'drug_class', label: 'Drug class', dataType: 'text', isQuizzable: false },
  ]);
});

async function seed(rows: { slug: string; generic: string; fields: Record<string, FieldValue> }[]) {
  return db.insert(drugs).values(
    rows.map((row) => ({ slug: row.slug, genericName: row.generic, fields: row.fields })),
  ).returning({ id: drugs.id, slug: drugs.slug });
}

/** One answered quiz question keyed on this drug-and-field. */
async function asked(drugId: string, fieldKey: string, when: Date) {
  const [attempt] = await db.insert(quizAttempts)
    .values({ userId: ADMIN, config: {} })
    .returning({ id: quizAttempts.id });

  await db.insert(quizAnswers).values({
    attemptId: attempt.id,
    drugId,
    fieldKey,
    questionKey: `${drugId}:${fieldKey}`,
    prompt: {},
    choices: [],
    correctIndex: 0,
    answeredAt: when,
  });
}

describe('what reaches the queue', () => {
  it('takes flagged values and leaves ok and none alone', async () => {
    await seed([
      { slug: 'a', generic: 'Aaa', fields: { moa: value('doubted', 'flagged') } },
      { slug: 'b', generic: 'Bbb', fields: { moa: value('fine', 'ok') } },
      { slug: 'c', generic: 'Ccc', fields: { moa: value('', 'none') } },
    ]);

    const queue = await flaggedQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].slug).toBe('a');
    expect(queue[0].fieldLabel).toBe('Mechanism of action');
    expect(queue[0].text).toBe('doubted');
  });

  it('counts one row per flagged value, not per drug', async () => {
    await seed([{
      slug: 'a',
      generic: 'Aaa',
      fields: { moa: value('x', 'flagged'), dosing: value('y', 'flagged') },
    }]);

    const queue = await flaggedQueue();
    const counts = await flaggedCounts();
    expect(queue).toHaveLength(2);
    expect(counts.values).toBe(2);
    expect(counts.drugs).toBe(1);
  });

  it('separates the values no quiz asks, which are a profile problem', async () => {
    await seed([{
      slug: 'a',
      generic: 'Aaa',
      fields: { moa: value('x', 'flagged'), drug_class: value('Statin', 'flagged') },
    }]);

    const counts = await flaggedCounts();
    expect(counts.values).toBe(2);
    expect(counts.unquizzable).toBe(1);

    const klass = (await flaggedQueue()).find((row) => row.fieldKey === 'drug_class');
    expect(klass?.quizzable).toBe(false);
  });

  /**
   * A field can be retired from the registry while a flagged value sits behind
   * it. Hiding the row would hide a value that is still on the profile.
   */
  it('keeps a value whose field is no longer defined', async () => {
    await seed([{ slug: 'a', generic: 'Aaa', fields: { gone: value('orphan', 'flagged') } }]);

    const [row] = await flaggedQueue();
    expect(row.fieldKey).toBe('gone');
    expect(row.fieldLabel).toBe('gone');
    expect(row.text).toBe('orphan');
  });
});

describe('the ordering, which is the point of the screen', () => {
  it('puts what has been asked ahead of what has not, then the most recent', async () => {
    const seeded = await seed([
      { slug: 'never', generic: 'Aaa Never', fields: { moa: value('x', 'flagged') } },
      { slug: 'once-old', generic: 'Bbb Once Old', fields: { moa: value('x', 'flagged') } },
      { slug: 'once-new', generic: 'Ccc Once New', fields: { moa: value('x', 'flagged') } },
      { slug: 'twice', generic: 'Zzz Twice', fields: { moa: value('x', 'flagged') } },
    ]);
    const id = (slug: string) => seeded.find((row) => row.slug === slug)!.id;

    await asked(id('twice'), 'moa', new Date('2026-10-01T00:00:00Z'));
    await asked(id('twice'), 'moa', new Date('2026-10-02T00:00:00Z'));
    await asked(id('once-old'), 'moa', new Date('2026-09-01T00:00:00Z'));
    await asked(id('once-new'), 'moa', new Date('2026-11-01T00:00:00Z'));

    const queue = await flaggedQueue();
    expect(queue.map((row) => row.slug)).toEqual(['twice', 'once-new', 'once-old', 'never']);
    expect(queue[0].asked).toBe(2);
    // Alphabetical last, which is where the queue starts life: "Zzz Twice"
    // leads anyway, because being asked outranks the alphabet.
    expect(queue[3].asked).toBe(0);
    expect(queue[3].lastAsked).toBeNull();
  });

  it('counts only answers for the same field, not the whole drug', async () => {
    const [drug] = await seed([{
      slug: 'a', generic: 'Aaa', fields: { moa: value('x', 'flagged') },
    }]);

    // Asked a lot, but about the dosing -- which says nothing about whether
    // the doubtful mechanism has reached anybody.
    await asked(drug.id, 'dosing', new Date('2026-11-01T00:00:00Z'));
    await asked(drug.id, 'dosing', new Date('2026-11-02T00:00:00Z'));

    const [row] = await flaggedQueue();
    expect(row.asked).toBe(0);
    expect((await flaggedCounts()).asked).toBe(0);
  });
});

describe('clearing a flag', () => {
  it('removes the doubt and changes nothing else about the value', async () => {
    await seed([{
      slug: 'a',
      generic: 'Aaa',
      fields: { moa: value('the wording nobody wants changed', 'flagged', 'FDA label') },
    }]);

    const result = await clearFlag('a', 'moa', ADMIN);
    expect(result.ok).toBe(true);

    const [after] = await db.select().from(drugs);
    expect(after.fields.moa?.status).toBe('ok');
    expect(after.fields.moa?.value).toBe('the wording nobody wants changed');
    expect(after.fields.moa?.source).toBe('FDA label');
    expect(await flaggedQueue()).toHaveLength(0);
  });

  it('writes one audit row through the editor own writer', async () => {
    await seed([{ slug: 'a', generic: 'Aaa', fields: { moa: value('x', 'flagged') } }]);
    await clearFlag('a', 'moa', ADMIN);

    const log = await db.select().from(auditLog);
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe('drug.field');
    expect(log[0].actorId).toBe(ADMIN);
  });

  it('refuses what it cannot do, and says which', async () => {
    await seed([{ slug: 'a', generic: 'Aaa', fields: { moa: value('x', 'ok') } }]);

    const missingDrug = await clearFlag('nope', 'moa', ADMIN);
    expect(missingDrug.ok).toBe(false);

    const missingValue = await clearFlag('a', 'dosing', ADMIN);
    expect(missingValue.ok).toBe(false);

    // Already clear: not an error, and writes nothing.
    const alreadyOk = await clearFlag('a', 'moa', ADMIN);
    expect(alreadyOk.ok).toBe(true);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });
});
