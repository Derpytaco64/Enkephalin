'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LookupCard, LookupHit } from '@/lib/study/lookup';
import { lookupDrugAction, searchDrugsAction } from './lookup-actions';

/** The drug a trigger names, which is what the panel opens on. */
export type LookupTarget = { slug: string; generic: string };

/**
 * A drug name you can press to see the drug.
 *
 * Every drug named in a runner is one of these, and there is no separate
 * "look up a drug" button: the name in front of you *is* the way in, and a
 * second control for the same act was one control too many. Searching for
 * something else is still possible once the panel is open, which is where that
 * belongs -- it is the rarer thing.
 *
 * Disabled while a question is unanswered or a card unflipped, and it says
 * what has to happen first rather than disappearing. That gate is the point:
 * a retrieval attempt in progress is the one moment that teaches something,
 * and reading the answer instead is not studying. Hiding the control would
 * also hide the rule.
 */
export function LookupTrigger({
  drug,
  available,
  unavailableReason,
  onOpen,
  className = 'text-sm text-[var(--accent)] underline',
}: {
  drug: LookupTarget;
  available: boolean;
  unavailableReason: string;
  onOpen: (drug: LookupTarget) => void;
  className?: string;
}) {
  if (!available) {
    return (
      <span className="text-sm text-[var(--muted)]" title={unavailableReason}>
        {unavailableReason}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(drug)}
      title={`Look up ${drug.generic} without leaving the session`}
      className={className}
    >
      {drug.generic}
    </button>
  );
}

/**
 * The drug itself, over the session rather than instead of it.
 *
 * Controlled: the runner holds which drug is open, so one panel serves every
 * name on the page -- the question's drug, the drug a wrong answer belonged
 * to, every row of the summary -- instead of a panel per link each with its
 * own state.
 *
 * An overlay rather than a page, because a session is in memory. Navigating
 * away loses the paper, which is why the only link out of here opens a new
 * tab.
 */
export function LookupPanel({
  drug,
  available,
  onClose,
}: {
  /** Null is closed. */
  drug: LookupTarget | null;
  /** False shuts it, wherever it was opened from. */
  available: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<LookupHit[]>([]);
  const [card, setCard] = useState<LookupCard | null>(null);
  const [searching, setSearching] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  const open = drug !== null;

  const close = useCallback(() => {
    setQuery('');
    setHits([]);
    setCard(null);
    onClose();
  }, [onClose]);

  // Shut the moment it stops being allowed, whatever opened it. Answering is
  // not the only way out of a question: Next moves to the following one, where
  // this has to close without being touched.
  useEffect(() => {
    if (!available && open) close();
  }, [available, open, close]);

  // The drug the trigger named, loaded without being searched for.
  useEffect(() => {
    if (drug === null) return;

    let current = true;
    void lookupDrugAction(drug.slug).then((found) => {
      if (current) setCard(found);
    });
    return () => {
      current = false;
    };
  }, [drug]);

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  // Debounced, and a reply is dropped if the box has moved on since -- without
  // that, a slow early query overwrites the answer to a later one.
  useEffect(() => {
    if (!open) return;

    const needle = query.trim();
    if (needle.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }

    let current = true;
    setSearching(true);
    const timer = setTimeout(async () => {
      const found = await searchDrugsAction(needle);
      if (!current) return;
      setHits(found);
      setSearching(false);
    }, 180);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      {/* A click outside closes it. The sheet below sits above this layer, so
          a click that lands on the sheet is not a click on the backdrop. */}
      <div className="absolute inset-0" onClick={close} aria-hidden="true" />

      <div
        role="dialog"
        aria-label="Look up a drug"
        className="relative z-10 w-full max-w-xl rounded border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl sm:p-6"
      >
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={box}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Look up something else"
            autoComplete="off"
            className="h-9 min-w-48 flex-1 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
          />
          <button
            type="button" onClick={close}
            className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
          >
            Close <span className="text-xs text-[var(--muted)]">esc</span>
          </button>
        </div>

        {query.trim().length >= 2 && hits.length === 0 && !searching && (
          <p className="mt-3 text-sm text-[var(--muted)]">Nothing by that name.</p>
        )}

        {hits.length > 0 && (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {hits.map((hit) => (
              <li key={hit.slug}>
                <button
                  type="button"
                  onClick={() => void lookupDrugAction(hit.slug).then(setCard)}
                  className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 py-2 text-left text-sm"
                >
                  <span className={hit.slug === card?.slug ? 'font-medium underline' : 'font-medium'}>
                    {hit.generic}
                  </span>
                  {/* Why this row matched, when it was not the name. Searching
                      Zocor and being shown Simvastatin needs the connection
                      said out loud. */}
                  {hit.matchedBrand !== null && (
                    <span className="text-xs text-[var(--muted)]">as {hit.matchedBrand}</span>
                  )}
                  {hit.schedule !== null && (
                    <span className="text-xs text-[var(--muted)]">{hit.schedule}</span>
                  )}
                  <span className="text-xs text-[var(--muted)]">{hit.drugClass ?? 'Uncategorized'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {card === null ? (
          <p className="mt-4 text-sm text-[var(--muted)]">Fetching {drug.generic}…</p>
        ) : (
          <article className="mt-4 border-t border-[var(--border)] pt-4">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h2 className="text-lg font-medium">{card.generic}</h2>
              {card.schedule !== null && (
                <span className="text-sm text-[var(--muted)]">{card.schedule}</span>
              )}
              {card.drugClass !== null && (
                <span className="text-sm text-[var(--muted)]">{card.drugClass}</span>
              )}
            </div>

            {card.brands.length > 0 && (
              <p className="mt-1 text-sm text-[var(--muted)]">{card.brands.join(', ')}</p>
            )}

            {card.groups.map((group) => (
              <section key={group.group} className="mt-3">
                <h3 className="text-xs uppercase tracking-wide text-[var(--muted)]">
                  {group.group}
                </h3>
                <dl className="mt-1 space-y-2">
                  {group.fields.map((field) => (
                    <div key={field.key}>
                      <dt className="text-xs text-[var(--muted)]">{field.label}</dt>
                      {field.lines.map((line, index) => (
                        <dd key={index} className="whitespace-pre-line text-sm">{line}</dd>
                      ))}
                    </div>
                  ))}
                </dl>
              </section>
            ))}

            {/* A new tab, for the same reason the panel exists at all: the
                session is in memory and a navigation would end it. */}
            <Link
              href={`/drugs/${card.slug}`} target="_blank" rel="noreferrer"
              className="mt-4 inline-block text-xs text-[var(--accent)] underline"
            >
              Full profile &#8599;
            </Link>
          </article>
        )}
      </div>
    </div>
  );
}
