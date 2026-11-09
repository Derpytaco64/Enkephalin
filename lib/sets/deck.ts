/**
 * One address for both kinds of deck.
 *
 * `/sets/thyroid` is a set. `/sets/pharm/exam-3` is every set on Exam 3.
 * `/sets/pharm/exam-3/endocrine/thyroid` is the same single set reached
 * through the tree. All three are decks, all three study the same way, and
 * one resolver means the flashcard page does not need to know which it got.
 *
 * **A set slug wins over a node when a single segment could be either.** Every
 * link written before the tree existed is `/sets/<slug>`, and a course that
 * happens to slug the same as a set must not silently redirect those
 * elsewhere. The node is still reachable: it has a parent, or it is one
 * segment of a longer path.
 */
import { loadScopeStudy } from './scope.ts';
import { loadSetStudy } from './session.ts';
import { scopePath, type TreeSet } from './tree.ts';
import type { SetStudySource } from './source.ts';

/**
 * A deck url, as the route's own shape.
 *
 * `typedRoutes` checks every `href` against the route tree, so this is a
 * template literal type rather than `string`: annotate one of these as a
 * string anywhere on the way to a `<Link>` and the check is gone for every
 * page downstream of it.
 */
export type DeckHref = `/sets/${string}`;

export type Deck = {
  kind: 'set' | 'scope';
  /** What to call it: the set's name, or the node's label. */
  title: string;
  /** Canonical url segments for this deck. */
  path: string[];
  /** Ancestors, innermost last, each already a url. */
  trail: { label: string; href: DeckHref }[];
  source: SetStudySource;
  /** For a scope: the sets in it. For a set: just itself. */
  members: { slug: string; name: string; items: number }[];
  /** What the merge left out, in words. Empty for a single set. */
  notes: string[];
};

/**
 * The url for a deck path.
 *
 * Typed as the route's own shape rather than `string`: `typedRoutes` checks
 * every `href` against the route tree, and a helper that returned a plain
 * string would push that check out of every page that uses it.
 */
export function deckHref(path: string[]): DeckHref {
  return `/sets/${path.map(encodeURIComponent).join('/')}`;
}

/** The flashcard or quiz url for a deck path. */
export function studyHref(path: string[], surface: 'flashcards' | 'quiz'): DeckHref {
  return `${deckHref(path)}/${surface}`;
}

/**
 * Resolve a url path to a deck.
 *
 * `sets` is the listing the caller already has -- the tree is built from it,
 * so passing it in keeps this to one database round trip for the listing
 * however many ways a page needs to read it.
 */
export async function loadDeck(sets: TreeSet[], segments: string[]): Promise<Deck | null> {
  const clean = segments.map((segment) => segment.trim()).filter(Boolean);
  if (clean.length === 0) return null;

  if (clean.length === 1) {
    const found = sets.find((set) => set.slug === clean[0]);
    if (found) {
      const source = await loadSetStudy(found.slug);
      if (!source) return null;

      return {
        kind: 'set',
        title: found.name,
        path: [found.slug],
        trail: trailOf(found),
        source,
        members: [{ slug: found.slug, name: found.name, items: found.items }],
        notes: [],
      };
    }
  }

  const scope = await loadScopeStudy(sets, clean);
  if (scope) {
    // A node holding exactly one set is that set's deck under another name.
    // Said rather than hidden: the page shows which set it is.
    return {
      kind: 'scope',
      title: scope.scope.label,
      path: clean,
      trail: scope.scope.trail.slice(0, -1).map((step) => ({
        label: step.label,
        href: deckHref(step.path),
      })),
      source: scope.source,
      members: scope.members,
      notes: scope.notes,
    };
  }

  return null;
}

/** A set's own breadcrumb: the scope it was filed under, as links. */
function trailOf(set: TreeSet): { label: string; href: DeckHref }[] {
  const steps = scopePath(set);
  return steps.map((step, index) => ({
    label: step.value,
    href: deckHref(steps.slice(0, index + 1).map((earlier) => earlier.segment)),
  }));
}
