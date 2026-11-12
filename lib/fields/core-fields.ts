import type { fieldDefs } from '@/db/schema';

type NewFieldDef = typeof fieldDefs.$inferInsert;

/**
 * The field set the class sheet itself defines, including which program years
 * are responsible for each — taken from the sheet's own header rows, which
 * data/drugs-seed.json carries as `year_levels`.
 *
 * `isCore` marks the fields backed by their own column or table rather than
 * drugs.fields: generic name, brands, indications, class and schedule. They
 * appear here anyway so profiles, the field picker and study config can treat
 * every field uniformly.
 */
export const CORE_FIELD_DEFS: NewFieldDef[] = [
  {
    key: 'generic',
    label: 'Generic name',
    group: 'Identity',
    dataType: 'text',
    isCore: true,
    sortOrder: 10,
    yearLevels: ['P1', 'P2', 'P3'],
    promptTemplate: 'Which drug is this?',
  },
  {
    key: 'brand',
    label: 'Brand names',
    group: 'Identity',
    dataType: 'list',
    isCore: true,
    sortOrder: 20,
    yearLevels: ['P1', 'P2', 'P3'],
    // The other half of the brand/generic pair: shown the generic, name the
    // brands. Its mirror -- shown a brand, name the generic -- is the
    // facts-to-drug direction of this same field.
    promptTemplate: 'Brand name(s)? — {{generic}}',
  },
  {
    key: 'indication',
    label: 'Indications',
    group: 'Clinical',
    dataType: 'list',
    isCore: true,
    sortOrder: 30,
    yearLevels: ['P1', 'P2', 'P3'],
    promptTemplate: 'What is {{generic}} used for?',
  },
  {
    key: 'drug_class',
    label: 'Drug class',
    group: 'Identity',
    dataType: 'text',
    isCore: true,
    sortOrder: 40,
    // Not one of the sheet's year-scoped fields: this is resolved from RxNorm
    // rather than assigned to a program year.
    yearLevels: [],
    /**
     * Not asked. Only the class sheet's own seven columns are study material,
     * and class is not one of them -- it comes from RxNorm. It earns its place
     * by driving colour coding, the browse filter, and same-class distractor
     * sampling for the fields that *are* asked.
     */
    isQuizzable: false,
    helpText: 'Resolved from RxNorm as an FDA Established Pharmacologic Class. '
      + 'Supports filtering and quiz distractors rather than being asked itself.',
  },
  {
    key: 'controlled',
    label: 'Controlled schedule',
    group: 'Regulatory',
    dataType: 'enum',
    enumOptions: ['CI', 'CII', 'CIII', 'CIV', 'CV'],
    isCore: true,
    sortOrder: 50,
    yearLevels: ['P2', 'P3'],
    // 213 of 237 are not controlled, so an empty value is the answer.
    blankMeansNone: true,
    promptTemplate: 'What is the controlled-substance schedule of {{generic}}?',
  },
  {
    key: 'route',
    label: 'Route',
    group: 'Clinical',
    dataType: 'list',
    sortOrder: 55,
    // The sheet assigns no year to it: route is read out of the drug's own
    // name and dosing text rather than taught as its own column.
    yearLevels: [],
    /**
     * Not asked, for the same reason as class: the sheet has no route column,
     * so it is not study material. It still earns its place as a study scope
     * filter, and as the axis the per-route dosing subsystem will hang off.
     * The route also appears inside a dosing answer, which *is* asked.
     */
    isQuizzable: false,
    helpText: 'How the drug is given. Blank means the source never said, not that it has none. '
      + 'Supports filtering rather than being asked itself.',
  },
  {
    key: 'dosing',
    label: 'Dosing',
    group: 'Clinical',
    dataType: 'markdown',
    sortOrder: 60,
    yearLevels: ['P2', 'P3'],
    promptTemplate: 'How is {{generic}} dosed?',
  },
  {
    key: 'regimen',
    label: 'Regimens',
    group: 'Clinical',
    dataType: 'markdown',
    sortOrder: 65,
    /**
     * Named multi-drug protocols this drug is a component of, and what it
     * contributes to each: FOLFOX, ipilimumab + nivolumab, dabrafenib +
     * trametinib. Oncology is where a dose stops being a property of one drug
     * -- oxaliplatin is 85 mg/m2 *in FOLFOX*, and nivolumab is 1 mg/kg beside
     * ipilimumab and 240 mg alone -- so the combination has to be sayable
     * somewhere, and `dosing` cannot say it without lying about whose dose it
     * is.
     *
     * Markdown rather than its own table, deliberately, and the trade is
     * written down in PLAN.md: a table of regimens with member rows is the
     * right shape for a pharmacy system and the wrong first move for a study
     * app, where the thing being learned is the sentence *this drug appears in
     * these protocols at these doses, chosen on these grounds*. A nested list
     * renders as the decision it is, and a regimen named the same way on two
     * drugs is found by searching the field.
     */
    blankMeansNone: true,
    /**
     * No year, which is not an oversight: the sheet has no regimen column, so
     * there is no program year responsible for it, and a year preset must not
     * tick a field that answers "none" for two hundred of the drugs in it.
     * Ticking it deliberately -- which is what studying an oncology unit looks
     * like -- works exactly as it does for every other field.
     */
    yearLevels: [],
    promptTemplate: 'Which named regimens include {{generic}}, and at what dose?',
  },
  {
    key: 'moa',
    label: 'Mechanism of action',
    group: 'Clinical',
    dataType: 'markdown',
    sortOrder: 70,
    yearLevels: ['P3'],
    promptTemplate: 'What is the mechanism of action of {{generic}}?',
  },
  {
    key: 'bbw',
    label: 'Black box warning',
    group: 'Regulatory',
    dataType: 'markdown',
    sortOrder: 80,
    yearLevels: ['P3'],
    // 147 of 237 have none. Without this the review queue fills with phantom
    // work and flashcards ask for warnings that do not exist.
    blankMeansNone: true,
    // Not *does it carry one*, which was the question while a card could
    // answer "None". Only the drugs that have one are asked now -- see
    // `worthAsking` in lib/study/cards.ts -- so a yes/no question would be one
    // whose answer is always yes, and what is worth recalling is the warning.
    promptTemplate: 'What is the black box warning for {{generic}}?',
  },
];
