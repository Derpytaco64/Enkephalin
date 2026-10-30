'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

export function SessionRunner({
  cards,
  config,
  inScope,
}: {
  cards: StudyCardSpec[];
  config: StudyConfig;
  inScope: number;
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
      <div className="mt-10 rounded border border-[var(--border)] p-6">
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
      <div className="mt-10 rounded border border-[var(--border)] p-6">
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
        </span>
        <span>{rules.reschedules ? 'Review' : 'Cram — schedule untouched'}</span>
      </div>

      <article className="mt-3 rounded border border-[var(--border)] bg-[var(--surface)] p-6">
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

      {revealed && (
        <div className="mt-4 flex flex-wrap gap-2">
          {buttons.map((button, index) => (
            <button
              key={button.grade}
              type="button"
              onClick={() => answer(button.grade)}
              className="flex-1 rounded border border-[var(--border)] px-4 py-3 text-sm hover:bg-[var(--surface)]"
            >
              {button.label} <span className="text-xs text-[var(--muted)]">{index + 1}</span>
            </button>
          ))}
        </div>
      )}

      <p className="mt-6 text-xs text-[var(--muted)]">
        <Link href={`/drugs/${card.slug}`} className="underline">
          Open {card.generic}
        </Link>
      </p>
    </div>
  );
}
