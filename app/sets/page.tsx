import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { listSets } from '@/lib/sets/import';
import { progressBySet } from '@/lib/sets/scope';
import { buildScopeTree } from '@/lib/sets/tree';
import { NodeBlock, SetRow } from './_components/tree';

export const metadata = { title: 'Class sets' };
export const dynamic = 'force-dynamic';

/**
 * Sets as a tree, because that is how somebody decides what to study: not
 * "which of my eleven sets" but *what is on Exam 3* -- and then, once inside
 * it, *the endocrine half of it*.
 *
 * The nesting is the `course / exam / unit / topic` each set already declared,
 * read as a path. Every node of it is a deck: the Cards and Quiz links beside
 * a course study the whole course, and the sets under it answer the same
 * question together.
 */
export default async function SetsPage() {
  const session = await requireUser();
  const [sets, progress] = await Promise.all([
    listSets(),
    progressBySet(session.user.id),
  ]);

  const tree = buildScopeTree(sets);
  const due = [...progress.values()].reduce((sum, row) => sum + row.due, 0);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Class sets</h1>

      {sets.length === 0 ? (
        <p className="mt-4 text-[var(--muted)]">
          Nothing imported yet. A set is a table of study material — one topic, its own columns.{' '}
          <Link href="/admin/sets" className="text-[var(--accent)] underline">Import one</Link>.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {tree.totals.sets} set{tree.totals.sets === 1 ? '' : 's'}, {tree.totals.items} rows
            {due > 0 && <>, <span className="text-[var(--accent)]">{due} cards due</span></>}
            , beside the{' '}
            <Link href="/drugs" className="text-[var(--accent)] underline">top-drugs list</Link>.
          </p>

          <p className="mt-1 text-xs text-[var(--muted)]">
            Every level is a deck. Cards beside a course studies the whole course; the sets under it
            share their columns, so a question&rsquo;s wrong answers can come from any of them.
          </p>

          {tree.children.length > 0 && (
            <div className="mt-5 rounded border border-[var(--border)]">
              {tree.children.map((node) => (
                <NodeBlock key={node.path.join('/')} node={node} progress={progress} />
              ))}
            </div>
          )}

          {/* Sets that declared no scope at all. Not a node -- a node called
              "(none)" would be a branch nobody filed anything under. */}
          {tree.loose.length > 0 && (
            <section className="mt-6">
              <h2 className="text-sm font-semibold tracking-tight">Unfiled</h2>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                No course or unit declared, so there is nothing to nest these under. Add a{' '}
                <code className="text-xs">scope</code> to the file and re-import to file them.
              </p>
              <ul className="mt-2 divide-y divide-[var(--border)] rounded border border-[var(--border)]">
                {tree.loose.map((set) => (
                  <SetRow key={set.id} set={set} progress={progress} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </main>
  );
}
