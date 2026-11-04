import Link from 'next/link';
import { groupFieldDefs, listFieldDefs } from '@/lib/fields/registry';
import { deleteFieldAction, restoreFieldAction } from './actions';

export const metadata = { title: 'Fields — Enkephalin' };

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

      {groupFieldDefs(active).map(([group, fields]) => (
        <section key={group} className="mt-10">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">{group}</h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {fields.map((field) => (
              <li key={field.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
                <Link href={`/admin/fields/${field.id}`} className="text-[var(--accent)] underline">
                  {field.label}
                </Link>
                <code className="text-xs text-[var(--muted)]">{field.key}</code>
                <span className="text-xs text-[var(--muted)]">{field.dataType}</span>
                {field.yearLevels.length > 0 && (
                  <span className="text-xs text-[var(--muted)]">{field.yearLevels.join(' · ')}</span>
                )}
                {field.blankMeansNone && (
                  <span className="text-xs text-[var(--muted)]">blank means none</span>
                )}
                {!field.isQuizzable && <span className="text-xs text-[var(--muted)]">not quizzed</span>}

                <span className="ml-auto flex items-center gap-3 text-xs">
                  {field.isCore ? (
                    <span className="text-[var(--muted)]">core</span>
                  ) : (
                    <form action={deleteFieldAction}>
                      <input type="hidden" name="id" value={field.id} />
                      <button type="submit" className="pill pill-xs pill-danger">Remove</button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}

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
