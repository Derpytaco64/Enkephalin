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
function answerText(def: FieldDef, value: FieldValue | undefined): string | null {
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

function inScope(source: CardSource, config: StudyConfig) {
  const { scope } = config;
  if (scope.tags.length > 0 && !scope.tags.some((tag) => source.tags.includes(tag))) return false;
  if (scope.classes.length > 0 && !scope.classes.includes(source.drugClass ?? '')) return false;
  if (scope.schedules.length > 0 && !scope.schedules.includes(source.schedule ?? '')) return false;
  if (scope.routes.length > 0 && !scope.routes.some((route) => source.routes.includes(route))) return false;
  return true;
}

/**
 * A pairing nobody has confirmed must not become a card. Tirzepatide's brands
 * and indications are the case: with the pairing unreviewed, a card built from
 * both fields can teach Mounjaro for weight management.
 */
function pairingBlocked(source: CardSource, fieldKeys: string[]) {
  return source.needsPairingReview && fieldKeys.includes('brand') && fieldKeys.includes('indication');
}

function promptFor(config: StudyConfig, generic: string, faces: CardFace[], defs: FieldDef[]) {
  if (config.direction === 'fields_to_drug') {
    return faces.map((face) => `${face.label}: ${face.text}`).join('\n');
  }

  // A field can carry its own wording; otherwise the label does the asking.
  const single = faces.length === 1 ? defs.find((def) => def.key === faces[0].key) : undefined;
  if (single?.promptTemplate) return single.promptTemplate.replaceAll('{{generic}}', generic);

  return generic;
}

export function buildCards(
  sources: CardSource[],
  defs: FieldDef[],
  config: StudyConfig,
): StudyCardSpec[] {
  const byKey = new Map(defs.map((def) => [def.key, def]));
  const selected = config.fields
    .map((key) => byKey.get(key))
    .filter((def): def is FieldDef => Boolean(def) && def!.isQuizzable);

  if (selected.length === 0) return [];

  const cards: StudyCardSpec[] = [];

  for (const source of sources) {
    if (!inScope(source, config)) continue;

    const answered = selected
      .map((def) => {
        const value = source.values[def.key];
        if (config.scope.verifiedOnly && value?.status !== 'verified') return null;

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
        if (pairingBlocked(source, fieldKeys)) continue;

        const key = cardKey({ mode: config.mode, direction: config.direction, fieldKeys });
        cards.push({
          id: `${source.slug}:${key}`,
          drugId: source.drugId,
          slug: source.slug,
          generic: source.generic,
          cardKey: key,
          fieldKeys,
          prompt: promptFor(config, source.generic, [face], defs),
          faces: config.direction === 'fields_to_drug' ? [{ key: 'generic', label: 'Drug', text: source.generic }] : [face],
        });
      }
      continue;
    }

    const fieldKeys = answered.map((face) => face.key);
    if (pairingBlocked(source, fieldKeys)) continue;

    const key = cardKey({ mode: config.mode, direction: config.direction, fieldKeys });
    cards.push({
      id: `${source.slug}:${key}`,
      drugId: source.drugId,
      slug: source.slug,
      generic: source.generic,
      cardKey: key,
      fieldKeys,
      prompt: promptFor(config, source.generic, answered, defs),
      faces:
        config.direction === 'fields_to_drug'
          ? [{ key: 'generic', label: 'Drug', text: source.generic }]
          : answered,
    });
  }

  return cards;
}
