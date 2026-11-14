import type { FieldValue } from '@/db/schema';
import { formatFieldValue } from '@/lib/fields/format';
import { splitSections } from '@/lib/fields/prose';
import type { FieldDef } from '@/lib/fields/registry';
import { cardKey, partSlug, type StudyConfig } from './config';

/**
 * One drug with everything a card might need, core fields folded in beside the
 * stored ones so the builder treats every field the same way.
 */
export type CardSource = {
  drugId: string;
  slug: string;
  generic: string;
  drugClass: string | null;
  schedule: string | null;
  routes: string[];
  tags: string[];
  /** Indication slugs, not the prose: the scope compares slug to slug. */
  indications: string[];
  /**
   * The drug's dosing as printed sig, or null where any of its rows could not
   * be decoded. This is the comparable form: "1 gram by mouth two times a day"
   * and "1 g by mouth two times a day" are different sentences and the same
   * dose, and only the sig knows that.
   */
  dosingSig: string | null;
  /**
   * Dosing split by indication, where the source splits it -- empty for the
   * 235 drugs whose dose is simply the drug's dose.
   *
   * Sildenafil is the one that forced it: 20 mg three times a day for
   * pulmonary hypertension as Revatio, 50 mg an hour beforehand for erectile
   * dysfunction as Viagra, and both brands on the top-drugs list. One of those
   * used to be stored as *the* answer.
   *
   * `sig` is the comparable form, null where the branch's components could not
   * be read; `text` is what a reader sees. Which is asked is the quiz's
   * business -- see `atomsOf` -- and a flashcard goes on showing the whole
   * prose, which names both.
   */
  dosingBranches: { label: string; text: string; sig: string | null }[];
  /** Shown as a to-do on the profile; it does not hold cards back. */
  needsPairingReview: boolean;
  values: Record<string, FieldValue | undefined>;
  /**
   * Which version supplied each value, for the keys a variant spoke about.
   *
   * Only the keys it actually overrode: everything else came from the drug and
   * has nothing to say about whose words it is. Optional because most callers
   * -- and every fixture -- have no variants in play at all, and an absent
   * record and an empty one mean the same thing: the drug's own words.
   */
  wordedBy?: Record<string, CardVariant>;
};

/**
 * A version of a profile, as a card has to show it: the number and whose it is.
 *
 * **Never the drug's name**, which is the whole constraint here -- on a
 * `drug_to_fields` card the drug *is* the answer, so a pill reading
 * *amoxicillin [V-2]* on the question side would give it away. The number and
 * the class are safe: *V-2 · PHRM 535* says whose wording you are being asked
 * about without saying what the drug is.
 *
 * **`n` is 1 for the drug's own words**, where those words are themselves one
 * class's -- a drug a lecture created holds that lecture's wording as its base,
 * and that is version one of it. The layers are numbered from 2. See
 * `drugs.base_variant_tag_id` and `VariantOption.n`.
 */
export type CardVariant = { n: number; label: string; slug: string };

export type CardFace = { key: string; label: string; text: string };

export type StudyCardSpec = {
  id: string;
  drugId: string;
  slug: string;
  generic: string;
  cardKey: string;
  fieldKeys: string[];
  prompt: string;
  /** What the reveal shows. */
  faces: CardFace[];
  /**
   * The versions whose wording this card is asking about, deduplicated.
   *
   * Usually empty, often one, and more than one only where a card groups
   * several fields that different classes worded. Shown as pills on both sides
   * of the card, because the question *and* the answer are that class's -- see
   * `CardVariant` for why the drug's name is not in them.
   */
  variants: CardVariant[];
};

/**
 * Renders a value as a single line of answer text.
 *
 * `none` still renders, as *None* or *Not controlled*: it is a real answer,
 * and the whole field system exists to tell it apart from nobody having filled
 * anything in. Whether it is a thing to *ask* is a separate question, and
 * `worthAsking` below is where that is decided -- a profile shows it, the
 * quiz's per-drug mode prints it as a line of the profile being identified,
 * and no card is built out of it.
 */
export function answerText(def: FieldDef, value: FieldValue | undefined): string | null {
  const formatted = formatFieldValue(def, value);

  switch (formatted.kind) {
    case 'missing':
      return null;
    case 'none':
      return def.dataType === 'enum' ? 'Not controlled' : 'None';
    case 'list':
      return formatted.items.join(', ');
    case 'markdown':
      return formatted.paragraphs.join('\n\n');
    case 'bool':
      return formatted.value ? 'Yes' : 'No';
    case 'enum':
      return formatted.option;
    case 'number':
      return formatted.text;
    default:
      return formatted.text;
  }
}

/**
 * Whether this field has something to **ask** about on this drug.
 *
 * `none` is an answer and not a question. 147 of 237 drugs carry no black box
 * warning and 213 are not controlled, so asked drug-to-fact the deck fills
 * with cards whose answer is the same word and buries the ones that have one;
 * asked fact-to-drug it is incoherent, because all 147 are equally right.
 *
 * This was the controlled schedule's own rule in `lib/study/quiz.ts`, where it
 * had been since the quiz could tell *not controlled* from *not recorded*. It
 * is every field now, on the owner's call, and flashcards follow it too -- the
 * screens asked the question honestly and the honest question was not worth
 * asking a hundred times.
 *
 * What it costs, and it is worth knowing: a card existing is now itself a
 * fact. A black box warning card only comes up for the drugs that have one, so
 * its existence says so before the answer is shown. That is a smaller price
 * than a deck of *None*, and it is why `missing` and `none` still differ
 * everywhere else -- the profile goes on saying which it is.
 *
 * The field's question changed with it: *does {{generic}} carry a black box
 * warning* was a fair yes/no while *None* was an answer, and would now be one
 * whose answer is always yes. It asks for the warning instead.
 */
export function worthAsking(def: FieldDef, value: FieldValue | undefined): boolean {
  return formatFieldValue(def, value).kind !== 'none';
}

/** The one field whose headings are names rather than structure. */
const SPLIT_BY_HEADING = 'regimen';

/** A named piece of a field, asked on its own. See `partsOf`. */
export type CardPart = {
  /** The heading, as written: *FOLFOX*. It is the card's label and its prompt. */
  name: string;
  /** That name as a card key can carry it -- see `cardKey`. */
  slug: string;
  text: string;
};

/**
 * The named pieces a field is asked one at a time, or empty where it is asked
 * whole.
 *
 * Only the regimen field, and the reason is what a heading means there. In a
 * mechanism or a dosing note a heading is structure; in a regimen it is the
 * **name of a protocol** -- FOLFOX, CAPEOX, *lazertinib + amivantamab* -- and
 * the 61 drugs that have one hold 169 of them between them, up to 19 on a
 * single drug. One card for the lot cannot be graded: you either know all
 * nineteen or you do not, and *Again* on the nineteenth buries the eighteen
 * you had. One card per protocol is the thing you can actually block out.
 *
 * Split off the **overlaid** value, so a class that rewords a drug's regimens
 * is split into that class's protocols and not the drug's own.
 *
 * `splitSections` returns nothing where the prose has words before its first
 * heading, and that is the fallback: such a field is asked whole, exactly as
 * it was before.
 */
export function partsOf(def: FieldDef, value: FieldValue | undefined): CardPart[] {
  if (def.key !== SPLIT_BY_HEADING || value === undefined) return [];

  const slices = splitSections(value.value ?? '');
  const seen = new Set<string>();

  return slices.flatMap((slice) => {
    // Through the formatter rather than raw, so a piece of a field is written
    // the way the whole field would have been.
    const text = answerText(def, { ...value, value: slice.text });
    if (text === null) return [];

    // Two protocols under one name on one drug would be two cards with one
    // schedule between them. There are none today; there is nothing stopping
    // one tomorrow.
    let slug = partSlug(slice.heading);
    for (let n = 2; seen.has(slug); n += 1) slug = `${partSlug(slice.heading)}-${n}`;
    seen.add(slug);

    return [{ name: slice.heading, slug, text }];
  });
}

/**
 * How a named piece of a field is asked, where the field's own template cannot
 * say it.
 *
 * *Which named regimens include bevacizumab, and at what dose?* is the right
 * question about the whole field and the wrong one about a single protocol --
 * the protocol has already been named, so what is left to ask is what it is
 * for and what this drug does in it.
 *
 * Shared by the deck and the quiz so one protocol is one question however it
 * is met.
 */
export function partPrompt(generic: string, part: CardPart): string {
  return `${part.name} — what is it for, and what is ${generic}'s part in it?`;
}

/**
 * The drug's own name struck out of a clue that is about to ask for it.
 *
 * A regimen names its members, and marks which one the drug is: *Bevacizumab
 * — Metastatic, RAS-mutated or any side ← this drug*. Asked facts-to-drug that
 * is not a question, it is the answer typed out. Blanked, it becomes the
 * better question the marker was always pointing at -- which drug fills this
 * slot in FOLFOX.
 *
 * Only where the drug *is* the answer. Asked the other way the name is part of
 * the protocol and belongs on the card.
 */
export function maskGeneric(text: string, generic: string): string {
  const name = generic.trim();
  if (name === '') return text;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '———');
}

export function inScope(source: CardSource, config: StudyConfig) {
  const { scope } = config;
  // Each axis narrows the one before it. Within an axis it is *any*, so two
  // exams mean revising both; across axes it is *all*, so "Top Drugs 2026 +
  // Anticonvulsants" is the anticonvulsants within that list.
  //
  // Lists are the one axis that can be asked the other way, because they hold
  // four kinds of thing: *Top Drugs 2026 and PHRM 535* means the drugs on
  // both, and `tagsAll` is how the screen says so.
  if (scope.tags.length > 0) {
    const held = scope.tags.filter((tag) => source.tags.includes(tag));
    if (scope.tagsAll ? held.length !== scope.tags.length : held.length === 0) return false;
  }
  if (scope.categories.length > 0 && !scope.categories.some((tag) => source.tags.includes(tag))) {
    return false;
  }
  if (
    scope.indications.length > 0
    && !scope.indications.some((slug) => source.indications.includes(slug))
  ) {
    return false;
  }
  if (scope.classes.length > 0 && !scope.classes.includes(source.drugClass ?? '')) return false;
  if (scope.schedules.length > 0 && !scope.schedules.includes(source.schedule ?? '')) return false;
  if (scope.routes.length > 0 && !scope.routes.some((route) => source.routes.includes(route))) return false;
  return true;
}

/**
 * What sort of thing is being studied.
 *
 * One value, `DRUG_SUBJECT` -- this was written as a parameter when a second
 * section was going to pass a different one, and it is kept as a shape rather
 * than folded back into constants because it is where the identity wording
 * lives: what the subject's own name column is called, how the identity
 * question is asked, and the sharper question the brand/generic pair wants.
 *
 * A subject's own name is never one of the things asked about. Going
 * subject -> facts it is the stimulus, so a card made of it alone asks "Which
 * drug is this?" with nothing to go on; going facts -> subject it is the
 * answer, so putting it among the clues gives the game away.
 */
export type StudySubject = {
  /** The field key holding the subject's own name. */
  identityKey: string;
  /** The label on a face showing that name. */
  identityLabel: string;
  /** How the identity question is asked: *Which drug?*, *Which hormone?* */
  askingWhich: string;
  /**
   * A field that *pairs* with the identity, where naming the pair is sharper
   * than the general question: shown Xanax, what is wanted is the generic name
   * and not "which drug" in some looser sense. Leaving it unset uses the
   * general question.
   */
  pairKey?: string;
  /** The pair question, in a quiz. */
  pairAsking?: string;
  /** The pair question on a flashcard, where there is less room. */
  pairAskingShort?: string;
};

export const DRUG_SUBJECT: StudySubject = {
  identityKey: 'generic',
  identityLabel: 'Drug',
  askingWhich: 'Which drug?',
  pairKey: 'brand',
  pairAsking: 'Which generic is this a brand of?',
  pairAskingShort: 'Generic name?',
};

/**
 * A prompt has to say what it wants. Without this a card reads as a bare drug
 * name and you are left guessing whether it means the dose, the mechanism or
 * the warning.
 */
function promptFor(
  config: StudyConfig,
  generic: string,
  faces: CardFace[],
  defs: FieldDef[],
  subject: StudySubject,
  part: CardPart | null = null,
) {
  if (config.direction === 'fields_to_drug') {
    const clues = faces
      // A clue about a protocol must not contain the drug it is asking for --
      // and that includes the protocol's **name**, a third of which are built
      // out of their members: *lazertinib + amivantamab*.
      .map((face) => {
        const line = `${face.label}: ${face.text}`;
        return part ? maskGeneric(line, generic) : line;
      })
      .join('\n');

    // The pair question where the subject has one: shown Xanax, what is
    // wanted is the generic name. The reverse card -- generic shown, brands
    // wanted -- comes from the brand field's own template.
    const asking = subject.pairKey && subject.pairAskingShort
      && faces.length === 1 && faces[0].key === subject.pairKey
      ? subject.pairAskingShort
      : subject.askingWhich;
    return `${asking}\n\n${clues}`;
  }

  // A named piece has already been named, so the field's own question -- which
  // asks about all of them -- is the wrong one to put over it.
  if (part) return partPrompt(generic, part);

  // A field can carry its own wording, which reads better than a generated
  // question: "What is the mechanism of action of Acyclovir?"
  const single = faces.length === 1 ? defs.find((def) => def.key === faces[0].key) : undefined;
  if (single?.promptTemplate) return single.promptTemplate.replaceAll('{{generic}}', generic);

  return `${generic} — ${faces.map((face) => face.label).join(', ')}?`;
}

export function buildCards(
  sources: CardSource[],
  defs: FieldDef[],
  config: StudyConfig,
): StudyCardSpec[] {
  const subject = DRUG_SUBJECT;
  const byKey = new Map(defs.map((def) => [def.key, def]));
  const selected = config.fields
    .map((key) => byKey.get(key))
    .filter((def): def is FieldDef => Boolean(def) && def!.isQuizzable)
    .filter((def) => def.key !== subject.identityKey);

  if (selected.length === 0) return [];

  const cards: StudyCardSpec[] = [];

  /**
   * The versions behind a card's field keys, in overlay order, each once.
   *
   * Derived from the keys the card actually asks about rather than from
   * everything the drug has: a mechanism card studied in a class that only
   * rewords the dosing is the drug's own mechanism, and saying otherwise would
   * be a lie told by a pill.
   */
  const variantsOf = (source: CardSource, fieldKeys: string[]): CardVariant[] => {
    const seen = new Map<string, CardVariant>();
    for (const key of fieldKeys) {
      const variant = source.wordedBy?.[key];
      if (variant) seen.set(variant.slug, variant);
    }
    return [...seen.values()];
  };

  for (const source of sources) {
    if (!inScope(source, config)) continue;

    const answered = selected
      .map((def) => {
        const value = source.values[def.key];
        // A field the drug has none of is not asked -- see `worthAsking`. A
        // card whose every field is like that is not built at all, which is
        // the `answered.length === 0` line below.
        const text = worthAsking(def, value) ? answerText(def, value) : null;
        return text === null ? null : { key: def.key, label: def.label, text };
      })
      .filter((face): face is CardFace => face !== null);

    if (answered.length === 0) continue;

    const identity: CardFace = {
      key: subject.identityKey, label: subject.identityLabel, text: source.generic,
    };

    /**
     * One field's card, or one named piece of one field's card.
     *
     * A piece takes the protocol's name as its label and its prompt, and its
     * own slot in the schedule -- that is the whole point of splitting it.
     */
    const one = (face: CardFace, part: CardPart | null) => {
      const fieldKeys = [face.key];
      const key = cardKey({
        mode: config.mode, direction: config.direction, fieldKeys, part: part?.slug,
      });
      const shown: CardFace = part
        ? { key: face.key, label: part.name, text: part.text }
        : face;

      cards.push({
        id: `${source.slug}:${key}`,
        drugId: source.drugId,
        slug: source.slug,
        generic: source.generic,
        cardKey: key,
        fieldKeys,
        prompt: promptFor(config, source.generic, [shown], defs, subject, part),
        faces: config.direction === 'fields_to_drug' ? [identity] : [shown],
        variants: variantsOf(source, fieldKeys),
      });
    };

    /** A field asked one protocol at a time, where it is one -- see `partsOf`. */
    const split = (face: CardFace): boolean => {
      const def = byKey.get(face.key);
      const parts = def ? partsOf(def, source.values[face.key]) : [];
      if (parts.length === 0) return false;
      for (const part of parts) one(face, part);
      return true;
    };

    if (config.mode === 'exclusive') {
      // One card per field, each scheduled on its own, so mechanism recall and
      // dosing recall advance at their own rates.
      for (const face of answered) {
        if (!split(face)) one(face, null);
      }
      continue;
    }

    // **An inclusive card splits only when the field is the whole card.** The
    // bundle is one drug's whole selection at once; cutting the regimen out of
    // it into nineteen cards would print the mechanism and the dosing nineteen
    // times beside it. Alone -- which is what studying regimens looks like --
    // there is nothing to repeat, and the protocols separate as they should.
    if (answered.length === 1 && split(answered[0])) continue;

    const fieldKeys = answered.map((face) => face.key);
    const key = cardKey({ mode: config.mode, direction: config.direction, fieldKeys });
    cards.push({
      id: `${source.slug}:${key}`,
      drugId: source.drugId,
      slug: source.slug,
      generic: source.generic,
      cardKey: key,
      fieldKeys,
      prompt: promptFor(config, source.generic, answered, defs, subject),
      faces: config.direction === 'fields_to_drug' ? [identity] : answered,
      variants: variantsOf(source, fieldKeys),
    });
  }

  return cards;
}
