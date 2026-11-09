/**
 * Studying a node of the tree rather than a set.
 *
 * *Everything on Exam 3* is one deck made of four files, and this is the merge
 * that makes it one. It is the same adapter trick `source.ts` plays one level
 * up: the engine consumes `CardSource[]` and `FieldDef[]`, so several sets
 * become one session by concatenating the first and reconciling the second --
 * no second engine, no second SRS.
 *
 * The merge is where all the judgement is, and it has one governing rule:
 * **a node studies what its sets agree on, and says what it left out.** Three
 * decks that all call a column `mechanism` give one bigger pool to draw
 * distractors from, which is the entire reason to study a unit instead of a
 * set. Two decks that disagree about what `onset` *is* -- a number here, text
 * there -- have no shared column, and quietly picking one of them is how a
 * quiz earns distrust. So that column sits out, and the page says so.
 *
 * What is deliberately not here: pooling two differently-named columns that
 * share an `answers` type (`mechanism` and `target` both being mechanisms).
 * That is the distractor ladder's rungs 3 and 4, it is worth having, and it
 * needs the stored `answers_type` to be the key the engine draws on rather
 * than the column name -- which would change `card_key` for every remapped
 * column and fork the schedule of every card already reviewed. Worth doing
 * deliberately, not as a side effect of this.
 */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { setItems, studyCards } from '../../db/schema.ts';
import type { FieldDef } from '../fields/registry.ts';
import { loadSet, withIdentityValue, type SetItemExtras, type SetStudySource } from './source.ts';
import { resolveScope, type ResolvedScope, type TreeSet } from './tree.ts';

export type ScopeStudy = {
  /** The node, and the trail to it. */
  scope: ResolvedScope;
  /** The merged study source: what the engine sees. */
  source: SetStudySource;
  /** The sets that went in, in tree order. */
  members: { slug: string; name: string; items: number }[];
  /**
   * What the merge could not keep, in words a person can act on. Shown, not
   * logged: a missing column is otherwise invisible until a session is short.
   */
  notes: string[];
};

/**
 * One item's address inside a merged deck.
 *
 * `extras` is keyed by item slug, and two sets may both hold a row called
 * *levothyroxine*. The engine never parses this -- it threads `slug` through
 * as an opaque string -- so prefixing is free, and without it one set's row
 * would silently wear the other's `recall_only` flag.
 */
function memberSlug(setSlug: string, itemSlug: string): string {
  return `${setSlug}/${itemSlug}`;
}

/** The identity every member set agrees on, or the majority one. */
function chooseIdentity(sources: SetStudySource[]): {
  key: string;
  label: string;
  kind: string | null;
  agreed: boolean;
} {
  const counts = new Map<string, { count: number; key: string; label: string; kind: string }>();

  for (const source of sources) {
    const { identityKey: key, identityLabel: label, identityKind: kind } = source.set;
    const id = `${key} as ${kind}`;
    const seen = counts.get(id);
    if (seen) seen.count += 1;
    else counts.set(id, { count: 1, key, label, kind });
  }

  const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
  const winner = ranked[0];

  return {
    key: winner.key,
    label: winner.label,
    // Mixed kinds cannot be asked as one question -- *which hormone* over a
    // deck half of which is drugs is a wrong question, not a loose one.
    kind: ranked.length === 1 ? winner.kind : null,
    agreed: ranked.length === 1,
  };
}

/**
 * The columns the member sets share.
 *
 * Union by key, first spelling wins for the label -- and a key two sets
 * disagree about the *shape* of is dropped rather than coerced, the same
 * refusal the importer makes when a file changes a column's type under it.
 */
function mergeDefs(
  sources: SetStudySource[],
  identityKeys: Set<string>,
): { defs: FieldDef[]; notes: string[] } {
  const byKey = new Map<string, { def: FieldDef; from: string[] }>();
  const dropped = new Map<string, string>();

  for (const source of sources) {
    for (const def of source.defs) {
      // Every set's identity column is handled separately and must never
      // become a fact column: "what is the generic name of T4" is not a
      // question, it is the row's own name asked sideways.
      if (identityKeys.has(def.key)) continue;

      const seen = byKey.get(def.key);
      if (!seen) {
        byKey.set(def.key, { def, from: [source.set.slug] });
        continue;
      }

      if (seen.def.dataType !== def.dataType) {
        dropped.set(
          def.key,
          `“${seen.def.label}” is a ${seen.def.dataType} in ${seen.from.join(', ')}`
            + ` and a ${def.dataType} in ${source.set.slug}, so it is left out of this deck.`
            + ' Study those sets on their own, or correct one of them.',
        );
        continue;
      }

      seen.from.push(source.set.slug);
      // Context in one set, askable in another: the stricter reading wins.
      // A column somebody marked as context is not an answer anywhere.
      if (!def.isQuizzable && seen.def.isQuizzable) {
        seen.def = { ...seen.def, isQuizzable: false };
        dropped.set(
          `asks:${def.key}`,
          `“${seen.def.label}” is marked as context in ${source.set.slug}, so it is shown`
            + ' but never asked here.',
        );
      }
    }
  }

  for (const key of dropped.keys()) {
    if (!key.startsWith('asks:')) byKey.delete(key);
  }

  return {
    defs: [...byKey.values()]
      .map((entry) => entry.def)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)),
    notes: [...dropped.values()],
  };
}

/**
 * Several sets as one study source.
 *
 * Pure, given loaded sets: the merge rules are the feature, and they are
 * testable without a database.
 */
export function mergeSources(loaded: SetStudySource[]): {
  source: SetStudySource;
  notes: string[];
} {
  const identity = chooseIdentity(loaded);
  const identityKeys = new Set(loaded.map((source) => source.set.identityKey));
  const { defs, notes } = mergeDefs(loaded, identityKeys);

  const sources: SetStudySource['sources'] = [];
  const extras = new Map<string, SetItemExtras>();

  for (const loadedSet of loaded) {
    for (const item of loadedSet.sources) {
      const slug = memberSlug(loadedSet.set.slug, item.slug);
      const found = loadedSet.extras.get(item.slug);
      if (found) extras.set(slug, found);

      sources.push({
        ...item,
        slug,
        // The name under the *chosen* key, so every row in the deck answers
        // the same identity question. A set whose own key differs keeps its
        // name here and loses nothing: the name itself travels in `generic`.
        values: {
          ...item.values,
          [identity.key]: {
            value: item.generic,
            status: 'ok',
            source: `set ${loadedSet.set.slug}`,
            updatedAt: '',
            updatedBy: null,
          },
        },
      });
    }
  }

  if (!identity.agreed) {
    const kinds = [...new Set(loaded.map((source) => source.set.identityKind))];
    notes.push(
      `These sets are about different things (${kinds.join(', ')}), so the “which one?”`
        + ` question asks for a name rather than a ${kinds[0]}.`,
    );
  }

  const first = loaded[0];

  return {
    notes,
    source: {
      set: {
        ...first.set,
        identityKey: identity.key,
        identityLabel: identity.label,
        // `subjectOf` asks "Which <kind>?", so a mixed deck asking "Which
        // one?" is this single word rather than a second subject builder.
        identityKind: identity.kind ?? 'one',
      },
      defs,
      sources,
      extras,
    },
  };
}

/**
 * Everything needed to study a node: resolve the path, load its sets, merge.
 *
 * Returns null for a path that is not a node, which is a 404 rather than an
 * empty deck -- a mistyped url should say so, not look like a set with nothing
 * in it.
 */
export async function loadScopeStudy(
  sets: TreeSet[],
  segments: string[],
): Promise<ScopeStudy | null> {
  const scope = resolveScope(sets, segments);
  if (!scope || scope.sets.length === 0) return null;

  const loaded = (await Promise.all(scope.sets.map((set) => loadSet(set.slug))))
    .filter((source): source is SetStudySource => source !== null)
    .map(withIdentityValue);

  if (loaded.length === 0) return null;

  const { source, notes } = mergeSources(loaded);

  return {
    scope,
    source,
    notes,
    members: scope.sets.map((set) => ({ slug: set.slug, name: set.name, items: set.items })),
  };
}

export type SetProgress = {
  /** Cards this set has a schedule for -- reviewed at least once. */
  scheduled: number;
  /** Of those, how many are due now. */
  due: number;
};

/**
 * Per-set review progress for one person.
 *
 * One grouped query rather than one per set: a course node with eleven sets
 * under it would otherwise be eleven round trips to draw one page. Sets with
 * nothing reviewed are absent from the map, which is how the tree tells
 * *nothing due* from *never started* -- two very different things to show
 * somebody deciding what to study.
 */
export async function progressBySet(userId: string): Promise<Map<string, SetProgress>> {
  const rows = await db
    .select({
      setId: setItems.setId,
      scheduled: sql<number>`count(*)::int`,
      due: sql<number>`count(*) filter (where ${studyCards.dueAt} <= now())::int`,
    })
    .from(studyCards)
    .innerJoin(setItems, eq(studyCards.itemId, setItems.id))
    .where(eq(studyCards.userId, userId))
    .groupBy(setItems.setId);

  return new Map(rows.map((row) => [row.setId, { scheduled: row.scheduled, due: row.due }]));
}

/** The same question for one set's items only -- used by the set page. */
export async function progressOfSets(
  userId: string,
  setIds: string[],
): Promise<SetProgress> {
  if (setIds.length === 0) return { scheduled: 0, due: 0 };

  const [row] = await db
    .select({
      scheduled: sql<number>`count(*)::int`,
      due: sql<number>`count(*) filter (where ${studyCards.dueAt} <= now())::int`,
    })
    .from(studyCards)
    .innerJoin(setItems, eq(studyCards.itemId, setItems.id))
    .where(and(eq(studyCards.userId, userId), inArray(setItems.setId, setIds)));

  return row ?? { scheduled: 0, due: 0 };
}

/** Cards due now across every set, for the tree's own summary line. */
export async function dueCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ due: sql<number>`count(*)::int` })
    .from(studyCards)
    .innerJoin(setItems, eq(studyCards.itemId, setItems.id))
    .where(and(eq(studyCards.userId, userId), lte(studyCards.dueAt, new Date())));

  return row?.due ?? 0;
}
