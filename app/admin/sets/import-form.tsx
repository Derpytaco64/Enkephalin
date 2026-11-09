'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { submitTo } from '@/app/_components/submit';
import type { ImportReport } from '@/lib/sets/import';
import type { FileResult, ImportState } from './actions';

const control = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
const panel = 'rounded border border-[var(--border)] bg-[var(--surface)] p-3';

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
  const [chosen, setChosen] = useState(0);

  const files = state?.kind === 'results' ? state.files : [];
  const imported = files.filter((file) => file.ok).length;
  const failed = files.length - imported;

  return (
    <>
      <form onSubmit={submitTo(formAction)} className="mt-4 space-y-4">
        <div>
          <label htmlFor="file" className="block text-sm font-medium">Set files</label>
          <input
            id="file" name="file" type="file" multiple accept="application/json,.json"
            onChange={(event) => setChosen(event.target.files?.length ?? 0)}
            className={control}
          />
          <p className="mt-1 text-xs text-[var(--muted)]">
            {chosen > 1
              ? `${chosen} files. Each is imported on its own, so one bad file does not stop the rest.`
              : 'Pick as many as you like — a whole unit of lecture decks at once.'}
          </p>
        </div>

        <div>
          <label htmlFor="pasted" className="block text-sm font-medium">Or paste one</label>
          <textarea
            id="pasted" name="pasted" rows={8} spellCheck={false}
            placeholder={'{\n  "format": "enkephalin.set/1",\n  ...\n}'}
            className={`${control} font-mono text-xs`}
          />
          <p className="mt-1 text-xs text-[var(--muted)]">
            A paste wins over the chosen files, since it is the one you just put there.
          </p>
        </div>

        <div>
          <label htmlFor="mode" className="block text-sm font-medium">If a set is already here</label>
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
            {' '}Applies to every file in the batch.
          </p>
        </div>

        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Importing…' : chosen > 1 ? `Import ${chosen} files` : 'Import'}
        </button>
      </form>

      {state?.kind === 'nothing' && (
        <p className={`mt-4 text-sm ${panel}`}>{state.message}</p>
      )}

      {/* A line across the batch before the per-file detail: with nine files
          the question is "did they all go in", and counting cards to find out
          is worse than being told. Shown only for a real batch -- for one
          file the card below says everything. */}
      {files.length > 1 && (
        <p className={`mt-4 text-sm ${panel}`}>
          <span className="font-medium">
            {imported} of {files.length} imported
          </span>
          {failed > 0 && (
            <span className="text-[var(--muted)]">
              {' · '}{failed} not imported, listed below
            </span>
          )}
        </p>
      )}

      <div className="mt-4 space-y-4">
        {/* Index in the key as well as the name: two files picked from
            different folders can share a filename, and a duplicate React key
            would drop one card from the report. */}
        {files.map((file, index) => (
          <FileCard key={`${index}:${file.name}`} file={file} many={files.length > 1} />
        ))}
      </div>
    </>
  );
}

/** One file's outcome. The filename leads, because that is what you scan for. */
function FileCard({ file, many }: { file: FileResult; many: boolean }) {
  return (
    <div className={panel}>
      {many && (
        <p className="mb-2 font-mono text-xs text-[var(--muted)]">{file.name}</p>
      )}

      {!file.ok && 'message' in file && <p className="text-sm">{file.message}</p>}

      {!file.ok && 'problems' in file && (
        <>
          <p className="text-sm font-medium">
            Not imported. {file.problems.length} thing
            {file.problems.length === 1 ? '' : 's'} to fix:
          </p>
          {/* Every problem at once. Fixing a generated file one error per run
              is how somebody gives up on a format. */}
          <ul className="mt-2 space-y-1 text-sm">
            {file.problems.map((problem) => (
              <li key={`${problem.at}:${problem.message}`}>
                <code className="text-xs text-[var(--muted)]">{problem.at}</code>{' '}
                {problem.message}
              </li>
            ))}
          </ul>
        </>
      )}

      {file.ok && <Report report={file.report} />}
    </div>
  );
}

function Report({ report }: { report: ImportReport }) {
  return (
    <>
      <p className="text-sm font-medium">
        {report.created ? 'Imported' : 'Updated'}{' '}
        <Link href={`/sets/${report.slug}`} className="text-[var(--accent)] underline">
          {report.name}
        </Link>
      </p>

      <ul className="mt-2 space-y-0.5 text-sm text-[var(--muted)]">
        {report.itemsInserted > 0 && <li>{report.itemsInserted} rows added</li>}
        {report.itemsUpdated > 0 && <li>{report.itemsUpdated} rows updated</li>}
        {report.itemsDeleted > 0 && <li>{report.itemsDeleted} rows deleted</li>}
        {report.itemsKept.length > 0 && (
          <li>{report.itemsKept.length} rows left as you had edited them</li>
        )}
        {report.fieldsInserted > 0 && <li>{report.fieldsInserted} columns added</li>}
        {report.fieldsKept.length > 0 && (
          <li>columns left as you had them: {report.fieldsKept.join(', ')}</li>
        )}
        {report.fieldsLeftDeleted.length > 0 && (
          <li>still deleted: {report.fieldsLeftDeleted.join(', ')}</li>
        )}
      </ul>

      {/* What it can be quizzed on, said now rather than six weeks later when
          a question comes out guessable. */}
      <table className="mt-3 w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-[var(--muted)]">
            <th className="py-1 font-medium">Column</th>
            <th className="py-1 font-medium">Distinct answers</th>
            <th className="py-1 font-medium">Quiz</th>
          </tr>
        </thead>
        <tbody>
          {report.columns.map((column) => (
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

      {report.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-[var(--muted)]">
          {report.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      <p className="mt-3 text-sm">
        <Link href={`/sets/${report.slug}/flashcards`} className="text-[var(--accent)] underline">
          Flashcard it
        </Link>
        {' · '}
        <Link href={`/sets/${report.slug}/quiz`} className="text-[var(--accent)] underline">
          Quiz it
        </Link>
      </p>
    </>
  );
}
