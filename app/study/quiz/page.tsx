import { asc, count, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { drugIndications, drugTags, indications, tags } from '@/db/schema';
import { indicationOptions } from '@/lib/drugs/indications';
import { listFieldDefs } from '@/lib/fields/registry';
import { TAG_KIND_GROUPS } from '@/lib/tags/constants';
import { requireUser } from '@/lib/session';
import { DEFAULT_CONFIG, fieldsForYear, normalizeConfig, type StudyConfig, type YearLevel } from '@/lib/study/config';
import type { QuizDirection } from '@/lib/study/quiz';
import { loadQuiz, recentAttempts } from '@/lib/study/quiz-session';
import {
  describeSetup, listSetups, saveSetupHref, setupParams, startsSomething, SURFACES,
} from '@/lib/study/presets';
import { fieldKeysParam, manyParam } from '@/lib/study/search-params';
import { FieldPicker } from '../_components/field-picker';
import { SaveSetupButton } from '../_components/save-setup-button';
import { SetupBar } from '../_components/setup-bar';
import { HintedLabel } from '../_components/hint';
import { RememberSetup } from '../_components/remember-setup';
import { ScopePicker } from '../_components/scope-picker';
import { finishQuizAction } from './actions';
import { QuizRunner } from './quiz-runner';

export const metadata = { title: 'Quiz' };
export const dynamic = 'force-dynamic';

type Search = {
  year?: string; max?: string; dir?: string; tag?: string; set?: string; pri?: string;
  /** Repeated once per ticked box, so these arrive as arrays. */
  fields?: string | string[];
  cat?: string | string[];
  ind?: string | string[];
};

/**
 * The same config the flashcards use, minus the three things that only mean
 * something to a schedule: review/cram, blocks and the due filter. A quiz is a
 * paper, not a spacing algorithm.
 */
function configFromSearch(search: Search, defs: Awaited<ReturnType<typeof listFieldDefs>>): StudyConfig {
  const year = ['P1', 'P2', 'P3'].includes(search.year ?? '') ? (search.year as YearLevel) : null;
  const fromQuery = fieldKeysParam(search.fields);
  const fields = fromQuery.length > 0 ? fromQuery : year ? fieldsForYear(defs, year) : [];

  return normalizeConfig({
    sessionMode: 'cram',
    yearLevel: year,
    fields,
    // Per fact by default: a question per field is what most of a quiz should
    // be. Per drug bundles the whole selection into one question instead.
    mode: search.set === 'inclusive' ? 'inclusive' : 'exclusive',
    // The stored config keeps a concrete direction; `random` lives beside it
    // as a paper setting, because a schedule cannot key a card on a coin toss.
    direction: search.dir === 'fields_to_drug' ? 'fields_to_drug' : 'drug_to_fields',
    blockSize: 0,
    // 0 is no cap, which is what an untouched control means: the paper is
    // everything the filters can ask.
    maxCards: search.max === undefined ? 0 : Number(search.max),
    scope: {
      ...DEFAULT_CONFIG.scope,
      dueOnly: false,
      tags: search.tag ? [search.tag] : [],
      categories: manyParam(search.cat),
      indications: manyParam(search.ind),
    },
  });
}

export default async function QuizPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireUser();
  const search = await searchParams;

  const [defs, listRows, categoryRows, indicationRows, history] = await Promise.all([
    listFieldDefs(),
    db.select({ slug: tags.slug, label: tags.label, kind: tags.kind }).from(tags)
      .where(ne(tags.kind, 'system')).orderBy(asc(tags.label)),
    db.select({ slug: tags.slug, label: tags.label, count: count(drugTags.drugId) })
      .from(tags)
      .leftJoin(drugTags, eq(drugTags.tagId, tags.id))
      .where(eq(tags.kind, 'system'))
      .groupBy(tags.slug, tags.label)
      .orderBy(asc(tags.label)),
    db
      .select({
        drugId: drugIndications.drugId,
        slug: indications.slug,
        label: indications.label,
      })
      .from(drugIndications)
      .innerJoin(indications, eq(indications.id, drugIndications.indicationId)),
    recentAttempts(session.user.id, 5),
  ]);
  const indicationChoices = indicationOptions(indicationRows);

  const config = configFromSearch(search, defs);
  // Random unless asked otherwise: a paper that only ever asks one way trains
  // one half of the recall.
  const direction: QuizDirection = search.dir === 'drug_to_fields' || search.dir === 'fields_to_drug'
    ? search.dir
    : 'random';
  // Weighted unless turned off: missing something is the clearest signal the
  // app has about what to ask next, and ignoring it by default would waste it.
  const priority = search.pri !== 'off';
  const quizzable = defs.filter((def) => def.isQuizzable && def.key !== 'generic');
  const started = config.fields.length > 0;
  const paper = started
    ? await loadQuiz(config, { direction, weightFor: priority ? session.user.id : null })
    : { id: 'none', questions: [], available: 0, missed: null };

  // A per-drug question's fieldKey is the whole selection joined, so history
  // reads back as "Mechanism of action, Dosing" rather than "moa+dosing".
  const labelFor = (key: string) => key
    .split('+')
    .map((part) => defs.find((def) => def.key === part)?.label ?? part)
    .join(', ');

  // The setups saved for this page, and where saving this one goes. Both read
  // off the query, which is where every setting already lives.
  const saveParams = setupParams('quiz', search);
  const setups = (await listSetups(session.user.id, 'quiz')).map((setup) => ({
    id: setup.id,
    name: setup.name,
    params: setup.params,
    summary: describeSetup('quiz', setup.params, labelFor),
  }));

  // What is being asked, in words, so it can be read without opening anything.
  const summary = started
    ? [
      `${paper.questions.length} question${paper.questions.length === 1 ? '' : 's'}`
        + (paper.available > paper.questions.length ? ` of ${paper.available}` : ''),
      config.mode === 'inclusive' ? 'per drug' : 'per fact',
      direction === 'random'
        ? 'mixed directions'
        : direction === 'drug_to_fields' ? 'drug → fact' : 'fact → drug',
      // Only worth a word when there is something to say: a first quiz has no
      // history, and "0 you have missed before" reads like a verdict on it.
      ...(paper.missed ? [`${paper.missed} you’ve missed before`] : []),
      config.fields.map(labelFor).join(', '),
      ...(config.scope.tags.length > 0
        ? [listRows.find((tag) => tag.slug === config.scope.tags[0])?.label ?? config.scope.tags[0]]
        : []),
      ...(config.scope.categories.length > 0
        ? [`${config.scope.categories.length} categor${config.scope.categories.length === 1 ? 'y' : 'ies'}`]
        : []),
      ...(config.scope.indications.length > 0
        ? [`${config.scope.indications.length} indication${config.scope.indications.length === 1 ? '' : 's'}`]
        : []),
    ]
    : [];
  const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

  // Everything above the question, on one line, once there is a question.
  //
  // Before a quiz starts this page is a form and the title, the saved setups
  // and the settings each deserve their own row. The moment a paper is on
  // screen they are reference material about something you have already
  // decided, and they were taking about 140px of the first screenful -- enough
  // to push the options of a four-option question below the fold on a laptop.
  // So while a quiz is running the title shrinks to a label, the summary and
  // the setups join it on that line, and the settings panel keeps only its
  // one-line summary.
  const setupBar = (
    <SetupBar
      path={SURFACES.quiz.path}
      setups={setups}
      saveHref={startsSomething(saveParams) ? saveSetupHref('quiz', saveParams) : null}
      compact={started}
    />
  );

  return (
    <main className={`mx-auto max-w-2xl px-4 ${started ? 'py-5' : 'py-10'}`}>
      {/* Once a quiz is running the settings are a read-only line. Changing
          one mid-quiz cannot do what it looks like it does -- it redraws the
          questions, so it would throw away the quiz in hand -- and opening the
          form says so rather than leaving the controls sitting there live.

          The setup bar is outside the panel below either way: the panel
          collapses the moment a quiz starts, which is exactly when there is a
          setup worth saving, so a save link inside it would be hidden at the
          only time it applies. */}
      {started ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-base font-semibold tracking-tight">Quiz</h1>
          <p className="text-xs text-[var(--muted)]">{summary.join(' · ')}</p>
          {setupBar}
        </div>
      ) : (
        <>
          <h1 className="text-2xl font-semibold tracking-tight">Quiz</h1>
          {setupBar}
        </>
      )}

      <details
        open={!started}
        className={`rounded border border-[var(--border)] ${started ? 'mt-2' : 'mt-3'}`}
      >
        <summary
          className={`cursor-pointer font-medium ${started ? 'px-3 py-1.5 text-xs' : 'px-4 py-3 text-sm'}`}
        >
          {started ? 'Change these and start a new quiz' : 'Quiz settings'}
          {started && (
            <span className="ml-2 font-normal text-[var(--muted)]">
              the one running now is left behind
            </span>
          )}
        </summary>

        <form method="get" className="border-t border-[var(--border)] p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldPicker
              fields={quizzable.map((def) => ({ key: def.key, label: def.label, yearLevels: def.yearLevels }))}
              selected={config.fields}
              year={config.yearLevel ?? ''}
              control={control}
            />

            <div>
              <HintedLabel
                htmlFor="set"
                title="Question shape"
                hint={(
                  <>
                    Per fact asks each field on its own. Per drug puts every selected field in one
                    question, so the options are whole profiles and the ask is which of four drugs
                    this is — fewer questions, more evidence in each.
                  </>
                )}
              />
              <select
                id="set" name="set" defaultValue={config.mode}
                aria-describedby="set-hint" className={control}
              >
                <option value="exclusive">One question per fact</option>
                <option value="inclusive">One question per drug</option>
              </select>
            </div>

            <div>
              <HintedLabel
                htmlFor="dir"
                title="Direction"
                hint={(
                  <>
                    Shown a drug, pick the fact — or shown a fact, pick the drug. Mixed asks
                    both, since recognising a mechanism and naming its drug are two different
                    recalls.
                  </>
                )}
              />
              <select
                id="dir" name="dir" defaultValue={direction}
                aria-describedby="dir-hint" className={control}
              >
                <option value="random">Mixed — decided per question</option>
                <option value="drug_to_fields">Drug → fact</option>
                <option value="fields_to_drug">Fact → drug</option>
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
                    three times running — but nothing drops to zero, so a short quiz still
                    works through the rest of the material instead of re-sitting the same corner
                    of it. Only changes which questions you get when the count below is lower
                    than the pool; above that it only changes the order.
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

            {listRows.length > 0 && (
              <div>
                <label htmlFor="tag" className="block text-sm font-medium">Drug list</label>
                <select id="tag" name="tag" defaultValue={config.scope.tags[0] ?? ''} className={control}>
                  <option value="">Every drug</option>
                  {/* Grouped by kind, because the axis holds five different
                      questions now: which drugs are on a syllabus, which year
                      teaches them, and the three scopes that can also teach a
                      drug in their own words. */}
                  {TAG_KIND_GROUPS.map(({ kind, label }) => {
                    const group = listRows.filter((tag) => tag.kind === kind);
                    if (group.length === 0) return null;
                    return (
                      <optgroup key={kind} label={label}>
                        {group.map((tag) => (
                          <option key={tag.slug} value={tag.slug}>{tag.label}</option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  A class or exam here is studied in <em>its own words</em>: where it
                  has its own wording for a drug, that is what the quiz asks. Everything else is
                  the drug&rsquo;s own, and the narrowest one in scope wins.
                </p>
              </div>
            )}

            <div>
              <label htmlFor="max" className="block text-sm font-medium">Questions</label>
              {/* Shows everything the current filters can ask, so an untouched
                  control means the whole paper rather than an arbitrary 20.
                  Lower it and that many are drawn at random. */}
              <input
                id="max" name="max" type="number" min={1}
                defaultValue={config.maxCards > 0 ? config.maxCards : paper.available || ''}
                placeholder="All of them"
                className={control}
              />
              <p className="mt-1 text-xs text-[var(--muted)]">
                {started
                  ? `${paper.available} can be asked with these filters. Lower it and that many are picked at random.`
                  : 'Starts at everything the filters can ask. Lower it and that many are picked at random.'}
              </p>
            </div>

            {categoryRows.length > 0 && (
              <ScopePicker
                name="cat"
                legend="Categories"
                description="Therapeutic groups — beta blockers, anticonvulsants, statins. Pick several for the drugs in any of them."
                filterLabel="Filter categories"
                options={categoryRows}
                selected={config.scope.categories}
                control={control}
              />
            )}

            {indicationChoices.length > 0 && (
              <ScopePicker
                name="ind"
                legend="Indications"
                description="What the drug is used for, in the sheet’s own words. Pick several for the drugs treating any of them."
                filterLabel="Filter indications"
                options={indicationChoices}
                selected={config.scope.indications}
                control={control}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn btn-primary mt-4">
              Start
            </button>
            {/* Saves what the controls say now, which is what lets a setup be
                kept without starting anything. */}
            <SaveSetupButton surface="quiz" />
          </div>
        </form>
      </details>

      {/* Renders nothing. Tells the server this is the quiz to offer on the
          home page next time, which is why it sits inside the started branch:
          a page showing its form started nothing. */}
      {started ? (
        <>
        <RememberSetup surface="quiz" params={saveParams} />
        <QuizRunner
          // A fresh id per render, so re-submitting the same filters starts a
          // genuinely new paper rather than redisplaying the last one.
          key={paper.id}
          questions={paper.questions}
          config={config}
          available={paper.available}
          onFinish={finishQuizAction}
        />
        </>
      ) : (
        <p className="mt-8 text-[var(--muted)]">
          Pick a year or some fields to sit a quiz. Four options a question: the answer, one near
          miss from the same class, and two from further afield.
        </p>
      )}

      {history.length > 0 && (
        <section className="mt-12 border-t border-[var(--border)] pt-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
            Previous quizzes
          </h2>
          <ul className="mt-3 space-y-2 text-sm">
            {history.map((attempt) => (
              <li key={attempt.id} className="flex flex-wrap items-baseline gap-x-3">
                <span className="font-medium">
                  {attempt.score}/{attempt.total}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {attempt.startedAt.toLocaleDateString()}
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {attempt.byField
                    .map((field) => `${labelFor(field.fieldKey)} ${field.right}/${field.asked}`)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
