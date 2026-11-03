'use client';

import Link from 'next/link';
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import type { StudyCardSpec } from '@/lib/study/cards';
import { sessionRules, type StudyConfig } from '@/lib/study/config';
import {
  blockProgress,
  createSession,
  currentCard,
  grade as gradeSession,
} from '@/lib/study/blocks';
import { GRADE_BUTTONS, type Grade } from '@/lib/study/srs';
import { gradeCardAction } from './actions';

/* Red through green, defined in app/globals.css so that this file does not
   import lib/theme -- the study pages are held clear of the palette on
   purpose, and these four are chrome, not a drug's colour.

   Stepped by *position in the row that is on screen*, not by grade name, so
   both scales read red-to-green end to end: four buttons take all four steps,
   the binary pair takes the ends. That does mean "Good" is the green end on
   the binary scale and the third step on the four-point one -- correct either
   way, because what the colour says is how far along this row you are. */
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
  }, [answer, buttons, card, revealed]);

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
        <Link href="/study/flashcards" className="mt-4 inline-block text-sm text-[var(--accent)] underline">
          Start another
        </Link>
      </div>
    );
  }

  const progress = blockProgress(session);

  return (
    <div className="mt-8">
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
        <p className="whitespace-pre-line text-lg">{card.prompt}</p>

        {revealed ? (
          <dl className="mt-6 space-y-4 border-t border-[var(--border)] pt-4">
            {card.faces.map((face) => (
              <div key={face.key}>
                <dt className="text-xs uppercase tracking-wide text-[var(--muted)]">{face.label}</dt>
                <dd className="mt-1 whitespace-pre-line">{face.text}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="mt-6 rounded bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)]"
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

      {/* A new tab on purpose: a session is in-memory, so navigating to the
          profile and back would start the block over. */}
      <p className="mt-6 text-xs text-[var(--muted)]">
        <a href={`/drugs/${card.slug}`} target="_blank" rel="noreferrer" className="underline">
          Open {card.generic} &#8599;
        </a>
      </p>
    </div>
  );
}
