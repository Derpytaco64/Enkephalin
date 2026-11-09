import Link from 'next/link';
import { deckHref, studyHref, type Deck } from '@/lib/sets/deck';
import { progressBySet, progressOfSets } from '@/lib/sets/scope';
import { buildScopeTree, findNode, type TreeSet } from '@/lib/sets/tree';
import { cellLines } from '@/lib/sets/render';
import { NodeRow } from './tree';

/**
 * A deck: one set as the table it is, or a node of the tree as what is under
 * it.
 *
 * The same url shape serves both -- `/sets/thyroid` and `/sets/pharm/exam-3`
 * -- because both are things you study, and splitting them into two routes
 * would mean two of every page beneath them. What differs is only what there
 * is to show: a set has rows, a node has children.
 */
export async function DeckView({
  deck, sets, userId,
}: {
  deck: Deck;
  sets: TreeSet[];
  userId: string;
}) {
  const here = deckHref(deck.path);
  const memberIds = sets
    .filter((set) => deck.members.some((member) => member.slug === set.slug))
    .map((set) => set.id);
  const [progress, bySet] = await Promise.all([
    progressOfSets(userId, memberIds),
    progressBySet(userId),
  ]);

  const { set, defs, sources, extras } = deck.source;
  const columns = defs.filter((def) => def.key !== set.identityKey);
  const node = deck.kind === 'scope' ? findNode(buildScopeTree(sets), deck.path) : null;

  // Sequences are shown in their own order and apart from the table: the order
  // *is* the content, and sorting them alphabetically among the others would
  // destroy the only thing they carry.
  const inSequence = sources.filter((item) => extras.get(item.slug)?.sequence);
  const plain = sources.filter((item) => !extras.get(item.slug)?.sequence);

  const sequences = new Map<string, typeof sources>();
  for (const item of inSequence) {
    const name = extras.get(item.slug)!.sequence!;
    sequences.set(name, [...(sequences.get(name) ?? []), item]);
  }
  for (const [, members] of sequences) {
    members.sort((a, b) =>
      (extras.get(a.slug)!.sequenceOrder ?? 0) - (extras.get(b.slug)!.sequenceOrder ?? 0));
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-xs text-[var(--muted)]">
        <Link href="/sets" className="underline">Class sets</Link>
        {deck.trail.map((step) => (
          <span key={step.href}>
            {' · '}
            <Link href={step.href} className="underline">{step.label}</Link>
          </span>
        ))}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{deck.title}</h1>

      <p className="mt-2 text-sm">
        <Link href={studyHref(deck.path, 'flashcards')} className="text-[var(--accent)] underline">
          Flashcards
        </Link>
        {' · '}
        <Link href={studyHref(deck.path, 'quiz')} className="text-[var(--accent)] underline">
          Quiz
        </Link>
        <span className="ml-2 text-xs text-[var(--muted)]">
          {deck.kind === 'scope' && `${deck.members.length} set${deck.members.length === 1 ? '' : 's'}, `}
          {sources.length} row{sources.length === 1 ? '' : 's'}, {columns.length} column
          {columns.length === 1 ? '' : 's'}
          {progress.scheduled > 0 && ` · ${progress.due} of ${progress.scheduled} cards due`}
        </span>
      </p>

      {/* What the merge could not keep. Said here rather than left to be
          noticed as a short session six weeks later. */}
      {deck.notes.length > 0 && (
        <ul className="mt-4 space-y-1 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          {deck.notes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      )}

      {node && node.children.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold tracking-tight">Inside this</h2>
          <ul className="mt-2 divide-y divide-[var(--border)] rounded border border-[var(--border)]">
            {node.children.map((child) => (
              <NodeRow key={child.path.join('/')} node={child} progress={bySet} />
            ))}
          </ul>
        </section>
      )}

      {deck.kind === 'scope' && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold tracking-tight">
            {deck.members.length} set{deck.members.length === 1 ? '' : 's'} in this deck
          </h2>
          <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {deck.members.map((member) => (
              <li key={member.slug}>
                <Link href={deckHref([member.slug])} className="text-[var(--accent)] underline">
                  {member.name}
                </Link>
                <span className="text-xs text-[var(--muted)]"> {member.items}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Studied together: a column these sets share draws its wrong answers from all of them,
            which is the reason to sit a unit rather than a set.
          </p>
        </section>
      )}

      {plain.length > 0 && (
        <div className="mt-6 overflow-x-auto rounded border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2 font-medium">{set.identityLabel}</th>
                {columns.map((def) => (
                  <th key={def.key} className="px-3 py-2 font-medium">{def.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plain.map((item) => {
                const extra = extras.get(item.slug);
                return (
                  <tr key={item.slug} className="border-t border-[var(--border)] align-top">
                    <td className="px-3 py-2 font-medium">
                      {item.generic}
                      {extra && extra.aliases.length > 0 && (
                        <span className="block text-xs font-normal text-[var(--muted)]">
                          {extra.aliases.join(', ')}
                        </span>
                      )}
                      {extra?.recallOnly && (
                        <span className="block text-xs font-normal text-[var(--muted)]">
                          cards only
                        </span>
                      )}
                    </td>
                    {columns.map((def) => (
                      <td key={def.key} className="px-3 py-2">
                        {cellLines(item.values[def.key]?.value).map((line, index) => (
                          // A line of one answer, as a text node. The `<br>` the
                          // author wrote is recognised and discarded, never passed
                          // through -- accepting one tag from an imported file is
                          // how a format grows an XSS hole.
                          <span key={index} className="block">{line}</span>
                        ))}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {[...sequences].map(([name, members]) => (
        <section key={name} className="mt-8">
          <h2 className="text-sm font-semibold tracking-tight">{name}</h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            In order. A step&rsquo;s wrong answers are the other steps in its own sequence, never a
            mechanism borrowed from elsewhere.
          </p>
          <ol className="mt-2 divide-y divide-[var(--border)] rounded border border-[var(--border)]">
            {members.map((item) => (
              <li key={item.slug} className="flex gap-3 px-3 py-2">
                <span className="tabular-nums text-xs text-[var(--muted)]">
                  {extras.get(item.slug)?.sequenceOrder}
                </span>
                <div>
                  <p className="text-sm font-medium">{item.generic}</p>
                  {columns.map((def) => {
                    const lines = cellLines(item.values[def.key]?.value);
                    if (lines.length === 0) return null;
                    return (
                      <p key={def.key} className="text-sm text-[var(--muted)]">
                        {lines.map((line, index) => (
                          <span key={index} className="block">{line}</span>
                        ))}
                      </p>
                    );
                  })}
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </main>
  );
}
