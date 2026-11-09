import Link from 'next/link';
import { DEFAULT_CONFIG, normalizeConfig, type StudyConfig } from '@/lib/study/config';
import { fieldKeysParam } from '@/lib/study/search-params';
import { loadSetDeck, studiableFields } from '@/lib/sets/session';
import { deckHref, type Deck } from '@/lib/sets/deck';
import { SessionRunner } from '@/app/study/flashcards/session-runner';
import { gradeSetCardAction } from '../_actions/flashcards';

export type FlashcardSearch = {
  mode?: string; dir?: string; set?: string; block?: string; max?: string;
  fields?: string | string[];
};

/**
 * Flashcards for one imported set.
 *
 * Deliberately a shorter form than the drug page's. Most of that page is scope
 * -- lists, categories, indications, program year -- and a set *is* the scope:
 * you picked it by opening it. What is left is the handful of settings that
 * still mean something.
 */
export async function FlashcardsView({
  deck,
  search,
  userId,
}: {
  deck: Deck;
  search: FlashcardSearch;
  userId: string;
}) {
  const source = deck.source;

  const studiable = studiableFields(source);
  const fromQuery = fieldKeysParam(search.fields);
  // Every column by default. A set is small and you opened it to learn it, so
  // an empty picker would be a form standing between you and the thing.
  const fields = fromQuery.length > 0
    ? fromQuery.filter((key) => studiable.some((def) => def.key === key))
    : studiable.map((def) => def.key);

  const config: StudyConfig = normalizeConfig({
    sessionMode: search.mode === 'review' ? 'review' : 'cram',
    yearLevel: null,
    fields,
    mode: search.set === 'inclusive' ? 'inclusive' : 'exclusive',
    direction: search.dir === 'fields_to_drug' ? 'fields_to_drug' : 'drug_to_fields',
    blockSize: search.block === undefined ? DEFAULT_CONFIG.blockSize : Number(search.block),
    maxCards: search.max === undefined ? 0 : Number(search.max),
    scope: { ...DEFAULT_CONFIG.scope },
  });

  const drawn = await loadSetDeck(userId, source, config);
  const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';
  const running = drawn.cards.length > 0;
  const subject = source.set.identityLabel;

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
      <h1 className={`mt-1 font-semibold tracking-tight ${running ? 'text-base' : 'text-2xl'}`}>
        Flashcards
      </h1>

      <details open={!running} className="mt-3 rounded border border-[var(--border)]">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
          Session settings
          <span className="ml-2 font-normal text-[var(--muted)]">
            {config.sessionMode === 'cram' ? 'Cram' : 'Review'} ·{' '}
            {config.mode === 'inclusive' ? 'per row' : 'per fact'} · {config.fields.length} column
            {config.fields.length === 1 ? '' : 's'}
          </span>
        </summary>

        <form method="get" className="border-t border-[var(--border)] p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="mode" className="block text-sm font-medium">Session</label>
              <select id="mode" name="mode" defaultValue={config.sessionMode} className={control}>
                <option value="cram">Cram — everything, schedule untouched</option>
                <option value="review">Review — what is due</option>
              </select>
            </div>

            <div>
              <label htmlFor="dir" className="block text-sm font-medium">Direction</label>
              <select id="dir" name="dir" defaultValue={config.direction} className={control}>
                <option value="drug_to_fields">{subject} → facts</option>
                <option value="fields_to_drug">Facts → {subject.toLowerCase()}</option>
              </select>
            </div>

            <div>
              <label htmlFor="set" className="block text-sm font-medium">Card shape</label>
              <select id="set" name="set" defaultValue={config.mode} className={control}>
                <option value="exclusive">One card per fact</option>
                <option value="inclusive">One card per row</option>
              </select>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Per fact gives each column its own card and its own schedule. Per row asks for
                every column at once.
              </p>
            </div>

            <div>
              <label htmlFor="max" className="block text-sm font-medium">Most cards</label>
              <input
                id="max" name="max" type="number" min={1}
                defaultValue={config.maxCards > 0 ? config.maxCards : ''}
                placeholder="All of them"
                className={control}
              />
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

          <button type="submit" className="btn btn-primary mt-4">Start</button>
        </form>
      </details>

      <SessionRunner
        cards={drawn.cards}
        config={config}
        inScope={drawn.inScope}
        available={drawn.available}
        onGrade={gradeSetCardAction}
        emptyHint={
          studiable.length === 0
            ? 'Every column in this set is marked as context rather than an answer, so there is nothing to ask about.'
            : 'No cards from the columns picked. Tick more columns above.'
        }
      />
    </main>
  );
}
