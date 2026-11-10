import Link from 'next/link';
import { groupFieldDefs, listFieldDefs } from '@/lib/fields/registry';
import {
  deleteFieldAction, reorderFieldsAction, restoreFieldAction, setFieldFlagAction,
} from './actions';
import { FieldList } from './field-list';

export const metadata = { title: 'Fields' };

export default async function FieldsPage() {
  const all = await listFieldDefs({ includeDeleted: true });
  const active = all.filter((field) => !field.deletedAt);
  const removed = all.filter((field) => field.deletedAt);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Fields</h1>
        <Link href="/admin/fields/new" className="pill pill-edge">
          New field
        </Link>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Fields are rows, not columns. Adding one needs no migration and no deploy.
      </p>

      {/* Flattened through `groupFieldDefs` rather than passed in `sortOrder`
          order, because those two are not the same list: the numbers interleave
          the groups (`ae` at 0, `generic` at 10, `indication` at 30) and a
          profile reads them grouped, so the grouped order is the appearance
          order and the raw one is a detail of how it got there. Handing the
          list over already grouped also means each group is one contiguous run
          in there, which is what lets a row move by its neighbour. The first
          reorder renumbers the lot and the two agree from then on. */}
      <FieldList
        fields={groupFieldDefs(active).flatMap(([, fields]) => fields)}
        reorder={reorderFieldsAction}
        setFlag={setFieldFlagAction}
        remove={deleteFieldAction}
      />

      {removed.length > 0 && (
        <section className="mt-12">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Removed</h2>
          <p className={'mt-1 text-xs text-[var(--muted)]'}>
            Values are kept. Restoring a field brings them back as they were.
          </p>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {removed.map((field) => (
              <li key={field.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
                <span>{field.label}</span>
                <code className="text-xs text-[var(--muted)]">{field.key}</code>
                <form action={restoreFieldAction} className="ml-auto">
                  <input type="hidden" name="id" value={field.id} />
                  <button type="submit" className="pill pill-xs">Restore</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
