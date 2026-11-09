import Link from 'next/link';
import { DEFAULT_CONFIG, normalizeConfig, type StudyConfig } from '@/lib/study/config';
import type { QuizDirection } from '@/lib/study/quiz';
import { fieldKeysParam } from '@/lib/study/search-params';
import { loadSetPaper, studiableFields } from '@/lib/sets/session';
import { deckHref, studyHref, type Deck } from '@/lib/sets/deck';
import { QuizRunner } from '@/app/study/quiz/quiz-runner';
import { HintedLabel } from '@/app/study/_components/hint';
import { finishSetQuizAction } from '../_actions/quiz';

export type QuizSearch = {
  dir?: string; set?: string; max?: string; pri?: string;
  fields?: string | string[];
};

/** A paper drawn from one imported set. */
export async function QuizView({
  deck,
  search,
  userId,
}: {
  deck: Deck;
  search: QuizSearch;
  userId: string;
}) {
  const source = deck.source;

  const studiable = studiableFields(source);
  const fromQuery = fieldKeysParam(search.fields);
  const fields = fromQuery.length > 0
    ? fromQuery.filter((key) => studiable.some((def) => def.key === key))
    : studiable.map((def) => def.key);

  const config: StudyConfig = normalizeConfig({
    sessionMode: 'cram',
    yearLevel: null,
    fields,
    mode: search.set === 'inclusive' ? 'inclusive' : 'exclusive',
    direction: search.dir === 'fields_to_drug' ? 'fields_to_drug' : 'drug_to_fields',
    blockSize: 0,
    maxCards: search.max === undefined ? 0 : Number(search.max),
    scope: { ...DEFAULT_CONFIG.scope },
  });

  // Mixed by default, which is the paper's own setting rather than the
  // config's: a schedule cannot key a card on a coin toss, but a paper can.
  const direction: QuizDirection = search.dir === 'drug_to_fields'
    ? 'drug_to_fields'
    : search.dir === 'fields_to_drug'
      ? 'fields_to_drug'
      : 'random';

  // Weighted unless turned off, which is the drug quiz's default and for the
  // same reason: what you have missed is the clearest signal about what to ask.
  const priority = search.pri !== 'off';
  const paper = await loadSetPaper(source, config, direction, priority ? userId : null);
  const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';
  const running = paper.questions.length > 0;
  const subject = source.set.identityLabel;
  const labelFor = (key: string) => key
    .split('+')
    .map((part) => source.defs.find((def) => def.key === part)?.label ?? part)
    .join(', ');

  // What is being asked, in words, in the same order the drug quiz says it.
  const summary = running
    ? [
      `${paper.questions.length} question${paper.questions.length === 1 ? '' : 's'}`
        + (paper.available > paper.questions.length ? ` of ${paper.available}` : ''),
      config.mode === 'inclusive' ? 'per row' : 'per fact',
      direction === 'random'
        ? 'mixed directions'
        : direction === 'drug_to_fields'
          ? `${subject.toLowerCase()} → fact`
          : `fact → ${subject.toLowerCase()}`,
      ...(paper.missed ? [`${paper.missed} you’ve missed before`] : []),
      config.fields.map(labelFor).join(', '),
    ].filter((part) => part !== '')
    : [];

  return (
    <main className={`mx-auto max-w-2xl px-4 ${running ? 'py-5' : 'py-10'}`}>
      <p className="text-xs text-[var(--muted)]">
        <Link href="/sets" className="underline">Class sets</Link>
        {deck.trail.map((step) => (
          <span key={step.href}>
            {' · '}
            <Link href={step.href} className="underline">{step.label}</Link>
          </span>
        ))}
        {' · '}
        <Link href={deckHref(deck.path)} className="underline">{deck.title}</Link>
      </p>
      {running ? (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-base font-semibold tracking-tight">Quiz</h1>
          <p className="text-xs text-[var(--muted)]">{summary.join(' · ')}</p>
        </div>
      ) : (
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Quiz</h1>
      )}

      {/* Once a paper is running these are reference material about something
          already decided: changing one redraws the questions, so the summary
          says so rather than leaving live controls open mid-quiz. */}
      <details
        open={!running}
        className={`rounded border border-[var(--border)] ${running ? 'mt-2' : 'mt-3'}`}
      >
        <summary
          className={`cursor-pointer font-medium ${running ? 'px-3 py-1.5 text-xs' : 'px-4 py-3 text-sm'}`}
        >
          {running ? 'Change these and start a new quiz' : 'Quiz settings'}
          <span className="ml-2 font-normal text-[var(--muted)]">
            {running
              ? 'the one running now is left behind'
              : `${paper.available} question${paper.available === 1 ? '' : 's'} available`}
          </span>
        </summary>

        <form method="get" className="border-t border-[var(--border)] p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <HintedLabel
                htmlFor="set"
                title="Question shape"
                hint={(
                  <>
                    Per fact asks each column on its own. Per row puts every selected column in
                    one question, so the options are whole rows and the ask is which of four this
                    is — fewer questions, more evidence in each.
                  </>
                )}
              />
              <select
                id="set" name="set" defaultValue={config.mode}
                aria-describedby="set-hint" className={control}
              >
                <option value="exclusive">One question per fact</option>
                <option value="inclusive">One question per row</option>
              </select>
            </div>

            <div>
              <HintedLabel
                htmlFor="dir"
                title="Direction"
                hint={(
                  <>
                    Shown the {subject.toLowerCase()}, pick the fact — or shown a fact, pick the
                    {' '}{subject.toLowerCase()}. Mixed asks both, since recognising a fact and
                    naming what it belongs to are two different recalls.
                  </>
                )}
              />
              <select
                id="dir" name="dir" defaultValue={direction}
                aria-describedby="dir-hint" className={control}
              >
                <option value="random">Mixed — decided per question</option>
                <option value="drug_to_fields">{subject} → fact</option>
                <option value="fields_to_drug">Fact → {subject.toLowerCase()}</option>
              </select>
            </div>

            <div>
              <HintedLabel
                htmlFor="pri"
                title="Priority"
                hint={(
                  <>
                    A question you last got wrong is four times as likely to be drawn as one you
                    have never seen, and eight times as likely as one you have answered right
                    three times running — but nothing drops to zero, so a short paper still
                    works through the rest of the deck. Only changes which questions you get when
                    the count below is lower than the pool; above that it only changes the order.
                  </>
                )}
              />
              <select
                id="pri" name="pri" defaultValue={priority ? 'on' : 'off'}
                aria-describedby="pri-hint" className={control}
              >
                <option value="on">Favour what you’ve missed</option>
                <option value="off">Every question equally likely</option>
              </select>
            </div>

            <div>
              <label htmlFor="max" className="block text-sm font-medium">Questions</label>
              <input
                id="max" name="max" type="number" min={1}
                defaultValue={config.maxCards > 0 ? config.maxCards : paper.available || ''}
                placeholder="All of them"
                className={control}
              />
              <p className="mt-1 text-xs text-[var(--muted)]">
                {running
                  ? `${paper.available} can be asked from this deck. Lower it and that many are picked at random.`
                  : 'Starts at everything the deck can ask. Lower it and that many are picked at random.'}
              </p>
            </div>

            <fieldset className="sm:col-span-2">
              <legend className="text-sm font-medium">Columns</legend>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {studiable.map((def) => (
                  <label key={def.key} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox" name="fields" value={def.key}
                      defaultChecked={config.fields.includes(def.key)}
                    />
                    {def.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <button type="submit" className="btn btn-primary mt-4">
            Start
          </button>
        </form>
      </details>

      {running ? (
        <QuizRunner
          // A fresh id per render, so re-submitting starts a genuinely new
          // paper rather than redisplaying the last one.
          key={paper.id}
          questions={paper.questions}
          config={config}
          available={paper.available}
          onFinish={finishSetQuizAction}
        />
      ) : (
        <div className="mt-8 rounded border border-[var(--border)] p-4 sm:p-6">
          <p className="font-medium">Nothing to ask.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {studiable.length === 0
              ? 'Every column in this set is marked as context rather than an answer.'
              : 'A question needs at least one other row to put beside the right answer. This set '
                + 'is too small, or the columns picked are filled in for too few rows — it will '
                + 'still work as flashcards.'}
          </p>
          {paper.recallOnly > 0 && (
            <p className="mt-2 text-sm text-[var(--muted)]">
              {paper.recallOnly} row{paper.recallOnly === 1 ? '' : 's'} in this set{' '}
              {paper.recallOnly === 1 ? 'is' : 'are'} marked cards-only and never offered as
              multiple choice.
            </p>
          )}
          <p className="mt-3 text-sm">
            <Link
              href={studyHref([source.set.slug], 'flashcards')}
              className="text-[var(--accent)] underline"
            >
              Flashcard it instead
            </Link>
          </p>
        </div>
      )}
    </main>
  );
}
