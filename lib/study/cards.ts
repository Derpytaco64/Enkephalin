import type { FieldValue } from '@/db/schema';
import { formatFieldValue } from '@/lib/fields/format';
import type { FieldDef } from '@/lib/fields/registry';
import { cardKey, type StudyConfig } from './config';

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
};

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
};

/**
 * Renders a value as a single line of answer text. `none` is kept: "no black
 * box warning" is a fact worth being asked for, and the whole field system
 * exists to tell that apart from nobody having filled it in.
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

export function inScope(source: CardSource, config: StudyConfig) {
  const { scope } = config;
  // Each axis narrows the one before it. Two lists mean either list, but a
  // list and a category mean the drugs in both: "Top Drugs 2026 +
  // Anticonvulsants" is the anticonvulsants within that list.
  if (scope.tags.length > 0 && !scope.tags.some((tag) => source.tags.includes(tag))) return false;
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
 * This is the one place the engine genuinely knew it was about drugs, and an
 * imported set of hormones or receptors needs it not to. Everything below reads
 * the subject rather than a constant, and the default *is* the drug section, so
 * nothing about the top-drugs list changes.
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
   * and not "which drug" in some looser sense. Drugs have one; a set does not,
   * and leaving it unset simply uses the general question.
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
) {
  if (config.direction === 'fields_to_drug') {
    const clues = faces.map((face) => `${face.label}: ${face.text}`).join('\n');

    // The pair question where the subject has one: shown Xanax, what is
    // wanted is the generic name. The reverse card -- generic shown, brands
    // wanted -- comes from the brand field's own template.
    const asking = subject.pairKey && subject.pairAskingShort
      && faces.length === 1 && faces[0].key === subject.pairKey
      ? subject.pairAskingShort
      : subject.askingWhich;
    return `${asking}\n\n${clues}`;
  }

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
  subject: StudySubject = DRUG_SUBJECT,
): StudyCardSpec[] {
  const byKey = new Map(defs.map((def) => [def.key, def]));
  const selected = config.fields
    .map((key) => byKey.get(key))
    .filter((def): def is FieldDef => Boolean(def) && def!.isQuizzable)
    .filter((def) => def.key !== subject.identityKey);

  if (selected.length === 0) return [];

  const cards: StudyCardSpec[] = [];

  for (const source of sources) {
    if (!inScope(source, config)) continue;

    const answered = selected
      .map((def) => {
        const value = source.values[def.key];
        const text = answerText(def, value);
        return text === null ? null : { key: def.key, label: def.label, text };
      })
      .filter((face): face is CardFace => face !== null);

    if (answered.length === 0) continue;

    if (config.mode === 'exclusive') {
      // One card per field, each scheduled on its own, so mechanism recall and
      // dosing recall advance at their own rates.
      for (const face of answered) {
        const fieldKeys = [face.key];
        const key = cardKey({ mode: config.mode, direction: config.direction, fieldKeys });
        cards.push({
          id: `${source.slug}:${key}`,
          drugId: source.drugId,
          slug: source.slug,
          generic: source.generic,
          cardKey: key,
          fieldKeys,
          prompt: promptFor(config, source.generic, [face], defs, subject),
          faces: config.direction === 'fields_to_drug'
            ? [{ key: subject.identityKey, label: subject.identityLabel, text: source.generic }]
            : [face],
        });
      }
      continue;
    }

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
      faces:
        config.direction === 'fields_to_drug'
          ? [{ key: subject.identityKey, label: subject.identityLabel, text: source.generic }]
          : answered,
    });
  }

  return cards;
}
