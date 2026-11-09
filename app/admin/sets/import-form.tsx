'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { submitTo } from '@/app/_components/submit';
import type { ImportState } from './actions';

const control = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

export function ImportForm({
  action,
}: {
  action: (formData: FormData) => Promise<ImportState>;
}) {
  const [state, formAction, pending] = useActionState(
    async (_previous: ImportState | null, formData: FormData) => action(formData),
    null,
  );
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');

  return (
    <>
      <form onSubmit={submitTo(formAction)} className="mt-4 space-y-4">
        <div>
          <label htmlFor="file" className="block text-sm font-medium">Set file</label>
          <input
            id="file" name="file" type="file" accept="application/json,.json"
            className={control}
          />
        </div>

        <div>
          <label htmlFor="pasted" className="block text-sm font-medium">Or paste it</label>
          <textarea
            id="pasted" name="pasted" rows={8} spellCheck={false}
            placeholder={'{\n  "format": "enkephalin.set/1",\n  ...\n}'}
            className={`${control} font-mono text-xs`}
          />
          <p className="mt-1 text-xs text-[var(--muted)]">
            A paste wins over a chosen file, since it is the one you just put there.
          </p>
        </div>

        <div>
          <label htmlFor="mode" className="block text-sm font-medium">If this set is already here</label>
          <select
            id="mode" name="mode" value={mode}
            onChange={(event) => setMode(event.target.value as 'merge' | 'replace')}
            className={control}
          >
            <option value="merge">Merge — leave anything the file does not mention alone</option>
            <option value="replace">Replace — also delete the rows the file no longer has</option>
          </select>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {mode === 'merge'
              ? 'Rows and columns you have edited yourself are kept, and a column you deleted stays deleted.'
              : 'The file becomes the whole truth: your own edits are overwritten, a deleted column comes back, and a row the file dropped is deleted along with any schedule built on it.'}
          </p>
        </div>

        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Importing…' : 'Import'}
        </button>
      </form>

      {state?.ok === false && 'message' in state && (
        <p className="mt-4 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          {state.message}
        </p>
      )}

      {state?.ok === false && 'problems' in state && (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="text-sm font-medium">
            Nothing was imported. {state.problems.length} thing
            {state.problems.length === 1 ? '' : 's'} to fix:
          </p>
          {/* Every problem at once. Fixing a generated file one error per run is
              how somebody gives up on a format. */}
          <ul className="mt-2 space-y-1 text-sm">
            {state.problems.map((problem) => (
              <li key={`${problem.at}:${problem.message}`}>
                <code className="text-xs text-[var(--muted)]">{problem.at}</code>{' '}
                {problem.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {state?.ok && (
        <div className="mt-4 rounded border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="text-sm font-medium">
            {state.report.created ? 'Imported' : 'Updated'}{' '}
            <Link href={`/sets/${state.report.slug}`} className="text-[var(--accent)] underline">
              {state.report.name}
            </Link>
          </p>

          <ul className="mt-2 space-y-0.5 text-sm text-[var(--muted)]">
            {state.report.itemsInserted > 0 && <li>{state.report.itemsInserted} rows added</li>}
            {state.report.itemsUpdated > 0 && <li>{state.report.itemsUpdated} rows updated</li>}
            {state.report.itemsDeleted > 0 && <li>{state.report.itemsDeleted} rows deleted</li>}
            {state.report.itemsKept.length > 0 && (
              <li>{state.report.itemsKept.length} rows left as you had edited them</li>
            )}
            {state.report.fieldsInserted > 0 && <li>{state.report.fieldsInserted} columns added</li>}
            {state.report.fieldsKept.length > 0 && (
              <li>
                columns left as you had them: {state.report.fieldsKept.join(', ')}
              </li>
            )}
            {state.report.fieldsLeftDeleted.length > 0 && (
              <li>still deleted: {state.report.fieldsLeftDeleted.join(', ')}</li>
            )}
          </ul>

          {/* What it can be quizzed on, said now rather than six weeks later
              when a question comes out guessable. */}
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--muted)]">
                <th className="py-1 font-medium">Column</th>
                <th className="py-1 font-medium">Distinct answers</th>
                <th className="py-1 font-medium">Quiz</th>
              </tr>
            </thead>
            <tbody>
              {state.report.columns.map((column) => (
                <tr key={column.key} className="border-t border-[var(--border)]">
                  <td className="py-1">{column.label}</td>
                  <td className="py-1 tabular-nums">{column.distinct}</td>
                  <td className="py-1 text-[var(--muted)]">
                    {!column.asks ? 'context only' : column.quizzable ? 'yes' : 'flashcards only'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {state.report.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-[var(--muted)]">
              {state.report.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          )}

          <p className="mt-3 text-sm">
            <Link href={`/sets/${state.report.slug}/flashcards`} className="text-[var(--accent)] underline">
              Flashcard it
            </Link>
            {' · '}
            <Link href={`/sets/${state.report.slug}/quiz`} className="text-[var(--accent)] underline">
              Quiz it
            </Link>
          </p>
        </div>
      )}
    </>
  );
}
