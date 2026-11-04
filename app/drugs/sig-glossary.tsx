'use client';

import {
  INTERVAL_LETTERS, MODIFIERS, PER_DAY_CODES, ROUTES, UNITS,
} from '@/lib/dosing/model';

/**
 * What the codes in the dosing preview mean, next to the box you type in.
 *
 * Every row is read off the model's own tables rather than retyped, so the
 * glossary cannot drift from the printer: a code shown to a person and a code
 * written into a sig, kept in two lists, would eventually disagree, and the one
 * thing guaranteed not to notice is the glossary.
 *
 * It explains the output, not the input. You write prose -- "10 mg by mouth
 * once a day" -- and the parser reads it; what appears underneath is the sig.
 * Knowing that `QD` came from "once a day" is the whole skill being practised,
 * so the English each code stands for is right beside it.
 *
 * The codes were set in `--accent`, which is the colour of a *link* and these
 * are not links -- it was the one place in the app where blue text did nothing
 * when you clicked it. They are `--fg` against the muted English beside them
 * now; the monospace was always what set them apart.
 */
export function SigGlossary() {
  const rows = <T,>(items: T[], render: (item: T) => { code: string; label: string }) => items
    .map(render)
    .map((row) => (
      <div key={row.code} className="flex gap-2">
        <dt className="shrink-0 font-mono font-medium text-[var(--fg)]">{row.code}</dt>
        <dd className="text-[var(--muted)]">{row.label}</dd>
      </div>
    ));

  const section = (title: string, body: React.ReactNode) => (
    <div>
      <h4 className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{title}</h4>
      <dl className="mt-1 space-y-0.5 text-xs">{body}</dl>
    </div>
  );

  return (
    <details className="mt-2 rounded border border-[var(--border)]">
      <summary className="cursor-pointer px-3 py-2 text-xs text-[var(--muted)]">
        What the sig codes mean
      </summary>

      <div className="grid gap-4 border-t border-[var(--border)] p-3 sm:grid-cols-2">
        {section('How often', (
          <>
            {rows(
              Object.values(PER_DAY_CODES),
              (entry) => ({ code: entry.sig, label: entry.label }),
            )}
            {rows(
              Object.entries(INTERVAL_LETTERS),
              ([unit, letter]) => ({ code: `Q${letter}`, label: `every ${unit}` }),
            )}
            <div className="flex gap-2">
              <dt className="shrink-0 font-mono font-medium text-[var(--fg)]">Q8H</dt>
              <dd className="text-[var(--muted)]">every 8 hours — any number before the letter</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 font-mono font-medium text-[var(--fg)]">QOD</dt>
              <dd className="text-[var(--muted)]">every other day</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 font-mono font-medium text-[var(--fg)]">x1</dt>
              <dd className="text-[var(--muted)]">once, a single dose</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 font-mono font-medium text-[var(--fg)]">2-3x/day</dt>
              <dd className="text-[var(--muted)]">
                a range of counts, spelled out — there is no code for it
              </dd>
            </div>
          </>
        ))}

        {section('Route', rows(
          Object.values(ROUTES),
          (entry) => ({ code: entry.sig, label: entry.label }),
        ))}

        {section('When, and with what', rows(
          Object.values(MODIFIERS),
          (entry) => ({ code: entry.sig, label: entry.label }),
        ))}

        {section('Amount', (
          <>
            {rows(
              Object.values(UNITS).filter((unit) => unit.sig !== unit.label),
              (entry) => ({ code: entry.sig, label: entry.label }),
            )}
            <div className="flex gap-2">
              <dt className="shrink-0 font-mono font-medium text-[var(--fg)]">5-10 mg</dt>
              <dd className="text-[var(--muted)]">
                a range, which compares as a range rather than as either end
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 font-mono font-medium text-[var(--fg)]">/kg</dt>
              <dd className="text-[var(--muted)]">per kilogram of body weight</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 font-mono font-medium text-[var(--fg)]">x7 days</dt>
              <dd className="text-[var(--muted)]">for seven days — how long, not how often</dd>
            </div>
          </>
        ))}
      </div>

      <p className="border-t border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
        You write the dosing as prose and the sig is printed from it, so typing{' '}
        <span className="font-mono">10 mg by mouth once a day</span> is what produces{' '}
        <span className="font-mono">10 mg PO QD</span>. The preview above is the check: if a word
        did not make it into the sig, the parser did not understand it.
      </p>
    </details>
  );
}
