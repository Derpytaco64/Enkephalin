import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { fieldDefs, type FieldValue } from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { listFieldDefs, type FieldDef } from '@/lib/fields/registry';
import type { CardSource } from '@/lib/study/cards';
import { DEFAULT_CONFIG, type StudyConfig } from '@/lib/study/config';
import { buildQuiz, capQuiz } from '@/lib/study/quiz';
import { fieldKeysParam, manyParam } from '@/lib/study/search-params';

let defs: FieldDef[];

beforeEach(async () => {
  await db.delete(fieldDefs);
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);
  defs = await listFieldDefs();
});

function value(partial: Partial<FieldValue>): FieldValue {
  return { value: null, status: 'ok', source: 'test', updatedAt: '', updatedBy: null, ...partial };
}

function source(partial: Partial<CardSource> & { slug: string; generic: string }): CardSource {
  return {
    drugId: `id-${partial.slug}`,
    drugClass: null,
    schedule: null,
    routes: [],
    tags: [],
    indications: [],
    dosingSig: null,
    needsPairingReview: false,
    values: {},
    ...partial,
  };
}

const config = (partial: Partial<StudyConfig> = {}): StudyConfig => ({
  ...DEFAULT_CONFIG,
  fields: ['moa'],
  ...partial,
});

/** Deterministic rng: always the first candidate, so a test can assert sets. */
const first = () => 0;

/** A statin class with four members, plus two outsiders. */
function pool(): CardSource[] {
  const statin = (slug: string, generic: string, moa: string, dosing: string) =>
    source({
      slug, generic, drugClass: 'HMG-CoA Reductase Inhibitor', tags: ['statins', 'top-drugs-2026'],
      values: { moa: value({ value: moa }), dosing: value({ value: dosing }) },
    });

  return [
    statin('atorvastatin', 'Atorvastatin', 'HMG-CoA reductase inhibition', '10 mg by mouth once a day'),
    statin('rosuvastatin', 'Rosuvastatin', 'HMG-CoA reductase inhibition (hepatoselective)', '5 mg by mouth once a day'),
    statin('simvastatin', 'Simvastatin', 'HMG-CoA reductase inhibition, prodrug', '20 mg by mouth at bedtime'),
    statin('pravastatin', 'Pravastatin', 'HMG-CoA reductase inhibition, hydrophilic', '40 mg by mouth once a day'),
    source({
      slug: 'lisinopril', generic: 'Lisinopril', drugClass: 'ACE Inhibitor', tags: ['top-drugs-2026'],
      values: { moa: value({ value: 'ACE inhibition' }), dosing: value({ value: '10 mg by mouth once a day' }) },
    }),
    source({
      slug: 'metformin', generic: 'Metformin', drugClass: 'Biguanide', tags: ['top-drugs-2026'],
      values: { moa: value({ value: 'Hepatic gluconeogenesis inhibition' }), dosing: value({ value: '500 mg by mouth twice a day' }) },
    }),
  ];
}

describe('buildQuiz', () => {
  it('asks one field per question, four options, one of them right', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa'] }));

    expect(questions).toHaveLength(6);
    for (const question of questions) {
      expect(question.options).toHaveLength(4);
      expect(question.fieldKey).toBe('moa');
      expect(question.options[question.correctIndex]).toBeTruthy();
      // Four distinct strings: an option repeated is a question with two right
      // answers, however it got there.
      expect(new Set(question.options.map((option) => option.toLowerCase())).size).toBe(4);
    }
  });

  it('takes exactly one distractor from the same class', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa'] }));
    const asked = questions.find((question) => question.slug === 'atorvastatin')!;

    const classmates = ['rosuvastatin', 'simvastatin', 'pravastatin'];
    const fromClass = asked.fromSlug.filter((slug) => slug && classmates.includes(slug));

    // One near miss makes the question discriminating; three would make it a
    // test of digits, and none would make it answerable by elimination.
    expect(fromClass).toHaveLength(1);
    expect(asked.fromSlug.filter((slug) => slug === 'atorvastatin')).toHaveLength(1);
  });

  it('falls back to a category-mate when the class has only one member', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa'] }));
    const asked = questions.find((question) => question.slug === 'metformin')!;

    // Biguanide is a class of one here, so the near miss comes from the list
    // they share instead of being skipped.
    expect(asked.options).toHaveLength(4);
    expect(asked.fromSlug.filter(Boolean)).toHaveLength(4);
  });

  it('never offers another of the asked drug’s own answers as wrong', () => {
    const tirzepatide = source({
      slug: 'tirzepatide', generic: 'Tirzepatide',
      values: { indication: value({ value: 'Diabetes\nWeight management\nObstructive sleep apnea' }) },
    });
    const others = [
      source({ slug: 'lisinopril', generic: 'Lisinopril', values: { indication: value({ value: 'Hypertension' }) } }),
      source({ slug: 'metformin', generic: 'Metformin', values: { indication: value({ value: 'Diabetes' }) } }),
      source({ slug: 'sertraline', generic: 'Sertraline', values: { indication: value({ value: 'Depression' }) } }),
      source({ slug: 'gabapentin', generic: 'Gabapentin', values: { indication: value({ value: 'Neuropathic pain' }) } }),
    ];

    const questions = buildQuiz([tirzepatide, ...others], defs, config({ fields: ['indication'] }));
    const asked = questions.find((question) => question.slug === 'tirzepatide')!;

    const correct = asked.options[asked.correctIndex];
    const wrong = asked.options.filter((_, index) => index !== asked.correctIndex);

    expect(asked.acceptable.sort()).toEqual(['Diabetes', 'Obstructive sleep apnea', 'Weight management']);
    // Weight management is not a wrong answer about tirzepatide, so it cannot
    // be offered as one -- nor can Metformin's "Diabetes", which is the same
    // string as a right answer.
    for (const option of wrong) expect(asked.acceptable).not.toContain(option);
    expect(wrong).not.toContain(correct);
  });

  it('treats one indication written two ways as one answer', () => {
    // The sheet writes both: carbamazepine "Seizure", divalproex "Seizures".
    // Offering one as the wrong answer to the other offers a right answer.
    const asked = source({
      slug: 'carbamazepine', generic: 'Carbamazepine',
      values: { indication: value({ value: 'Seizure' }) },
    });
    const twin = source({
      slug: 'divalproex', generic: 'Divalproex sodium',
      values: { indication: value({ value: 'Seizures' }) },
    });
    const others = [
      source({ slug: 'lisinopril', generic: 'Lisinopril', values: { indication: value({ value: 'Hypertension' }) } }),
      source({ slug: 'metformin', generic: 'Metformin', values: { indication: value({ value: 'Diabetes' }) } }),
      source({ slug: 'sertraline', generic: 'Sertraline', values: { indication: value({ value: 'Depression' }) } }),
    ];

    const questions = buildQuiz([asked, twin, ...others], defs, config({ fields: ['indication'] }));
    const question = questions.find((row) => row.slug === 'carbamazepine')!;

    expect(question.options).not.toContain('Seizures');
    expect(question.options[question.correctIndex]).toBe('Seizure');
  });

  it('matches a clue to its plural when asking which drug', () => {
    const asked = source({
      slug: 'carbamazepine', generic: 'Carbamazepine',
      values: { indication: value({ value: 'Seizure' }) },
    });
    const twin = source({
      slug: 'divalproex', generic: 'Divalproex sodium',
      values: { indication: value({ value: 'Seizures' }) },
    });
    const others = [
      source({ slug: 'lisinopril', generic: 'Lisinopril', values: { indication: value({ value: 'Hypertension' }) } }),
      source({ slug: 'metformin', generic: 'Metformin', values: { indication: value({ value: 'Diabetes' }) } }),
      source({ slug: 'sertraline', generic: 'Sertraline', values: { indication: value({ value: 'Depression' }) } }),
    ];

    const questions = buildQuiz([asked, twin, ...others], defs, config({
      fields: ['indication'], direction: 'fields_to_drug',
    }));
    const question = questions.find((row) => row.slug === 'carbamazepine')!;

    // Divalproex is a right answer to "which drug treats seizures", however
    // the sheet spelled it, so it cannot be one of the wrong ones.
    expect(question.acceptable.sort()).toEqual(['Carbamazepine', 'Divalproex sodium']);
    expect(question.options).not.toContain('Divalproex sodium');
  });

  it('treats one dose written two ways as one answer', () => {
    // Real pair from the sheet: methenamine "1 gram by mouth two times a day"
    // and valacyclovir "1 g by mouth two times a day". Different sentences,
    // same dose, so the sig is what has to be compared.
    const asked = source({
      slug: 'valacyclovir', generic: 'Valacyclovir', dosingSig: '1 g PO BID',
      values: { dosing: value({ value: '1 g by mouth two times a day' }) },
    });
    const twin = source({
      slug: 'methenamine', generic: 'Methenamine', dosingSig: '1 g PO BID',
      values: { dosing: value({ value: '1 gram by mouth two times a day' }) },
    });
    const others = [
      source({ slug: 'metformin', generic: 'Metformin', dosingSig: '500 mg PO BID', values: { dosing: value({ value: '500 mg by mouth twice a day' }) } }),
      source({ slug: 'lisinopril', generic: 'Lisinopril', dosingSig: '10 mg PO QD', values: { dosing: value({ value: '10 mg by mouth once a day' }) } }),
      source({ slug: 'simvastatin', generic: 'Simvastatin', dosingSig: '20 mg PO QHS', values: { dosing: value({ value: '20 mg by mouth at bedtime' }) } }),
    ];

    const questions = buildQuiz([asked, twin, ...others], defs, config({ fields: ['dosing'] }));
    const question = questions.find((row) => row.slug === 'valacyclovir')!;

    expect(question.options).not.toContain('1 gram by mouth two times a day');
    expect(question.options[question.correctIndex]).toBe('1 g by mouth two times a day');
  });

  it('compares undecoded dosing by its wording, which is all it has', () => {
    // No sig on either, so the only honest comparison is the text -- and two
    // identical strings still cannot both be offered.
    const asked = source({
      slug: 'one', generic: 'One', dosingSig: null,
      values: { dosing: value({ value: 'Dose per protocol' }) },
    });
    const twin = source({
      slug: 'two', generic: 'Two', dosingSig: null,
      values: { dosing: value({ value: 'Dose per protocol' }) },
    });
    const others = [
      source({ slug: 'three', generic: 'Three', values: { dosing: value({ value: 'Titrate to effect' }) } }),
      source({ slug: 'four', generic: 'Four', values: { dosing: value({ value: 'Per pharmacy' }) } }),
    ];

    const questions = buildQuiz([asked, twin, ...others], defs, config({ fields: ['dosing'] }));
    const question = questions.find((row) => row.slug === 'one')!;

    expect(question.options.filter((option) => option === 'Dose per protocol')).toHaveLength(1);
  });

  it('asks a list field about one item rather than the whole list', () => {
    const drug = source({
      slug: 'albuterol', generic: 'Albuterol',
      values: { indication: value({ value: 'Asthma\nCOPD\nBronchospasm' }) },
    });
    const questions = buildQuiz(
      [drug, ...pool().map((other) => source({ ...other, values: { indication: value({ value: `${other.generic} use` }) } }))],
      defs,
      config({ fields: ['indication'], direction: 'drug_to_fields' }),
      { rng: first },
    );

    const asked = questions.find((question) => question.slug === 'albuterol')!;
    expect(asked.options[asked.correctIndex]).toBe('Asthma');
    expect(asked.options[asked.correctIndex]).not.toContain('COPD');
  });

  it('quizzes a dosing nobody could parse, because its wording is its own', () => {
    // The user's rule: a staged infusion is so distinctive that no other option
    // could accidentally be right, so it belongs in multiple choice.
    const acetylcysteine = source({
      slug: 'acetylcysteine', generic: 'Acetylcysteine',
      values: {
        dosing: value({
          value: '300 mg/kg total dose as a 21-hour IV infusion in 3 doses: first over 1 hour, second over 4, third over 16',
        }),
      },
    });

    const questions = buildQuiz([acetylcysteine, ...pool()], defs, config({ fields: ['dosing'] }));
    const asked = questions.find((question) => question.slug === 'acetylcysteine')!;

    expect(asked).toBeTruthy();
    expect(asked.options).toHaveLength(4);
    expect(asked.options[asked.correctIndex]).toContain('21-hour');
  });

  it('asks which drug when the direction is reversed, and keeps co-owners out', () => {
    const questions = buildQuiz(pool(), defs, config({
      fields: ['moa'], direction: 'fields_to_drug',
    }));
    const asked = questions.find((question) => question.slug === 'atorvastatin')!;

    expect(asked.prompt.startsWith('Which drug?')).toBe(true);
    expect(asked.prompt).toContain('HMG-CoA reductase inhibition');
    expect(asked.options[asked.correctIndex]).toBe('Atorvastatin');
    expect(asked.options).toHaveLength(4);
  });

  it('will not key one drug correct when another is equally right', () => {
    // Two drugs written up with the same mechanism: asked "which drug has
    // this?", both are right, so neither may appear as the other's distractor.
    const twins = [
      source({ slug: 'enalapril', generic: 'Enalapril', values: { moa: value({ value: 'ACE inhibition' }) } }),
      source({ slug: 'lisinopril', generic: 'Lisinopril', values: { moa: value({ value: 'ACE inhibition' }) } }),
      source({ slug: 'metformin', generic: 'Metformin', values: { moa: value({ value: 'Hepatic gluconeogenesis inhibition' }) } }),
      source({ slug: 'sertraline', generic: 'Sertraline', values: { moa: value({ value: 'SSRI' }) } }),
    ];

    const questions = buildQuiz(twins, defs, config({ fields: ['moa'], direction: 'fields_to_drug' }));
    const asked = questions.find((question) => question.slug === 'enalapril')!;

    expect(asked.acceptable.sort()).toEqual(['Enalapril', 'Lisinopril']);
    expect(asked.options).not.toContain('Lisinopril');
  });

  it('skips a field no drug in scope has a value for', () => {
    expect(buildQuiz(pool(), defs, config({ fields: ['bbw'] }))).toEqual([]);
  });

  it('asks nothing when there is nobody to draw a distractor from', () => {
    const alone = [source({ slug: 'only', generic: 'Only', values: { moa: value({ value: 'Something' }) } })];
    expect(buildQuiz(alone, defs, config({ fields: ['moa'] }))).toEqual([]);
  });

  it('honours the scope the flashcards use', () => {
    const questions = buildQuiz(pool(), defs, config({
      fields: ['moa'],
      scope: { ...DEFAULT_CONFIG.scope, categories: ['statins'] },
    }));

    expect(questions.map((question) => question.slug).sort())
      .toEqual(['atorvastatin', 'pravastatin', 'rosuvastatin', 'simvastatin']);
  });

  it('builds a question per field when several are picked', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa', 'dosing'] }));

    expect(questions).toHaveLength(12);
    expect(new Set(questions.map((question) => question.fieldKey))).toEqual(new Set(['moa', 'dosing']));
  });
});

describe('capQuiz', () => {
  it('caps at random rather than from the front', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa', 'dosing'] }));

    const capped = capQuiz(questions, 5);
    expect(capped).toHaveLength(5);
    expect(new Set(capped.map((question) => question.id)).size).toBe(5);

    const seen = new Set<string>();
    for (let run = 0; run < 40; run += 1) {
      for (const question of capQuiz(questions, 5)) seen.add(question.id);
    }
    expect(seen.size).toBe(questions.length);
  });

  it('shuffles even when nothing is cut, so a paper is not alphabetical', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa'] }));
    expect(capQuiz(questions, 0)).toHaveLength(questions.length);
  });
});

describe('mixed direction', () => {
  it('asks both ways in one paper when the direction is random', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa', 'dosing'] }), {
      direction: 'random',
    });

    const directions = new Set(questions.map((question) => question.direction));
    // Twelve questions over a fair coin: both sides appearing is all but
    // certain, and a paper stuck on one side is the bug this guards.
    expect(questions.length).toBe(12);
    expect(directions.size).toBe(2);
  });

  it('decides per question rather than per paper', () => {
    // A coin tossed once for the whole paper would make every question agree.
    const papers = Array.from({ length: 20 }, () =>
      buildQuiz(pool(), defs, config({ fields: ['moa'] }), { direction: 'random' }));

    const mixed = papers.filter(
      (paper) => new Set(paper.map((question) => question.direction)).size === 2,
    );
    expect(mixed.length).toBeGreaterThan(15);
  });

  it('still honours an explicit direction', () => {
    const forward = buildQuiz(pool(), defs, config({ fields: ['moa'] }), {
      direction: 'drug_to_fields',
    });
    const reverse = buildQuiz(pool(), defs, config({ fields: ['moa'] }), {
      direction: 'fields_to_drug',
    });

    expect(new Set(forward.map((q) => q.direction))).toEqual(new Set(['drug_to_fields']));
    expect(new Set(reverse.map((q) => q.direction))).toEqual(new Set(['fields_to_drug']));
  });
});

describe('reading the config out of a URL', () => {
  it('takes field keys repeated, as the form submits them', () => {
    // The checkbox group submits one `fields` per ticked box. Reading that as
    // a comma-joined string worked for one field and threw for two, which is
    // how the Start button came to do nothing.
    expect(fieldKeysParam(['moa', 'dosing'])).toEqual(['moa', 'dosing']);
    expect(fieldKeysParam('moa')).toEqual(['moa']);
    expect(fieldKeysParam(undefined)).toEqual([]);
  });

  it('still takes them comma-joined, as a saved link may carry them', () => {
    expect(fieldKeysParam('moa,dosing')).toEqual(['moa', 'dosing']);
    expect(fieldKeysParam(['moa,dosing', 'bbw'])).toEqual(['moa', 'dosing', 'bbw']);
    expect(fieldKeysParam(' moa , dosing ,, ')).toEqual(['moa', 'dosing']);
  });

  it('reads a repeated scope param as a list', () => {
    expect(manyParam(['statins', 'beta-blockers'])).toEqual(['statins', 'beta-blockers']);
    expect(manyParam('statins')).toEqual(['statins']);
    expect(manyParam(undefined)).toEqual([]);
  });
});
