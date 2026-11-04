'use client';

import Link from 'next/link';
import { useState } from 'react';
import { submitTo } from '@/app/_components/submit';
import { DosingPreview } from '@/app/drugs/dosing-preview';
import type { BenchRow } from '@/lib/dosing/bench';
import type { Result } from '@/lib/drugs/mutations';

/**
 * One drug in the review queue: what the parser read, and the two ways to
 * settle it.
 *
 * Collapsed until opened. 72 drugs with a prose box and a live readback each
 * is a page nobody scrolls, and the queue's first job is to be countable.
 *
 * The prose is the only editable thing here, because the prose is the source:
 * the rows below it are a reading of it and are replaced wholesale on save.
 * That is also why the readback is live -- the parser is pure and client-safe,
 * so what is shown while typing is the same reading the save will store, not
 * an approximation of it.
 */
export function BenchRowPanel({
  row,
  save,
  markUnique,
}: {
  row: BenchRow;
  save: (formData: FormData) => Promise<Result>;
  markUnique: (formData: FormData) => Promise<Result>;
}) {
  const [open, setOpen] = useState(false);
  const [prose, setProse] = useState(row.prose ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const run = (action: (formData: FormData) => Promise<Result>) =>
    async (formData: FormData) => {
      setPending(true);
      setError(null);
      const result = await action(formData);
      setPending(false);
      if (result.ok) setSaved(true);
      else setError(result.message);
    };

  const control = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* Opens the row in place rather than navigating, so it reads as a
            pill and not as a link; filled while it is open. */}
        <button
          type="button"
          onClick={() => { setOpen(!open); setError(null); }}
          aria-expanded={open}
          className={`pill font-medium ${open ? 'pill-on' : 'pill-soft'}`}
        >
          {row.generic}
        </button>
        {row.drugClass !== null && (
          <span className="text-xs text-[var(--muted)]">{row.drugClass}</span>
        )}
        {row.dosingUnique && (
          <span className="text-xs text-[var(--verified)]">looked at — sig is as written</span>
        )}
        {/* The reason this drug is ahead of the alphabet. Silent at zero,
            which is most of them until somebody has sat a quiz. */}
        {row.asked > 0 && (
          <span className="text-xs text-[var(--unverified)]">
            asked {row.asked} time{row.asked === 1 ? '' : 's'}
          </span>
        )}
        <span className="w-full text-xs text-[var(--muted)] sm:w-auto sm:flex-1">
          {row.regimens.length} row{row.regimens.length === 1 ? '' : 's'}
          {' · '}
          {row.prose === null ? 'no dosing text' : row.prose.replace(/\s+/g, ' ').slice(0, 90)}
        </span>
      </div>

      {open && (
        <div className="mt-3 rounded border border-[var(--border)] p-3">
          {/* What is stored now, per row, before anything is changed. The sig
              is the comparable form a quiz grades against; a null one is the
              whole problem, so it says so in words rather than showing an
              empty cell. */}
          <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
            Stored now
          </h3>
          <dl className="mt-2 space-y-2 text-sm">
            {row.regimens.map((regimen) => (
              <div key={regimen.id} className="border-l-2 border-[var(--border)] pl-3">
                <dt className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-xs">
                    {regimen.sig ?? 'no sig — free recall only'}
                  </span>
                  {regimen.indication !== null && (
                    <span className="text-xs text-[var(--muted)]">for {regimen.indication}</span>
                  )}
                  {regimen.orphaned && (
                    <span className="text-xs text-[var(--flagged)]">indication not recognised</span>
                  )}
                  {regimen.label !== null && (
                    <span className="text-xs text-[var(--muted)]">{regimen.label}</span>
                  )}
                </dt>
                <dd className="text-xs text-[var(--muted)]">{regimen.sourceText}</dd>
                {regimen.readback !== null && (
                  <dd className="text-xs text-[var(--muted)]">reads back as: {regimen.readback}</dd>
                )}
                {regimen.notes.map((note) => (
                  <dd key={note} className="text-xs text-[var(--unverified)]">{note}</dd>
                ))}
              </div>
            ))}
          </dl>

          {/* ------------------------------------------------- rewrite ---- */}
          <form onSubmit={submitTo(run(save))} className="mt-4 border-t border-[var(--border)] pt-3">
            <input type="hidden" name="slug" value={row.slug} />
            <input type="hidden" name="drugId" value={row.drugId} />
            <input type="hidden" name="generic" value={row.generic} />

            <label htmlFor={`dosing-${row.slug}`} className="block text-sm font-medium">
              Dosing
            </label>
            <textarea
              id={`dosing-${row.slug}`}
              name="dosing"
              rows={3}
              value={prose}
              onChange={(event) => { setProse(event.target.value); setSaved(false); }}
              aria-describedby={`preview-${row.slug}`}
              className={`${control} font-mono`}
            />
            <p className="mt-1 text-xs text-[var(--muted)]">
              {/* Said here because this is the screen where somebody will want
                  it, and the form is invisible until you know it exists. */}
              One line per indication — <span className="font-mono">Pulmonary hypertension: 20 mg
              by mouth three times a day</span> — files each dose under that condition, and the
              quiz then asks them separately. Every line has to be labelled for it to count.
            </p>

            <DosingPreview prose={prose} generic={row.generic} id={`preview-${row.slug}`} />

            <div>
              <label htmlFor={`source-${row.slug}`} className="mt-3 block text-sm font-medium">
                Where you read it
              </label>
              <input
                id={`source-${row.slug}`}
                name="source"
                placeholder="FDA labelling, Lexicomp, the sheet as printed…"
                className={control}
              />
              <p className="mt-1 text-xs text-[var(--muted)]">
                Left blank, the value keeps whatever source it already had.
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={pending}
                className="btn btn-primary btn-sm"
              >
                Save and re-read
              </button>
              <Link href={`/drugs/${row.slug}/edit`} className="btn btn-quiet btn-sm">
                Full editor
              </Link>
            </div>
          </form>

          {/* --------------------------------------------- it is like that -- */}
          <form onSubmit={submitTo(run(markUnique))} className="mt-3 border-t border-[var(--border)] pt-3">
            <input type="hidden" name="slug" value={row.slug} />
            {!row.dosingUnique && <input type="hidden" name="unique" value="on" />}
            <p className="text-xs text-[var(--muted)]">
              {row.dosingUnique
                ? 'Marked as read: this wording is the answer, and it is asked as free recall. '
                  + 'Clearing that puts it back in the queue.'
                : 'Some dosings genuinely have no sig — individualised, titrated to effect, '
                  + '"apply to the affected area". Saying so leaves the wording exactly as it is '
                  + 'and takes it out of the queue, which is different from nobody having looked.'}
            </p>
            <button
              type="submit"
              disabled={pending}
              className="btn btn-quiet btn-sm mt-2"
            >
              {row.dosingUnique ? 'Put it back in the queue' : 'The source really is like that'}
            </button>
          </form>

          {error !== null && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
          {error === null && saved && (
            <p className="mt-3 text-sm text-[var(--ok)]">
              Saved. The queue updates on the next load.
            </p>
          )}
        </div>
      )}
    </li>
  );
}
