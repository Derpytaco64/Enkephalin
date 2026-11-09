/**
 * Sets as a deck tree, and studying any node of it.
 *
 * The nesting is **not new structure** -- every set already declares
 * `course`, `exam`, `unit`, `topic`, which is a four-level path written in the
 * course's own words. What was missing was a surface that reads it as a path
 * and a way to study a node rather than a set: *everything on Exam 3*, not
 * "which of my eleven sets". That is what a nested deck is in the spaced
 * repetition plugin this borrows the shape from -- a parent deck is reviewable
 * and holds its children's cards -- and it arrives here without a migration,
 * because the hierarchy was in the data from the first import.
 *
 * Two rules make the tree honest:
 *
 * - **An empty level collapses rather than becoming a blank node.** A set with
 *   a course and a unit but no exam hangs directly under its course. A branch
 *   called "(no exam)" is a thing nobody filed anything under.
 * - **A node is addressed by slugged segments, and the tree is grouped by the
 *   same segments.** Two scope values that slug alike -- `Exam 3` and
 *   `exam-3` -- therefore become one node rather than two nodes sharing a URL,
 *   which is the failure that would otherwise be invisible until the second
 *   one's cards went missing from the first one's session.
 */
import type { listSets } from './import.ts';

/** The scope levels, outermost first. The order *is* the nesting. */
export const SCOPE_LEVELS = ['course', 'exam', 'unit', 'topic'] as const;

export type ScopeLevel = (typeof SCOPE_LEVELS)[number];

/** What the tree needs of a set: its scope, and enough to show a row. */
export type TreeSet = Pick<
  Awaited<ReturnType<typeof listSets>>[number],
  'id' | 'slug' | 'name' | 'course' | 'exam' | 'unit' | 'topic' | 'items'
>;

export type ScopeNode = {
  /** Url segments from the root. Empty for the root itself. */
  path: string[];
  /** The scope value as somebody wrote it, which is what a heading shows. */
  label: string;
  /** Which column this node came from -- for "Exam 3" vs "Unit 3". */
  level: ScopeLevel;
  children: ScopeNode[];
  /** Sets filed exactly here, not in a child. */
  sets: TreeSet[];
  /** This node and everything under it. */
  totals: { sets: number; items: number };
};

export type ScopeTree = {
  children: ScopeNode[];
  /** Sets with no scope at all. They belong nowhere and are not a node. */
  loose: TreeSet[];
  totals: { sets: number; items: number };
};

/**
 * One scope value as a url segment.
 *
 * The same spelling `scopeTags` uses, and exported so there is one of it:
 * a tag and a path segment disagreeing about what `Exam 3` shortens to would
 * put the scope filter and the deck tree on different decks.
 */
export function scopeSegment(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** A set's scope as the levels it actually filled in, outermost first. */
export function scopePath(set: {
  course: string | null;
  exam: string | null;
  unit: string | null;
  topic: string | null;
}): { level: ScopeLevel; value: string; segment: string }[] {
  const steps: { level: ScopeLevel; value: string; segment: string }[] = [];

  for (const level of SCOPE_LEVELS) {
    const value = set[level]?.trim();
    if (!value) continue;
    const segment = scopeSegment(value);
    // A value of nothing but punctuation slugs to the empty string, which
    // cannot be a url segment and must not become one.
    if (segment) steps.push({ level, value, segment });
  }

  return steps;
}

/**
 * The tree.
 *
 * Children are sorted by label, which is what a list of exams or units wants;
 * sets within a node keep the order they were given (import order, newest
 * first, as `listSets` returns them).
 */
export function buildScopeTree(sets: TreeSet[]): ScopeTree {
  const root: ScopeNode = {
    path: [], label: '', level: 'course', children: [], sets: [],
    totals: { sets: 0, items: 0 },
  };
  const loose: TreeSet[] = [];

  for (const set of sets) {
    const steps = scopePath(set);
    if (steps.length === 0) {
      loose.push(set);
      continue;
    }

    let node = root;
    for (const step of steps) {
      let child = node.children.find((candidate) =>
        candidate.path[candidate.path.length - 1] === step.segment);

      if (!child) {
        child = {
          path: [...node.path, step.segment],
          label: step.value,
          level: step.level,
          children: [],
          sets: [],
          totals: { sets: 0, items: 0 },
        };
        node.children.push(child);
      }

      node = child;
    }

    node.sets.push(set);
  }

  const total = (node: ScopeNode): { sets: number; items: number } => {
    const own = node.sets.reduce(
      (sum, set) => ({ sets: sum.sets + 1, items: sum.items + set.items }),
      { sets: 0, items: 0 },
    );

    node.children.sort((a, b) => a.label.localeCompare(b.label));
    for (const child of node.children) {
      const sub = total(child);
      own.sets += sub.sets;
      own.items += sub.items;
    }

    node.totals = own;
    return own;
  };

  const totals = total(root);

  return {
    children: root.children,
    loose,
    totals: {
      sets: totals.sets + loose.length,
      items: totals.items + loose.reduce((sum, set) => sum + set.items, 0),
    },
  };
}

/** Every node in the tree, depth first -- for a flat listing or a lookup. */
export function flattenTree(tree: ScopeTree): ScopeNode[] {
  const out: ScopeNode[] = [];
  const walk = (nodes: ScopeNode[]) => {
    for (const node of nodes) {
      out.push(node);
      walk(node.children);
    }
  };
  walk(tree.children);
  return out;
}

/**
 * The node at a path, with its children -- what a node page needs to offer
 * the next step down. `resolveScope` answers the other question, *which sets
 * does this address*, and flattens the children away to do it.
 */
export function findNode(tree: ScopeTree, segments: string[]): ScopeNode | null {
  let nodes = tree.children;
  let found: ScopeNode | null = null;

  for (const segment of segments) {
    const next = nodes.find((node) => node.path[node.path.length - 1] === segment);
    if (!next) return null;
    found = next;
    nodes = next.children;
  }

  return found;
}

export type ResolvedScope = {
  /** The node, with its ancestors, so a page can show a trail. */
  trail: { path: string[]; label: string; level: ScopeLevel }[];
  label: string;
  /** Every set at this node or under it. The deck. */
  sets: TreeSet[];
};

/**
 * Which sets a path addresses.
 *
 * Resolution is by segment against the same `scopeSegment` the tree groups by,
 * rather than a database query on the raw values -- the slugging is lossy, and
 * a query would quietly disagree with the tree about which node a set is in.
 */
export function resolveScope(sets: TreeSet[], segments: string[]): ResolvedScope | null {
  if (segments.length === 0) return null;

  let nodes = buildScopeTree(sets).children;
  const trail: ResolvedScope['trail'] = [];
  let found: ScopeNode | null = null;

  for (const segment of segments) {
    const next = nodes.find((node) => node.path[node.path.length - 1] === segment);
    if (!next) return null;
    trail.push({ path: next.path, label: next.label, level: next.level });
    found = next;
    nodes = next.children;
  }

  if (!found) return null;

  const collect = (node: ScopeNode): TreeSet[] => [
    ...node.sets,
    ...node.children.flatMap(collect),
  ];

  return { trail, label: found.label, sets: collect(found) };
}
