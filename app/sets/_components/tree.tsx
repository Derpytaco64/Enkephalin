import Link from 'next/link';
import { deckHref } from '@/lib/sets/deck';
import type { SetProgress } from '@/lib/sets/scope';
import type { ScopeNode, TreeSet } from '@/lib/sets/tree';

/**
 * The deck tree, drawn.
 *
 * Nested `<details>` and nothing else: a tree that expands with no client
 * boundary, no state to get out of step, and a node that is a link whether or
 * not the branch is open. A node opens itself when something under it is due,
 * which is the one piece of state worth having -- otherwise the page you open
 * to decide what to study starts by hiding the answer.
 */

export type Progress = Map<string, SetProgress>;

/** What is due under a node, counted over the sets it holds. */
function dueUnder(node: ScopeNode, progress: Progress): number {
  const own = node.sets.reduce((sum, set) => sum + (progress.get(set.id)?.due ?? 0), 0);
  return own + node.children.reduce((sum, child) => sum + dueUnder(child, progress), 0);
}

/** `12 rows · 5 due`, or an honest *not started* instead of a bare zero. */
function Counts({
  items, due, scheduled,
}: { items: number; due: number; scheduled: number }) {
  return (
    <span className="text-xs text-[var(--muted)]">
      {items} row{items === 1 ? '' : 's'}
      {due > 0 && <span className="text-[var(--accent)]"> · {due} due</span>}
      {due === 0 && scheduled > 0 && ' · nothing due'}
      {scheduled === 0 && ' · not started'}
    </span>
  );
}

/** Cards and Quiz, for any deck. */
function Study({ path }: { path: string[] }) {
  const href = deckHref(path);
  return (
    <span className="ml-auto whitespace-nowrap text-xs">
      <Link href={`${href}/flashcards`} className="text-[var(--accent)] underline">Cards</Link>
      {' · '}
      <Link href={`${href}/quiz`} className="text-[var(--accent)] underline">Quiz</Link>
    </span>
  );
}

export function SetRow({ set, progress }: { set: TreeSet; progress: Progress }) {
  const own = progress.get(set.id);

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
      <Link href={deckHref([set.slug])} className="text-sm font-medium text-[var(--accent)] underline">
        {set.name}
      </Link>
      <Counts items={set.items} due={own?.due ?? 0} scheduled={own?.scheduled ?? 0} />
      <Study path={[set.slug]} />
    </li>
  );
}

/** One node as a row -- for a listing of children, with no nesting below it. */
export function NodeRow({ node, progress }: { node: ScopeNode; progress: Progress }) {
  const due = dueUnder(node, progress);
  const scheduled = node.sets.reduce(
    (sum, set) => sum + (progress.get(set.id)?.scheduled ?? 0), 0);

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 px-3 py-2">
      <Link href={deckHref(node.path)} className="text-sm font-medium text-[var(--accent)] underline">
        {node.label}
      </Link>
      <span className="text-xs text-[var(--muted)]">
        {node.totals.sets} set{node.totals.sets === 1 ? '' : 's'}
      </span>
      <Counts items={node.totals.items} due={due} scheduled={scheduled} />
      <Study path={node.path} />
    </li>
  );
}

/** One node and everything under it, as a disclosure. */
export function NodeBlock({ node, progress }: { node: ScopeNode; progress: Progress }) {
  const due = dueUnder(node, progress);
  const scheduled = node.sets.reduce(
    (sum, set) => sum + (progress.get(set.id)?.scheduled ?? 0), 0);

  return (
    <details open={due > 0} className="border-t border-[var(--border)] first:border-t-0">
      <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 px-3 py-2">
        <span className="text-sm font-medium">{node.label}</span>
        <span className="text-xs text-[var(--muted)]">
          {node.level} · {node.totals.sets} set{node.totals.sets === 1 ? '' : 's'}
        </span>
        <Counts items={node.totals.items} due={due} scheduled={scheduled} />
        <Study path={node.path} />
      </summary>

      <div className="ml-3 border-l border-[var(--border)] pl-1">
        {node.children.length > 0 && (
          <div className="divide-y divide-[var(--border)]">
            {node.children.map((child) => (
              <NodeBlock key={child.path.join('/')} node={child} progress={progress} />
            ))}
          </div>
        )}

        {node.sets.length > 0 && (
          <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {node.sets.map((set) => <SetRow key={set.id} set={set} progress={progress} />)}
          </ul>
        )}
      </div>
    </details>
  );
}
