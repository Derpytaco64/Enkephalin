'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LookupCard, LookupHit } from '@/lib/study/lookup';
import type { CardVariant } from '@/lib/study/cards';
import { lookupDrugAction, searchDrugsAction } from './lookup-actions';
import { VariantPills } from './variant-pills';

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
  // A chip, not a link in a sentence: it stands alone under the question and
  // what it names is a drug rather than a word in a line of prose.
  className = 'pill pill-edge',
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
 *
 * It is read mid-session, with a question still on the screen behind it, so
 * the layout is built for scanning rather than for reading through: the drug's
 * identity in one band at the top, then a label column beside a value column,
 * so the eye runs down the labels and stops at the one it wants. Everything
 * below the search row scrolls inside the sheet instead of growing it -- a
 * drug with every field filled is taller than a laptop screen, and a dialog
 * that pushes its own close button off the bottom is a trap.
 */
export function LookupPanel({
  drug,
  available,
  onClose,
  scopeTags = [],
}: {
  /** Null is closed. */
  drug: LookupTarget | null;
  /** False shuts it, wherever it was opened from. */
  available: boolean;
  onClose: () => void;
  /**
   * The session's scope, so the panel reads each drug as the session reads it
   * and says so. `config.scope.tags`; empty is the drug's own profile, which
   * is what every caller outside a scoped session wants.
   */
  scopeTags?: string[];
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
    void lookupDrugAction(drug.slug, scopeTags).then((found) => {
      if (current) setCard(found);
    });
    return () => {
      current = false;
    };
    // The scope is fixed for the life of a session, and a fresh array literal
    // from the parent on every render would refetch the drug forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/50 p-3 backdrop-blur-sm sm:items-center sm:p-8">
      {/* A click outside closes it. The sheet below sits above this layer, so
          a click that lands on the sheet is not a click on the backdrop. */}
      <div className="absolute inset-0" onClick={close} aria-hidden="true" />

      <div
        role="dialog"
        aria-label="Look up a drug"
        className="relative z-10 flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden
          rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl sm:max-h-[86vh]"
      >
        {/* Held at the top of the sheet rather than scrolling away under the
            profile: it is the way to the *next* drug, and the close button
            beside it has to stay reachable however long the drug is. */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-3">
          <input
            ref={box}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Look up something else"
            autoComplete="off"
            className="h-9 min-w-48 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-sm"
          />
          {/* Square-cornered like the search field beside it rather than a
              pill, because the two of them are one row. Only the hover moved:
              it lifted the edge to `--accent`, which no season touches. */}
          <button
            type="button" onClick={close}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm
              hover:border-[var(--btn-edge)] hover:text-[var(--fg)]"
          >
            Close <span className="text-xs text-[var(--muted)]">esc</span>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {query.trim().length >= 2 && hits.length === 0 && !searching && (
            <p className="text-sm text-[var(--muted)]">Nothing by that name.</p>
          )}

          {hits.length > 0 && (
            <ul className="mb-4 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
              {hits.map((hit) => (
                <li key={hit.slug}>
                  <button
                    type="button"
                    onClick={() => void lookupDrugAction(hit.slug, scopeTags).then(setCard)}
                    className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-1 px-3 py-2
                      text-left text-sm hover:bg-[var(--bg)]"
                  >
                    <span className={hit.slug === card?.slug ? 'font-medium underline' : 'font-medium'}>
                      {hit.generic}
                    </span>
                    {/* Why this row matched, when it was not the name.
                        Searching Zocor and being shown Simvastatin needs the
                        connection said out loud. */}
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
            <p className="text-sm text-[var(--muted)]">Fetching {drug.generic}…</p>
          ) : (
            <article>
              {/* The name, and then everything else as a labelled row.

                  It had a band of chips for the class and the schedule and a
                  "Sold as" sentence for the brands -- three shapes for three
                  facts, above a field list that states facts one way. The
                  owner's call, and the right one: the panel is a reference
                  card, so the brands read the way the profile's Brands section
                  reads rather than as an ornament.

                  Indications join them here, which they never did: the card
                  has carried them all along and the panel never printed them,
                  because they are held out of the field groups (the profile
                  shows them per brand) and nothing picked them up again. */}
              <h2 className="text-xl font-semibold tracking-tight">{card.generic}</h2>

              {/* Whose words these are, in the same coloured pill the card
                  wore -- the panel is opened to check an answer against the
                  profile, and the two have to be the same profile. Where a
                  class has reworded a field, the row says so below; this band
                  is the whole panel's provenance.

                  The drug's name is above it rather than inside it, which the
                  card may not do: here the drug has already been named by the
                  thing that opened the panel. */}
              {card.versions.length > 0 && (
                <div className="mt-2">
                  <VariantPills variants={card.versions} />
                </div>
              )}

              <dl className="mt-3 space-y-2.5">
                {card.schedule !== null && <Row label="Controlled schedule">{card.schedule}</Row>}
                {card.drugClass !== null && <Row label="Drug class">{card.drugClass}</Row>}
                {card.brands.length > 0 && (
                  <Row label="Brands">{card.brands.join(', ')}</Row>
                )}
                {card.indications.length > 0 && (
                  <Row label="Indications">{card.indications.join(', ')}</Row>
                )}
              </dl>

              {card.groups.map((group) => (
                <section key={group.group} className="mt-5">
                  <h3
                    className="flex items-center gap-2 text-xs font-medium uppercase
                      tracking-wide text-[var(--muted)]"
                  >
                    {group.group}
                    <span aria-hidden="true" className="h-px flex-1 bg-[var(--border)]" />
                  </h3>
                  {/* Label beside value from `sm` up, so the eye runs down one
                      column of labels instead of zig-zagging through stacked
                      pairs. Stacked below that, where two columns would leave
                      a dose wrapping to four lines. */}
                  <dl className="mt-2 space-y-2.5">
                    {group.fields.map((field) => (
                      <Row
                        key={field.key}
                        label={field.label}
                        /* Only a layer's. V-1 is named once at the top and is
                           most of the panel; repeating it on every row would
                           bury the two lines that are somebody else's. */
                        version={field.version && field.version.n > 1 ? field.version : null}
                      >
                        {field.lines.map((line, index) => (
                          <span key={index} className="block whitespace-pre-line">{line}</span>
                        ))}
                      </Row>
                    ))}
                  </dl>
                </section>
              ))}

              {/* A new tab, for the same reason the panel exists at all: the
                  session is in memory and a navigation would end it. */}
              <Link
                href={`/drugs/${card.slug}`} target="_blank" rel="noreferrer"
                className="pill pill-xs mt-5"
              >
                Full profile &#8599;
              </Link>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One labelled fact: label beside value from `sm` up, stacked below it.
 *
 * Every line in the panel is one of these, the drug's own identity included.
 * The eye then runs down a single column of labels and stops at the one it
 * wants, which is what a thing read mid-question has to support -- where three
 * different shapes for three kinds of fact made it a page to read through.
 *
 * Deliberately uncoloured, where the browser and the profile tint their class
 * and schedule from the palette: the study side may not read it. A coloured
 * chip beside a question is a cue that can be matched without reading either
 * side of it -- which is what `tests/colour-is-cosmetic.test.ts` exists to
 * stop.
 */
function Row({
  label,
  version = null,
  children,
}: {
  label: string;
  /** A class that worded this line its own way, where one did. */
  version?: CardVariant | null;
  children: React.ReactNode;
}) {
  return (
    <div className="sm:grid sm:grid-cols-[9rem_1fr] sm:gap-3">
      <dt className="text-xs text-[var(--muted)] sm:pt-0.5">
        {label}
        {version && (
          <span className="mt-1 block">
            <VariantPills variants={[version]} />
          </span>
        )}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}
