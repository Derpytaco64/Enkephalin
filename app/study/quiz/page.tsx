import { asc, count, eq, ne } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { drugIndications, drugTags, indications, tags } from '@/db/schema';
import { indicationOptions } from '@/lib/drugs/indications';
import { listFieldDefs } from '@/lib/fields/registry';
import { requireUser } from '@/lib/session';
import { DEFAULT_CONFIG, fieldsForYear, normalizeConfig, type StudyConfig, type YearLevel } from '@/lib/study/config';
import type { QuizDirection } from '@/lib/study/quiz';
import { loadQuiz, recentAttempts } from '@/lib/study/quiz-session';
import { fieldKeysParam, manyParam } from '@/lib/study/search-params';
import { FieldPicker } from '../_components/field-picker';
import { ScopePicker } from '../_components/scope-picker';
import { finishQuizAction } from './actions';
import { QuizRunner } from './quiz-runner';

export const metadata = { title: 'Quiz — Enkephalin' };
export const dynamic = 'force-dynamic';

type Search = {
  year?: string; max?: string; dir?: string; tag?: string;
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
    mode: 'exclusive',
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
    db.select({ slug: tags.slug, label: tags.label }).from(tags)
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
  const quizzable = defs.filter((def) => def.isQuizzable && def.key !== 'generic');
  const started = config.fields.length > 0;
  const paper = started ? await loadQuiz(config, direction) : { questions: [], available: 0 };

  const labelFor = (key: string) => defs.find((def) => def.key === key)?.label ?? key;
  const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Quiz</h1>
        <Link href="/study/flashcards" className="text-sm text-[var(--accent)] underline">
          Flashcards
        </Link>
      </div>

      <details open={paper.questions.length === 0} className="mt-6 rounded border border-[var(--border)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Paper settings
          {started && (
            <span className="ml-2 font-normal text-[var(--muted)]">
              {paper.questions.length} question{paper.questions.length === 1 ? '' : 's'}
              {paper.available > paper.questions.length && ` of ${paper.available}`}
              {' · '}
              {direction === 'random'
                ? 'mixed directions'
                : direction === 'drug_to_fields' ? 'drug → fact' : 'fact → drug'}
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
              <label htmlFor="dir" className="block text-sm font-medium">Direction</label>
              <select id="dir" name="dir" defaultValue={direction} className={control}>
                <option value="random">Mixed — decided per question</option>
                <option value="drug_to_fields">Drug → fact</option>
                <option value="fields_to_drug">Fact → drug</option>
              </select>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Shown a drug, pick the fact — or shown a fact, pick the drug. Mixed asks both,
                since recognising a mechanism and naming its drug are two different recalls.
              </p>
            </div>

            {listRows.length > 0 && (
              <div>
                <label htmlFor="tag" className="block text-sm font-medium">Drug list</label>
                <select id="tag" name="tag" defaultValue={config.scope.tags[0] ?? ''} className={control}>
                  <option value="">Every drug</option>
                  {listRows.map((tag) => (
                    <option key={tag.slug} value={tag.slug}>{tag.label}</option>
                  ))}
                </select>
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

          <button type="submit" className="mt-4 rounded bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)]">
            Start
          </button>
        </form>
      </details>

      {started ? (
        <QuizRunner
          questions={paper.questions}
          config={config}
          available={paper.available}
          onFinish={finishQuizAction}
        />
      ) : (
        <p className="mt-8 text-[var(--muted)]">
          Pick a year or some fields to sit a paper. Four options a question: the answer, one near
          miss from the same class, and two from further afield.
        </p>
      )}

      {history.length > 0 && (
        <section className="mt-12 border-t border-[var(--border)] pt-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
            Recent papers
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
