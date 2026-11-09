'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { submitTo } from '@/app/_components/submit';
import type { SetDeletePreview } from '@/lib/sets/import';
import type { DeleteState } from './actions';

export type SetRow = {
  id: string;
  slug: string;
  name: string;
  course: string | null;
  exam: string | null;
  unit: string | null;
  topic: string | null;
  items: number;
  fields: number;
  preview: SetDeletePreview;
};

/**
 * The imported sets, each with a way to remove it.
 *
 * **The state lives here rather than in the row**, which is the whole reason
 * this is one component and not a list of them: a successful delete revalidates
 * the page, the row unmounts, and a message held inside it would vanish with
 * the thing it was reporting on. Above the list it survives, so you find out
 * what went -- "9 rows, 31 schedules and 12 answers" -- after the row is gone.
 */
export function SetList({
  rows,
  remove,
}: {
  rows: SetRow[];
  remove: (formData: FormData) => Promise<DeleteState>;
}) {
  const [state, formAction, pending] = useActionState<DeleteState | null, FormData>(
    async (_previous, formData) => remove(formData),
    null,
  );

  return (
    <>
      {state?.ok === false && (
        <p className="mt-3 text-sm text-[var(--danger)]">{state.message}</p>
      )}
      {state?.ok && (
        <p className="mt-3 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          <span className="font-medium">Deleted {state.report.name}.</span>{' '}
          <span className="text-[var(--muted)]">
            {state.report.items} row{state.report.items === 1 ? '' : 's'} and{' '}
            {state.report.fields} column{state.report.fields === 1 ? '' : 's'} went with it
            {state.report.cards > 0 || state.report.answers > 0
              ? `, along with ${state.report.cards} study schedule${state.report.cards === 1 ? '' : 's'}`
                + ` and ${state.report.answers} quiz answer${state.report.answers === 1 ? '' : 's'}`
              : ''}
            . Re-importing the file brings the rows back, not the schedules.
          </span>
        </p>
      )}

      <ul className="mt-3 divide-y divide-[var(--border)] rounded border border-[var(--border)]">
        {rows.map((row) => (
          <li key={row.id} className="px-3 py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <Link href={`/sets/${row.slug}`} className="font-medium text-[var(--accent)] underline">
                {row.name}
              </Link>
              <span className="ml-auto text-xs">
                <Link href={`/sets/${row.slug}/flashcards`} className="text-[var(--accent)] underline">
                  Cards
                </Link>
                {' · '}
                <Link href={`/sets/${row.slug}/quiz`} className="text-[var(--accent)] underline">
                  Quiz
                </Link>
              </span>
            </div>

            <p className="mt-0.5 text-xs text-[var(--muted)]">
              {[row.course, row.exam, row.unit, row.topic].filter(Boolean).join(' · ')}
              {[row.course, row.exam, row.unit, row.topic].some(Boolean) && ' — '}
              {row.items} row{row.items === 1 ? '' : 's'}, {row.fields} column
              {row.fields === 1 ? '' : 's'}
              {' · '}
              <code>{row.slug}</code>
            </p>

            {/* Folded away: eleven open delete forms is a page you stop
                reading. The counts are inside, where the decision is made. */}
            <details className="mt-1.5">
              <summary className="cursor-pointer text-xs text-[var(--muted)]">Delete this set</summary>

              <form onSubmit={submitTo(formAction)} className="mt-2 space-y-2">
                <input type="hidden" name="slug" value={row.slug} />

                <p className="text-xs text-[var(--muted)]">
                  Takes {row.items} row{row.items === 1 ? '' : 's'}, {row.fields} column
                  {row.fields === 1 ? '' : 's'}, {row.preview.cards} study schedule
                  {row.preview.cards === 1 ? '' : 's'} and {row.preview.answers} quiz answer
                  {row.preview.answers === 1 ? '' : 's'} with it.
                  {row.preview.cards > 0 || row.preview.answers > 0
                    ? ' That history belongs to whoever studied it, and re-importing the file'
                      + ' does not bring it back.'
                    : ' Nobody has studied it yet.'}
                </p>

                {/* The checkbox is the whole confirmation, as in the drug
                    editor's danger zone: a second page to click through is a
                    page people learn to click through. */}
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" name="confirm" value="yes" />
                  Yes, delete {row.name} and everything above
                </label>

                <button type="submit" disabled={pending} className="pill pill-xs pill-danger">
                  {pending ? 'Deleting…' : 'Delete'}
                </button>
              </form>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
