import Link from 'next/link';
import { listFieldDefs } from '@/lib/fields/registry';
import { requireUser } from '@/lib/session';
import { DEFAULT_CONFIG, fieldsForYear, normalizeConfig, type StudyConfig, type YearLevel } from '@/lib/study/config';
import { loadDeck } from '@/lib/study/session';
import { SessionRunner } from './session-runner';

export const metadata = { title: 'Flashcards — Enkephalin' };
export const dynamic = 'force-dynamic';

type Search = { mode?: string; year?: string; fields?: string; block?: string; dir?: string; set?: string };

/**
 * The config lives in the URL rather than in state: a session you like is then
 * a link you can keep, and the back button undoes a change rather than
 * abandoning the run.
 */
function configFromSearch(search: Search, defs: Awaited<ReturnType<typeof listFieldDefs>>): StudyConfig {
  const year = ['P1', 'P2', 'P3'].includes(search.year ?? '') ? (search.year as YearLevel) : null;
  const fromQuery = (search.fields ?? '').split(',').map((key) => key.trim()).filter(Boolean);
  const fields = fromQuery.length > 0 ? fromQuery : year ? fieldsForYear(defs, year) : [];

  return normalizeConfig({
    sessionMode: search.mode === 'cram' ? 'cram' : 'review',
    yearLevel: year,
    fields,
    mode: search.set === 'inclusive' ? 'inclusive' : 'exclusive',
    direction: search.dir === 'fields_to_drug' ? 'fields_to_drug' : 'drug_to_fields',
    blockSize: search.block === undefined ? DEFAULT_CONFIG.blockSize : Number(search.block),
  });
}

export default async function FlashcardsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireUser();
  const search = await searchParams;
  const defs = await listFieldDefs();

  const config = configFromSearch(search, defs);
  const quizzable = defs.filter((def) => def.isQuizzable);
  const started = config.fields.length > 0;
  const deck = started ? await loadDeck(session.user.id, config) : { cards: [], inScope: 0 };

  const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Flashcards</h1>

      <form method="get" className="mt-6 rounded border border-[var(--border)] p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="mode" className="block text-sm font-medium">Session</label>
            <select id="mode" name="mode" defaultValue={config.sessionMode} className={control}>
              <option value="review">Review — what is due</option>
              <option value="cram">Cram — everything, schedule untouched</option>
            </select>
          </div>

          <div>
            <label htmlFor="year" className="block text-sm font-medium">Year</label>
            <select id="year" name="year" defaultValue={config.yearLevel ?? ''} className={control}>
              <option value="">Pick fields myself</option>
              <option value="P1">P1</option>
              <option value="P2">P2</option>
              <option value="P3">P3</option>
            </select>
            <p className="mt-1 text-xs text-[var(--muted)]">Selects the fields that year is responsible for.</p>
          </div>

          <div>
            <label htmlFor="set" className="block text-sm font-medium">Card shape</label>
            <select id="set" name="set" defaultValue={config.mode} className={control}>
              <option value="exclusive">One card per fact</option>
              <option value="inclusive">One card per drug</option>
            </select>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Per fact gives each field its own card and its own schedule, so mechanism and dosing
              advance separately. Per drug asks for every selected field at once — far fewer cards,
              and one schedule covering the set.
            </p>
          </div>

          <div>
            <label htmlFor="dir" className="block text-sm font-medium">Direction</label>
            <select id="dir" name="dir" defaultValue={config.direction} className={control}>
              <option value="drug_to_fields">Drug → facts</option>
              <option value="fields_to_drug">Facts → drug</option>
            </select>
          </div>

          <div>
            <label htmlFor="block" className="block text-sm font-medium">Block size</label>
            <input
              id="block" name="block" type="number" min={0} defaultValue={config.blockSize} className={control}
            />
            <p className="mt-1 text-xs text-[var(--muted)]">0 for one flat pass.</p>
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium">Fields</legend>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Leave empty to use the year above. How these become cards depends on the card shape.
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {quizzable.map((def) => (
              <label key={def.key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox" name="fields" value={def.key}
                  defaultChecked={config.fields.includes(def.key)}
                />
                {def.label}
              </label>
            ))}
          </div>
        </fieldset>

        <button type="submit" className="mt-4 rounded bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)]">
          Start
        </button>
      </form>

      {started ? (
        <SessionRunner cards={deck.cards} config={config} inScope={deck.inScope} />
      ) : (
        <p className="mt-8 text-[var(--muted)]">
          Pick a year or some fields to build a deck. There are{' '}
          <Link href="/drugs" className="text-[var(--accent)] underline">236 drugs</Link> to draw from.
        </p>
      )}
    </main>
  );
}
