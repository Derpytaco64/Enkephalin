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
import {
  answerText, DRUG_SUBJECT, inScope, maskGeneric, mayAsk, partPrompt, partsOf, worthAsking,
  type CardPart, type CardSource, type CardVariant, type StudySubject,
} from './cards';
import { partSlug, type StudyConfig, type StudyDirection } from './config';
import { weightOf, type QuestionWeights } from './priority';

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
  /**
   * Whether this field's words are markdown, and so want drawing as the
   * headings, paragraphs and nested lists they are.
   *
   * Which half of the question that applies to follows from the direction:
   * asked drug-to-fields the **options** are the field's words, asked the
   * other way round the **prompt** carries them as the clue.
   */
  prose: boolean;
  options: string[];
  correctIndex: number;
  /**
   * Every answer this question would also accept. Tirzepatide treats diabetes
   * *and* obesity, so with one keyed correct the other must never appear as a
   * wrong option -- it is not wrong.
   */
  acceptable: string[];
  /**
   * The version this question's field is worded by, where one is.
   *
   * One rather than a list: a question asks about exactly one field, so there
   * is at most one class whose wording is in play. Shown as a pill on the
   * question and on the review -- never with the drug's name in it, because
   * asked the other way round the drug *is* the answer.
   */
  variant: CardVariant | null;
  /** Which drug each option came from, for the review screen. */
  fromSlug: (string | null)[];
  /** That drug's name, so a wrong answer can be told what it belongs to. */
  fromGeneric: (string | null)[];
  /**
   * What the option *is* right about, where the option text does not already
   * say. Asked the other way round -- options are drug names -- a wrong answer
   * is only instructive if you are told the fact it would have matched, so
   * this carries that drug's own value for the field. Null when the option
   * text is itself the fact.
   */
  fromFact: (string | null)[];
  /**
   * **Everyone** the option is true of, per option, and the reason
   * `fromGeneric` is not enough.
   *
   * An option is drawn from one drug, and for most fields that drug is the
   * only one it belongs to: one mechanism, one dose, one brand. The schedule
   * is not like that. Nine drugs in the sheet are CII, so "CII is the
   * controlled schedule of Methylphenidate" is true, arbitrary, and reads as
   * if the other eight were not -- the drug named is simply whichever one the
   * draw happened to reach for. Same shape wherever a value is shared: a
   * common indication, a dose two drugs are written up with identically.
   *
   * So the review names all of them. Matched on the answer *key*, which is
   * the same comparison that keeps a shared value from being offered as a
   * wrong answer -- see `answerKey`.
   */
  fromOwners: { slug: string; generic: string }[][];
};

/** The drug's own name is the stimulus or the answer, never a thing asked about. */
const SUBJECT = DRUG_SUBJECT;

/** The line break inside a bundled option, spelled so no tool can eat it. */
const NEWLINE = String.fromCharCode(10);

/**
 * The atomic answers a field offers, or null where there is nothing to ask.
 *
 * A list field asks about *one* of its items -- "which of these is an
 * indication of albuterol" wants Asthma, not "Asthma, COPD, Bronchospasm",
 * which is a sentence no option would ever match. Everything else is asked
 * whole. Read from the formatted value rather than from the joined answer
 * text, because splitting that back apart is how the items got lost once.
 */
function atomsOf(def: FieldDef, source: CardSource): string[] | null {
  // Dosing the source splits by indication is asked one branch at a time, and
  // the option is the **bare dose**: prefixing it with the condition would put
  // a `Something: ` on exactly one of the four options, which is a tell. Which
  // branch is being asked goes in the prompt instead -- see `qualify`.
  if (def.key === 'dosing' && source.dosingBranches.length > 0) {
    return source.dosingBranches.map((branch) => branch.text);
  }

  // A regimen is asked one named protocol at a time, for the same reason: the
  // whole field is nineteen of them and no option anybody reads. The name goes
  // in the prompt, not in the option -- `partsOf` for why it is split at all.
  const parts = partsOf(def, source.values[def.key]);
  if (parts.length > 0) return parts.map((part) => part.text);

  const value = source.values[def.key];
  const formatted = formatFieldValue(def, value);
  if (formatted.kind === 'missing') return null;
  if (formatted.kind === 'list') return formatted.items.length > 0 ? formatted.items : null;

  const text = answerText(def, value);
  return text === null ? null : [text];
}

/**
 * What a branch of a split dosing is for, per atom, or null everywhere else.
 *
 * Parallel to `atoms` rather than folded into them because it belongs to the
 * *question* and not to the answer: "How is sildenafil dosed **for erectile
 * dysfunction**?" with four bare doses under it.
 */
function qualifiersOf(def: FieldDef, source: CardSource, atoms: string[]): (string | null)[] {
  if (def.key === 'dosing' && source.dosingBranches.length > 0) {
    return atoms.map((text) =>
      source.dosingBranches.find((branch) => branch.text === text)?.label ?? null);
  }

  // By position, not by text: `atomsOf` built the atoms from these same parts
  // in this same order, and two protocols written up identically would
  // otherwise both answer to the first one's name.
  const parts = partsOf(def, source.values[def.key]);
  if (parts.length > 0) return atoms.map((_, at) => parts[at]?.name ?? null);

  return atoms.map(() => null);
}

/**
 * Narrows a prompt to the branch being asked.
 *
 * Reads the question's own punctuation rather than rewriting the template: the
 * templates are admin-editable, so the only safe assumption is that a question
 * ends in a question mark.
 */
function qualify(def: Asking, prompt: string, qualifier: string | null): string {
  if (qualifier === null) return prompt;

  // A protocol **replaces** the question rather than narrowing it. *Which
  // named regimens include bevacizumab, and at what dose, for folfox?* is not
  // a sentence; the name has already been given, so what is left to ask is
  // what FOLFOX is for and what this drug does in it. Shared with the deck, so
  // one protocol is one question wherever it is met.
  if (def.key === REGIMEN_KEY) return partPrompt({ name: qualifier, slug: '', text: '' });

  return `${prompt.replace(/\s*\?\s*$/, '')} for ${qualifier.toLowerCase()}?`;
}

/**
 * What heads a clue in the facts-to-drug direction.
 *
 * A protocol's clue is headed by the protocol, not by the field: *FOLFOX:*
 * reads as the thing being described where *Regimens:* reads as a category.
 *
 * Deliberately the opposite of a dosing branch, which stays unnamed in this
 * direction -- naming the condition there would all but answer the question,
 * since the clue is a dose and one drug in the list treats it. A protocol names
 * a handful of drugs and asks which of them this slot is.
 */
function clueLabel(def: Asking, qualifier: string | null): string {
  return def.key === REGIMEN_KEY && qualifier !== null ? qualifier : def.label;
}

/**
 * What a question's qualifier adds to its identity, so two of them are two
 * questions in the history rather than one that keeps changing its mind.
 *
 * An indication goes through the alias table, which is what a dosing branch is
 * named by; a protocol is slugged the way its card key is, so the deck and the
 * quiz call the same protocol by the same name.
 */
function branchKey(def: Asking, qualifier: string | null): string {
  if (qualifier === null) return '';
  const slug = def.key === REGIMEN_KEY
    ? partSlug(qualifier)
    : indicationSlug(qualifier) || qualifier;
  return `:${slug}`;
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
  if (def.key === 'dosing') {
    // A branch is compared by *its own* sig, not by the drug's: the whole
    // point of splitting sildenafil is that its two doses are two answers.
    const branch = source.dosingBranches.find((row) => row.text === text);
    if (branch) return branch.sig ? `sig:${branch.sig.toLowerCase()}` : text.trim().toLowerCase();
    if (source.dosingSig) return `sig:${source.dosingSig.toLowerCase()}`;
  }
  return text.trim().toLowerCase();
}

type Candidate = {
  source: CardSource;
  atoms: string[];
  keys: string[];
  /** Per atom, and almost always all null. See `qualifiersOf`. */
  qualifiers: (string | null)[];
};

/**
 * What a question is *about*: one field, or -- in per-drug mode -- the whole
 * selection at once. The two builders below only ever needed this much of a
 * `FieldDef`, and taking it this way is what lets a bundle of fields be asked
 * by exactly the same code as a single one.
 */
type Asking = {
  key: string;
  label: string;
  promptTemplate: string | null;
  /** See `QuizQuestion.prose`. A bundle of several fields is never one. */
  prose: boolean;
};

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

/**
 * Whether this drug can be *asked about* on this field, as against merely
 * having a value for it.
 *
 * The controlled schedule needed this first and needed it badly: 213 of the
 * 236 drugs are not controlled, and *not controlled* is a perfectly good fact
 * -- it is just not a question. Asked drug-to-fact it floods a quiz with a
 * hundred questions whose answer is the same word, which teaches nothing about
 * what CII means and buries the 23 that do; asked fact-to-drug it is
 * incoherent, since 213 drugs are equally right. So a schedule question is
 * asked only of a scheduled drug, and its options are therefore other
 * schedules -- which is the question anyone meant by it.
 *
 * It is now every field rather than that one, which is the same argument with
 * the black box warning's numbers in it: 147 of 237 have none. `worthAsking`
 * holds the rule, flashcards keep it too, and the distractor pool is built
 * from these candidates -- so *None* cannot turn up as a wrong option either,
 * which would have been a free elimination once it stopped being a right one.
 *
 * Nothing changes about what is stored or what a profile shows: *not
 * controlled* is still recorded and still shown. This is about what is worth
 * being asked.
 */
function askable(def: FieldDef, source: CardSource): boolean {
  // A split dosing is asked branch by branch, and a branch is always a dose.
  if (def.key === 'dosing' && source.dosingBranches.length > 0) return true;
  return worthAsking(def, source.values[def.key]);
}

/** The field asked one named protocol at a time. See `partsOf`. */
const REGIMEN_KEY = 'regimen';

/**
 * One drug's answer to the whole selection at once, as one option.
 *
 * This is per-drug mode: rather than four mechanisms, the options are four
 * *profiles*, and the question is which of them is this drug's. It asks a
 * different thing from the per-fact version -- not "what is atorvastatin's
 * mechanism" but "which of these four drugs is atorvastatin", with four facts'
 * worth of evidence -- and that is the recall an exam actually wants.
 *
 * A drug needs a value for every field **it is handed** to be in it. A bundle
 * missing one of them is not merely incomplete, it is a tell: the option with
 * three lines where the others have four is visibly the odd one out.
 *
 * Which fields those are is the caller's, not the selection's: `buildQuiz`
 * asks each drug on the fields it has and draws that question's options from
 * the drugs that can show the same ones. Handed the whole selection for every
 * drug, as it was until 2026-11-16, this rule emptied the paper rather than
 * shortening it.
 */
function bundleOf(
  defs: FieldDef[],
  source: CardSource,
  rng: () => number,
): { text: string; key: string } | null {
  const lines: string[] = [];
  const keys: string[] = [];

  for (const def of defs) {
    // A bundle line is unqualified even for a split dosing. The question here
    // is which drug this profile belongs to, and one of its doses is a true
    // line of it -- where a "Dosing (erectile dysfunction)" label on one
    // option out of four would be the tell this builder exists to avoid.
    const atoms = atomsOf(def, source);
    if (atoms === null) return null;

    // One of them, as the per-fact question does: a drug with six indications
    // would otherwise make an option nobody reads.
    const at = Math.floor(rng() * atoms.length);

    // The exception to the line above, and not a contradiction of it: a
    // protocol's name is what its line is *about*, where a dosing branch's
    // condition is a narrowing of the question. Every option here carries one,
    // because a bundle missing a field is not built at all.
    //
    // And the drug's own name comes out of it. The whole question is which
    // drug this profile belongs to, and a regimen marks its own member.
    const name = def.key === REGIMEN_KEY ? qualifiersOf(def, source, atoms)[at] : null;
    const line = `${name === null ? def.label : `${def.label} — ${name}`}: ${atoms[at]}`;

    lines.push(def.key === REGIMEN_KEY ? maskGeneric(line, source.generic) : line);
    keys.push(answerKey(def, source, atoms[at]));
  }

  // A blank line between fields, because each one is its own paragraph and a
  // single break would run them into one. Read as markdown (`prose` below),
  // which is what the values in them are: a dosing with two bullets and a
  // regimen with a heading were being printed with their syntax showing.
  return { text: lines.join(NEWLINE + NEWLINE), key: keys.join(' | ') };
}

/**
 * The fields a session actually asks about, in the order they were picked.
 *
 * Quizzable only, and never the subject's own identity key: the drug's name is
 * the stimulus or the answer, not a thing asked about. Shared with
 * `silentInScope` below so the two cannot disagree about what was selected.
 */
function selectedDefs(
  defs: FieldDef[],
  config: StudyConfig,
  subject: StudySubject,
): FieldDef[] {
  const byKey = new Map(defs.map((def) => [def.key, def]));
  return config.fields
    .map((key) => byKey.get(key))
    .filter((def): def is FieldDef => Boolean(def) && def!.isQuizzable)
    .filter((def) => def.key !== subject.identityKey);
}

/**
 * In-scope drugs the versions in scope worded nothing about.
 *
 * Not a fault and not a gap in the data: studying an exam asks what that exam
 * taught, and an exam's list routinely carries drugs it only *mentions* --
 * seven of Heme/Onc Exam 3's 110 are on the class sheet and reworded by
 * nothing, so there is nothing of that exam's to ask. What it is, is a number
 * a reader needs: *110 drugs, 103 questions* looks broken until something says
 * which three it is not asking about and why.
 *
 * Counted here rather than inferred from the shortfall, because a question can
 * also be lost to having no wrong answer available, and the two have different
 * answers -- one is the scope doing its job and the other is worth fixing.
 */
export function silentInScope(
  sources: CardSource[],
  defs: FieldDef[],
  config: StudyConfig,
): number {
  const selected = selectedDefs(defs, config, SUBJECT);
  if (selected.length === 0) return 0;

  return sources.filter((source) => inScope(source, config)
    && !selected.some((def) => mayAsk(source, def.key) && atomsOf(def, source) !== null)).length;
}

export function buildQuiz(
  sources: CardSource[],
  defs: FieldDef[],
  config: StudyConfig,
  options: QuizOptions = {},
): QuizQuestion[] {
  const rng = options.rng ?? Math.random;
  const optionCount = options.optionCount ?? 4;
  const direction = options.direction ?? config.direction;
  const subject = SUBJECT;

  const selected = selectedDefs(defs, config, subject);

  if (selected.length === 0) return [];

  const asked = new Set(
    sources.filter((source) => inScope(source, config)).map((source) => source.drugId),
  );
  const questions: QuizQuestion[] = [];

  /**
   * Both modes end the same way: one builder or the other, per drug.
   *
   * @param worded Whether this drug may be asked *this* question, which is
   *   where a session scoped to a class or an exam narrows the paper to what
   *   that version actually worded. Per mode rather than inside, because the
   *   two modes ask different things: one field, or the whole selection.
   *
   * The pool handed to the builders is the unfiltered one either way. The
   * distractors are drawn from the whole database on purpose -- see
   * `candidates` below -- and narrowing them to one exam's values is how a
   * question runs out of wrong answers and quietly disappears.
   */
  const ask = (
    about: Asking,
    candidates: Candidate[],
    worded: (source: CardSource) => boolean,
  ) => {
    for (const candidate of candidates.filter(
      (row) => asked.has(row.source.drugId) && worded(row.source),
    )) {
      // Decided per question, so one quiz holds both kinds rather than the
      // whole quiz landing on one side of a coin toss.
      const asksForTheDrug = direction === 'random'
        ? rng() < 0.5
        : direction === 'fields_to_drug';

      const built = asksForTheDrug
        ? nameQuestion(about, candidate, candidates, optionCount, rng, subject)
        : factQuestion(about, candidate, candidates, optionCount, rng);
      if (built) questions.push(built);
    }
  };

  if (config.mode === 'inclusive') {
    /*
     * One question per drug, not per field, **on the fields that drug has**.
     *
     * `askable` is deliberately not consulted: "not controlled" is no question
     * on its own, but it is a perfectly good line of a profile, and the
     * question here is which profile belongs to which drug.
     *
     * What a drug is asked on is its own selection, not the whole one (bug,
     * 2026-11-16, reported as *per drug says there are no questions*). It was
     * the whole selection, and a drug missing any one field was dropped
     * entirely -- so the mode was all-or-nothing across the selection and one
     * thin field emptied the paper. Tick `counseling` and the quiz was empty
     * every time: no drug in the library has one. Nine fields of the nineteen
     * are on fewer than a fifth of drugs, and the intersection of a handful of
     * them is nobody.
     *
     * Flashcards have always done the right thing here -- `buildCards` keeps
     * the fields a drug has and builds the card from those, skipping only a
     * drug that has none of them -- so the same config gave a usable deck and
     * an empty quiz, which is exactly what `StudyConfig` exists to prevent.
     *
     * The quiz has one constraint a flashcard does not: **every option in a
     * question must carry the same lines**, or the bundle's shape is the tell
     * -- the option with two lines where the others have four is visibly the
     * odd one out. So drugs are grouped by the field set they can be asked on,
     * and each group is one question's worth of options drawn from everyone in
     * the database who can show those same lines.
     */
    /*
     * Which drugs can answer about which field, counted once.
     *
     * A signature's pool is then a count rather than a rebuild, which is what
     * makes the shrinking below cheap enough to do per drug.
     */
    const whoHas = new Map<string, Set<string>>();
    for (const def of selected) {
      whoHas.set(def.key, new Set(
        sources.filter((source) => atomsOf(def, source) !== null)
          .map((source) => source.drugId),
      ));
    }

    /**
     * The fields this drug is asked on: as many as can actually be asked.
     *
     * **A signature with no company is a question with no wrong answers**
     * (bug, 2026-11-16, reported as *90 drugs, 87 questions*). Every option
     * has to carry the same lines, so the pool is the drugs that have all of
     * them -- and a drug with an unusually complete profile is the only drug
     * in the database with its exact set. Amphotericin B deoxycholate has ten
     * of the selected fields and a pool of **one**: itself. No distractor, no
     * question, no explanation. The drugs being dropped were the best
     * documented ones, which is as backwards as it gets.
     *
     * So fields are added commonest-first and a field that would cost options
     * is refused: the rarest is the first to go, because it is the one buying
     * the least company per line. The target is a full set of options **or
     * however many are left**, whichever is smaller -- a six-drug library
     * cannot offer four, and refusing a field for that would shrink every
     * bundle in a small scope to nothing. One field is always kept, even
     * where nothing else in the database has it: `factQuestion` still refuses
     * a question it cannot find a single distractor for, which is the honest
     * end of the line rather than a guess.
     */
    const askOn = (source: CardSource): FieldDef[] => {
      const mine = selected.filter(
        (def) => mayAsk(source, def.key) && whoHas.get(def.key)!.has(source.drugId),
      );
      if (mine.length === 0) return [];

      const commonest = [...mine]
        .sort((a, b) => whoHas.get(b.key)!.size - whoHas.get(a.key)!.size);

      const keep = new Set<string>();
      let pool = sources.map((row) => row.drugId);
      for (const def of commonest) {
        const narrowed = pool.filter((drugId) => whoHas.get(def.key)!.has(drugId));
        if (narrowed.length < Math.min(optionCount, pool.length)) break;
        pool = narrowed;
        keep.add(def.key);
      }
      if (keep.size === 0) keep.add(commonest[0].key);

      // In the order they were picked, which is the order they are read in.
      return selected.filter((def) => keep.has(def.key));
    };

    const signatures = new Map<string, FieldDef[]>();
    const askedOn = new Map<string, Set<string>>();

    for (const source of sources) {
      if (!asked.has(source.drugId)) continue;

      // Present, and this version's. Studying an exam asks what that exam
      // worded -- see `CardSource.askOnly` -- and a field of this drug can be
      // another lecture's, which is a line that does not belong in this
      // version's profile at all.
      const mine = askOn(source);
      if (mine.length === 0) continue;

      const signature = mine.map((def) => def.key).join('+');
      signatures.set(signature, mine);
      const who = askedOn.get(signature) ?? new Set<string>();
      who.add(source.drugId);
      askedOn.set(signature, who);
    }

    for (const [signature, group] of signatures) {
      const who = askedOn.get(signature) ?? new Set<string>();

      const about: Asking = {
        key: signature,
        label: group.map((def) => def.label).join(', '),
        // A field's own wording asks about that field; a bundle is not that.
        promptTemplate: null,
        /*
         * **A bundle is markdown** (bug, 2026-11-16: *the available answers
         * and the wrong-answer text are not rendering as markdown*).
         *
         * This said `false`, on the reasoning that a bundle is not one
         * field's prose but a stack of `Label: value` lines meant to read
         * flat. The lines are real, but *flat* was never a rendering: a plain
         * span collapses the breaks between them, so a five-field option
         * arrived as one run-on sentence with `###` and `-` in the middle of
         * it. Most of the field set is markdown -- fourteen of the nineteen
         * quizzable fields -- so a bundle of them is markdown by composition,
         * and it is drawn the same way everywhere a bundle is read: the
         * option, the prompt asked the other way round, *also right*, and the
         * sentence naming what a wrong answer was right about.
         */
        prose: true,
      };

      /*
       * The options, from the whole database and **not** narrowed by version.
       *
       * `bundleOf` still refuses a drug missing any of these fields, which is
       * what keeps the four options the same shape. But a drug is in here on
       * what it *has*, where it is asked on what its version *worded*: narrow
       * the pool by the version too and an exam's thirty drugs are the only
       * wrong answers available, which is how a question runs out of options
       * and quietly disappears. Same rule as the per-fact pool below.
       */
      const candidates: Candidate[] = sources.flatMap((source) => {
        const bundle = bundleOf(group, source, rng);
        return bundle === null
          ? []
          : [{ source, atoms: [bundle.text], keys: [bundle.key], qualifiers: [null] }];
      });

      ask(about, candidates, (source) => who.has(source.drugId));
    }

    return questions;
  }

  for (const def of selected) {
    // Everyone with something to say about this field, scope or not: this is
    // the distractor pool, and it is deliberately the whole database.
    const candidates: Candidate[] = sources.flatMap((source) => {
      if (!askable(def, source)) return [];
      const atoms = atomsOf(def, source);
      if (atoms === null) return [];
      return [{
        source,
        atoms,
        keys: atoms.map((text) => answerKey(def, source, text)),
        qualifiers: qualifiersOf(def, source, atoms),
      }];
    });
    if (candidates.length === 0) continue;

    const about: Asking = {
      key: def.key,
      label: def.label,
      promptTemplate: def.promptTemplate,
      prose: def.dataType === 'markdown',
    };

    // Studying a version asks what that version worded, and this field of
    // this drug may be another lecture's -- see `CardSource.askOnly`.
    const worded = (source: CardSource) => mayAsk(source, def.key);

    ask(
      about,
      // A protocol's one card goes to a drug that can actually be asked about
      // it. `onePerProtocol` prefers the drugs in scope for exactly this
      // reason -- a claim by a drug nobody is asking means the protocol never
      // comes up -- and a narrowed session needs the same preference narrowed
      // the same way.
      def.key === REGIMEN_KEY
        ? onePerProtocol(candidates, new Set(
          [...asked].filter((drugId) => candidates
            .some((row) => row.source.drugId === drugId && worded(row.source))),
        ))
        : candidates,
      worded,
    );
  }

  return questions;
}

/**
 * One candidate per protocol, rather than one per drug in it.
 *
 * The importer composes a regimen onto every member, so FOLFOX is written out
 * on seven drugs. Left alone, a quiz over those seven asks about FOLFOX seven
 * times with the same answer -- the flashcard deck has the same problem and
 * `buildCards` solves it the same way.
 *
 * **Drugs in scope get first claim.** The pool here is the whole database,
 * because that is where distractors come from; claiming by database order
 * would hand FOLFOX to a drug that is not being asked about and the protocol
 * would never come up. A stable sort, so the order inside each half is still
 * alphabetical and the same scope gives the same owner every time.
 */
function onePerProtocol(candidates: Candidate[], asked: Set<string>): Candidate[] {
  const inScopeFirst = [...candidates].sort((a, b) =>
    Number(asked.has(b.source.drugId)) - Number(asked.has(a.source.drugId)));

  const claimed = new Set<string>();

  return inScopeFirst.flatMap((candidate) => {
    const kept = candidate.atoms
      .map((_, at) => at)
      .filter((at) => {
        const name = candidate.qualifiers[at];
        if (name === null) return true;
        if (claimed.has(partSlug(name))) return false;
        claimed.add(partSlug(name));
        return true;
      });

    if (kept.length === 0) return [];
    return [{
      source: candidate.source,
      atoms: kept.map((at) => candidate.atoms[at]),
      keys: kept.map((at) => candidate.keys[at]),
      qualifiers: kept.map((at) => candidate.qualifiers[at]),
    }];
  });
}

/**
 * An option, with enough about where it came from to explain itself.
 *
 * `key` is carried rather than recomputed because it is what the pool is
 * searched by afterwards: everyone this option is also true of (`fromOwners`)
 * is found by matching keys, and recomputing one here would be a second
 * opinion about what counts as the same answer.
 */
type Distractor = { text: string; key: string; slug: string; generic: string; atoms: string[] };

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
}): Distractor[] {
  const { asked, candidates, exclude, offersOf, count, rng } = input;
  const taken = new Set(exclude);
  const drawn: Distractor[] = [];

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
      drawn.push({
        text: choice.text,
        key: choice.key,
        slug: candidate.source.slug,
        generic: candidate.source.generic,
        atoms: candidate.atoms,
      });
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
  def: Asking,
  candidate: Candidate,
  candidates: Candidate[],
  optionCount: number,
  rng: () => number,
): QuizQuestion | null {
  const asked = candidate.source;
  const index = Math.floor(rng() * candidate.atoms.length);
  const correct = candidate.atoms[index];
  if (correct === undefined) return null;
  const qualifier = candidate.qualifiers[index] ?? null;

  // Every atom, still: asked "how is sildenafil dosed for erectile
  // dysfunction", the pulmonary dose is not a *wrong* answer about the drug,
  // so it must never be offered as one. Same rule as tirzepatide's two
  // indications, and the same reason.
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
    [
      {
        text: correct,
        key: candidate.keys[index],
        slug: asked.slug,
        generic: asked.generic,
        atoms: candidate.atoms,
      },
      ...distractors,
    ],
    rng,
  );

  // Everyone each option is true of, the right one included. The pool is the
  // whole database, which is what makes this worth printing: a question narrowed
  // to one class still tells you that nine drugs share the schedule.
  const ownersOf = (key: string) => candidates
    .filter((other) => other.keys.includes(key))
    .map((other) => ({ slug: other.source.slug, generic: other.source.generic }));

  // The branch is part of the identity of the question, not decoration on it:
  // without it, history would file two different questions about sildenafil
  // under one key and report the pair as one thing getting better and worse.
  const branch = branchKey(def, qualifier);

  return {
    id: `${asked.slug}:${def.key}${branch}:drug_to_fields`,
    drugId: asked.drugId,
    slug: asked.slug,
    generic: asked.generic,
    questionKey: `drug_to_fields:${def.key}${branch}`,
    fieldKey: def.key,
    fieldLabel: def.label,
    variant: asked.wordedBy?.[def.key] ?? null,
    direction: 'drug_to_fields',
    prose: def.prose,
    prompt: qualify(
      def,
      def.promptTemplate
        ? def.promptTemplate.replaceAll('{{generic}}', asked.generic)
        : `${asked.generic} — ${def.label}?`,
      qualifier,
    ),
    options: laid.map((option) => option.text),
    correctIndex: laid.findIndex((option) => option.text === correct),
    acceptable,
    fromSlug: laid.map((option) => option.slug),
    fromGeneric: laid.map((option) => option.generic),
    // The option already reads as the fact, so there is nothing to add.
    fromFact: laid.map(() => null),
    fromOwners: laid.map((option) => ownersOf(option.key)),
  };
}

/** "Which drug has this mechanism?" -- options are drug names. */
function nameQuestion(
  def: Asking,
  candidate: Candidate,
  candidates: Candidate[],
  optionCount: number,
  rng: () => number,
  subject: StudySubject,
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

  const laid = shuffled(
    [
      {
        text: asked.generic,
        key: asked.generic.toLowerCase(),
        slug: asked.slug,
        generic: asked.generic,
        atoms: candidate.atoms,
      },
      ...distractors,
    ],
    rng,
  );

  const asking = subject.pairKey && subject.pairAsking && def.key === subject.pairKey
    ? subject.pairAsking
    : subject.askingWhich;

  // Two branches of a split dosing are two different questions with the same
  // answer, so they are keyed apart -- otherwise history files them as one and
  // reports a single thing getting better and worse.
  //
  // The *prompt* deliberately does not say which branch, though the other
  // direction's does. There, naming the condition narrows the question; here it
  // would all but answer it, since the clue is already a dose and the only ED
  // drug in the list is the one being asked about.
  const qualifier = candidate.qualifiers[at] ?? null;
  const branch = branchKey(def, qualifier);

  return {
    id: `${asked.slug}:${def.key}${branch}:fields_to_drug`,
    drugId: asked.drugId,
    slug: asked.slug,
    generic: asked.generic,
    questionKey: `fields_to_drug:${def.key}${branch}`,
    fieldKey: def.key,
    fieldLabel: def.label,
    variant: asked.wordedBy?.[def.key] ?? null,
    direction: 'fields_to_drug',
    prose: def.prose,
    // A regimen names its members and marks which one this drug is, so asked
    // this way round the clue would hand over its own answer -- the protocol's
    // own name included, a third of them being built out of their members.
    // See `maskGeneric`.
    prompt: `${asking}\n\n${def.key === REGIMEN_KEY
      ? maskGeneric(`${clueLabel(def, qualifier)}: ${clue}`, asked.generic)
      : `${clueLabel(def, qualifier)}: ${clue}`}`,
    options: laid.map((option) => option.text),
    correctIndex: laid.findIndex((option) => option.text === asked.generic),
    acceptable,
    fromSlug: laid.map((option) => option.slug),
    fromGeneric: laid.map((option) => option.generic),
    // Pick the wrong drug and this is the answer you were actually describing,
    // which is the thing worth being told.
    fromFact: laid.map((option) => option.atoms.join(', ') || null),
    // An option here *is* a drug, so it is true of exactly that drug. The
    // sharing in this direction is on the clue instead, and `acceptable`
    // already carries every drug the clue is equally true of.
    fromOwners: laid.map((option) => [{ slug: option.slug, generic: option.generic }]),
  };
}

/**
 * Orders a pool by weight, drawing without replacement.
 *
 * Efraimidis-Spirakis: give each question an exponential key divided by its
 * weight and sort ascending. One pass, exactly proportional to the weights,
 * and the injected rng keeps it decidable in a test -- a constant rng orders
 * by weight alone, heaviest first.
 *
 * It orders the whole pool rather than picking the top `maxCards`, because the
 * order is worth having even when nothing is cut: a quiz abandoned halfway
 * should have spent that half on the shaky material.
 */
function weightedOrder(
  questions: QuizQuestion[],
  weights: QuestionWeights,
  rng: () => number,
): QuizQuestion[] {
  return questions
    .map((question) => {
      // rng() can legitimately return 0, and -log(0) is Infinity, which would
      // park that question at the back of every quiz it appears in.
      const u = rng() || Number.MIN_VALUE;
      return { question, key: -Math.log(u) / weightOf(weights, question) };
    })
    .sort((a, b) => a.key - b.key)
    .map((row) => row.question);
}

/**
 * Cuts the question list to `maxCards`, at random rather than from the front:
 * the pool is built field by field over drugs in alphabetical order, so the
 * first N would be the A's on one field every time.
 *
 * With `weights`, random becomes weighted: the questions you last got wrong
 * are four times as likely to be drawn as ones you have never seen and eight
 * times as likely as ones you have answered right three running. Everything
 * keeps a weight, so a cap never stops reaching the rest of the pool. See
 * `priority.ts` for why those numbers.
 */
export function capQuiz(
  questions: QuizQuestion[],
  maxCards: number,
  rng: () => number = Math.random,
  weights?: QuestionWeights,
): QuizQuestion[] {
  const ordered = weights === undefined
    ? shuffled(questions, rng)
    : weightedOrder(questions, weights, rng);
  return maxCards <= 0 ? ordered : ordered.slice(0, maxCards);
}

/**
 * The same questions, asked again, with everything that was a position moved.
 *
 * A retake of what you missed is worth nothing if it is the same card with the
 * answer in the same place: you have just watched option 3 turn green, so
 * re-serving the options in their original order asks you to remember a
 * *position* rather than the fact. The order of the paper moves too, for the
 * same reason -- the review screen you just read listed the misses in the
 * order they were asked.
 *
 * What does not move is the question's identity. `id`, `questionKey`, the drug
 * and the field are untouched, because it is the same question: history should
 * file the second answer under the first, and the priority weighting should see
 * a miss followed by a right answer rather than two unrelated rows.
 *
 * Reason this is not two lines at the call site: five of a question's fields
 * are indexed *by option* and have to move together. Permuting four of them
 * is how the review ends up telling you that a wrong answer belonged to a drug
 * it does not.
 */
export function retakeOf(
  questions: QuizQuestion[],
  rng: () => number = Math.random,
): QuizQuestion[] {
  return shuffled(questions, rng).map((question) => {
    const order = shuffled(question.options.map((_, at) => at), rng);
    const reorder = <T>(list: T[]): T[] => order.map((at) => list[at]);

    return {
      ...question,
      options: reorder(question.options),
      correctIndex: order.indexOf(question.correctIndex),
      fromSlug: reorder(question.fromSlug),
      fromGeneric: reorder(question.fromGeneric),
      fromFact: reorder(question.fromFact),
      // Guarded for the same reason the review reads it with `?.`: a paper is
      // held in memory, and one drawn before this field existed has none.
      fromOwners: question.fromOwners ? reorder(question.fromOwners) : question.fromOwners,
    };
  });
}
