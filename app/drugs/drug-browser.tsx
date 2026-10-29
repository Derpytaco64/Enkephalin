'use client';

import Fuse from 'fuse.js';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { BrowseFacets, DrugIndexRow } from '@/lib/drugs/browse';

const VERIFICATION_LABELS = {
  verified: 'Verified',
  partial: 'Partly verified',
  unverified: 'Unverified',
  flagged: 'Flagged',
} as const;

type Filters = {
  q: string;
  drugClass: string;
  schedule: string;
  tag: string;
  verification: string;
  missing: string;
};

const EMPTY: Filters = { q: '', drugClass: '', schedule: '', tag: '', verification: '', missing: '' };

const PARAM_NAMES: Record<keyof Filters, string> = {
  q: 'q',
  drugClass: 'class',
  schedule: 'schedule',
  tag: 'tag',
  verification: 'status',
  missing: 'missing',
};

function scheduleToken(schedule: string | null) {
  if (!schedule) return 'var(--sched-none)';
  return `var(--sched-${schedule.toLowerCase().replace('c', 'c')})`;
}

export function DrugBrowser({ rows, facets }: { rows: DrugIndexRow[]; facets: BrowseFacets }) {
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>(() => ({
    q: searchParams.get('q') ?? '',
    drugClass: searchParams.get('class') ?? '',
    schedule: searchParams.get('schedule') ?? '',
    tag: searchParams.get('tag') ?? '',
    verification: searchParams.get('status') ?? '',
    missing: searchParams.get('missing') ?? '',
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
      if (filters.drugClass && row.drugClass !== filters.drugClass) return false;
      if (filters.schedule && row.schedule !== filters.schedule) return false;
      if (filters.tag && !row.tags.includes(filters.tag)) return false;
      if (filters.verification && row.verification !== filters.verification) return false;
      if (filters.missing && !row.missing.includes(filters.missing)) return false;
      return true;
    });
  }, [rows, fuse, filters]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  const active = Object.values(filters).some(Boolean);
  const control =
    'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm';

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[14rem_1fr] lg:items-start">
      <aside className="space-y-4">
        <div>
          <label htmlFor="q" className="block text-sm font-medium">Search</label>
          <input
            id="q" value={filters.q} onChange={(event) => set('q', event.target.value)}
            placeholder="generic, brand, class" className={control} autoComplete="off"
          />
        </div>

        <div>
          <label htmlFor="class" className="block text-sm font-medium">Class</label>
          <select id="class" value={filters.drugClass} onChange={(e) => set('drugClass', e.target.value)} className={control}>
            <option value="">Any</option>
            {facets.classes.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
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
          <label htmlFor="missing" className="block text-sm font-medium">Missing field</label>
          <select id="missing" value={filters.missing} onChange={(e) => set('missing', e.target.value)} className={control}>
            <option value="">Any</option>
            {facets.fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Finds genuine gaps. A drug with no black box warning is not missing one.
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
              <li key={row.slug} className="py-3">
                {/* One list that reflows: the class and brand detail drop to a
                    second line on a phone instead of a separate component. */}
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <Link href={`/drugs/${row.slug}`} className="font-medium text-[var(--accent)] underline">
                    {row.generic}
                  </Link>

                  {row.schedule && (
                    <span
                      className="rounded px-1.5 py-0.5 text-xs text-[var(--accent-fg)]"
                      style={{ backgroundColor: scheduleToken(row.schedule) }}
                    >
                      {row.schedule}
                    </span>
                  )}

                  {row.verification === 'flagged' && (
                    <span className="text-xs text-[var(--flagged)]">flagged</span>
                  )}
                  {row.needsReview && <span className="text-xs text-[var(--unverified)]">needs review</span>}

                  <span className="w-full text-sm text-[var(--muted)] sm:w-auto">
                    {row.brands.join(', ') || 'no brands listed'}
                  </span>

                  {row.drugClass && (
                    <span className="w-full text-sm text-[var(--muted)] sm:ml-auto sm:w-auto">{row.drugClass}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
