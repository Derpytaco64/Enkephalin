'use client';

import Fuse from 'fuse.js';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { BrowseFacets, DrugIndexRow } from '@/lib/drugs/browse';
import { scheduleColor } from '@/lib/drugs/schedule';

const VERIFICATION_LABELS = {
  verified: 'Verified',
  partial: 'Partly verified',
  unverified: 'Unverified',
  flagged: 'Flagged',
} as const;

type Filters = {
  q: string;
  drugClass: string;
  indication: string;
  schedule: string;
  tag: string;
  verification: string;
  blank: string;
};

const EMPTY: Filters = {
  q: '',
  drugClass: '',
  indication: '',
  schedule: '',
  tag: '',
  verification: '',
  blank: '',
};

const PARAM_NAMES: Record<keyof Filters, string> = {
  q: 'q',
  drugClass: 'class',
  indication: 'indication',
  schedule: 'schedule',
  tag: 'tag',
  verification: 'status',
  blank: 'blank',
};

const contains = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.trim().toLowerCase());

export function DrugBrowser({ rows, facets }: { rows: DrugIndexRow[]; facets: BrowseFacets }) {
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() => ({
    q: searchParams.get('q') ?? '',
    drugClass: searchParams.get('class') ?? '',
    indication: searchParams.get('indication') ?? '',
    schedule: searchParams.get('schedule') ?? '',
    tag: searchParams.get('tag') ?? '',
    verification: searchParams.get('status') ?? '',
    blank: searchParams.get('blank') ?? '',
  }));

  // The URL trails the state rather than driving it, so typing stays instant
  // and every view is still bookmarkable. replaceState rather than
  // router.replace: this is a URL update, not a navigation, and it should
  // neither re-render the server component nor add history entries per
  // keystroke.
  useEffect(() => {
    const params = new URLSearchParams();
    for (const [key, param] of Object.entries(PARAM_NAMES)) {
      const value = filters[key as keyof Filters];
      if (value) params.set(param, value);
    }
    const query = params.toString();
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  }, [filters]);

  const fuse = useMemo(
    () =>
      new Fuse(rows, {
        keys: [
          { name: 'generic', weight: 3 },
          { name: 'brands', weight: 2 },
          { name: 'drugClass', weight: 1 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [rows],
  );

  const results = useMemo(() => {
    const searched = filters.q.trim() ? fuse.search(filters.q.trim()).map((hit) => hit.item) : rows;

    return searched.filter((row) => {
      // Class and indication match on substring rather than equality, so a
      // half-typed "beta" narrows the list before you pick a suggestion.
      if (filters.drugClass && !contains(row.drugClass ?? '', filters.drugClass)) return false;
      if (filters.indication && !row.indications.some((text) => contains(text, filters.indication))) return false;
      if (filters.schedule && row.schedule !== filters.schedule) return false;
      if (filters.tag && !row.tags.includes(filters.tag)) return false;
      if (filters.verification && row.verification !== filters.verification) return false;
      if (filters.blank && !row.missing.includes(filters.blank)) return false;
      return true;
    });
  }, [rows, fuse, filters]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const active = Object.values(filters).some(Boolean);
  const control =
    'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm';

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_1fr] lg:items-start">
      <aside className="space-y-4">
        <div>
          <label htmlFor="q" className="block text-sm font-medium">Search</label>
          <input
            id="q" value={filters.q} onChange={(event) => set('q', event.target.value)}
            placeholder="generic or brand" className={control} autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="class" className="block text-sm font-medium">Class</label>
          <input
            id="class" list="class-options" value={filters.drugClass}
            onChange={(event) => set('drugClass', event.target.value)}
            placeholder="type to narrow" className={control} autoComplete="off"
          />
          <datalist id="class-options">
            {facets.classes.map((option) => <option key={option} value={option} />)}
          </datalist>
        </div>

        <div>
          <label htmlFor="indication" className="block text-sm font-medium">Indication</label>
          <input
            id="indication" list="indication-options" value={filters.indication}
            onChange={(event) => set('indication', event.target.value)}
            placeholder="what it treats" className={control} autoComplete="off"
          />
          <datalist id="indication-options">
            {facets.indications.map((option) => <option key={option} value={option} />)}
          </datalist>
        </div>

        <div>
          <label htmlFor="schedule" className="block text-sm font-medium">Schedule</label>
          <select id="schedule" value={filters.schedule} onChange={(e) => set('schedule', e.target.value)} className={control}>
            <option value="">Any</option>
            {facets.schedules.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </div>

        {facets.tags.length > 0 && (
          <div>
            <label htmlFor="tag" className="block text-sm font-medium">Tag</label>
            <select id="tag" value={filters.tag} onChange={(e) => set('tag', e.target.value)} className={control}>
              <option value="">Any</option>
              {facets.tags.map((tag) => <option key={tag.slug} value={tag.slug}>{tag.label}</option>)}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="status" className="block text-sm font-medium">Verification</label>
          <select id="status" value={filters.verification} onChange={(e) => set('verification', e.target.value)} className={control}>
            <option value="">Any</option>
            {Object.entries(VERIFICATION_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="blank" className="block text-sm font-medium">Still blank</label>
          <select id="blank" value={filters.blank} onChange={(e) => set('blank', e.target.value)} className={control}>
            <option value="">Any</option>
            {facets.fields.map((field) => (
              <option key={field.key} value={field.key}>{field.label} not filled in</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Finds drugs still waiting on a value — pick “Mechanism of action not filled in” to see
            what is left to write. A drug that simply has no black box warning does not count as
            blank.
          </p>
        </div>

        {active && (
          <button type="button" onClick={() => setFilters(EMPTY)} className="text-sm text-[var(--accent)] underline">
            Clear filters
          </button>
        )}
      </aside>

      <section>
        <p className="text-sm text-[var(--muted)]">
          {results.length} of {rows.length} drugs
        </p>

        {results.length === 0 ? (
          <p className="mt-8">Nothing matches those filters.</p>
        ) : (
          <ul className="mt-3 divide-y divide-[var(--border)]">
            {results.map((row) => (
              <li
                key={row.slug}
                /* Columns rather than a flex run: with everything flowing after
                   the name, brands started at a different x on every row. On a
                   phone it collapses back to stacked lines. */
                className="grid gap-x-4 gap-y-1 py-3 sm:grid-cols-[14rem_1fr_auto] sm:items-baseline"
              >
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/drugs/${row.slug}`} className="font-medium text-[var(--accent)] underline">
                    {row.generic}
                  </Link>

                  {row.schedule && (
                    <span
                      className="rounded px-1.5 py-0.5 text-xs text-[var(--accent-fg)]"
                      style={{ backgroundColor: scheduleColor(row.schedule) }}
                    >
                      {row.schedule}
                    </span>
                  )}
                  {row.verification === 'flagged' && (
                    <span className="text-xs text-[var(--flagged)]">flagged</span>
                  )}
                  {row.needsReview && <span className="text-xs text-[var(--unverified)]">needs review</span>}
                </div>

                <span className="text-sm text-[var(--muted)]">
                  {row.brands.join(', ') || '—'}
                </span>

                <span className="text-sm text-[var(--muted)] sm:text-right">{row.drugClass ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
