'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { submitTo } from '@/app/_components/submit';
import type { RemoveState } from './actions';

export type RemovableDrug = {
  slug: string;
  generic: string;
  tags: string[];
  tagSlugs: string[];
  variants: { slug: string; label: string; fields: number }[];
};

const CARD = 'rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4';
const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

const contains = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.trim().toLowerCase());

const layerKey = (drugSlug: string, variantSlug: string) => `${drugSlug}:${variantSlug}`;
const drugOf = (key: string) => key.slice(0, key.indexOf(':'));

/**
 * Tick what should go, type DELETE, press the button.
 *
 * The ticks are plain checkboxes sharing one name, so the whole selection
 * travels as `drug=a&drug=b` -- the same device the study scope pickers use.
 * What is held in state is the filtering, and **Tick every drug shown** is the
 * control this screen exists for: undoing a bad import means filtering to the
 * tag it created and taking all of them, and doing that by hand twenty-four
 * times is how the twenty-fifth gets missed.
 *
 * A drug and its versions are separate ticks on purpose. A lecture that wrote
 * its wording over the wrong class leaves drugs that should stay and layers
 * that should not, and a screen that could only delete whole drugs would make
 * the only fix for that worse than the problem.
 */
export function RemoveForm({
  rows,
  facetTags,
  action,
}: {
  rows: RemovableDrug[];
  facetTags: { slug: string; label: string }[];
  action: (formData: FormData) => Promise<RemoveState>;
}) {
  const [state, formAction, pending] = useActionState<RemoveState, FormData>(
    async (_previous, formData) => action(formData),
    { kind: 'idle' },
  );

  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [onlyVersions, setOnlyVersions] = useState(false);
  const [drugPicks, setDrugPicks] = useState<string[]>([]);
  const [layerPicks, setLayerPicks] = useState<string[]>([]);

  const shown = useMemo(() => rows.filter((row) => {
    if (tag && !row.tagSlugs.includes(tag)) return false;
    if (onlyVersions && row.variants.length === 0) return false;
    if (query.trim() && !contains(row.generic, query) && !contains(row.slug, query)) return false;
    return true;
  }), [rows, query, tag, onlyVersions]);

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  const tickAllShown = () =>
    setDrugPicks([...new Set([...drugPicks, ...shown.map((row) => row.slug)])]);

  const tickAllVersionsShown = () =>
    setLayerPicks([...new Set([
      ...layerPicks,
      ...shown.flatMap((row) => row.variants.map((variant) => layerKey(row.slug, variant.slug))),
    ])]);

  const picked = drugPicks.length + layerPicks.length;
  // Counted over every tick rather than only the shown ones: a filter changing
  // is not a reason for a tick to be forgotten, and a count that moved when you
  // typed would be the one number here nobody could trust.
  const goingAnyway = layerPicks.filter((key) => drugPicks.includes(drugOf(key))).length;
  const layersGoing = layerPicks.length - goingAnyway;

  return (
    <form onSubmit={submitTo(formAction)} className="mt-6">
      <div className={CARD}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="q" className="block text-sm font-medium">Find</label>
            <input
              id="q" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="name" className={control} autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="tag" className="block text-sm font-medium">On a list</label>
            <select
              id="tag" value={tag} onChange={(event) => setTag(event.target.value)}
              className={control}
            >
              <option value="">Any</option>
              {facetTags.map((entry) => (
                <option key={entry.slug} value={entry.slug}>{entry.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" checked={onlyVersions}
                onChange={() => setOnlyVersions(!onlyVersions)}
              />
              Only drugs with a version
            </label>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          <span className="text-xs text-[var(--muted)]">
            {shown.length} of {rows.length} shown · {picked} ticked
          </span>
          <button type="button" onClick={tickAllShown} className="pill pill-xs pill-edge">
            Tick every drug shown
          </button>
          <button type="button" onClick={tickAllVersionsShown} className="pill pill-xs pill-edge">
            Tick every version shown
          </button>
          {picked > 0 && (
            <button
              type="button"
              onClick={() => { setDrugPicks([]); setLayerPicks([]); }}
              className="pill pill-xs pill-edge"
            >
              Clear ticks
            </button>
          )}
        </div>
      </div>

      <ul className={`${CARD} mt-4 divide-y divide-[var(--border)]`}>
        {shown.map((row) => {
          const withDrug = drugPicks.includes(row.slug);
          return (
            <li key={row.slug} className="py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox" name="drug" value={row.slug}
                    checked={withDrug}
                    onChange={() => setDrugPicks(toggle(drugPicks, row.slug))}
                  />
                  <span className={withDrug ? 'font-medium line-through' : 'font-medium'}>
                    {row.generic}
                  </span>
                </label>
                <Link href={`/drugs/${row.slug}`} className="text-xs text-[var(--muted)] underline">
                  look
                </Link>
                {row.tags.length > 0 && (
                  <span className="text-xs text-[var(--muted)]">{row.tags.join(', ')}</span>
                )}
              </div>

              {row.variants.length > 0 && (
                <ul className="mt-1 ml-6 space-y-0.5">
                  {row.variants.map((variant) => {
                    const key = layerKey(row.slug, variant.slug);
                    return (
                      <li key={key}>
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox" name="layer" value={key}
                            checked={layerPicks.includes(key)}
                            onChange={() => setLayerPicks(toggle(layerPicks, key))}
                          />
                          <span className={layerPicks.includes(key) || withDrug ? 'line-through' : ''}>
                            what {variant.label} says
                          </span>
                          <span className="text-[var(--muted)]">
                            {variant.fields} field{variant.fields === 1 ? '' : 's'}
                            {withDrug ? ' — goes with the drug' : ''}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="text-sm text-[var(--muted)]">Nothing matches that.</li>
        )}
      </ul>

      <div className={`${CARD} mt-4`}>
        <p className="text-sm">
          {picked === 0 ? 'Tick a drug or a version above.' : (
            <>
              <strong>{drugPicks.length} drug{drugPicks.length === 1 ? '' : 's'}</strong> and{' '}
              <strong>{layersGoing} version{layersGoing === 1 ? '' : 's'}</strong> will be deleted.
              {goingAnyway > 0 && (
                <> {goingAnyway} ticked version{goingAnyway === 1 ? '' : 's'} already{' '}
                  {goingAnyway === 1 ? 'goes' : 'go'} with its drug.</>
              )}
            </>
          )}
        </p>
        <div className="mt-2 sm:flex sm:items-end sm:gap-3">
          <div className="sm:w-48">
            <label htmlFor="confirm" className="block text-sm font-medium">Type DELETE</label>
            <input
              id="confirm" name="confirm" autoComplete="off" placeholder="DELETE"
              className={control}
            />
          </div>
          <button
            type="submit" disabled={pending || picked === 0}
            className="btn btn-quiet mt-2 text-[var(--danger)] sm:mt-0"
          >
            {pending ? 'Deleting…' : 'Delete what is ticked'}
          </button>
        </div>
      </div>

      {state.kind === 'error' && (
        <p className="mt-4 rounded-lg border border-[var(--danger)] bg-[var(--surface)] p-4 text-sm">
          {state.message}
        </p>
      )}

      {state.kind === 'done' && (
        <div className={`${CARD} mt-4 text-sm`}>
          <p className="font-medium">
            {state.report.drugs.length} drug{state.report.drugs.length === 1 ? '' : 's'} and{' '}
            {state.report.layers.length} version
            {state.report.layers.length === 1 ? '' : 's'} deleted.
          </p>
          {state.report.withTheDrug > 0 && (
            <p className="mt-1 text-[var(--muted)]">
              {state.report.withTheDrug} ticked version
              {state.report.withTheDrug === 1 ? '' : 's'} went with{' '}
              {state.report.withTheDrug === 1 ? 'its' : 'their'} drug.
            </p>
          )}
          {state.report.drugs.length > 0 && (
            <p className="mt-1 font-mono text-xs text-[var(--muted)]">
              {state.report.drugs.join(', ')}
            </p>
          )}
          {state.report.problems.length > 0 && (
            <ul className="mt-2 space-y-1 text-[var(--danger)]">
              {state.report.problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          )}
          <p className="mt-2 text-xs text-[var(--muted)]">
            The list above still shows what it showed before. Reload to see it without them.
          </p>
        </div>
      )}
    </form>
  );
}
