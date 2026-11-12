'use client';

import Fuse from 'fuse.js';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { BrowseFacets, DrugIndexRow, VariantText } from '@/lib/drugs/browse';
import { classLabel, isUncategorized } from '@/lib/drugs/drug-class';
import { matchesTags, tagList } from '@/lib/tags/constants';
import { colorFor, scheduleBadge, type ColorAxis } from '@/lib/theme/palette';

const REVIEW_LABELS = {
  flagged: 'Flagged',
  gaps: 'Has gaps',
  ok: 'Complete',
} as const;

/**
 * Every filter is a string, and the three loops below are why.
 *
 * The URL sync, the *is anything on* check and the advanced-filter count all
 * walk this object generically, and they only stay generic while every value is
 * falsy when unset. So the tag axis -- which holds several slugs now -- is a
 * comma-joined string rather than an array: an empty array is truthy and would
 * have put the rail permanently in its filtered state. A comma is safe because
 * a tag slug is `[a-z0-9-]`, and `?tag=top-drugs-2026,heme-onc-exam-3` is a
 * readable, bookmarkable spelling of one filter holding two values.
 */
type Filters = {
  q: string;
  drugClass: string;
  indication: string;
  schedule: string;
  route: string;
  tag: string;
  /**
   * `'1'` to take a drug on **any** tag picked; empty to require **all** of
   * them, which is the default.
   *
   * The study screens default the other way, and the difference is the job
   * rather than an oversight: a scope *collects* material to revise, where
   * *Exam 2 and Exam 3* means both and an intersection can hand back an empty
   * deck; a browse filter *narrows*, like every other control on this rail, so
   * *Top Drugs 2026 and Heme/Onc* means the drugs on both. Named for the
   * non-default so the default carries nothing in the URL -- which also leaves
   * every `?tag=` link already out there meaning what it used to.
   */
  tagsAny: string;
  review: string;
  blank: string;
  /** Which field the `fieldText` below has to appear in. */
  fieldKey: string;
  fieldText: string;
};

const EMPTY: Filters = {
  q: '',
  drugClass: '',
  indication: '',
  schedule: '',
  route: '',
  tag: '',
  tagsAny: '',
  review: '',
  blank: '',
  fieldKey: '',
  fieldText: '',
};

const PARAM_NAMES: Record<keyof Filters, string> = {
  q: 'q',
  drugClass: 'class',
  indication: 'indication',
  schedule: 'schedule',
  route: 'route',
  tag: 'tag',
  tagsAny: 'tagsany',
  review: 'review',
  blank: 'blank',
  fieldKey: 'field',
  fieldText: 'has',
};

/** Tag kinds in the order the filter lists them, with a heading each. */
const TAG_GROUPS = [
  { kind: 'top_list', label: 'Drug lists' },
  { kind: 'system', label: 'Categories' },
  { kind: 'school_year', label: 'Year' },
  // The two that can carry a profile variant, widest first -- the same order
  // they overlay in. See lib/drugs/variant-kinds.ts.
  { kind: 'course', label: 'Classes' },
  { kind: 'exam', label: 'Exams' },
  { kind: 'custom', label: 'Other' },
] as const;

/**
 * Why a row is in the list when its name is not what matched: the field, the
 * text around the hit, and -- where it was a class's wording rather than the
 * drug's own -- which version.
 */
type MatchReport = { label: string; text: string; variant: VariantText | null };

const contains = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.trim().toLowerCase());

/** The `route` field is a list, and the rail filters on one route at a time. */
const splitRoutes = (raw: string | undefined) =>
  (raw ?? '').split(';').map((part) => part.trim()).filter(Boolean);

/**
 * Enough of the matched text to see *why* a row is in the list.
 *
 * A window around the hit rather than the first 90 characters: the reason a
 * drug matched "pyrexia" is halfway down its adverse effects, and a snippet
 * that starts at the beginning of the field shows the reader none of it.
 */
function snippet(text: string, lower: string): string {
  const at = text.toLowerCase().indexOf(lower);
  if (at < 0) return text.slice(0, 90);
  const from = Math.max(0, at - 30);
  const to = Math.min(text.length, at + lower.length + 60);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

export function DrugBrowser({
  rows,
  facets,
  axis,
  overrides,
}: {
  rows: DrugIndexRow[];
  facets: BrowseFacets;
  axis: ColorAxis;
  overrides: Record<string, string>;
}) {
  const searchParams = useSearchParams();

  /** This row's colour on the chosen axis, and what that colour stands for. */
  const colorOf = (row: DrugIndexRow) => colorFor(axis, row, overrides);
  const colorMeans = (row: DrugIndexRow) => {
    if (axis === 'class') return row.drugClass;
    if (axis === 'schedule') return row.schedule ?? 'Not controlled';
    if (axis === 'tag') return row.tags[0] ?? null;
    return null;
  };

  const [filters, setFilters] = useState<Filters>(() => ({
    q: searchParams.get('q') ?? '',
    drugClass: searchParams.get('class') ?? '',
    indication: searchParams.get('indication') ?? '',
    schedule: searchParams.get('schedule') ?? '',
    route: searchParams.get('route') ?? '',
    tag: searchParams.get('tag') ?? '',
    tagsAny: searchParams.get('tagsany') ?? '',
    review: searchParams.get('review') ?? '',
    blank: searchParams.get('blank') ?? '',
    fieldKey: searchParams.get('field') ?? '',
    fieldText: searchParams.get('has') ?? '',
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

  // The tag axis, parsed once: the predicate, the select and the pills all read
  // it, and three `split(',')` calls is three chances to disagree.
  const pickedTags = useMemo(() => tagList(filters.tag), [filters.tag]);
  const tagLabels = useMemo(
    () => new Map(facets.tags.map((tag) => [tag.slug, tag.label])),
    [facets.tags],
  );

  const fuse = useMemo(
    () =>
      new Fuse(rows, {
        keys: [
          { name: 'generic', weight: 3 },
          { name: 'brands', weight: 2 },
          { name: 'drugClass', weight: 1 },
          { name: 'indications', weight: 1 },
        ],
        threshold: 0.35,
        ignoreLocation: true,
      }),
    [rows],
  );

  /**
   * Every field's text, lower-cased once, so the box below can search all of
   * it on every keystroke.
   *
   * Fuzzy matching stays where it belongs -- on the name, the brands, the class
   * and the indications, where a near-miss spelling is the whole point. Field
   * prose is matched on **substring** instead, deliberately: fuzzy search over
   * a paragraph of mechanism finds something for almost any three letters, and
   * a rail that always has hits is a rail that never answers a question.
   *
   * **The drug's own values first, then each version's.** Order carries
   * meaning here: `find` below takes the first hit, so a drug that says
   * something itself is reported as saying it, and a version is only named
   * when the drug's own profile does not contain what was typed. Within the
   * versions it is overlay order, which is the order the numbers are in.
   */
  const fieldIndex = useMemo(
    () =>
      new Map(
        rows.map((row) => [
          row.slug,
          [
            ...Object.entries(row.values).map(([key, text]) => ({
              key, text, lower: text.toLowerCase(), variant: null as VariantText | null,
            })),
            ...row.variants.flatMap((variant) =>
              Object.entries(variant.values).map(([key, text]) => ({
                key, text, lower: text.toLowerCase(), variant,
              })),
            ),
          ],
        ]),
      ),
    [rows],
  );

  const fieldLabels = useMemo(
    () => new Map(facets.fields.map((field) => [field.key, field.label])),
    [facets.fields],
  );

  /**
   * One box, two searches, in order: the name-ish fuzzy hits first, then the
   * drugs whose *content* contains what was typed.
   *
   * The order is the point. Searching "pyrexia" should find the BRAF
   * inhibitors by their adverse effects, and searching "dabrafenib" must still
   * put dabrafenib first -- so a content hit never outranks a name hit, and
   * `matchedIn` below says which field earned a row its place when its name
   * did not.
   */
  const { ranked, matchedIn } = useMemo(() => {
    const query = filters.q.trim();
    if (!query) return { ranked: rows, matchedIn: new Map<string, MatchReport>() };

    const named = fuse.search(query).map((hit) => hit.item);
    const seen = new Set(named.map((row) => row.slug));
    const lower = query.toLowerCase();
    const found = new Map<string, MatchReport>();
    const byContent: DrugIndexRow[] = [];
    const byVariant: DrugIndexRow[] = [];

    for (const row of rows) {
      if (seen.has(row.slug)) continue;
      const hit = fieldIndex.get(row.slug)?.find((field) => field.lower.includes(lower));
      if (!hit) continue;
      // A drug whose own profile says it outranks one where only a class's
      // wording does -- same reasoning as a name hit outranking a content hit.
      // The last tier is still a real answer: it is the only way to find what
      // a lecture wrote.
      (hit.variant ? byVariant : byContent).push(row);
      found.set(row.slug, {
        label: fieldLabels.get(hit.key) ?? hit.key,
        text: snippet(hit.text, lower),
        variant: hit.variant,
      });
    }

    return { ranked: [...named, ...byContent, ...byVariant], matchedIn: found };
  }, [rows, fuse, fieldIndex, fieldLabels, filters.q]);

  const results = useMemo(() => {
    return ranked.filter((row) => {
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
      if (filters.route && !splitRoutes(row.values.route).includes(filters.route)) return false;
      // All of the picked tags by default: stacking tags narrows, the same way
      // stacking a class onto an indication does.
      if (!matchesTags(row.tags, pickedTags, filters.tagsAny ? 'any' : 'all')) return false;
      if (filters.review && row.review !== filters.review) return false;
      if (filters.blank && !row.missing.includes(filters.blank)) return false;
      // The precise form of the box above: this exact field, containing this
      // text. A field chosen with nothing typed is not a filter yet -- it is
      // half of one -- so it narrows nothing until there is something to find.
      if (filters.fieldKey && filters.fieldText.trim()) {
        // Versions count here as well. Having the box find a row by a class's
        // wording and then the precise form of the same question lose it would
        // be two different ideas of what this app knows about a drug -- and
        // the looser control cannot be the more capable one.
        const inBase = contains(row.values[filters.fieldKey] ?? '', filters.fieldText);
        const inVariant = row.variants.some(
          (variant) => contains(variant.values[filters.fieldKey] ?? '', filters.fieldText),
        );
        if (!inBase && !inVariant) return false;
      }
      return true;
    });
  }, [ranked, filters, pickedTags]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((current) => ({ ...current, [key]: value }));

  // Counts over the whole set, so an option that would return nothing says so
  // rather than looking broken when you pick it.
  const counts = useMemo(() => {
    const blank = new Map<string, number>();
    const review = new Map<string, number>();
    const schedule = new Map<string, number>();
    const route = new Map<string, number>();
    const tag = new Map<string, number>();
    const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

    for (const row of rows) {
      for (const key of row.missing) bump(blank, key);
      bump(review, row.review);
      if (row.schedule) bump(schedule, row.schedule);
      for (const name of splitRoutes(row.values.route)) bump(route, name);
      for (const slug of row.tags) bump(tag, slug);
    }
    return { blank, review, schedule, route, tag };
  }, [rows]);

  // A filter that cannot narrow anything is noise: options nothing matches are
  // dropped, and a control left with fewer than two is hidden outright. It
  // stays visible while it holds a value, so a filter arriving in the URL is
  // never stranded with no way to clear it.
  const options = useMemo(() => {
    const blank = facets.fields.filter((field) => (counts.blank.get(field.key) ?? 0) > 0);
    const review = Object.entries(REVIEW_LABELS).filter(
      ([value]) => (counts.review.get(value) ?? 0) > 0,
    );
    const schedules = facets.schedules.filter((value) => (counts.schedule.get(value) ?? 0) > 0);
    const routes = facets.routes.filter((value) => (counts.route.get(value) ?? 0) > 0);
    const tags = facets.tags.filter((tag) => (counts.tag.get(tag.slug) ?? 0) > 0);
    return { blank, review, schedules, routes, tags };
  }, [facets, counts]);

  const show = {
    blank: options.blank.length > 0 || Boolean(filters.blank),
    review: options.review.length > 1 || Boolean(filters.review),
    schedule: options.schedules.length > 1 || Boolean(filters.schedule),
    route: options.routes.length > 1 || Boolean(filters.route),
    // `> 0`, unlike the facets above it, and the difference is real: a
    // schedule or a route *partitions* the drugs, so the only value present
    // narrows nothing and the control is noise. A tag *marks a subset* -- it is
    // the question "which of these are on that list", which is worth asking of
    // one tag as much as of ten, and the reason this control was missing from
    // the rail entirely while the database held a single list.
    tag: options.tags.length > 0 || Boolean(filters.tag),
  };

  const advancedKeys = [
    'drugClass', 'indication', 'schedule', 'route', 'tag', 'review', 'blank', 'fieldText',
    // `tagsAny` is deliberately absent: it changes how the tag filter reads
    // rather than being a filter of its own, and counting it would say "2
    // filters" for one narrowing.

  ] as const;
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
            placeholder="name, brand, or anything recorded" className={control} autoComplete="off"
          />
          {/* Worth saying once: the box searches the *contents* of a profile
              as well as its name, which is not what a search box in a list
              usually does and is the only way to find a drug by a toxicity
              you half remember. */}
          <p className="mt-1 text-xs text-[var(--muted)]">
            Searches the name, brands, class and indications — and the text of
            every field, so a mechanism, a warning or a regimen name finds its
            drug. Use <em>In one field</em> below to be exact about where.
          </p>
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

            {show.route && (
              <div>
                <label htmlFor="route" className="block text-sm font-medium">Route</label>
                <select id="route" value={filters.route} onChange={(e) => set('route', e.target.value)} className={control}>
                  <option value="">Any</option>
                  {options.routes.map((option) => (
                    <option key={option} value={option}>
                      {option} ({counts.route.get(option) ?? 0})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Read out of the drug&rsquo;s own name and dosing text. A drug with no route
                  recorded is not a drug with no route — it is one the source never said.
                </p>
              </div>
            )}

            {/* The exact form of the search box: this field, this text. The
                box above searches every field at once, which is what you want
                when you half remember a fact and not what you want when two
                fields could both hold the word -- "melanoma" is an indication
                on one drug and a regimen's name on another. */}
            {facets.fields.length > 0 && (
              <div>
                <label htmlFor="field" className="block text-sm font-medium">In one field</label>
                <select
                  id="field" value={filters.fieldKey}
                  onChange={(e) => set('fieldKey', e.target.value)} className={control}
                >
                  <option value="">Any field</option>
                  {facets.fields.map((field) => (
                    <option key={field.key} value={field.key}>{field.label}</option>
                  ))}
                </select>
                <input
                  value={filters.fieldText}
                  onChange={(event) => set('fieldText', event.target.value)}
                  placeholder={filters.fieldKey
                    ? `text in ${fieldLabels.get(filters.fieldKey) ?? 'that field'}`
                    : 'pick a field first'}
                  disabled={!filters.fieldKey}
                  aria-label="Text that field must contain"
                  className={`${control} disabled:opacity-60`}
                  autoComplete="off"
                />
              </div>
            )}

            {show.tag && (
              <div>
                <label htmlFor="tag" className="block text-sm font-medium">Tags</label>
                {/* Add-and-pill rather than a column of checkboxes: the rail is
                    15rem wide and this list is sixty-seven long once the
                    categories are seeded, so the picked few belong on screen
                    and the rest behind the select. The select empties itself
                    after each pick, which is what makes it read as *add*. */}
                <select
                  id="tag" value="" className={control}
                  onChange={(event) => {
                    const slug = event.target.value;
                    if (slug) set('tag', [...pickedTags, slug].join(','));
                  }}
                >
                  <option value="">
                    {pickedTags.length > 0 ? 'Add another…' : 'Any'}
                  </option>
                  {/* Grouped by kind: a drug list and a therapeutic category are
                      two different questions, and after seeding the categories
                      this was one flat list of sixty-seven. */}
                  {TAG_GROUPS.map(({ kind, label }) => {
                    const group = options.tags.filter(
                      (tag) => tag.kind === kind && !pickedTags.includes(tag.slug),
                    );
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

                {pickedTags.length > 0 && (
                  <ul className="mt-2 flex flex-wrap items-center gap-1">
                    {pickedTags.map((slug, at) => (
                      <li key={slug} className="flex items-center gap-1">
                        {/* The operator, printed where it applies rather than
                            described in a legend: you read the filter as
                            "Top Drugs 2026 and Heme/Onc Exam 3". */}
                        {at > 0 && (
                          <button
                            type="button"
                            onClick={() => set('tagsAny', filters.tagsAny ? '' : '1')}
                            title={filters.tagsAny
                              ? 'On any of these tags. Press for drugs on all of them.'
                              : 'On all of these tags. Press for drugs on any of them.'}
                            className="pill pill-xs pill-soft pill-edge font-mono"
                          >
                            {filters.tagsAny ? 'or' : 'and'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => set('tag', pickedTags.filter((other) => other !== slug).join(','))}
                          title={`Stop filtering by ${tagLabels.get(slug) ?? slug}`}
                          className="pill pill-xs pill-on"
                        >
                          {tagLabels.get(slug) ?? slug}
                          <span aria-hidden className="text-[var(--muted)]">&times;</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {show.review && (
              <div>
                <label htmlFor="review" className="block text-sm font-medium">Needs attention</label>
                <select id="review" value={filters.review} onChange={(e) => set('review', e.target.value)} className={control}>
                  <option value="">Any</option>
                  {options.review.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label} ({counts.review.get(value) ?? 0})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Flagged means somebody thinks a value is wrong; gaps are fields nobody has filled
                  in. Neither keeps a drug out of a deck — a flagged value is still studied, and a
                  gap simply makes no card.
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
              <button type="button" onClick={() => setFilters(EMPTY)} className="pill">
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
                   the name, brands started at a different x on every row. Below
                   the breakpoint it collapses back to stacked lines.

                   Three columns from `md` rather than `sm`, and every track
                   `minmax(0, ...)`. The class column used to be `auto`, which
                   in a grid means max-content -- so "Herpes Simplex Virus
                   Nucleoside Analog DNA Polymerase Inhibitor" took the width it
                   wanted and crushed the brands beside it, right up against the
                   16px gap. Bounded, it wraps to a second line instead, and the
                   other two keep their share. */
                className="grid gap-x-6 gap-y-1.5 py-3 md:grid-cols-[minmax(11rem,1.1fr)_minmax(0,1fr)_minmax(0,13rem)] md:items-baseline"
              >
                {/* gap-y as well as gap-x: the badges wrap under a long
                    generic name, and without it the two lines touched. */}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  {/* The axis owns colour. A dot rather than a fill, because
                      the thing it stands for -- a class name -- does not fit
                      in a row, and the badge beside it is text that has to
                      stay readable on its own. */}
                  {colorOf(row) !== null && (
                    <span
                      aria-hidden="true"
                      title={colorMeans(row) ?? undefined}
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: colorOf(row)! }}
                    />
                  )}
                  <Link href={`/drugs/${row.slug}`} className="font-medium text-[var(--accent)] underline">
                    {row.generic}
                  </Link>

                  {/* Always filled, on every axis: see scheduleBadge. */}
                  {row.schedule && (
                    <span className="rounded px-1.5 py-0.5 text-xs"
                      style={scheduleBadge(row.schedule, overrides) ?? undefined}>
                      {row.schedule}
                    </span>
                  )}
                  {/* How many alternate profiles this drug has. Bordered and
                      monospaced rather than coloured: it is a count, not a
                      state -- nothing is wrong with a drug that has three, and
                      the badges either side of it both mean "look at this".
                      The identifier is the point, so it matches the [V-2]
                      labels in the list builder, where you pick which one a
                      list reads. */}
                  {row.variants.length > 0 && (
                    <Link
                      href={`/drugs/${row.slug}`}
                      title={`V-1 the drug’s own, `
                        + `${row.variants.map((v) => `V-${v.n} ${v.label}`).join(', ')}`}
                      className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono
                        text-[0.6875rem] leading-none text-[var(--muted)]"
                    >
                      {/* The highest number, which is also how many versions
                          there are: the drug's own profile is V-1. */}
                      <span className="whitespace-nowrap">V-{row.variants.length + 1}</span>
                    </Link>
                  )}
                  {row.review === 'flagged' && (
                    <span className="text-xs text-[var(--flagged)]">flagged</span>
                  )}
                  {row.needsReview && <span className="text-xs text-[var(--unverified)]">needs review</span>}
                </div>

                <span className="text-sm text-[var(--muted)]">
                  {row.brands.join(', ') || '—'}
                </span>

                <span className="text-sm text-[var(--muted)] md:text-right">
                  {classLabel(row.drugClass)}
                </span>

                {/* Only for a row the *name* did not match: without it, a
                    search for a toxicity returns a list of drugs with no
                    visible reason to be in it, and a search box you cannot
                    check is a search box you stop trusting. */}
                {matchedIn.has(row.slug) && (
                  <p className="text-xs text-[var(--muted)] md:col-span-3">
                    <span className="font-medium">{matchedIn.get(row.slug)!.label}</span>
                    {/* Which version said it, where the drug's own profile did
                        not. Without this the row is a trap: you click through
                        to a profile that does not contain the word you typed,
                        because the class that wrote it is behind the dropdown
                        and nothing told you to look there. */}
                    {matchedIn.get(row.slug)!.variant && (
                      <span className="ml-1 rounded border border-[var(--border)] px-1 py-px
                        font-mono text-[0.625rem]">
                        <span className="whitespace-nowrap">
                          V-{matchedIn.get(row.slug)!.variant!.n}
                        </span>{' '}
                        {matchedIn.get(row.slug)!.variant!.label}
                      </span>
                    )}
                    <span className="font-medium">:</span>{' '}
                    {matchedIn.get(row.slug)!.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
