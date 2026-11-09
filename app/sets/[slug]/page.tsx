import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { loadSetStudy } from '@/lib/sets/session';
import { cellLines } from '@/lib/sets/render';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const source = await loadSetStudy(slug);
  return { title: source?.set.name ?? 'Set' };
}

/**
 * The set as the table it is.
 *
 * One row per subject, one column per declared column, which is the shape the
 * material was authored in and the shape that makes the questions work. A cell
 * written in several parts with `<br>` is shown as several lines -- as plain
 * text nodes, never as injected HTML.
 */
export default async function SetPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireUser();
  const { slug } = await params;
  const source = await loadSetStudy(slug);
  if (!source) notFound();

  const { set, defs, sources, extras } = source;
  const columns = defs.filter((def) => def.key !== set.identityKey);
  const scope = [set.course, set.exam, set.unit, set.topic].filter(Boolean);

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
        <Link href="/sets" className="underline">Sets</Link>
        {scope.length > 0 && ` · ${scope.join(' · ')}`}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{set.name}</h1>

      <p className="mt-2 text-sm">
        <Link href={`/sets/${set.slug}/flashcards`} className="text-[var(--accent)] underline">
          Flashcards
        </Link>
        {' · '}
        <Link href={`/sets/${set.slug}/quiz`} className="text-[var(--accent)] underline">
          Quiz
        </Link>
        <span className="ml-2 text-xs text-[var(--muted)]">
          {sources.length} row{sources.length === 1 ? '' : 's'}, {columns.length} column
          {columns.length === 1 ? '' : 's'}
        </span>
      </p>

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
