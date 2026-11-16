/**
 * What the drug list is showing, as a function rather than as a screen.
 *
 * This was the inside of `app/drugs/drug-browser.tsx` and moved out whole,
 * unchanged, when the profile page needed the same answer: *which drugs are in
 * the list you were just looking at, and in what order*. Paging from one drug
 * to the next one on screen is that question, and the only honest way to
 * answer it is with the function that drew the list -- a second implementation
 * would page through a slightly different list than the one you clicked from,
 * which is the kind of bug nobody reports and everybody distrusts.
 *
 * Client-safe: no database. The rail runs it on every keystroke over rows it
 * already has, and the profile runs it once on the server. `drugIndex` is the
 * expensive half and is separated out so the rail can memoise it -- rebuilding
 * a Fuse index per keystroke is the one thing here that would be felt.
 */
import Fuse from 'fuse.js';
import type { DrugIndexRow, VariantText } from './browse';
import { isUncategorized } from './drug-class';
import { matchesTags, tagList } from '@/lib/tags/constants';

/**
 * Every filter is a string, and the loops over this object are why.
 *
 * The URL sync, the *is anything on* check and the advanced-filter count all
 * walk it generically, and they only stay generic while every value is falsy
 * when unset. So the tag axis -- which holds several slugs now -- is a
 * comma-joined string rather than an array: an empty array is truthy and would
 * have put the rail permanently in its filtered state. A comma is safe because
 * a tag slug is `[a-z0-9-]`, and `?tag=top-drugs-2026,heme-onc-exam-3` is a
 * readable, bookmarkable spelling of one filter holding two values.
 */
export type DrugFilters = {
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

export const EMPTY_FILTERS: DrugFilters = {
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

export const FILTER_PARAMS: Record<keyof DrugFilters, string> = {
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

/**
 * The filters a URL is carrying.
 *
 * Takes a reader rather than a `URLSearchParams`, because the two callers hold
 * two different shapes of the same thing: `useSearchParams()` in the rail and
 * Next's resolved `searchParams` object on the server.
 */
export function filtersFrom(read: (param: string) => string | null | undefined): DrugFilters {
  const filters = { ...EMPTY_FILTERS };
  for (const key of Object.keys(FILTER_PARAMS) as (keyof DrugFilters)[]) {
    filters[key] = read(FILTER_PARAMS[key]) ?? '';
  }
  return filters;
}

/** The query string for these filters, with the unset ones left out. */
export function filterParams(filters: DrugFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of Object.keys(FILTER_PARAMS) as (keyof DrugFilters)[]) {
    if (filters[key]) params.set(FILTER_PARAMS[key], filters[key]);
  }
  return params;
}

/** Whether any filter is on, which is what makes a list *a* list. */
export const isFiltered = (filters: DrugFilters) =>
  Object.values(filters).some((value) => value !== '');

export const contains = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.trim().toLowerCase());

/** The `route` field is a list, and the rail filters on one route at a time. */
export const splitRoutes = (raw: string | undefined) =>
  (raw ?? '').split(';').map((part) => part.trim()).filter(Boolean);

/**
 * Why a row is in the list when its name is not what matched: the field, the
 * text around the hit, and -- where it was a class's wording rather than the
 * drug's own -- which version.
 */
export type MatchReport = { label: string; text: string; variant: VariantText | null };

/**
 * Enough of the matched text to see *why* a row is in the list.
 *
 * A window around the hit rather than the first 90 characters: the reason a
 * drug matched "pyrexia" is halfway down its adverse effects, and a snippet
 * that starts at the beginning of the field shows the reader none of it.
 */
export function snippet(text: string, lower: string): string {
  const at = text.toLowerCase().indexOf(lower);
  if (at < 0) return text.slice(0, 90);
  const from = Math.max(0, at - 30);
  const to = Math.min(text.length, at + lower.length + 60);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).trim()}${to < text.length ? '…' : ''}`;
}

/**
 * The searchable form of a set of rows: the fuzzy index over the name-ish
 * fields, and every field's text lower-cased once.
 *
 * Built apart from the search so the rail can hold on to it. Fuzzy matching
 * stays where it belongs -- on the name, the brands, the class and the
 * indications, where a near-miss spelling is the whole point. Field prose is
 * matched on **substring** instead, deliberately: fuzzy search over a paragraph
 * of mechanism finds something for almost any three letters, and a rail that
 * always has hits is a rail that never answers a question.
 */
export type DrugSearchIndex = {
  fuse: Fuse<DrugIndexRow>;
  byField: Map<string, { key: string; text: string; lower: string; variant: VariantText | null }[]>;
};

export function drugIndex(rows: DrugIndexRow[]): DrugSearchIndex {
  return {
    fuse: new Fuse(rows, {
      keys: [
        { name: 'generic', weight: 3 },
        { name: 'brands', weight: 2 },
        { name: 'drugClass', weight: 1 },
        { name: 'indications', weight: 1 },
      ],
      threshold: 0.35,
      ignoreLocation: true,
    }),
    /**
     * **The drug's own values first, then each version's.** Order carries
     * meaning here: the search below takes the first hit, so a drug that says
     * something itself is reported as saying it, and a version is only named
     * when the drug's own profile does not contain what was typed. Within the
     * versions it is overlay order, which is the order the numbers are in.
     */
    byField: new Map(
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
  };
}

/**
 * One box, two searches, in order: the name-ish fuzzy hits first, then the
 * drugs whose *content* contains what was typed.
 *
 * The order is the point. Searching "pyrexia" should find the BRAF inhibitors
 * by their adverse effects, and searching "dabrafenib" must still put
 * dabrafenib first -- so a content hit never outranks a name hit, and
 * `matchedIn` says which field earned a row its place when its name did not.
 */
export function rankDrugs(
  rows: DrugIndexRow[],
  index: DrugSearchIndex,
  filters: DrugFilters,
  fieldLabels: Map<string, string> = new Map(),
): { ranked: DrugIndexRow[]; matchedIn: Map<string, MatchReport> } {
  const query = filters.q.trim();
  if (!query) return { ranked: rows, matchedIn: new Map<string, MatchReport>() };

  const named = index.fuse.search(query).map((hit) => hit.item);
  const seen = new Set(named.map((row) => row.slug));
  const lower = query.toLowerCase();
  const found = new Map<string, MatchReport>();
  const byContent: DrugIndexRow[] = [];
  const byVariant: DrugIndexRow[] = [];

  for (const row of rows) {
    if (seen.has(row.slug)) continue;
    const hit = index.byField.get(row.slug)?.find((field) => field.lower.includes(lower));
    if (!hit) continue;
    // A drug whose own profile says it outranks one where only a class's
    // wording does -- same reasoning as a name hit outranking a content hit.
    // The last tier is still a real answer: it is the only way to find what a
    // lecture wrote.
    (hit.variant ? byVariant : byContent).push(row);
    found.set(row.slug, {
      label: fieldLabels.get(hit.key) ?? hit.key,
      text: snippet(hit.text, lower),
      variant: hit.variant,
    });
  }

  return { ranked: [...named, ...byContent, ...byVariant], matchedIn: found };
}

/** Everything the filters keep, in the order they were ranked. */
export function narrowDrugs(ranked: DrugIndexRow[], filters: DrugFilters): DrugIndexRow[] {
  const pickedTags = tagList(filters.tag);

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
    // The precise form of the search box: this exact field, containing this
    // text. A field chosen with nothing typed is not a filter yet -- it is half
    // of one -- so it narrows nothing until there is something to find.
    if (filters.fieldKey && filters.fieldText.trim()) {
      // Versions count here as well. Having the box find a row by a class's
      // wording and then the precise form of the same question lose it would be
      // two different ideas of what this app knows about a drug -- and the
      // looser control cannot be the more capable one.
      const inBase = contains(row.values[filters.fieldKey] ?? '', filters.fieldText);
      const inVariant = row.variants.some(
        (variant) => contains(variant.values[filters.fieldKey] ?? '', filters.fieldText),
      );
      if (!inBase && !inVariant) return false;
    }
    return true;
  });
}

/**
 * The list, start to finish: ranked, then narrowed.
 *
 * What the rail shows and what the profile pages through, from one call.
 */
export function selectDrugs(rows: DrugIndexRow[], filters: DrugFilters): DrugIndexRow[] {
  const { ranked } = rankDrugs(rows, drugIndex(rows), filters);
  return narrowDrugs(ranked, filters);
}

/** Where one drug sits in a filtered list, and what is either side of it. */
export type ListPlace = {
  /** 1-based, for *3 of 90*. */
  at: number;
  total: number;
  prev: { slug: string; generic: string } | null;
  next: { slug: string; generic: string } | null;
};

/**
 * One drug's place in the list the filters describe, or null.
 *
 * Null for a drug the filters do not select, which is the case worth being
 * careful about: a link can be edited, a drug can be untagged after the link
 * was made, and a pager claiming *4 of 90* on a drug that is not one of the 90
 * would be worse than no pager. It is also null for a list of one, where there
 * is nothing to page to.
 *
 * The *filtered* order, not alphabetical: a search ranks its results, and
 * paging has to walk the list that was on screen rather than a tidier one.
 */
export function placeInList(
  rows: DrugIndexRow[],
  filters: DrugFilters,
  slug: string,
): ListPlace | null {
  const list = selectDrugs(rows, filters);
  if (list.length < 2) return null;

  const at = list.findIndex((row) => row.slug === slug);
  if (at === -1) return null;

  const named = (row: DrugIndexRow | undefined) =>
    row ? { slug: row.slug, generic: row.generic } : null;

  return {
    at: at + 1,
    total: list.length,
    // Deliberately not a ring. Arriving back at the first drug after the
    // ninetieth reads as a bug the first time it happens, and the ends of a
    // list are information: *this is the last one* is worth knowing when you
    // are working through an exam.
    prev: named(list[at - 1]),
    next: named(list[at + 1]),
  };
}
