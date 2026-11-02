/**
 * Multiple choice over the same scope, fields and config the flashcards use,
 * so the two modes never disagree about what is in play.
 *
 * Four options, and the mix is deliberate: the right answer, **one** drawn
 * from the same class, and the rest from anywhere in the database. One near
 * miss is what makes a question discriminating -- four statins' doses side by
 * side is a memory test for digits rather than a question about statins -- and
 * three random ones would make most questions answerable by elimination.
 *
 * The scope decides what gets *asked*; distractors come from every drug there
 * is. That matters at both ends: a quiz narrowed to the four statins can still
 * fill four options, and asking "an indication of atorvastatin" inside a scope
 * where everything treats dyslipidemia would otherwise have no wrong answer to
 * offer and the question would vanish.
 *
 * One question asks about one field. A multiple-choice question cannot ask for
 * mechanism and dosing at once, so `mode` (per drug / per fact) is a flashcard
 * distinction and is ignored here.
 */
import type { FieldValue } from '@/db/schema';
import { indicationSlug } from '@/lib/drugs/indications';
import { formatFieldValue } from '@/lib/fields/format';
import type { FieldDef } from '@/lib/fields/registry';
import { answerText, inScope, type CardSource } from './cards';
import type { StudyConfig, StudyDirection } from './config';

export type QuizQuestion = {
  id: string;
  drugId: string;
  slug: string;
  generic: string;
  /** Stable across sessions, so history can group by what was asked. */
  questionKey: string;
  fieldKey: string;
  fieldLabel: string;
  direction: StudyDirection;
  prompt: string;
  options: string[];
  correctIndex: number;
  /**
   * Every answer this question would also accept. Tirzepatide treats diabetes
   * *and* obesity, so with one keyed correct the other must never appear as a
   * wrong option -- it is not wrong.
   */
  acceptable: string[];
  /** Which drug each option came from, for the review screen. */
  fromSlug: (string | null)[];
};

/** The drug's own name is the stimulus or the answer, never a thing asked about. */
const IDENTITY_FIELD = 'generic';

/**
 * The atomic answers a field offers, or null where there is nothing to ask.
 *
 * A list field asks about *one* of its items -- "which of these is an
 * indication of albuterol" wants Asthma, not "Asthma, COPD, Bronchospasm",
 * which is a sentence no option would ever match. Everything else is asked
 * whole. Read from the formatted value rather than from the joined answer
 * text, because splitting that back apart is how the items got lost once.
 */
function atomsOf(def: FieldDef, value: FieldValue | undefined): string[] | null {
  const formatted = formatFieldValue(def, value);
  if (formatted.kind === 'missing') return null;
  if (formatted.kind === 'list') return formatted.items.length > 0 ? formatted.items : null;

  const text = answerText(def, value);
  return text === null ? null : [text];
}

/**
 * Two answers are the same answer when this key matches -- which is a question
 * about meaning, not spelling, and the reason it is not just `toLowerCase`.
 *
 * - **Indications** go through the alias table, because the sheet writes one
 *   indication two ways: *Seizure* and *Seizures*, *Bacterial infection* and
 *   *Bacterial infections*, *BPH* and its expansion. Offering one as the wrong
 *   answer to the other is offering a right answer.
 * - **Dosing** compares the printed sig where the drug has one. *1 gram by
 *   mouth two times a day* and *1 g by mouth two times a day* are different
 *   sentences and the same dose; so are *50 mg by mouth once a day* and *50 mg
 *   by mouth daily in single or divided doses*. Eight sigs in the sheet are
 *   shared by differently-worded drugs, so this is not hypothetical.
 * - Everything else falls back to the trimmed, lowercased text, which is the
 *   most that can be claimed about prose nobody has decoded.
 */
function answerKey(def: FieldDef, source: CardSource, text: string): string {
  if (def.key === 'indication') return indicationSlug(text) || text.trim().toLowerCase();
  if (def.key === 'dosing' && source.dosingSig) return `sig:${source.dosingSig.toLowerCase()}`;
  return text.trim().toLowerCase();
}

type Candidate = { source: CardSource; atoms: string[]; keys: string[] };

/** Fisher-Yates over a copy, with the rng injectable so tests are decidable. */
function shuffled<T>(items: T[], rng: () => number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function pick<T>(items: T[], rng: () => number): T | undefined {
  return items.length === 0 ? undefined : items[Math.floor(rng() * items.length)];
}

/**
 * `random` mixes the two directions question by question, which is the default
 * for a paper: knowing a mechanism when you are shown the drug is a different
 * recall from naming the drug when you are shown the mechanism, and a paper
 * that only ever asks one way quietly trains one of them.
 *
 * It is a quiz-only value. The flashcard schedule keys a card by its
 * direction, so a card whose direction changed every session would look like a
 * new card every session.
 */
export type QuizDirection = StudyDirection | 'random';

export type QuizOptions = {
  rng?: () => number;
  /** Four is the default; fewer only where the scope cannot fill it. */
  optionCount?: number;
  /** Defaults to the config's own direction. */
  direction?: QuizDirection;
};

export function buildQuiz(
  sources: CardSource[],
  defs: FieldDef[],
  config: StudyConfig,
  options: QuizOptions = {},
): QuizQuestion[] {
  const rng = options.rng ?? Math.random;
  const optionCount = options.optionCount ?? 4;
  const direction = options.direction ?? config.direction;

  const byKey = new Map(defs.map((def) => [def.key, def]));
  const selected = config.fields
    .map((key) => byKey.get(key))
    .filter((def): def is FieldDef => Boolean(def) && def!.isQuizzable)
    .filter((def) => def.key !== IDENTITY_FIELD);

  if (selected.length === 0) return [];

  const asked = new Set(
    sources.filter((source) => inScope(source, config)).map((source) => source.drugId),
  );
  const questions: QuizQuestion[] = [];

  for (const def of selected) {
    // Everyone with something to say about this field, scope or not: this is
    // the distractor pool, and it is deliberately the whole database.
    const candidates: Candidate[] = sources.flatMap((source) => {
      const atoms = atomsOf(def, source.values[def.key]);
      if (atoms === null) return [];
      return [{ source, atoms, keys: atoms.map((text) => answerKey(def, source, text)) }];
    });
    if (candidates.length === 0) continue;

    for (const candidate of candidates.filter((row) => asked.has(row.source.drugId))) {
      // Decided per question, so one paper holds both kinds rather than the
      // whole paper landing on one side of a coin toss.
      const asksForTheDrug = direction === 'random'
        ? rng() < 0.5
        : direction === 'fields_to_drug';

      const built = asksForTheDrug
        ? nameQuestion(def, candidate, candidates, optionCount, rng)
        : factQuestion(def, candidate, candidates, optionCount, rng);
      if (built) questions.push(built);
    }
  }

  return questions;
}

/**
 * Takes distractors one class-mate first, then anyone -- which is the whole
 * shape of the question. `exclude` is matched on the option text, so the same
 * answer can never appear twice: two drugs written up as "10 mg by mouth once
 * a day" would otherwise make a question with two right answers, and that is
 * not a judgement about the drugs but about the words on the screen.
 */
function drawDistractors(input: {
  asked: CardSource;
  candidates: Candidate[];
  /** Keys, not texts: what counts as "already answered" is a meaning. */
  exclude: Set<string>;
  offersOf: (candidate: Candidate) => { text: string; key: string }[];
  count: number;
  rng: () => number;
}): { text: string; slug: string }[] {
  const { asked, candidates, exclude, offersOf, count, rng } = input;
  const taken = new Set(exclude);
  const drawn: { text: string; slug: string }[] = [];

  const offers = (candidate: Candidate) =>
    offersOf(candidate).filter((option) => !taken.has(option.key));

  const others = candidates.filter((candidate) => candidate.source.drugId !== asked.drugId);
  const sameClass = asked.drugClass
    ? others.filter((candidate) => candidate.source.drugClass === asked.drugClass)
    : [];
  // A class of one has no class-mates; the categories are the next-closest
  // thing the data knows about, and are what a course would group by anyway.
  const sameCategory = others.filter((candidate) =>
    candidate.source.tags.some((tag) => asked.tags.includes(tag)));
  // "One near miss" has to mean one. Filling the remaining options from the
  // whole pool would let a second class-mate turn up by luck -- rare over 236
  // drugs, common in a scope narrowed to one class, and a question with three
  // statins in it is the thing the single near miss exists to avoid.
  const far = others.filter((candidate) => !sameClass.includes(candidate));

  const take = (from: Candidate[]) => {
    for (const candidate of shuffled(from, rng)) {
      const choice = pick(offers(candidate), rng);
      if (choice === undefined) continue;
      taken.add(choice.key);
      drawn.push({ text: choice.text, slug: candidate.source.slug });
      return true;
    }
    return false;
  };

  if (count > 0) take(sameClass) || take(sameCategory) || take(far) || take(others);

  while (drawn.length < count) {
    // Anywhere but the class, unless the scope leaves nowhere else -- a short
    // question beats a silently skipped drug.
    if (!take(far) && !take(others)) break;
  }

  return drawn;
}

/** "What is the mechanism of action of Alprazolam?" -- options are facts. */
function factQuestion(
  def: FieldDef,
  candidate: Candidate,
  candidates: Candidate[],
  optionCount: number,
  rng: () => number,
): QuizQuestion | null {
  const asked = candidate.source;
  const index = Math.floor(rng() * candidate.atoms.length);
  const correct = candidate.atoms[index];
  if (correct === undefined) return null;

  const acceptable = candidate.atoms;
  const exclude = new Set(candidate.keys);

  const distractors = drawDistractors({
    asked,
    candidates,
    exclude,
    offersOf: (other) => other.atoms.map((text, at) => ({ text, key: other.keys[at] })),
    count: optionCount - 1,
    rng,
  });

  // A lone option is not a question. Two is, barely, and a scope that small is
  // the user's own doing -- better a short quiz than a drug silently skipped.
  if (distractors.length === 0) return null;

  const laid = shuffled(
    [{ text: correct, slug: asked.slug }, ...distractors],
    rng,
  );

  return {
    id: `${asked.slug}:${def.key}:drug_to_fields`,
    drugId: asked.drugId,
    slug: asked.slug,
    generic: asked.generic,
    questionKey: `drug_to_fields:${def.key}`,
    fieldKey: def.key,
    fieldLabel: def.label,
    direction: 'drug_to_fields',
    prompt: def.promptTemplate
      ? def.promptTemplate.replaceAll('{{generic}}', asked.generic)
      : `${asked.generic} — ${def.label}?`,
    options: laid.map((option) => option.text),
    correctIndex: laid.findIndex((option) => option.text === correct),
    acceptable,
    fromSlug: laid.map((option) => option.slug),
  };
}

/** "Which drug has this mechanism?" -- options are drug names. */
function nameQuestion(
  def: FieldDef,
  candidate: Candidate,
  candidates: Candidate[],
  optionCount: number,
  rng: () => number,
): QuizQuestion | null {
  const asked = candidate.source;
  const at = Math.floor(rng() * candidate.atoms.length);
  const clue = candidate.atoms[at];
  if (clue === undefined) return null;
  const clueKey = candidate.keys[at];

  // Any drug the clue is also true of is a right answer, so it cannot be a
  // wrong one -- matched on the key, so a drug written up as "Seizures" is
  // caught when the clue says "Seizure".
  const alsoTrue = candidates.filter((other) => other.keys.includes(clueKey));
  const acceptable = alsoTrue.map((other) => other.source.generic);
  const exclude = new Set(acceptable.map((name) => name.toLowerCase()));

  const distractors = drawDistractors({
    asked,
    candidates,
    exclude,
    // The options are names here, so a name is its own key.
    offersOf: (other) => [{ text: other.source.generic, key: other.source.generic.toLowerCase() }],
    count: optionCount - 1,
    rng,
  });
  if (distractors.length === 0) return null;

  const laid = shuffled([{ text: asked.generic, slug: asked.slug }, ...distractors], rng);

  const asking = def.key === 'brand' ? 'Which generic is this a brand of?' : 'Which drug?';

  return {
    id: `${asked.slug}:${def.key}:fields_to_drug`,
    drugId: asked.drugId,
    slug: asked.slug,
    generic: asked.generic,
    questionKey: `fields_to_drug:${def.key}`,
    fieldKey: def.key,
    fieldLabel: def.label,
    direction: 'fields_to_drug',
    prompt: `${asking}\n\n${def.label}: ${clue}`,
    options: laid.map((option) => option.text),
    correctIndex: laid.findIndex((option) => option.text === asked.generic),
    acceptable,
    fromSlug: laid.map((option) => option.slug),
  };
}

/**
 * Cuts the question list to `maxCards`, at random rather than from the front:
 * the pool is built field by field over drugs in alphabetical order, so the
 * first N would be the A's on one field every time.
 */
export function capQuiz(
  questions: QuizQuestion[],
  maxCards: number,
  rng: () => number = Math.random,
): QuizQuestion[] {
  if (maxCards <= 0 || questions.length <= maxCards) return shuffled(questions, rng);
  return shuffled(questions, rng).slice(0, maxCards);
}
