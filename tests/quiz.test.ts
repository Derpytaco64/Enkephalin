import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { fieldDefs, type FieldValue } from '@/db/schema';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';
import { listFieldDefs, type FieldDef } from '@/lib/fields/registry';
import type { CardSource } from '@/lib/study/cards';
import { DEFAULT_CONFIG, type StudyConfig } from '@/lib/study/config';
import { weightsFromHistory } from '@/lib/study/priority';
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
    dosingBranches: [],
    needsPairingReview: false,
    values: {},
    ...partial,
  };
}

/**
 * Per-fact by default, which is what the quiz page sends. `DEFAULT_CONFIG` is
 * per-drug because that is right for a flashcard deck -- one card per drug
 * rather than thousands per fact -- and the two modes ask different questions,
 * so a test has to say which one it means.
 */
const config = (partial: Partial<StudyConfig> = {}): StudyConfig => ({
  ...DEFAULT_CONFIG,
  fields: ['moa'],
  mode: 'exclusive',
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

describe('per-drug mode', () => {
  const perDrug = (fields: string[]) => config({ fields, mode: 'inclusive' });

  it('asks one question per drug, however many fields are picked', () => {
    const perFact = buildQuiz(pool(), defs, config({ fields: ['moa', 'dosing'] }));
    const bundled = buildQuiz(pool(), defs, perDrug(['moa', 'dosing']));

    // Six drugs, two fields: twelve per-fact questions, six per-drug ones.
    expect(perFact).toHaveLength(12);
    expect(bundled).toHaveLength(6);
    expect(new Set(bundled.map((question) => question.slug)).size).toBe(6);
  });

  it('puts every picked field in every option, labelled', () => {
    const [question] = buildQuiz(pool(), defs, perDrug(['moa', 'dosing']), {
      direction: 'drug_to_fields',
    });

    for (const option of question.options) {
      // A bundle short of a line is not incomplete, it is a tell: the option
      // with less in it is visibly the odd one out.
      expect(option).toContain('Mechanism');
      expect(option).toContain('Dosing');
    }
    expect(question.fieldKey).toBe('moa+dosing');
    expect(question.fieldLabel).toContain(',');
  });

  it('asks which drug when the direction is the other way', () => {
    const [question] = buildQuiz(pool(), defs, perDrug(['moa', 'dosing']), {
      direction: 'fields_to_drug',
    });

    // Options are names; the evidence is in the prompt.
    expect(question.options).toContain(question.generic);
    expect(question.prompt).toContain('Mechanism');
    expect(question.prompt).toContain('Dosing');
  });

  it('leaves out a drug missing any of the picked fields', () => {
    const partial = [
      ...pool(),
      source({
        slug: 'ezetimibe', generic: 'Ezetimibe',
        values: { moa: value({ value: 'Cholesterol absorption inhibition' }) },
      }),
    ];

    const questions = buildQuiz(partial, defs, perDrug(['moa', 'dosing']));
    expect(questions.map((question) => question.slug)).not.toContain('ezetimibe');
    // It is still askable on its own about the field it does have.
    expect(buildQuiz(partial, defs, config({ fields: ['moa'] })).map((q) => q.slug))
      .toContain('ezetimibe');
  });

  it('keeps the schedule in a bundle even though it is no question alone', () => {
    const drugs = [
      source({
        slug: 'alprazolam', generic: 'Alprazolam', schedule: 'CIV',
        values: { moa: value({ value: 'GABA-A positive modulation' }), controlled: value({ value: 'CIV' }) },
      }),
      source({
        slug: 'lisinopril', generic: 'Lisinopril',
        values: { moa: value({ value: 'ACE inhibition' }), controlled: value({ value: null, status: 'none' }) },
      }),
      source({
        slug: 'metformin', generic: 'Metformin',
        values: { moa: value({ value: 'Hepatic gluconeogenesis inhibition' }), controlled: value({ value: null, status: 'none' }) },
      }),
    ];

    const questions = buildQuiz(drugs, defs, perDrug(['moa', 'controlled']), {
      direction: 'drug_to_fields',
    });

    // "Not controlled" is no question on its own -- it is 212 drugs' answer --
    // but it is a perfectly good line of a profile, and the question here is
    // which profile belongs to which drug.
    expect(questions.map((question) => question.slug).sort())
      .toEqual(['alprazolam', 'lisinopril', 'metformin']);
    expect(questions.some((question) => question.options.some((o) => o.includes('Not controlled'))))
      .toBe(true);
  });
});

describe('the controlled schedule', () => {
  /** Two scheduled drugs among five, which is roughly the real ratio. */
  function scheduled(): CardSource[] {
    const uncontrolled = (slug: string, generic: string) =>
      source({
        slug, generic,
        values: { controlled: value({ value: null, status: 'none' }) },
      });

    return [
      source({
        slug: 'alprazolam', generic: 'Alprazolam', schedule: 'CIV',
        values: { controlled: value({ value: 'CIV' }) },
      }),
      source({
        slug: 'oxycodone', generic: 'Oxycodone', schedule: 'CII',
        values: { controlled: value({ value: 'CII' }) },
      }),
      uncontrolled('lisinopril', 'Lisinopril'),
      uncontrolled('metformin', 'Metformin'),
      uncontrolled('atorvastatin', 'Atorvastatin'),
    ];
  }

  it('is asked only of drugs that have one', () => {
    const questions = buildQuiz(scheduled(), defs, config({ fields: ['controlled'] }));

    // Three of the five are simply not controlled. That is a fact and a
    // flashcard; as multiple choice it is a hundred questions with one answer.
    expect(questions.map((question) => question.slug).sort()).toEqual(['alprazolam', 'oxycodone']);
  });

  it('never offers "Not controlled" as an option', () => {
    const questions = buildQuiz(scheduled(), defs, config({ fields: ['controlled'] }));

    for (const question of questions) {
      expect(question.options).not.toContain('Not controlled');
    }
  });
});

describe('what a wrong answer was right about', () => {
  it('names the drug whose fact you picked', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa'] }), {
      direction: 'drug_to_fields',
    });
    const question = questions[0];
    const wrong = question.options.findIndex((_, at) => at !== question.correctIndex);

    // The option text is already the fact, so what is missing is whose it is.
    expect(question.fromGeneric[wrong]).toBeTruthy();
    expect(question.fromGeneric[wrong]).not.toBe(question.generic);
    expect(question.fromFact[wrong]).toBeNull();
  });

  it('names the fact the drug you picked actually has', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa'] }), {
      direction: 'fields_to_drug',
    });
    const question = questions[0];
    const wrong = question.options.findIndex((_, at) => at !== question.correctIndex);

    // The option text is a drug name, so what is missing is its own value --
    // pick Lisinopril for a statin clue and you are owed "ACE inhibition".
    expect(question.fromGeneric[wrong]).toBe(question.options[wrong]);
    expect(question.fromFact[wrong]).toBeTruthy();
  });

  it('keeps one entry per option, in the order they are shown', () => {
    for (const question of buildQuiz(pool(), defs, config({ fields: ['moa', 'dosing'] }))) {
      expect(question.fromGeneric).toHaveLength(question.options.length);
      expect(question.fromFact).toHaveLength(question.options.length);
      expect(question.fromSlug).toHaveLength(question.options.length);
      expect(question.fromOwners).toHaveLength(question.options.length);
    }
  });
});

/* ------------------------------------------------------------------------
   A fact can belong to more than one drug, and the schedule nearly always
   does. Naming the one drug the option happened to be drawn from reads as
   if the others were not CII -- so the review names all of them, matched on
   the same answer key that keeps a shared value from being offered as a
   wrong answer.
   --------------------------------------------------------------------- */

describe('who else an answer is right about', () => {
  /** Four CII drugs and two others, which is the shape that forced this. */
  function ward(): CardSource[] {
    const at = (slug: string, generic: string, schedule: string) =>
      source({
        slug, generic, schedule,
        values: { controlled: value({ value: schedule }) },
      });

    return [
      at('methylphenidate', 'Methylphenidate', 'CII'),
      at('oxycodone', 'Oxycodone', 'CII'),
      at('fentanyl', 'Fentanyl', 'CII'),
      at('dextroamphetamine', 'Dextroamphetamine', 'CII'),
      at('alprazolam', 'Alprazolam', 'CIV'),
      at('pregabalin', 'Pregabalin', 'CV'),
    ];
  }

  it('names every drug the right answer belongs to', () => {
    const questions = buildQuiz(ward(), defs, config({ fields: ['controlled'] }), {
      direction: 'drug_to_fields',
    });
    const asked = questions.find((question) => question.slug === 'methylphenidate');
    expect(asked).toBeDefined();

    const owners = asked!.fromOwners[asked!.correctIndex].map((owner) => owner.slug).sort();
    expect(owners).toEqual(
      ['dextroamphetamine', 'fentanyl', 'methylphenidate', 'oxycodone'],
    );
  });

  it('names every drug a wrong answer belongs to', () => {
    // The complaint this answers: picking CII on an alprazolam question was
    // told "CII is the controlled schedule of Methylphenidate", when it is
    // equally the schedule of three others in the same pool.
    const questions = buildQuiz(ward(), defs, config({ fields: ['controlled'] }), {
      direction: 'drug_to_fields',
    });
    const asked = questions.find((question) => question.slug === 'alprazolam');
    const at = asked!.options.indexOf('CII');
    expect(at).toBeGreaterThanOrEqual(0);

    expect(asked!.fromOwners[at].map((owner) => owner.generic).sort()).toEqual(
      ['Dextroamphetamine', 'Fentanyl', 'Methylphenidate', 'Oxycodone'],
    );
  });

  it('names one drug where one drug is the whole answer', () => {
    // Which is nearly every field: one mechanism, one dose, one class. The
    // review says "is the mechanism of Atorvastatin" and is right to.
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa'] }), {
      direction: 'drug_to_fields',
    });

    for (const question of questions) {
      for (const owners of question.fromOwners) {
        expect(owners).toHaveLength(1);
      }
    }
  });

  it('is the option\u2019s own drug when the options are drug names', () => {
    // Asked the other way the sharing is on the *clue*, and `acceptable`
    // already carries every drug the clue is equally true of -- so an option
    // here is true of exactly the drug it names.
    const questions = buildQuiz(ward(), defs, config({ fields: ['controlled'] }), {
      direction: 'fields_to_drug',
    });

    for (const question of questions) {
      question.fromOwners.forEach((owners, at) => {
        expect(owners.map((owner) => owner.generic)).toEqual([question.options[at]]);
      });
      // And the clue being shared is said there instead -- for the four that
      // share one. Alprazolam and pregabalin are alone in their schedules.
      expect(question.acceptable.length).toBe(question.slug === 'alprazolam' || question.slug === 'pregabalin' ? 1 : 4);
    }
  });

  it('matches on meaning, not spelling, as every other answer does', () => {
    // Seizure and Seizures are one indication, so a drug written up with one
    // is named beside a drug written up with the other.
    const drugs = [
      source({
        slug: 'levetiracetam', generic: 'Levetiracetam',
        values: { indication: value({ value: 'Seizure' }) },
      }),
      source({
        slug: 'phenytoin', generic: 'Phenytoin',
        values: { indication: value({ value: 'Seizures' }) },
      }),
      source({
        slug: 'lisinopril', generic: 'Lisinopril',
        values: { indication: value({ value: 'Hypertension' }) },
      }),
      source({
        slug: 'metformin', generic: 'Metformin',
        values: { indication: value({ value: 'Type 2 diabetes' }) },
      }),
    ];

    const questions = buildQuiz(drugs, defs, config({ fields: ['indication'] }), {
      direction: 'drug_to_fields',
    });
    const asked = questions.find((question) => question.slug === 'levetiracetam');

    expect(asked!.fromOwners[asked!.correctIndex].map((owner) => owner.slug).sort())
      .toEqual(['levetiracetam', 'phenytoin']);
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

  it('draws a question you missed before one you have never seen', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa'] }));
    const weights = weightsFromHistory([
      { drugId: 'id-metformin', fieldKey: 'moa', wasCorrect: false },
    ]);

    // A constant rng leaves weight as the only thing deciding the order, so
    // this asserts the ordering itself rather than a lucky draw.
    expect(capQuiz(questions, 1, first, weights)[0].slug).toBe('metformin');
  });

  it('orders the whole pool even with no cap, so half a quiz is the right half', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa'] }));
    const weights = weightsFromHistory([
      { drugId: 'id-lisinopril', fieldKey: 'moa', wasCorrect: false },
    ]);

    const ordered = capQuiz(questions, 0, first, weights);
    expect(ordered).toHaveLength(questions.length);
    expect(ordered[0].slug).toBe('lisinopril');
  });

  it('still reaches a question you know, because no weight is zero', () => {
    const questions = buildQuiz(pool(), defs, config({ fields: ['moa'] }));
    // Everything answered right three times running -- the floor -- except the
    // one miss, which is four times heavier than anything else in the pool.
    const weights = weightsFromHistory(questions.flatMap((question) =>
      Array.from({ length: question.slug === 'metformin' ? 1 : 3 }, () => ({
        drugId: question.drugId,
        fieldKey: 'moa',
        wasCorrect: question.slug !== 'metformin',
      }))));

    const seen = new Set<string>();
    for (let run = 0; run < 200; run += 1) {
      seen.add(capQuiz(questions, 1, Math.random, weights)[0].slug);
    }
    // Weighted, not restricted: a cap of one still lands on every drug in the
    // pool eventually, which is the difference between priority and a grudge
    // list.
    expect(seen.size).toBe(questions.length);
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

/* ------------------------------------------------------------------------
   Dosing that splits by indication.

   Sildenafil: 20 mg three times a day for pulmonary hypertension as Revatio,
   50 mg an hour beforehand for erectile dysfunction as Viagra. One of the two
   used to be the keyed answer to "how is sildenafil dosed", which taught the
   less familiar half and never mentioned the other.
   --------------------------------------------------------------------- */

describe('a dosing split by indication', () => {
  const BRANCHES = [
    { label: 'Pulmonary hypertension', text: '20 mg by mouth three times a day', sig: '20 mg PO TID' },
    { label: 'Erectile dysfunction', text: '50 mg by mouth 1 hour prior to sexual activity', sig: null },
  ];

  const sildenafil = () => source({
    slug: 'sildenafil',
    generic: 'Sildenafil',
    drugClass: 'Phosphodiesterase 5 Inhibitor',
    dosingSig: null,
    dosingBranches: BRANCHES,
    // The field still carries the prose, which is what a flashcard shows.
    values: { dosing: value({ value: BRANCHES.map((b) => `${b.label}: ${b.text}`).join('\n\n') }) },
  });

  /** Enough other drugs to fill four options. */
  const others = () => [
    source({ slug: 'tadalafil', generic: 'Tadalafil', drugClass: 'Phosphodiesterase 5 Inhibitor', dosingSig: '10 mg PO PRN', values: { dosing: value({ value: '10 mg by mouth one hour prior to sexual activity' }) } }),
    source({ slug: 'metformin', generic: 'Metformin', dosingSig: '500 mg PO BID', values: { dosing: value({ value: '500 mg by mouth two times a day' }) } }),
    source({ slug: 'lisinopril', generic: 'Lisinopril', dosingSig: '10 mg PO daily', values: { dosing: value({ value: '10 mg by mouth once a day' }) } }),
    source({ slug: 'atorvastatin', generic: 'Atorvastatin', dosingSig: '20 mg PO daily', values: { dosing: value({ value: '20 mg by mouth once a day' }) } }),
  ];

  const ask = (seed: number) => {
    let at = seed;
    const rng = () => { at = (at * 9301 + 49297) % 233280; return at / 233280; };
    return buildQuiz(
      [sildenafil(), ...others()],
      defs,
      { ...DEFAULT_CONFIG, fields: ['dosing'], mode: 'exclusive', direction: 'drug_to_fields' },
      { rng },
    ).filter((question) => question.slug === 'sildenafil');
  };

  it('names the branch in the prompt', () => {
    // Over several draws, since one quiz asks one branch per drug.
    const prompts = new Set(
      [1, 7, 13, 29, 51, 97, 211, 307].flatMap((seed) => ask(seed).map((q) => q.prompt)),
    );
    expect([...prompts].sort()).toEqual([
      'How is Sildenafil dosed for erectile dysfunction?',
      'How is Sildenafil dosed for pulmonary hypertension?',
    ]);
  });

  it('leaves the options bare, because a label on one of four is a tell', () => {
    for (const question of ask(1)) {
      for (const option of question.options) {
        expect(option, option).not.toMatch(/^(Pulmonary hypertension|Erectile dysfunction):/);
      }
    }
  });

  it('never offers the other branch as a wrong answer', () => {
    // The tirzepatide rule, one field over: a dose that is true of the drug
    // cannot be marked wrong, whichever branch was asked.
    for (const seed of [1, 7, 13, 29, 51, 97, 211, 307]) {
      for (const question of ask(seed)) {
        const wrong = question.options.filter((_, at) => at !== question.correctIndex);
        for (const branch of BRANCHES) {
          expect(wrong, `${question.prompt} offered ${branch.text}`).not.toContain(branch.text);
        }
        expect(question.acceptable.sort()).toEqual(BRANCHES.map((b) => b.text).sort());
      }
    }
  });

  it('keys the two branches apart, so history can tell them apart', () => {
    const keys = new Set(
      [1, 7, 13, 29, 51, 97, 211, 307].flatMap((seed) => ask(seed).map((q) => q.questionKey)),
    );
    expect([...keys].sort()).toEqual([
      'drug_to_fields:dosing:erectile-dysfunction',
      'drug_to_fields:dosing:pulmonary-hypertension',
    ]);
  });

  it('keys them apart asked the other way too, without saying which in the prompt', () => {
    // Naming the condition there would all but answer it: the clue is already
    // a dose, and the only ED drug among the options is the one being asked.
    let at = 3;
    const rng = () => { at = (at * 9301 + 49297) % 233280; return at / 233280; };
    const questions = buildQuiz(
      [sildenafil(), ...others()],
      defs,
      { ...DEFAULT_CONFIG, fields: ['dosing'], mode: 'exclusive', direction: 'fields_to_drug' },
      { rng },
    ).filter((question) => question.slug === 'sildenafil');

    for (const question of questions) {
      expect(question.questionKey).toMatch(/^fields_to_drug:dosing:(erectile-dysfunction|pulmonary-hypertension)$/);
      expect(question.prompt).not.toMatch(/for (erectile|pulmonary)/i);
    }
  });

  it('leaves an unsplit drug exactly as it was', () => {
    let at = 5;
    const rng = () => { at = (at * 9301 + 49297) % 233280; return at / 233280; };
    const questions = buildQuiz(
      [sildenafil(), ...others()],
      defs,
      { ...DEFAULT_CONFIG, fields: ['dosing'], mode: 'exclusive', direction: 'drug_to_fields' },
      { rng },
    ).filter((question) => question.slug === 'metformin');

    expect(questions).toHaveLength(1);
    expect(questions[0].prompt).toBe('How is Metformin dosed?');
    expect(questions[0].questionKey).toBe('drug_to_fields:dosing');
  });
});
