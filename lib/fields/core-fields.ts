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
    helpText: 'Resolved from RxNorm as an FDA Established Pharmacologic Class.',
    promptTemplate: 'What class does {{generic}} belong to?',
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
    helpText: 'How the drug is given. Blank means the source never said, not that it has none.',
    promptTemplate: 'How is {{generic}} given?',
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
    promptTemplate: 'Does {{generic}} carry a black box warning?',
  },
];
