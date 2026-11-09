import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { listSets } from '@/lib/sets/import';
import { importSetAction } from './actions';
import { ImportForm } from './import-form';

export const metadata = { title: 'Imported sets' };
export const dynamic = 'force-dynamic';

export default async function AdminSetsPage() {
  await requireAdmin();
  const sets = await listSets();

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Imported sets</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        A set is a small table of study material that is not the top-drugs list — one topic, its
        own columns, its rows as subjects. The quiz draws every wrong answer from another row&rsquo;s
        answer to the same column, which is why the format is a table and not a pile of cards.
      </p>
      <p className="mt-2 text-sm text-[var(--muted)]">
        <code className="text-xs">docs/set-format.md</code> is the authoring guide. Hand it to a
        model along with your lecture notes and import what comes back; nothing is half-imported, so
        a file with a problem in it tells you every problem and changes nothing.
      </p>

      <ImportForm action={importSetAction} />

      <h2 className="mt-10 text-lg font-semibold tracking-tight">
        {sets.length === 0 ? 'Nothing imported yet' : `${sets.length} set${sets.length === 1 ? '' : 's'}`}
      </h2>

      {sets.length > 0 && (
        <ul className="mt-3 divide-y divide-[var(--border)] rounded border border-[var(--border)]">
          {sets.map((set) => (
            <li key={set.id} className="px-3 py-2.5">
              <Link href={`/sets/${set.slug}`} className="font-medium text-[var(--accent)] underline">
                {set.name}
              </Link>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                {[set.course, set.exam, set.unit, set.topic].filter(Boolean).join(' · ')}
                {[set.course, set.exam, set.unit, set.topic].some(Boolean) && ' — '}
                {set.items} row{set.items === 1 ? '' : 's'}, {set.fields} column
                {set.fields === 1 ? '' : 's'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
