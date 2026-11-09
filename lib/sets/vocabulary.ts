/**
 * The closed `answers` vocabulary.
 *
 * **This is the identifier that does the mixing**, and the reason it is closed.
 * A column's `answers` type -- not its heading -- decides which pool a wrong
 * answer may be drawn from, so a thyroid question can borrow a distractor from
 * the steroid deck and have it still be a mechanism.
 *
 * It cannot be the heading, and the nine source decks are the proof: they call
 * one thing *Mechanism*, *Principle mechanism* and *Target*. Headings are local
 * and must stay local; the pool they draw from has to be shared. Every entry
 * below is a heading or a cell type observed in those decks rather than a
 * category invented for completeness.
 *
 * Open to extension by editing this list -- the next course is respiratory and
 * will want something this one does not -- but **not** by an imported file,
 * which is the point: a set that could name its own pool key could not share a
 * pool with anything.
 */
export const ANSWER_TYPES = [
  // Entities: things that can be a subject in their own right, which is what
  // makes them fair as both answer and clue.
  'drug_name',
  'brand_name',
  'hormone',
  'receptor',
  'enzyme',
  'site',
  'stem',

  // Classifications.
  'chemical_class',
  'composition',

  // What a thing does.
  'mechanism',
  'target',
  'indication',
  'effect',
  'function',
  'toxicity',
  'population',

  // How it is given.
  'dose',
  'route',
  'half_life',
  'duration_class',
  'potency_ratio',

  // Where it is.
  'location',
  'source_tissue',

  // Measured and counted.
  'count',
  'year',

  // The honest catch-all. Never reversible: *which drug has these notes?* is
  // not a question, and a prose distractor is told apart by shape.
  'prose',
] as const;

export type AnswerType = (typeof ANSWER_TYPES)[number];

const LOOKUP = new Set<string>(ANSWER_TYPES);

export function isAnswerType(value: unknown): value is AnswerType {
  return typeof value === 'string' && LOOKUP.has(value);
}

/**
 * Which types may be the *clue* rather than the answer, by default.
 *
 * An entity can be asked in reverse -- *which drug inhibits TPO?* is a fair
 * question -- because the thing named is a subject somebody could know. Prose
 * cannot: *which drug has this description?* is answerable by reading alone.
 * A column may override this either way with `reversible`.
 */
const REVERSIBLE_BY_DEFAULT = new Set<AnswerType>([
  'drug_name', 'brand_name', 'hormone', 'receptor', 'enzyme', 'site', 'stem',
  'chemical_class', 'target', 'indication', 'location', 'source_tissue',
]);

export function reversibleByDefault(type: AnswerType): boolean {
  return REVERSIBLE_BY_DEFAULT.has(type);
}

/**
 * The data type a column of this answer type is assumed to hold, used only to
 * fill in a `type` an author left out. Never overrides a stated one.
 */
export function defaultDataType(type: AnswerType): 'text' | 'markdown' | 'list' | 'number' {
  switch (type) {
    case 'mechanism':
    case 'prose':
      return 'markdown';
    case 'indication':
    case 'toxicity':
      return 'list';
    case 'count':
    case 'year':
      return 'number';
    default:
      return 'text';
  }
}
