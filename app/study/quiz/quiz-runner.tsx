'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import type { StudyConfig } from '@/lib/study/config';
import type { QuizQuestion } from '@/lib/study/quiz';
import { LookupPanel, LookupTrigger, type LookupTarget } from '../_components/lookup-panel';
import type { FinishState } from './actions';

type Answer = { chosenIndex: number | null };
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


/**
 * The drugs a shared answer belongs to, named rather than summarised.
 *
 * `fromOwners` carries every drug an option is true of, which for most fields
 * is one. The controlled schedule is the case that made this necessary: nine
 * drugs in the sheet are CII, and naming only the one the option happened to
 * be drawn from reads as if the other eight were not -- the answer to "whose
 * schedule is this" is a list.
 *
 * Capped at four with a count after it. Nine names in a sentence is a list
 * nobody reads, and the number is the fact worth taking away: *this is not a
 * distinguishing answer*.
 */
function Owners({
  owners,
  tone,
  onLookup,
}: {
  owners: { slug: string; generic: string }[];
  tone: string;
  onLookup: (drug: LookupTarget) => void;
}) {
  const shown = owners.slice(0, 4);
  const rest = owners.length - shown.length;

  return (
    <>
      {shown.map((owner, at) => (
        <span key={owner.slug}>
          {at > 0 && (
            <span className="text-[var(--muted)]">
              {at === shown.length - 1 && rest === 0 ? ' and ' : ', '}
            </span>
          )}
          <button
            type="button"
            onClick={() => onLookup(owner)}
            className={`${tone} underline`}
          >
            {owner.generic}
          </button>
        </span>
      ))}
      {rest > 0 && (
        <span className="text-[var(--muted)]">
          {' '}and {rest} other{rest === 1 ? '' : 's'}
        </span>
      )}
    </>
  );
}

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
  onLookup,
}: {
  question: QuizQuestion;
  chosenIndex: number;
  onLookup: (drug: LookupTarget) => void;
}) {
  const chosen = question.options[chosenIndex];
  const owner = question.fromGeneric[chosenIndex];
  const fact = question.fromFact[chosenIndex];
  const slug = question.fromSlug[chosenIndex];
  // Everyone it is true of, not just the drug it was drawn from. Falls back to
  // that drug for a question built before the field existed -- a paper is held
  // in memory across a deploy.
  const owners = question.fromOwners?.[chosenIndex]?.length
    ? question.fromOwners[chosenIndex]
    : slug !== null && owner !== null
      ? [{ slug, generic: owner }]
      : [];
  if (!owner) return null;

  // Both halves of the pair wear the colour the wrong option was marked in,
  // so the sentence reads as belonging to the answer that was wrong rather
  // than as a general note. The connective words stay muted: what is being
  // pointed at is the drug and the fact, not "is the" or "of".
  const half = 'text-[var(--flagged)]';

  if (fact) {
    // Options were drug names: say what that drug is actually for.
    return (
      <>
        <span className="text-[var(--muted)]">{question.fieldLabel} of </span>
        <span className={half}>{owner}</span>
        <span className="text-[var(--muted)]">: </span>
        <span className={half}>{fact}</span>
      </>
    );
  }

  // Options were facts: say whose fact it is -- all of whose, where more than
  // one drug shares it.
  return (
    <>
      <span className="text-[var(--muted)]">&ldquo;</span>
      <span className={half}>{chosen}</span>
      <span className="text-[var(--muted)]">
        &rdquo; is the {question.fieldLabel.toLowerCase()} of{' '}
      </span>
      {owners.length === 0 ? (
        <span className={half}>{owner}</span>
      ) : (
        <Owners owners={owners} tone={half} onLookup={onLookup} />
      )}
      <span className="text-[var(--muted)]">.</span>
    </>
  );
}

/**
 * Who else the right answer is right about.
 *
 * The complaint this answers: a schedule question marked wrong names the
 * correct answer and one drug, when nine drugs in the sheet are CII. The
 * right answer to "what is methylphenidate's schedule" is CII, and the thing
 * worth learning alongside it is that CII is not a fact *about
 * methylphenidate* -- it is a fact about a group, and here is the group.
 *
 * Only ever rendered where the answer is genuinely shared, so it is silent on
 * a mechanism or a dose, which is nearly everything. The asked drug is left
 * out: it is already named in the prompt.
 */
function SharedAnswer({
  question,
  onLookup,
}: {
  question: QuizQuestion;
  onLookup: (drug: LookupTarget) => void;
}) {
  const owners = (question.fromOwners?.[question.correctIndex] ?? [])
    .filter((owner) => owner.slug !== question.slug);
  if (owners.length === 0) return null;

  return (
    <p className="mt-2 text-sm text-[var(--muted)]">
      Also the {question.fieldLabel.toLowerCase()} of{' '}
      <Owners owners={owners} tone="text-[var(--verified)]" onLookup={onLookup} />
      <span>.</span>
    </p>
  );
}

/**
 * Every other answer this question would have taken.
 *
 * Shown on the card and again in the review, because the review is where a
 * wrong answer is actually read back -- it was missing there, which made a
 * fact-to-drug question look as though one drug was the answer when the clue
 * was true of nine.
 */
function AlsoRight({ question }: { question: QuizQuestion }) {
  const others = question.acceptable
    .filter((text) => text !== question.options[question.correctIndex]);
  if (others.length === 0) return null;

  return (
    <span className="text-xs text-[var(--muted)]">Also right: {others.join(', ')}</span>
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
  const [lookup, setLookup] = useState<LookupTarget | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [finished, setFinished] = useState(false);
  const [saved, setSaved] = useState<FinishState | null>(null);

  /**
   * *Again* -- the same settings, a new paper, started.
   *
   * `router.refresh()` rather than a link, because the settings are already
   * what this page was rendered with: re-running the server render draws a
   * fresh paper from the same filters, and the page keys this component on
   * that paper's id, so a new draw remounts the runner with the new questions.
   * A link would have to rebuild the query out of the config, which is a
   * second opinion about what the settings were.
   *
   * Deliberately not offered until the attempt has been recorded. The write
   * happens in an effect on this component, and remounting mid-write would
   * throw away the quiz just sat.
   */
  const router = useRouter();
  const [starting, startAgain] = useTransition();

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
      // The panel owns the keyboard while it is open, and the search box owns
      // it while it has focus.
      if (lookup !== null || typingSomewhere(event)) return;
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
  }, [lookup, finished, saved, answers, config, questions, onFinish]);

  if (questions.length === 0) {
    return (
      <div className="mt-10 rounded border border-[var(--border)] p-4 sm:p-6">
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
        <div className="rounded border border-[var(--border)] p-4 sm:p-6">
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
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={saved === null || starting}
              onClick={() => startAgain(() => router.refresh())}
              title="A new paper from the same settings"
              className="btn btn-primary"
            >
              {starting ? 'Drawing…' : 'Again'}
            </button>
            {/* A button, not a link. It does the same kind of thing the
                button beside it does -- start a quiz -- and two controls with
                one job should not be two different shapes. */}
            <Link href="/study/quiz" className="btn btn-quiet">
              Another quiz
            </Link>
            <span className="text-xs text-[var(--muted)]">
              Again redraws these {questions.length} question
              {questions.length === 1 ? '' : 's'}&rsquo; worth from the same filters.
            </span>
          </div>
        </div>

        <LookupPanel drug={lookup} available onClose={() => setLookup(null)} />

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
                      <span className="text-[var(--verified)]">{row.options[row.correctIndex]}</span>
                    </p>
                    {chosen !== undefined && chosen !== null ? (
                      <>
                        <p className="text-sm">
                          <span className="text-[var(--muted)]">Your answer: </span>
                          <span className="text-[var(--flagged)]">{row.options[chosen]}</span>
                        </p>
                        <p className="mt-2 text-sm text-[var(--muted)]">
                          <Mismatch question={row} chosenIndex={chosen} onLookup={setLookup} />
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-[var(--muted)]">Not answered.</p>
                    )}
                    <SharedAnswer question={row} onLookup={setLookup} />
                    <div className="mt-1">
                      <AlsoRight question={row} />
                    </div>
                    {/* Nothing left to answer by the summary, so nothing
                        left to protect. */}
                    <div className="mt-2">
                      <LookupTrigger
                        drug={{ slug: row.slug, generic: row.generic }}
                        available
                        unavailableReason=""
                        onOpen={setLookup}
                        className="text-xs text-[var(--accent)] underline"
                      />
                    </div>
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
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-[var(--muted)]">
        <span>
          Question {index + 1} of {questions.length}
          {available > questions.length && ` · drawn from ${available}`}
        </span>
        <span>{score} right of {done} answered</span>
      </div>

      <article className="mt-3 rounded border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
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
                  className="flex w-full items-baseline gap-3 rounded border px-3 py-3 text-left disabled:cursor-default sm:px-4"
                >
                  <span className="shrink-0 text-xs text-[var(--muted)]">{optionIndex + 1}</span>
                  {/* min-w-0: a flex child will not shrink below its content
                      without it, so one long option would widen the whole
                      button past the card. */}
                  <span className="min-w-0 whitespace-pre-line">{option}</span>
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
            <Mismatch question={question} chosenIndex={answer.chosenIndex} onLookup={setLookup} />
          </p>
        )}

        {answered && <SharedAnswer question={question} onLookup={setLookup} />}

        {answered && (
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={next}
              className="btn btn-primary"
            >
              {index + 1 < questions.length ? 'Next' : 'Finish'}
            </button>
            {/* The drug itself, over the paper rather than instead of it.
                This used to open a new tab, which was the only way to look
                something up without losing the session.

                This row only renders once the question is answered, so the
                gate below never actually shows its sentence here -- it is
                stated anyway, so that moving the row cannot quietly move the
                rule with it. The flashcard footer, which renders either way,
                is where the sentence is seen. */}
            <LookupTrigger
              drug={{ slug: question.slug, generic: question.generic }}
              available={answered}
              unavailableReason="Answer first, then look it up"
              onOpen={setLookup}
            />
            <AlsoRight question={question} />
          </div>
        )}
      </article>

      <LookupPanel drug={lookup} available={answered} onClose={() => setLookup(null)} />

      <p className="mt-3 text-xs text-[var(--muted)]">
        1–{question.options.length} to answer, space to move on.
      </p>
    </div>
  );
}
