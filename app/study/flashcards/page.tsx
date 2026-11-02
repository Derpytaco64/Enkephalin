import { asc, eq, ne } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { tags } from '@/db/schema';
import { listFieldDefs } from '@/lib/fields/registry';
import { requireUser } from '@/lib/session';
import { DEFAULT_CONFIG, fieldsForYear, normalizeConfig, type StudyConfig, type YearLevel } from '@/lib/study/config';
import { loadDeck } from '@/lib/study/session';
import { FieldPicker } from './field-picker';
import { SessionRunner } from './session-runner';

export const metadata = { title: 'Flashcards — Enkephalin' };
export const dynamic = 'force-dynamic';

type Search = {
  mode?: string; year?: string; fields?: string; block?: string;
  dir?: string; set?: string; tag?: string; cat?: string;
};

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
    mode: search.set === 'exclusive' ? 'exclusive' : DEFAULT_CONFIG.mode,
    direction: search.dir === 'fields_to_drug' ? 'fields_to_drug' : 'drug_to_fields',
    blockSize: search.block === undefined ? DEFAULT_CONFIG.blockSize : Number(search.block),
    scope: {
      ...DEFAULT_CONFIG.scope,
      tags: search.tag ? [search.tag] : [],
      categories: search.cat ? [search.cat] : [],
    },
  });
}

export default async function FlashcardsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireUser();
  const search = await searchParams;
  // Lists and categories are both tags, and they are two different questions:
  // which drugs are on the syllabus, and which kind of drug. Kept apart so one
  // dropdown does not hold "Top Drugs 2026" beside sixty-five therapeutic
  // categories.
  const [defs, listRows, categoryRows] = await Promise.all([
    listFieldDefs(),
    db.select({ slug: tags.slug, label: tags.label }).from(tags)
      .where(ne(tags.kind, 'system')).orderBy(asc(tags.label)),
    db.select({ slug: tags.slug, label: tags.label }).from(tags)
      .where(eq(tags.kind, 'system')).orderBy(asc(tags.label)),
  ]);

  const config = configFromSearch(search, defs);
  // The drug's own name is the stimulus or the answer, never one of the things
  // asked about, so it is not on offer here.
  const quizzable = defs.filter((def) => def.isQuizzable && def.key !== 'generic');
  const started = config.fields.length > 0;
  const deck = started ? await loadDeck(session.user.id, config) : { cards: [], inScope: 0 };

  const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Flashcards</h1>

      {/* Open whenever there is nothing to study -- no fields picked, nothing
          matched, or everything scheduled for later -- since those are exactly
          the moments you need the controls. Collapsed once cards are running,
          because then the card is the page. */}
      <details open={deck.cards.length === 0} className="mt-6 rounded border border-[var(--border)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Session settings
          {started && (
            <span className="ml-2 font-normal text-[var(--muted)]">
              {config.sessionMode === 'cram' ? 'Cram' : 'Review'} ·{' '}
              {config.mode === 'inclusive' ? 'per drug' : 'per fact'} · {config.fields.length} field
              {config.fields.length === 1 ? '' : 's'}
            </span>
          )}
        </summary>

        <form method="get" className="border-t border-[var(--border)] p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="mode" className="block text-sm font-medium">Session</label>
            <select id="mode" name="mode" defaultValue={config.sessionMode} className={control}>
              <option value="review">Review — what is due</option>
              <option value="cram">Cram — everything, schedule untouched</option>
            </select>
          </div>

          <FieldPicker
            fields={quizzable.map((def) => ({ key: def.key, label: def.label, yearLevels: def.yearLevels }))}
            selected={config.fields}
            year={config.yearLevel ?? ''}
            control={control}
          />

          <div>
            <label htmlFor="set" className="block text-sm font-medium">Card shape</label>
            <select id="set" name="set" defaultValue={config.mode} className={control}>
              <option value="inclusive">One card per drug</option>
              <option value="exclusive">One card per fact</option>
            </select>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Per fact gives each field its own card and its own schedule, so mechanism and dosing
              advance separately. Per drug asks for every selected field at once — far fewer cards,
              and one schedule covering the set.
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

          {categoryRows.length > 0 && (
            <div>
              <label htmlFor="cat" className="block text-sm font-medium">Category</label>
              <select id="cat" name="cat" defaultValue={config.scope.categories[0] ?? ''} className={control}>
                <option value="">Every category</option>
                {categoryRows.map((tag) => (
                  <option key={tag.slug} value={tag.slug}>{tag.label}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Narrows the drug list rather than replacing it: a list and a category together
                mean the drugs in both.
              </p>
            </div>
          )}

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

        <button type="submit" className="mt-4 rounded bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)]">
          Start
        </button>
        </form>
      </details>

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
