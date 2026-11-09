import { requireAdmin } from '@/lib/session';
import { listSets, setDeletePreviews } from '@/lib/sets/import';
import { deleteSetAction, importSetAction } from './actions';
import { ImportForm } from './import-form';
import { SetList } from './set-list';

export const metadata = { title: 'Imported sets' };
export const dynamic = 'force-dynamic';

export default async function AdminSetsPage() {
  await requireAdmin();
  const [sets, previews] = await Promise.all([listSets(), setDeletePreviews()]);
  const rows = sets.map((set) => ({
    ...set,
    preview: previews.get(set.id) ?? { items: set.items, fields: set.fields, cards: 0, answers: 0 },
  }));

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

      {rows.length > 0 && <SetList rows={rows} remove={deleteSetAction} />}
    </main>
  );
}
