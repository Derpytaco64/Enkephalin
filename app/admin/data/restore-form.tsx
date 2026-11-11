'use client';

import { useActionState, useState } from 'react';
import { submitTo } from '@/app/_components/submit';
import { asMegabytes, MAX_BACKUP_BYTES } from '@/lib/data/limits';
import type { RestoreState } from './actions';

const control = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

/**
 * The size above which a failed upload is probably a size limit.
 *
 * One megabyte, because that is both Next's own default and nginx's
 * `client_max_body_size`, and the guess only has to be good enough to point at
 * the right thing.
 */
const COMMON_PROXY_CAP = 1024 * 1024;

/**
 * Hand it a backup, say what to do with it, press the button.
 *
 * **Two things here are about a failure that said nothing.** A backup travels
 * as a server-action body, and the parser in front of the action has a size
 * limit of its own -- 1 MB until `next.config.ts` said otherwise, which the
 * export crossed on 2026-11-10. The request never reached the action, so the
 * action's careful refusal never ran, and the screen sat there.
 *
 * So the size is checked here too, against the same number the action uses,
 * and **anything thrown is caught and shown**. A server action that rejects --
 * a body too large for the framework, or for a reverse proxy with a cap of its
 * own, or a connection that died mid-upload -- otherwise throws inside the
 * transition, where React logs it to a console nobody has open and the form
 * reports nothing at all. A restore is the thing you reach for on a bad day;
 * it has to say what went wrong on that day.
 */
export function RestoreForm({ action }: { action: (formData: FormData) => Promise<RestoreState> }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: RestoreState | null, formData: FormData): Promise<RestoreState> => {
      try {
        return await action(formData);
      } catch (error) {
        const file = formData.get('backup');
        const size = file instanceof File ? file.size : 0;
        const why = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          // The action catches its own failures and reports them, so reaching
          // here means the request itself did not complete -- and over a
          // megabyte, a size limit somewhere in front is the first thing to
          // check. Said as a thing to check, not as a diagnosis: this is the
          // one branch that cannot see what actually happened.
          message: size > COMMON_PROXY_CAP
            ? `The request did not complete (${(size / 1024 / 1024).toFixed(1)} MB uploaded). `
              + 'Worth checking a size limit in front of the app -- nginx allows 1 MB unless '
              + `told otherwise, Caddy has none of its own. (${why})`
            : `The request did not complete. (${why})`,
        };
      }
    },
    null,
  );
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [tooBig, setTooBig] = useState<number | null>(null);

  return (
    <form onSubmit={submitTo(formAction)} className="mt-4 space-y-4">
      <div>
        <label htmlFor="backup" className="block text-sm font-medium">Backup file</label>
        <input
          id="backup" name="backup" type="file" accept="application/json,.json" required
          className={control}
          onChange={(event) => {
            const file = event.target.files?.[0];
            setTooBig(file && file.size > MAX_BACKUP_BYTES ? file.size : null);
          }}
        />
        {tooBig !== null && (
          <p className="mt-1 text-xs text-[var(--danger)]">
            That file is {(tooBig / 1024 / 1024).toFixed(1)} MB and the limit is{' '}
            {asMegabytes(MAX_BACKUP_BYTES)}. Said here rather than after the upload, because an
            upload that large fails without explaining itself.
          </p>
        )}
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
                {state.report.quizAttemptsRestored > 0 && (
                  <li>
                    {state.report.quizAttemptsRestored} quizzes with{' '}
                    {state.report.quizAnswersRestored} answers
                    {state.report.quizAnswersOrphaned > 0
                      && `, ${state.report.quizAnswersOrphaned} dropped for a drug that is not here`}
                  </li>
                )}
                {(state.report.auditRestored > 0 || state.report.auditSkipped > 0) && (
                  <li>
                    {state.report.auditRestored} audit entries written
                    {state.report.auditSkipped > 0
                      && `, ${state.report.auditSkipped} already here`}
                  </li>
                )}
                {/* A dose the file could not tell from another, kept anyway.
                    Named because it is a change to the data nobody asked for,
                    and re-exporting from the source undoes the need for it. */}
                {state.report.dosingRekeyed.length > 0 && (
                  <li>
                    {state.report.dosingRekeyed.join(', ')} had two doses this file cannot tell
                    apart &mdash; it predates doses carrying their indication &mdash; so the second
                    is kept as another alternative. Re-export from the source to get the
                    indications back.
                  </li>
                )}
                {/* Said out loud rather than left to be noticed: the history is
                    intact, but those rows no longer say who. */}
                {state.report.auditActorsUnmatched.length > 0 && (
                  <li>
                    audit entries by {state.report.auditActorsUnmatched.join(', ')} kept without an
                    actor — no account here to attribute them to
                  </li>
                )}
              </ul>
              {/* A drug the database would not take. The rest of the file went
                  in, which is the point of reporting rather than stopping. */}
              {state.report.problems.length > 0 && (
                <>
                  <p className="mt-2 font-medium text-[var(--danger)]">
                    {state.report.problems.length} drug
                    {state.report.problems.length === 1 ? '' : 's'} could not be written. Everything
                    else in the file was.
                  </p>
                  <ul className="mt-1 space-y-0.5 font-mono text-xs text-[var(--danger)]">
                    {state.report.problems.map((problem) => <li key={problem}>{problem}</li>)}
                  </ul>
                </>
              )}
            </>
          ) : (
            state.message
          )}
        </div>
      )}

      <button
        type="submit" disabled={pending || tooBig !== null}
        className="btn btn-primary"
      >
        {pending ? 'Restoring…' : 'Restore from this file'}
      </button>
    </form>
  );
}
