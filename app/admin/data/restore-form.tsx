'use client';

import { useActionState, useState } from 'react';
import type { RestoreState } from './actions';

const control = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

export function RestoreForm({ action }: { action: (formData: FormData) => Promise<RestoreState> }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: RestoreState | null, formData: FormData) => action(formData),
    null,
  );
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <div>
        <label htmlFor="backup" className="block text-sm font-medium">Backup file</label>
        <input
          id="backup" name="backup" type="file" accept="application/json,.json" required
          className={control}
        />
      </div>

      <div>
        <label htmlFor="mode" className="block text-sm font-medium">What to do with it</label>
        <select
          id="mode" name="mode" value={mode}
          onChange={(event) => setMode(event.target.value as 'merge' | 'replace')}
          className={control}
        >
          <option value="merge">Merge — write the file over what matches, keep everything else</option>
          <option value="replace">Replace — also delete drugs the file does not contain</option>
        </select>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {mode === 'merge'
            ? 'For getting work back after an accident. A drug not in the file is left exactly as it is.'
            : 'For moving a database or undoing a bad bulk edit. Deleting a drug takes its brands, indications, dosing and every schedule anyone had built on it.'}
        </p>
      </div>

      {mode === 'replace' && (
        <div>
          <label htmlFor="confirm" className="block text-sm font-medium">
            Type REPLACE to confirm
          </label>
          <input id="confirm" name="confirm" autoComplete="off" className={control} />
        </div>
      )}

      {state && (
        <div
          className="rounded border p-3 text-sm"
          style={{ borderColor: state.ok ? 'var(--border)' : 'var(--flagged)' }}
        >
          {state.ok ? (
            <>
              <p className="font-medium">Restored ({state.report.mode}).</p>
              <ul className="mt-2 space-y-0.5 text-[var(--muted)]">
                <li>{state.report.drugsInserted} drugs added, {state.report.drugsUpdated} updated
                  {state.report.drugsDeleted > 0 && `, ${state.report.drugsDeleted} deleted`}</li>
                <li>{state.report.tagsInserted} tags, {state.report.fieldDefsWritten} field definitions</li>
                {state.report.progressRestored.length > 0 && (
                  <li>progress restored for {state.report.progressRestored.join(', ')}</li>
                )}
                {state.report.progressSkipped.length > 0 && (
                  <li>
                    no account here for {state.report.progressSkipped.join(', ')} — their progress is
                    still in the file, so invite them and restore it again
                  </li>
                )}
              </ul>
            </>
          ) : (
            state.message
          )}
        </div>
      )}

      <button
        type="submit" disabled={pending}
        className="rounded bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)] disabled:opacity-60"
      >
        {pending ? 'Restoring…' : 'Restore from this file'}
      </button>
    </form>
  );
}
