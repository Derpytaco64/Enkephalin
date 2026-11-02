'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { StudyConfig } from '@/lib/study/config';
import type { QuizQuestion } from '@/lib/study/quiz';
import type { FinishState } from './actions';

type Answer = { chosenIndex: number | null };

/**
 * What the answer you gave was actually right about.
 *
 * Marked wrong is the least useful thing a quiz can tell you. The option you
 * picked was true of *something* -- it is drawn from a real drug, usually one
 * in the same class, which is exactly why it was tempting -- so naming that is
 * where the distinction gets learned.
 *
 * Which half is missing depends on the direction. Shown a drug and picking the
 * wrong fact, the fact belongs to another drug, so name the drug. Shown a fact
 * and picking the wrong drug, that drug has its own value for the field, so
 * name the value.
 */
function Mismatch({
  question,
  chosenIndex,
}: {
  question: QuizQuestion;
  chosenIndex: number;
}) {
  const chosen = question.options[chosenIndex];
  const owner = question.fromGeneric[chosenIndex];
  const fact = question.fromFact[chosenIndex];
  if (!owner) return null;

  if (fact) {
    // Options were drug names: say what that drug is actually for.
    return (
      <>
        <span className="text-[var(--muted)]">
          {question.fieldLabel} of {owner}:{' '}
        </span>
        {fact}
      </>
    );
  }

  // Options were facts: say whose fact it is.
  return (
    <>
      <span className="text-[var(--muted)]">&ldquo;{chosen}&rdquo; is the </span>
      {question.fieldLabel.toLowerCase()}
      <span className="text-[var(--muted)]"> of </span>
      <a
        href={`/drugs/${question.fromSlug[chosenIndex]}`} target="_blank" rel="noreferrer"
        className="text-[var(--accent)] underline"
      >
        {owner} &#8599;
      </a>
      <span className="text-[var(--muted)]">.</span>
    </>
  );
}

/**
 * One question at a time, graded as you go.
 *
 * Feedback is immediate because this is studying, not an exam: being told at
 * the end that question 9 of 40 was wrong teaches far less than being told
 * while the drug is still in your head. The paper is fixed when the page
 * renders -- same questions, same option order -- so going back through the
 * review at the end shows what you actually answered.
 */
export function QuizRunner({
  questions: served,
  config,
  available,
  onFinish,
}: {
  questions: QuizQuestion[];
  config: StudyConfig;
  available: number;
  onFinish: (input: {
    config: StudyConfig;
    questions: QuizQuestion[];
    answers: { questionId: string; chosenIndex: number | null }[];
  }) => Promise<FinishState>;
}) {
  // The paper is taken once and never retaken from props. A server re-render
  // of this route draws a different random paper, and grading the answers to
  // one paper against the questions of another is exactly what happened: 0 of
  // 83, with a "what you missed" list of questions nobody was asked. The page
  // keys this component on a fresh paper id, so starting one really does start
  // one; anything else leaves the paper in hand alone.
  const [questions] = useState(served);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [finished, setFinished] = useState(false);
  const [saved, setSaved] = useState<FinishState | null>(null);

  const question = questions[index];
  const answer = question ? answers[question.id] : undefined;
  const answered = answer !== undefined;
  const score = questions.filter(
    (row) => answers[row.id]?.chosenIndex === row.correctIndex,
  ).length;
  const done = Object.keys(answers).length;

  function choose(chosenIndex: number) {
    if (!question || answers[question.id]) return;
    setAnswers((current) => ({ ...current, [question.id]: { chosenIndex } }));
  }

  function next() {
    if (index + 1 < questions.length) setIndex(index + 1);
    else setFinished(true);
  }

  // Keyboard on a laptop: 1-4 answers, space or enter moves on.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (finished || !question) return;
      if (event.key === ' ' || event.key === 'Enter') {
        if (answers[question.id]) {
          event.preventDefault();
          next();
        }
        return;
      }
      const choice = Number(event.key) - 1;
      if (Number.isInteger(choice) && choice >= 0 && choice < question.options.length) {
        event.preventDefault();
        choose(choice);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!finished || saved) return;
    let live = true;
    onFinish({
      config,
      questions,
      answers: questions.map((row) => ({
        questionId: row.id,
        chosenIndex: answers[row.id]?.chosenIndex ?? null,
      })),
    }).then((result) => { if (live) setSaved(result); });
    return () => { live = false; };
  }, [finished, saved, answers, config, questions, onFinish]);

  if (questions.length === 0) {
    return (
      <div className="mt-10 rounded border border-[var(--border)] p-6">
        <p className="font-medium">No questions.</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Either nothing in scope has a value for the fields you picked, or the scope is down to a
          single drug — a multiple-choice question needs someone else to disagree with.
        </p>
      </div>
    );
  }

  if (finished) {
    const wrong = questions.filter((row) => answers[row.id]?.chosenIndex !== row.correctIndex);

    return (
      <div className="mt-8">
        <div className="rounded border border-[var(--border)] p-6">
          <p className="text-lg font-medium">
            {score} of {questions.length} — {Math.round((score / questions.length) * 100)}%
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {saved === null
              ? 'Saving…'
              : saved.ok
                ? 'Recorded, with which fields let you down.'
                : saved.message}
          </p>
          <Link href="/study/quiz" className="mt-4 inline-block text-sm text-[var(--accent)] underline">
            Another quiz
          </Link>
        </div>

        {wrong.length > 0 && (
          <section className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
              What you missed
            </h2>
            <ul className="mt-3 space-y-4">
              {wrong.map((row) => {
                const chosen = answers[row.id]?.chosenIndex;
                return (
                  <li key={row.id} className="rounded border border-[var(--border)] p-4">
                    <p className="whitespace-pre-line text-sm">{row.prompt}</p>
                    <p className="mt-2 text-sm">
                      <span className="text-[var(--muted)]">Correct: </span>
                      {row.options[row.correctIndex]}
                    </p>
                    {chosen !== undefined && chosen !== null ? (
                      <>
                        <p className="text-sm">
                          <span className="text-[var(--muted)]">Your answer: </span>
                          {row.options[chosen]}
                        </p>
                        <p className="mt-2 text-sm text-[var(--muted)]">
                          <Mismatch question={row} chosenIndex={chosen} />
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">Not answered.</p>
                    )}
                    <a
                      href={`/drugs/${row.slug}`} target="_blank" rel="noreferrer"
                      className="mt-2 inline-block text-xs text-[var(--accent)] underline"
                    >
                      {row.generic} &#8599;
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-[var(--muted)]">
        <span>
          Question {index + 1} of {questions.length}
          {available > questions.length && ` · drawn from ${available}`}
        </span>
        <span>{score} right of {done} answered</span>
      </div>

      <article className="mt-3 rounded border border-[var(--border)] bg-[var(--surface)] p-6">
        <p className="whitespace-pre-line text-lg">{question.prompt}</p>

        <ul className="mt-6 space-y-2">
          {question.options.map((option, optionIndex) => {
            const isCorrect = optionIndex === question.correctIndex;
            const isChosen = answer?.chosenIndex === optionIndex;
            const border = !answered
              ? 'var(--border)'
              : isCorrect
                ? 'var(--verified)'
                : isChosen
                  ? 'var(--flagged)'
                  : 'var(--border)';

            return (
              <li key={option}>
                <button
                  type="button"
                  onClick={() => choose(optionIndex)}
                  disabled={answered}
                  style={{ borderColor: border }}
                  className="flex w-full items-baseline gap-3 rounded border px-4 py-3 text-left disabled:cursor-default"
                >
                  <span className="text-xs text-[var(--muted)]">{optionIndex + 1}</span>
                  <span className="whitespace-pre-line">{option}</span>
                  {answered && isCorrect && (
                    <span className="ml-auto shrink-0 text-xs text-[var(--verified)]">Correct</span>
                  )}
                  {answered && isChosen && !isCorrect && (
                    <span className="ml-auto shrink-0 text-xs text-[var(--flagged)]">Your answer</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* A wrong answer is only worth having if you are told what it *was*
            right about: the drug whose mechanism you picked, or the mechanism
            the drug you picked actually has. Knowing it was wrong teaches
            nothing; knowing what it belonged to is the distinction. */}
        {answered && answer?.chosenIndex !== null && answer?.chosenIndex !== undefined
          && answer.chosenIndex !== question.correctIndex && (
          <p className="mt-4 rounded border border-[var(--border)] p-3 text-sm">
            <Mismatch question={question} chosenIndex={answer.chosenIndex} />
          </p>
        )}

        {answered && (
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={next}
              className="rounded bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)]"
            >
              {index + 1 < questions.length ? 'Next' : 'Finish'}
            </button>
            {/* A new tab on purpose: looking a drug up mid-paper must not
                navigate away from the paper, which would lose it. */}
            <a
              href={`/drugs/${question.slug}`} target="_blank" rel="noreferrer"
              className="text-sm text-[var(--accent)] underline"
            >
              {question.generic} &#8599;
            </a>
            {question.acceptable.length > 1 && (
              <span className="text-xs text-[var(--muted)]">
                Also right: {question.acceptable.filter((text) => text !== question.options[question.correctIndex]).join(', ')}
              </span>
            )}
          </div>
        )}
      </article>

      <p className="mt-3 text-xs text-[var(--muted)]">
        1–{question.options.length} to answer, space to move on.
      </p>
    </div>
  );
}
