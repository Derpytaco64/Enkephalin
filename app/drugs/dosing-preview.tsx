'use client';

import { useMemo } from 'react';
import { activesOf, parseDosing } from '@/lib/dosing/parse';
import { toEnglish, toSig } from '@/lib/dosing/sig';

/**
 * What the parser makes of the prose, live.
 *
 * The parser is pure and client-safe, so this is the same reading the save
 * will store -- not an approximation of it. That is the point: the sig a quiz
 * compares answers against is printed from components read out of this
 * wording, and until now the only way to see whether the wording survived that
 * reading was to save and re-run a script.
 *
 * Three panes because they fail differently. The sig is the comparable form;
 * the readback is the sig turned back into English, which is where a
 * mis-filed component shows up as a sentence that does not mean what you
 * typed; and the notes are the parser saying what it could not account for.
 */
export function DosingPreview({ prose, generic = '' }: { prose: string; generic?: string }) {
  const result = useMemo(
    () => (prose.trim() ? parseDosing(prose, activesOf(generic)) : null),
    [prose, generic],
  );

  if (!result) return null;

  const refused = result.status === 'refused';

  return (
    <div className="mt-2 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          How this reads
        </span>
        <span
          className="text-xs"
          style={{
            color: refused
              ? 'var(--flagged)'
              : result.status === 'parsed'
                ? 'var(--verified)'
                : 'var(--unverified)',
          }}
        >
          {refused
            ? 'not machine-readable'
            : result.status === 'parsed'
              ? 'read cleanly'
              : 'read, needs a look'}
        </span>
      </div>

      {refused ? (
        <p className="mt-2 text-[var(--muted)]">
          The wording stays exactly as typed and is still shown and asked about. What it cannot do
          is back a multiple-choice question, since there are no components to compare against.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {result.regimens.map((regimen, index) => (
            <li key={index} className="border-l-2 border-[var(--border)] pl-3">
              {regimen.label && (
                <span className="text-xs text-[var(--muted)]">{regimen.label}: </span>
              )}
              <span className="font-mono">{toSig(regimen) || '—'}</span>
              <p className="mt-0.5 text-[var(--muted)]">{toEnglish(regimen)}</p>
            </li>
          ))}
        </ul>
      )}

      {result.notes.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-[var(--muted)]">
          {result.notes.map((note) => <li key={note}>— {note}</li>)}
        </ul>
      )}

      {/* Anything the parser could not account for is shown verbatim: a word
          silently dropped is how a dose changes meaning without anyone seeing. */}
      {result.unconsumed.length > 0 && (
        <p className="mt-2 text-xs text-[var(--unverified)]">
          Not accounted for: {result.unconsumed.join(' · ')}
        </p>
      )}
    </div>
  );
}
