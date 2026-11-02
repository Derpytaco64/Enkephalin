'use client';

import Fuse from 'fuse.js';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { BrowseFacets, DrugIndexRow } from '@/lib/drugs/browse';
import { classLabel, isUncategorized } from '@/lib/drugs/drug-class';
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

/** Tag kinds in the order the filter lists them, with a heading each. */
const TAG_GROUPS = [
  { kind: 'top_list', label: 'Drug lists' },
  { kind: 'system', label: 'Categories' },
  { kind: 'school_year', label: 'Year' },
  { kind: 'course', label: 'Courses' },
  { kind: 'custom', label: 'Other' },
] as const;

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
      if (filters.drugClass) {
        // "Uncategorized" asks for the drugs that have no class, which a
        // substring match over an empty string could never find.
        const matched = isUncategorized(filters.drugClass)
          ? !row.drugClass
          : contains(row.drugClass ?? '', filters.drugClass);
        if (!matched) return false;
      }
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

  // Counts over the whole set, so an option that would return nothing says so
  // rather than looking broken when you pick it.
  const counts = useMemo(() => {
    const blank = new Map<string, number>();
    const verification = new Map<string, number>();
    const schedule = new Map<string, number>();
    const tag = new Map<string, number>();
    const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

    for (const row of rows) {
      for (const key of row.missing) bump(blank, key);
      bump(verification, row.verification);
      if (row.schedule) bump(schedule, row.schedule);
      for (const slug of row.tags) bump(tag, slug);
    }
    return { blank, verification, schedule, tag };
  }, [rows]);

  // A filter that cannot narrow anything is noise: options nothing matches are
  // dropped, and a control left with fewer than two is hidden outright. It
  // stays visible while it holds a value, so a filter arriving in the URL is
  // never stranded with no way to clear it.
  const options = useMemo(() => {
    const blank = facets.fields.filter((field) => (counts.blank.get(field.key) ?? 0) > 0);
    const verification = Object.entries(VERIFICATION_LABELS).filter(
      ([value]) => (counts.verification.get(value) ?? 0) > 0,
    );
    const schedules = facets.schedules.filter((value) => (counts.schedule.get(value) ?? 0) > 0);
    const tags = facets.tags.filter((tag) => (counts.tag.get(tag.slug) ?? 0) > 0);
    return { blank, verification, schedules, tags };
  }, [facets, counts]);

  const show = {
    blank: options.blank.length > 0 || Boolean(filters.blank),
    verification: options.verification.length > 1 || Boolean(filters.verification),
    schedule: options.schedules.length > 1 || Boolean(filters.schedule),
    tag: options.tags.length > 1 || Boolean(filters.tag),
  };

  const advancedKeys = ['drugClass', 'indication', 'schedule', 'tag', 'verification', 'blank'] as const;
  const advancedCount = advancedKeys.filter((key) => filters[key]).length;
  const [showMore, setShowMore] = useState(advancedCount > 0);

  const active = Object.values(filters).some(Boolean);
  // One height for every control: a select and an input do not agree on their
  // own, and the rail reads as ragged when they disagree.
  const control =
    'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_1fr] lg:items-start">
      <aside className="space-y-3">
        <div>
          <label htmlFor="q" className="block text-sm font-medium">Find a drug</label>
          <input
            id="q" value={filters.q} onChange={(event) => set('q', event.target.value)}
            placeholder="generic or brand" className={control} autoComplete="off"
          />
        </div>

        {/* Collapsed by default so the rail is one box until you want more,
            and it works the same whether it sits on the left or stacked on
            top. It opens itself when a filter arrives in the URL, or the
            results would look filtered for no visible reason. */}
        <details
          open={showMore}
          onToggle={(event) => setShowMore(event.currentTarget.open)}
          className="rounded border border-[var(--border)]"
        >
          <summary className="cursor-pointer px-3 py-2 text-sm">
            More filters{advancedCount > 0 ? ` (${advancedCount})` : ''}
          </summary>

          <div className="space-y-4 border-t border-[var(--border)] px-3 py-3">
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

            {show.schedule && (
              <div>
                <label htmlFor="schedule" className="block text-sm font-medium">Schedule</label>
                <select id="schedule" value={filters.schedule} onChange={(e) => set('schedule', e.target.value)} className={control}>
                  <option value="">Any</option>
                  {options.schedules.map((option) => (
                    <option key={option} value={option}>
                      {option} ({counts.schedule.get(option) ?? 0})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {show.tag && (
              <div>
                <label htmlFor="tag" className="block text-sm font-medium">Tag</label>
                {/* Grouped by kind: a drug list and a therapeutic category are
                    two different questions, and after seeding the categories
                    this was one flat list of sixty-seven. */}
                <select id="tag" value={filters.tag} onChange={(e) => set('tag', e.target.value)} className={control}>
                  <option value="">Any</option>
                  {TAG_GROUPS.map(({ kind, label }) => {
                    const group = options.tags.filter((tag) => tag.kind === kind);
                    if (group.length === 0) return null;
                    return (
                      <optgroup key={kind} label={label}>
                        {group.map((tag) => (
                          <option key={tag.slug} value={tag.slug}>
                            {tag.label} ({counts.tag.get(tag.slug) ?? 0})
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>
              </div>
            )}

            {show.verification && (
              <div>
                <label htmlFor="status" className="block text-sm font-medium">Checked against a source</label>
                <select id="status" value={filters.verification} onChange={(e) => set('verification', e.target.value)} className={control}>
                  <option value="">Any</option>
                  {options.verification.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label} ({counts.verification.get(value) ?? 0})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  The sheet is the starting point, not a checked source. A value counts as confirmed
                  once an admin has compared it against Micromedex or lecture and pressed Mark
                  verified on the drug page.
                </p>
              </div>
            )}

            {show.blank && (
              <div>
                <label htmlFor="blank" className="block text-sm font-medium">Still blank</label>
                <select id="blank" value={filters.blank} onChange={(e) => set('blank', e.target.value)} className={control}>
                  <option value="">Any</option>
                  {options.blank.map((field) => (
                    <option key={field.key} value={field.key}>
                      {field.label}: {counts.blank.get(field.key) ?? 0} waiting
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Drugs still waiting on a value for that field. A drug with no black box warning
                  does not count as blank — that is an answer.
                </p>
              </div>
            )}

            {active && (
              <button type="button" onClick={() => setFilters(EMPTY)} className="text-sm text-[var(--accent)] underline">
                Clear filters
              </button>
            )}
          </div>
        </details>
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

                <span className="text-sm text-[var(--muted)] sm:text-right">{classLabel(row.drugClass)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
