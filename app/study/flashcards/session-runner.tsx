'use client';

import Link from 'next/link';
import {
  type CSSProperties, useCallback, useEffect, useMemo, useState,
} from 'react';
import type { StudyCardSpec } from '@/lib/study/cards';
import { VariantPills } from '../_components/variant-pills';
import { sessionRules, type StudyConfig } from '@/lib/study/config';
import {
  blockProgress,
  createSession,
  currentCard,
  grade as gradeSession,
} from '@/lib/study/blocks';
import { GRADE_BUTTONS, type Grade } from '@/lib/study/srs';
import { LookupPanel, LookupTrigger, type LookupTarget } from '../_components/lookup-panel';
import { gradeCardAction } from './actions';

/* Red through green, defined in app/globals.css so that this file does not
   import lib/theme -- the study pages are held clear of the palette on
   purpose, and these four are chrome, not a drug's colour.

   Stepped by *position in the row that is on screen*, not by grade name, so
   both scales read red-to-green end to end: four buttons take all four steps,
   the binary pair takes the ends. That does mean "Good" is the green end on
   the binary scale and the third step on the four-point one -- correct either
   way, because what the colour says is how far along this row you are. */

/**
 * A keystroke aimed at a text field is not a keystroke aimed at the runner.
 *
 * There was nothing to type into here until the lookup panel arrived, so this
 * never mattered; the moment it did, typing "2" into the search box would have
 * answered the question.
 */
function typingSomewhere(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (target === null) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

const GRADE_STEPS = ['--grade-1', '--grade-2', '--grade-3', '--grade-4'] as const;

function gradeStep(index: number, total: number): string {
  const last = GRADE_STEPS.length - 1;
  if (total < 2) return GRADE_STEPS[last];
  return GRADE_STEPS[Math.round((index * last) / (total - 1))];
}

export function SessionRunner({
  cards,
  config,
  inScope,
  available,
}: {
  cards: StudyCardSpec[];
  config: StudyConfig;
  inScope: number;
  /** What the scope offered after the due filter, before the session cap. */
  available: number;
}) {
  const byId = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards]);
  const [session, setSession] = useState(() => createSession(cards.map((card) => card.id), config.blockSize));
  const [revealed, setRevealed] = useState(false);
  const [lookup, setLookup] = useState<LookupTarget | null>(null);

  const rules = sessionRules(config);
  const buttons = GRADE_BUTTONS[rules.grading];
  const cardId = currentCard(session);
  const card = cardId ? byId.get(cardId) : undefined;

  const answer = useCallback(
    (grade: Grade) => {
      if (!card) return;

      // Fire and forget: the queue should not stall on a round-trip, and a
      // failed write is a lost grade rather than a lost session.
      void gradeCardAction({
        drugId: card.drugId,
        cardKey: card.cardKey,
        fieldKeys: card.fieldKeys,
        grade,
        config,
      });

      setRevealed(false);
      setSession((current) => gradeSession(current, grade));
    },
    [card, config],
  );

  // Space flips, 1-4 grade: on a laptop the whole session should be keyboard.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!card) return;
      if (lookup !== null || typingSomewhere(event)) return;

      if (event.code === 'Space' || event.key === 'Enter') {
        event.preventDefault();
        setRevealed(true);
        return;
      }
      if (!revealed) return;

      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < buttons.length) {
        event.preventDefault();
        answer(buttons[index].grade);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [answer, buttons, card, lookup, revealed]);

  if (cards.length === 0) {
    return (
      <div className="mt-10 rounded border border-[var(--border)] p-4 sm:p-6">
        <p className="font-medium">Nothing to study.</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {inScope === 0
            ? 'No cards match this scope. Try picking more fields, or widening the class and tag filters.'
            : `All ${inScope} cards in scope are scheduled for later. Switch to cram to go through them anyway.`}
        </p>
      </div>
    );
  }

  if (session.finished || !card) {
    return (
      <div className="mt-10 rounded border border-[var(--border)] p-4 sm:p-6">
        <p className="font-medium">Session complete.</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {cards.length} card{cards.length === 1 ? '' : 's'}
          {rules.reschedules ? ', scheduled for their next review.' : '. Cramming left your schedule untouched.'}
        </p>
        <Link href="/study/flashcards" className="btn btn-quiet mt-4">
          Start another
        </Link>
      </div>
    );
  }

  const progress = blockProgress(session);

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-[var(--muted)]">
        <span>
          {config.blockSize > 0
            ? `Block ${progress.block} of ${progress.blocks} — ${progress.cleared} of ${progress.size} cleared`
            : `${cards.length} cards`}
          {available > cards.length && ` · ${cards.length} of ${available}, picked at random`}
        </span>
        <span>{rules.reschedules ? 'Review' : 'Cram — schedule untouched'}</span>
      </div>

      <article className="mt-3 rounded border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
        {/* The card's top right, above the question, because it changes what
            the question means: *what is the mechanism* and *what does PHRM 535
            say the mechanism is* have different right answers. */}
        <VariantPills variants={card.variants} align="end" />
        <p className="mt-2 whitespace-pre-line text-lg">{card.prompt}</p>

        {revealed ? (
          <dl className="mt-6 space-y-4 border-t border-[var(--border)] pt-4">
            {card.faces.map((face) => (
              <div key={face.key}>
                <dt className="flex flex-wrap items-baseline gap-2 text-xs uppercase tracking-wide
                  text-[var(--muted)]">
                  {face.label}
                  {/* Again on the answer: this is whose words these are, and
                      the reveal is where somebody decides whether they got it
                      right. */}
                  <span className="normal-case"><VariantPills variants={card.variants} /></span>
                </dt>
                <dd className="mt-1 whitespace-pre-line">{face.text}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="btn btn-primary mt-6"
          >
            Show answer <span className="text-xs opacity-80">space</span>
          </button>
        )}
      </article>

      {/* `flex-1` alone never wraps -- it sets a zero basis, so four grade
          buttons squeezed onto one line and "Again" wrapped inside a 54px
          button on a phone. A minimum width makes them wrap instead: two rows
          of two narrow, one row of four from `sm`. */}
      {revealed && (
        <div className="mt-4 flex flex-wrap gap-2">
          {buttons.map((button, index) => (
            <button
              key={button.grade}
              type="button"
              onClick={() => answer(button.grade)}
              style={{ '--grade': `var(${gradeStep(index, buttons.length)})` } as CSSProperties}
              className="grade-step min-w-32 flex-1 rounded border px-4 py-3 text-sm"
            >
              {/* The keyboard hint inherits the grade colour rather than
                  --muted, which on a tinted fill came in under 4.5:1. */}
              {button.label} <span className="text-xs opacity-90">{index + 1}</span>
            </button>
          ))}
        </div>
      )}

      {/* The card's drug, over the session. It used to be a new-tab link
          that named the drug whether or not the card had been turned over --
          which on a fact-to-drug card is the answer. */}
      <p className="mt-6">
        <LookupTrigger
          drug={{ slug: card.slug, generic: card.generic }}
          available={revealed}
          unavailableReason="Flip it first, then look it up"
          onOpen={setLookup}
        />
      </p>

      {/* Read as the deck was built: the panel takes the session's scope,
          so the profile it shows is the one the card asked about. */}
      <LookupPanel
        drug={lookup} available={revealed} scopeTags={config.scope.tags}
        onClose={() => setLookup(null)}
      />
    </div>
  );
}
