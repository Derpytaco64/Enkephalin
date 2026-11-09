/**
 * Making an imported set look like something the study engine already knows
 * how to teach.
 *
 * **This is an adapter, not a second engine, and that is the whole payoff of
 * the table decision.** `buildCards` and `buildQuiz` consume `CardSource` and
 * `FieldDef` -- plain shapes that do not know what a drug is -- so a set needs
 * a translation and nothing more. Both study modes, both directions, the
 * identity question, per-subject bundles, the acceptable-answer protection,
 * SRS, cram blocks, the priority weighting and the quiz cap all arrive free.
 *
 * The mapping, and the one line in it that earns its keep:
 *
 * | `CardSource` | drug section | set section |
 * |---|---|---|
 * | `generic` | generic name | the item's identity value |
 * | `drugClass` | FDA EPC class | the set's `group` column |
 * | `tags` | tag slugs | the set's own scope, as slugs |
 * | `values` | `drugs.fields` | the item's columns |
 * | `schedule`, `routes`, `indications`, `dosingSig`, `dosingBranches` | real | empty |
 *
 * Those last five being empty is **correct by construction rather than a
 * stub**: `askable` already refuses `controlled` without a schedule, and
 * `atomsOf` only branches dosing where branches exist. And mapping `group` onto
 * `drugClass` is the line that pays -- one assignment buys the near-miss
 * distractor rule, the scope filter and the colour coding, all three of which
 * are class-driven today.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { setFields, setItems, sets, type FieldValue } from '../../db/schema.ts';
import type { CardSource } from '../study/cards.ts';
import type { FieldDef } from '../fields/registry.ts';

export type SetScope = {
  id: string;
  slug: string;
  name: string;
  course: string | null;
  exam: string | null;
  unit: string | null;
  topic: string | null;
  identityKey: string;
  identityLabel: string;
  identityKind: string;
  groupKey: string | null;
};

/** One loaded set: the engine's two input shapes, plus what sets add. */
export type SetStudySource = {
  set: SetScope;
  defs: FieldDef[];
  sources: CardSource[];
  /** Per item slug, for the rules the drug engine has no equivalent of. */
  extras: Map<string, SetItemExtras>;
};

export type SetItemExtras = {
  kind: string;
  aliases: string[];
  sequence: string | null;
  sequenceOrder: number | null;
  recallOnly: boolean;
  /** Column key to its `answers` type, for the cross-set distractor pool. */
  answersTypes: Record<string, string | null>;
};

/**
 * A set's scope as tag slugs.
 *
 * The scope filter already speaks tags, so *everything on Exam 3* is a tag
 * query rather than a new kind of filter -- and the prefixes keep a course
 * called `exam-3` from colliding with an exam called `exam-3`.
 */
export function scopeTags(scope: {
  slug: string;
  course: string | null;
  exam: string | null;
  unit: string | null;
  topic: string | null;
}): string[] {
  const slugify = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  return [
    `set:${scope.slug}`,
    ...(scope.course ? [`course:${slugify(scope.course)}`] : []),
    ...(scope.exam ? [`exam:${slugify(scope.exam)}`] : []),
    ...(scope.unit ? [`unit:${slugify(scope.unit)}`] : []),
    ...(scope.topic ? [`topic:${slugify(scope.topic)}`] : []),
  ];
}

/**
 * A set's column as the engine's own field definition.
 *
 * Synthesised rather than stored: `field_defs` rows are the sheet's, and a set
 * borrowing that table is what the separate `set_fields` decision was avoiding.
 * The id is the real `set_fields` id, so anything that round-trips through a
 * def and back still finds the row.
 *
 * `yearLevels` is empty on purpose. It is the sheet's own header -- which
 * program year is responsible for a field -- and a set has no such thing; the
 * year selector simply never narrows a set, which is the right behaviour rather
 * than an omission.
 */
export function defOf(field: {
  id: string;
  key: string;
  label: string;
  dataType: FieldDef['dataType'];
  enumOptions: string[] | null;
  prompt: string | null;
  asks: boolean;
  sortOrder: number;
}): FieldDef {
  return {
    id: field.id,
    key: field.key,
    label: field.label,
    group: null,
    dataType: field.dataType,
    enumOptions: field.enumOptions,
    sortOrder: field.sortOrder,
    isCore: false,
    // The one flag that matters here: a context column must never be asked,
    // and this is the switch the engine already honours.
    isQuizzable: field.asks,
    defaultVisible: true,
    yearLevels: [],
    // A blank cell in a set is a gap, not an answer. The sheet's "no black box
    // warning" case is a fact about a drug; an imported table that left a cell
    // empty simply did not say.
    blankMeansNone: false,
    promptTemplate: field.prompt,
    helpText: null,
    lookupMapping: null,
    deletedAt: null,
  };
}

/**
 * One item as a study subject.
 *
 * `drugId` carries the **item** id, which is the one piece of sleight of hand
 * in this file and is deliberate: the engine threads that string through
 * untouched, so everything downstream addresses the right row. What must not
 * happen is a *write* mistaking it for a drug, which is why `study_cards` and
 * `quiz_answers` have two columns and a check constraint rather than one
 * column and a convention.
 */
function sourceOf(
  item: {
    id: string;
    slug: string;
    name: string;
    values: Record<string, FieldValue>;
  },
  groupKey: string | null,
  tags: string[],
): CardSource {
  return {
    drugId: item.id,
    slug: item.slug,
    generic: item.name,
    drugClass: groupKey ? item.values[groupKey]?.value?.trim() || null : null,
    schedule: null,
    routes: [],
    tags,
    indications: [],
    dosingSig: null,
    dosingBranches: [],
    needsPairingReview: false,
    values: item.values,
  };
}

/** Everything one set needs to be studied. */
export async function loadSet(slug: string): Promise<SetStudySource | null> {
  const [found] = await db.select().from(sets).where(eq(sets.slug, slug));
  if (!found) return null;

  const [fields, items] = await Promise.all([
    db
      .select()
      .from(setFields)
      .where(and(eq(setFields.setId, found.id), isNull(setFields.deletedAt)))
      .orderBy(asc(setFields.sortOrder), asc(setFields.label)),
    db
      .select()
      .from(setItems)
      .where(eq(setItems.setId, found.id))
      .orderBy(asc(setItems.sortOrder), asc(setItems.name)),
  ]);

  const tags = scopeTags(found);
  const extras = new Map<string, SetItemExtras>();
  const answersTypes = Object.fromEntries(
    fields.map((field) => [field.key, field.answersType]),
  );

  for (const item of items) {
    extras.set(item.slug, {
      kind: item.kind,
      aliases: item.aliases,
      sequence: item.sequence,
      sequenceOrder: item.sequenceOrder,
      recallOnly: item.recallOnly,
      answersTypes,
    });
  }

  return {
    set: {
      id: found.id,
      slug: found.slug,
      name: found.name,
      course: found.course,
      exam: found.exam,
      unit: found.unit,
      topic: found.topic,
      identityKey: found.identityKey,
      identityLabel: found.identityLabel,
      identityKind: found.identityKind,
      groupKey: found.groupKey,
    },
    defs: fields.map(defOf),
    sources: items.map((item) => sourceOf(item, found.groupKey, tags)),
    extras,
  };
}

/**
 * A set's items with the set's own identity column folded in as a value.
 *
 * The engine asks the identity question by reading a field whose key is the
 * section's identity key, so the name has to be *in* `values` as well as being
 * the row's name. Done here rather than at import so the stored row keeps one
 * copy of its name and cannot drift from itself.
 */
export function withIdentityValue(source: SetStudySource): SetStudySource {
  const { identityKey, identityLabel } = source.set;

  const identityDef: FieldDef = defOf({
    id: `identity:${source.set.id}`,
    key: identityKey,
    label: identityLabel,
    dataType: 'text',
    enumOptions: null,
    prompt: null,
    asks: true,
    sortOrder: -1,
  });

  return {
    ...source,
    defs: [identityDef, ...source.defs.filter((def) => def.key !== identityKey)],
    sources: source.sources.map((item) => ({
      ...item,
      values: {
        ...item.values,
        [identityKey]: {
          value: item.generic,
          status: 'ok',
          source: 'imported set',
          updatedAt: '',
          updatedBy: null,
        },
      },
    })),
  };
}
