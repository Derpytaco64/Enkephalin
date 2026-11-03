'use client';

import { useState } from 'react';
import type { DeletePreview, MergePreview } from '@/lib/drugs/merge';
import type { Result } from '@/lib/drugs/mutations';

type Candidate = { slug: string; generic: string; drugClass: string | null };

/**
 * The two operations that cannot be undone.
 *
 * Both show what they are about to do before they will do it, and the counts
 * come from the server rather than from the page's own guess -- a merge reaches
 * brands, indication links, tags, dosing, every SRS schedule anyone holds and
 * every quiz answer anyone has given, and no amount of warning text conveys
 * that as well as "3 answers move".
 *
 * Deliberately at the bottom of the editor and deliberately plain: an admin
 * arrives here having noticed a duplicate while reading, and the thing that
 * stops a mistake is the preview, not a red box.
 */
export function DangerZone({
  slug,
  generic,
  deletePreview,
  candidates,
  previewMerge,
  merge,
  remove,
}: {
  slug: string;
  generic: string;
  deletePreview: DeletePreview;
  candidates: Candidate[];
  previewMerge: (formData: FormData) => Promise<Result<MergePreview>>;
  merge: (formData: FormData) => Promise<Result>;
  remove: (formData: FormData) => Promise<Result>;
}) {
  const [into, setInto] = useState('');
  const [plan, setPlan] = useState<MergePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const control = 'h-9 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';
  const button = 'rounded border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60';

  // Generic, so a preview's value survives the call. The trailing comma on
  // the type parameter is what stops TSX reading it as a tag.
  const run = async <T,>(action: () => Promise<Result<T>>): Promise<Result<T>> => {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    // A successful merge or delete redirects, so reaching here at all with
    // ok means only the preview did.
    if (!result.ok) setError(result.message);
    return result;
  };

  const askPlan = async (target: string) => {
    setPlan(null);
    if (target === '') return;

    const data = new FormData();
    data.set('from', slug);
    data.set('into', target);
    const result = await run(() => previewMerge(data));
    if (result.ok) setPlan(result.value ?? null);
  };

  const rows = (preview: MergePreview) => [
    ['Brands', preview.brands.moved.join(', ') || 'none',
      preview.brands.dropped.length > 0 ? `${preview.brands.dropped.join(', ')} already there` : ''],
    ['Indications', preview.indications.moved.join(', ') || 'none',
      preview.indications.dropped.length > 0 ? `${preview.indications.dropped.join(', ')} already there` : ''],
    ['Lists', `${preview.tags.moved} moved`, preview.tags.dropped > 0 ? `${preview.tags.dropped} already there` : ''],
    ['Dosing', preview.dosing.moved > 0 ? `${preview.dosing.moved} moved` : 'kept as it is',
      preview.dosing.dropped > 0 ? `${preview.dosing.dropped} discarded` : ''],
    ['Empty fields filled', preview.fieldsFilled.concat(preview.columnsFilled).join(', ') || 'none', ''],
    ['Study schedules', `${preview.cards.moved} moved`,
      preview.cards.dropped > 0 ? `${preview.cards.dropped} already on the survivor` : ''],
    ['Quiz answers', `${preview.answers} moved`, ''],
  ] as const;

  return (
    <section className="mt-12 border-t border-[var(--border)] pt-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
        Delete or merge
      </h2>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Neither can be undone. <span className="font-mono">/admin/data</span> exports the whole
        database as one file, which is the only way back.
      </p>

      {error !== null && <p className="mt-4 text-sm text-[var(--danger)]">{error}</p>}

      {/* ---------------------------------------------------------- merge -- */}
      <div className="mt-6 rounded border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium">Merge into another drug</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {generic} is folded into the drug you pick and then deleted. The survivor keeps every
          answer it already has; this one fills its gaps and hands over anything it lacks entirely.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="into" className="text-sm">Survivor</label>
          <select
            id="into" value={into} className={`${control} min-w-56 flex-1`}
            onChange={(event) => {
              setInto(event.target.value);
              void askPlan(event.target.value);
            }}
          >
            <option value="">Pick a drug…</option>
            {candidates.map((row) => (
              <option key={row.slug} value={row.slug}>
                {row.generic}{row.drugClass ? ` — ${row.drugClass}` : ''}
              </option>
            ))}
          </select>
        </div>

        {plan !== null && (
          <>
            <dl className="mt-4 divide-y divide-[var(--border)] text-sm">
              {rows(plan).map(([label, moved, note]) => (
                <div key={label} className="grid gap-x-4 gap-y-0.5 py-1.5 sm:grid-cols-[11rem_1fr_auto]">
                  <dt className="text-[var(--muted)]">{label}</dt>
                  <dd>{moved}</dd>
                  {note !== '' && <dd className="text-xs text-[var(--muted)] sm:text-right">{note}</dd>}
                </div>
              ))}
            </dl>

            <form
              action={async (formData: FormData) => { await run(() => merge(formData)); }}
              className="mt-4"
            >
              <input type="hidden" name="from" value={slug} />
              <input type="hidden" name="into" value={into} />
              <button type="submit" disabled={pending} className={button}>
                Merge {generic} into {plan.into.generic}
              </button>
            </form>
          </>
        )}
      </div>

      {/* --------------------------------------------------------- delete -- */}
      <div className="mt-4 rounded border border-[var(--border)] p-4">
        <h3 className="text-sm font-medium">Delete {generic}</h3>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Takes {deletePreview.brands} brand{deletePreview.brands === 1 ? '' : 's'},{' '}
          {deletePreview.indications} indication link
          {deletePreview.indications === 1 ? '' : 's'}, {deletePreview.tags} list membership
          {deletePreview.tags === 1 ? '' : 's'}, {deletePreview.regimens} dosing row
          {deletePreview.regimens === 1 ? '' : 's'}, {deletePreview.cards} study schedule
          {deletePreview.cards === 1 ? '' : 's'} and {deletePreview.answers} quiz answer
          {deletePreview.answers === 1 ? '' : 's'} with it.
          {(deletePreview.cards > 0 || deletePreview.answers > 0)
            && ' That history belongs to whoever studied it — if this is a duplicate, merge instead.'}
        </p>
        {deletePreview.indications > 0 && (
          /* The vocabulary is shared, so an indication nothing else uses is
             left behind rather than guessed at. /admin/indications lists the
             ones nothing points to any more. */
          <p className="mt-1 text-xs text-[var(--muted)]">
            An indication nothing else is for stays in the vocabulary; /admin/indications lists
            the unused ones.
          </p>
        )}

        {/* The checkbox is the whole confirmation. A second page to click
            through is a page people learn to click through. */}
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox" checked={confirmDelete}
            onChange={(event) => setConfirmDelete(event.target.checked)}
          />
          Yes, delete it and everything above
        </label>

        <form
          action={async (formData: FormData) => { await run(() => remove(formData)); }}
          className="mt-3"
        >
          <input type="hidden" name="slug" value={slug} />
          <button
            type="submit" disabled={pending || !confirmDelete}
            className={`${button} disabled:cursor-not-allowed`}
          >
            Delete {generic}
          </button>
        </form>
      </div>
    </section>
  );
}
