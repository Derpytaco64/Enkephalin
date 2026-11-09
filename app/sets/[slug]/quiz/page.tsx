import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/session';
import { DEFAULT_CONFIG, normalizeConfig, type StudyConfig } from '@/lib/study/config';
import type { QuizDirection } from '@/lib/study/quiz';
import { fieldKeysParam } from '@/lib/study/search-params';
import { loadSetPaper, loadSetStudy, studiableFields } from '@/lib/sets/session';
import { QuizRunner } from '@/app/study/quiz/quiz-runner';
import { finishSetQuizAction } from './actions';

export const dynamic = 'force-dynamic';

type Search = {
  dir?: string; set?: string; max?: string;
  fields?: string | string[];
};

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const source = await loadSetStudy(slug);
  return { title: source ? `${source.set.name} — quiz` : 'Quiz' };
}

/** A paper drawn from one imported set. */
export default async function SetQuizPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Search>;
}) {
  await requireUser();
  const [{ slug }, search] = await Promise.all([params, searchParams]);

  const source = await loadSetStudy(slug);
  if (!source) notFound();

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

  const paper = await loadSetPaper(source, config, direction);
  const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';
  const running = paper.questions.length > 0;
  const subject = source.set.identityLabel;

  return (
    <main className={`mx-auto max-w-2xl px-4 ${running ? 'py-5' : 'py-10'}`}>
      <p className="text-xs text-[var(--muted)]">
        <Link href="/sets" className="underline">Sets</Link>
        {' · '}
        <Link href={`/sets/${source.set.slug}`} className="underline">{source.set.name}</Link>
      </p>
      <h1 className={`mt-1 font-semibold tracking-tight ${running ? 'text-base' : 'text-2xl'}`}>
        Quiz
      </h1>

      <details open={!running} className="mt-3 rounded border border-[var(--border)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Paper settings
          <span className="ml-2 font-normal text-[var(--muted)]">
            {paper.available} question{paper.available === 1 ? '' : 's'} available
          </span>
        </summary>

        <form method="get" className="border-t border-[var(--border)] p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="dir" className="block text-sm font-medium">Direction</label>
              <select id="dir" name="dir" defaultValue={search.dir ?? 'random'} className={control}>
                <option value="random">Mixed</option>
                <option value="drug_to_fields">{subject} → facts</option>
                <option value="fields_to_drug">Facts → {subject.toLowerCase()}</option>
              </select>
            </div>

            <div>
              <label htmlFor="max" className="block text-sm font-medium">Most questions</label>
              <input
                id="max" name="max" type="number" min={1}
                defaultValue={config.maxCards > 0 ? config.maxCards : ''}
                placeholder="All of them"
                className={control}
              />
            </div>

            <div>
              <label htmlFor="set" className="block text-sm font-medium">Question shape</label>
              <select id="set" name="set" defaultValue={config.mode} className={control}>
                <option value="exclusive">One question per fact</option>
                <option value="inclusive">One question per row</option>
              </select>
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
            {running ? 'Another paper' : 'Start'}
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
              href={`/sets/${source.set.slug}/flashcards`}
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
