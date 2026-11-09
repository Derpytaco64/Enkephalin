import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { auditLog, sets, users } from '@/db/schema';
import { parseSet, SET_FORMAT, type ParsedSet } from '@/lib/sets/format';
import { importSet } from '@/lib/sets/import';
import { loadSet, scopeTags, withIdentityValue } from '@/lib/sets/source';
import { buildCards, type StudySubject } from '@/lib/study/cards';
import { buildQuiz } from '@/lib/study/quiz';
import type { StudyConfig } from '@/lib/study/config';

/**
 * An imported set, studied by the engine the drug section uses.
 *
 * This is the test that the adapter decision was right. The claim in the plan
 * is that sets need **a translation, not a second engine** -- that `buildCards`
 * and `buildQuiz` consume plain shapes, so both study modes, both directions,
 * the identity question, the acceptable-answer protection and the near-miss
 * distractor rule all arrive free. Either the real builders produce real cards
 * and real questions from a real imported set, or that claim was wishful.
 */

const ME = 'me-id';

const config = (over: Partial<StudyConfig> = {}): StudyConfig => ({
  mode: 'exclusive',
  direction: 'drug_to_fields',
  fields: ['mechanism'],
  scope: {
    tags: [], classes: [], categories: [], indications: [], routes: [], schedules: [],
    dueOnly: false,
  },
  grading: 'binary',
  maxCards: 50,
  blockSize: 0,
  sessionMode: 'cram',
  yearLevel: null,
  ...over,
} as StudyConfig);

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(sets);
  await db.delete(users);
  await db.insert(users).values({ id: ME, email: 'me@example.test', role: 'admin' });
});

function parsed(input: Record<string, unknown>): ParsedSet {
  const result = parseSet({ format: SET_FORMAT, ...input });
  if (!result.ok) throw new Error(`fixture: ${JSON.stringify(result.problems)}`);
  return result.set;
}

/** Four thyroid drugs with a class, a mechanism and a use. */
const thyroid = () => parsed({
  slug: 'thyroid',
  name: 'Thyroid',
  course: 'PSCI 413',
  exam: 'Exam 3',
  unit: 'Unit 5: Thyroid',
  identity: { key: 'generic', label: 'Generic', kind: 'drug' },
  group: 'subclass',
  kinds: ['drug'],
  fields: [
    { key: 'subclass', label: 'Subclass', type: 'enum', answers: 'chemical_class',
      options: ['Thioamide', 'Iodide'] },
    { key: 'mechanism', label: 'Mechanism', type: 'markdown', answers: 'mechanism' },
    { key: 'notes', label: 'Notes', asks: false },
  ],
  items: [
    { generic: 'Methimazole', subclass: 'Thioamide', mechanism: 'Inhibits thyroid peroxidase',
      notes: 'Once daily' },
    { generic: 'Propylthiouracil', subclass: 'Thioamide', mechanism: 'Inhibits TPO and D1' },
    { generic: 'Iodide solutions', subclass: 'Iodide', mechanism: 'Inhibits hormone release' },
    { generic: 'Radioactive iodide', subclass: 'Iodide', mechanism: 'Destroys thyroid tissue' },
  ],
});

/** A set whose subjects are not drugs at all. */
const hormones = () => parsed({
  slug: 'hormones',
  name: 'Hormones',
  identity: { key: 'hormone', label: 'Hormone', kind: 'hormone' },
  kinds: ['hormone'],
  fields: [
    { key: 'source_tissue', label: 'Source', answers: 'source_tissue' },
    { key: 'function', label: 'Function', answers: 'function' },
  ],
  items: [
    { hormone: 'TSH', source_tissue: 'Anterior pituitary', function: 'Stimulates the thyroid' },
    { hormone: 'TRH', source_tissue: 'Hypothalamus', function: 'Stimulates TSH release' },
    { hormone: 'T4', source_tissue: 'Thyroid follicles', function: 'Prohormone of T3',
      aliases: ['Thyroxine'] },
    { hormone: 'Calcitonin', source_tissue: 'Thyroid C cells', function: 'Lowers serum calcium' },
  ],
});

async function loaded(set: ParsedSet) {
  await importSet(set, ME, 'merge');
  const source = await loadSet(set.slug);
  if (!source) throw new Error('the set did not load');
  return withIdentityValue(source);
}

describe('the scope becomes tags, because the scope filter already speaks tags', () => {
  it('prefixes each level so two levels cannot collide', () => {
    expect(scopeTags({
      slug: 'thyroid', course: 'PSCI 413', exam: 'Exam 3',
      unit: 'Unit 5: Thyroid', topic: null,
    })).toEqual(['set:thyroid', 'course:psci-413', 'exam:exam-3', 'unit:unit-5-thyroid']);
  });

  it('leaves out the levels a set does not have', () => {
    expect(scopeTags({ slug: 'x', course: null, exam: null, unit: null, topic: null }))
      .toEqual(['set:x']);
  });

  it('puts them on every item, so studying one exam is a tag query', async () => {
    const source = await loaded(thyroid());
    expect(source.sources.every((item) => item.tags.includes('exam:exam-3'))).toBe(true);
  });
});

describe('the adapter', () => {
  it('maps the group column onto drugClass, which is the line that pays', async () => {
    const source = await loaded(thyroid());
    const byName = new Map(source.sources.map((item) => [item.generic, item]));

    expect(byName.get('Methimazole')!.drugClass).toBe('Thioamide');
    expect(byName.get('Radioactive iodide')!.drugClass).toBe('Iodide');
  });

  it('leaves the drug-only fields empty rather than faking them', async () => {
    const source = await loaded(thyroid());
    for (const item of source.sources) {
      expect(item.schedule).toBeNull();
      expect(item.routes).toEqual([]);
      expect(item.dosingSig).toBeNull();
      expect(item.dosingBranches).toEqual([]);
    }
  });

  it('marks a context column unquizzable, which is the switch the engine honours', async () => {
    const source = await loaded(thyroid());
    const notes = source.defs.find((def) => def.key === 'notes')!;
    expect(notes.isQuizzable).toBe(false);
  });
});

describe('flashcards, from the real builder', () => {
  it('builds one card per row from a column', async () => {
    const source = await loaded(thyroid());
    const cards = buildCards(source.sources, source.defs, config(), subjectOf(source));

    expect(cards).toHaveLength(4);
    expect(cards.map((card) => card.generic).sort()).toEqual([
      'Iodide solutions', 'Methimazole', 'Propylthiouracil', 'Radioactive iodide',
    ]);
    expect(cards[0].prompt).toContain('Mechanism');
  });

  it('never builds a card from a context column', async () => {
    const source = await loaded(thyroid());
    const cards = buildCards(
      source.sources, source.defs, config({ fields: ['mechanism', 'notes'] }), subjectOf(source),
    );
    expect(cards.every((card) => !card.fieldKeys.includes('notes'))).toBe(true);
  });

  it('asks the other direction with the subject own name as the answer', async () => {
    const source = await loaded(thyroid());
    const cards = buildCards(
      source.sources, source.defs, config({ direction: 'fields_to_drug' }), subjectOf(source),
    );

    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0].prompt).toContain('Which drug?');
    expect(cards[0].faces[0].text).toBeTruthy();
  });

  /** The whole reason the subject stopped being a constant. */
  it('asks "Which hormone?" for a set of hormones', async () => {
    const source = await loaded(hormones());
    const cards = buildCards(
      source.sources,
      source.defs,
      config({ direction: 'fields_to_drug', fields: ['function'] }),
      subjectOf(source),
    );

    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0].prompt).toContain('Which hormone?');
    expect(cards[0].prompt).not.toContain('Which drug?');
  });

  it('never asks a subject about its own name', async () => {
    const source = await loaded(hormones());
    const cards = buildCards(
      source.sources, source.defs, config({ fields: ['hormone', 'function'] }), subjectOf(source),
    );
    expect(cards.every((card) => !card.fieldKeys.includes('hormone'))).toBe(true);
  });
});

describe('a quiz, from the real builder', () => {
  it('draws its wrong answers from the other rows of the same column', async () => {
    const source = await loaded(thyroid());
    const questions = buildQuiz(
      source.sources, source.defs, config(), { rng: seeded(), subject: subjectOf(source) },
    );

    expect(questions.length).toBeGreaterThan(0);

    const mechanisms = new Set(
      source.sources.map((item) => item.values.mechanism?.value).filter(Boolean),
    );
    for (const question of questions) {
      expect(question.options).toHaveLength(4);
      // Every option is some row's real answer -- which is the entire argument
      // for importing a table instead of cards.
      for (const option of question.options) expect(mechanisms.has(option)).toBe(true);
      expect(question.options[question.correctIndex])
        .toBe(source.sources.find((item) => item.slug === question.slug)!.values.mechanism!.value);
    }
  });

  it('asks the identity question with other rows names as the options', async () => {
    const source = await loaded(hormones());
    const questions = buildQuiz(
      source.sources,
      source.defs,
      config({ direction: 'fields_to_drug', fields: ['function'] }),
      { rng: seeded(), subject: subjectOf(source) },
    );

    expect(questions.length).toBeGreaterThan(0);
    const names = new Set(source.sources.map((item) => item.generic));
    for (const question of questions) {
      expect(question.prompt).toContain('Which hormone?');
      for (const option of question.options) expect(names.has(option)).toBe(true);
    }
  });

  it('never offers a value the subject itself holds as a wrong answer', async () => {
    const source = await loaded(thyroid());
    const questions = buildQuiz(
      source.sources, source.defs, config(), { rng: seeded(), subject: subjectOf(source) },
    );

    for (const question of questions) {
      const own = source.sources.find((item) => item.slug === question.slug)!;
      const wrong = question.options.filter((_, index) => index !== question.correctIndex);
      expect(wrong).not.toContain(own.values.mechanism?.value);
    }
  });

  /**
   * Short rather than padded, which is the engine's existing rule and worth
   * pinning for sets: it asks with as many real options as the set can fill and
   * never invents one. Two options is a question, barely; one is not.
   */
  it('asks short rather than padding when the column is thin', async () => {
    const source = await loaded(parsed({
      slug: 'thin',
      name: 'Thin',
      identity: { key: 'generic', label: 'Generic', kind: 'drug' },
      kinds: ['drug'],
      fields: [{ key: 'mechanism', answers: 'mechanism' }],
      items: [
        { generic: 'One', mechanism: 'A' },
        { generic: 'Two', mechanism: 'B' },
      ],
    }));

    const questions = buildQuiz(
      source.sources, source.defs, config(), { rng: seeded(), subject: subjectOf(source) },
    );

    expect(questions).toHaveLength(2);
    for (const question of questions) {
      expect(question.options).toHaveLength(2);
      expect(new Set(question.options).size).toBe(2);
    }
  });

  it('refuses outright when there is nothing to put beside the answer', async () => {
    const source = await loaded(parsed({
      slug: 'lonely',
      name: 'Lonely',
      identity: { key: 'generic', label: 'Generic', kind: 'drug' },
      kinds: ['drug'],
      fields: [{ key: 'mechanism', answers: 'mechanism' }],
      items: [{ generic: 'Only one', mechanism: 'A' }],
    }));

    const questions = buildQuiz(
      source.sources, source.defs, config(), { rng: seeded(), subject: subjectOf(source) },
    );
    // A lone option is not a question.
    expect(questions).toHaveLength(0);
  });
});

/** The set's own identity, as the engine's subject. */
function subjectOf(source: Awaited<ReturnType<typeof loaded>>): StudySubject {
  return {
    identityKey: source.set.identityKey,
    identityLabel: source.set.identityLabel,
    askingWhich: `Which ${source.set.identityKind}?`,
  };
}

/** Deterministic, so a failure is reproducible rather than occasional. */
function seeded() {
  let state = 42;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}
