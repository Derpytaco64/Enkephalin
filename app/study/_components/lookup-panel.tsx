'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LookupCard, LookupHit } from '@/lib/study/lookup';
import { lookupDrugAction, searchDrugsAction } from './lookup-actions';

/**
 * Look a drug up without leaving the session.
 *
 * Closed until the card is turned over. A quiz question you have not answered
 * and a flashcard you have not flipped are both a retrieval attempt in
 * progress, and a lookup there is not studying -- it turns the one moment that
 * teaches something into reading. So the trigger is disabled and says what has
 * to happen first, rather than being hidden: knowing the panel is there is the
 * point of it being there at all.
 *
 * An overlay rather than a page, because a session is in memory. Navigating
 * away loses the paper, which is why every other way out of a runner opens a
 * new tab.
 */
export function LookupPanel({
  available,
  unavailableReason,
  onOpenChange,
}: {
  available: boolean;
  /** Shown on the disabled trigger: what has to happen first. */
  unavailableReason: string;
  /** So the runner can stand its keyboard down while this is open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<LookupHit[]>([]);
  const [card, setCard] = useState<LookupCard | null>(null);
  const [searching, setSearching] = useState(false);
  const box = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  // Shut the moment it stops being allowed. Answering is not the only way out
  // of a question: Next moves to the following one, where this must close.
  useEffect(() => {
    if (!available && open) close();
  }, [available, open, close]);

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

  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

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

  const show = async (slug: string) => {
    setCard(await lookupDrugAction(slug));
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          if (!available) return;
          setOpen(true);
          onOpenChange?.(true);
        }}
        disabled={!available}
        title={available ? 'Look a drug up' : unavailableReason}
        className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--fg)] disabled:cursor-not-allowed disabled:text-[var(--muted)] disabled:opacity-70"
      >
        {available ? 'Look up a drug' : unavailableReason}
      </button>
    );
  }

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
            placeholder="Generic or brand name"
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
                  onClick={() => show(hit.slug)}
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

        {card !== null && (
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
