import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { listSets } from '@/lib/sets/import';

export const metadata = { title: 'Sets' };
export const dynamic = 'force-dynamic';

/**
 * Grouped by course and exam, because that is how somebody decides what to
 * study: not "which of my eleven sets" but "what is on Exam 3".
 */
export default async function SetsPage() {
  await requireUser();
  const sets = await listSets();

  const groups = new Map<string, typeof sets>();
  for (const set of sets) {
    const key = [set.course, set.exam].filter(Boolean).join(' · ') || 'Everything else';
    groups.set(key, [...(groups.get(key) ?? []), set]);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Sets</h1>

      {sets.length === 0 ? (
        <p className="mt-4 text-[var(--muted)]">
          Nothing imported yet. A set is a table of study material — one topic, its own columns.{' '}
          <Link href="/admin/sets" className="text-[var(--accent)] underline">Import one</Link>.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {sets.length} set{sets.length === 1 ? '' : 's'} beside the{' '}
            <Link href="/drugs" className="text-[var(--accent)] underline">top-drugs list</Link>.
          </p>

          {[...groups].map(([heading, rows]) => (
            <section key={heading} className="mt-6">
              <h2 className="text-sm font-semibold tracking-tight">{heading}</h2>
              <ul className="mt-2 divide-y divide-[var(--border)] rounded border border-[var(--border)]">
                {rows.map((set) => (
                  <li key={set.id} className="flex flex-wrap items-baseline gap-x-3 px-3 py-2.5">
                    <Link
                      href={`/sets/${set.slug}`}
                      className="font-medium text-[var(--accent)] underline"
                    >
                      {set.name}
                    </Link>
                    <span className="text-xs text-[var(--muted)]">
                      {[set.unit, set.topic].filter(Boolean).join(' · ')}
                      {[set.unit, set.topic].some(Boolean) && ' — '}
                      {set.items} row{set.items === 1 ? '' : 's'}
                    </span>
                    <span className="ml-auto text-xs">
                      <Link
                        href={`/sets/${set.slug}/flashcards`}
                        className="text-[var(--accent)] underline"
                      >
                        Cards
                      </Link>
                      {' · '}
                      <Link
                        href={`/sets/${set.slug}/quiz`}
                        className="text-[var(--accent)] underline"
                      >
                        Quiz
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </main>
  );
}
