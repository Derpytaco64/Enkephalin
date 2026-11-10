/**
 * Client-safe tag constants: the kinds a person can create.
 *
 * `system` is absent on purpose. Therapeutic categories are system tags and
 * `scripts/seed-categories.ts` owns them, rebuilding every link on each run,
 * so offering the kind in a form would invite work that the next run undoes.
 *
 * `course` and `exam` are the two that can also carry a **variant** of a drug
 * profile -- what that class says about the drug, where it says something of
 * its own. `lib/drugs/variant-kinds.ts` is where that list lives and where the
 * order they stack in is written down; this one only decides what a form may
 * offer. Leaving a kind out of here is how a tag ends up `custom` by accident,
 * which is a variant nothing can read.
 *
 * `topic` is deliberately absent: what a lecture is *about* is an indication,
 * and indications are a field with their own axis in the study scope. See
 * `variant-kinds.ts` for why that is a subtraction rather than an omission.
 */
export const TAG_KINDS = [
  'top_list', 'school_year', 'course', 'exam', 'custom',
] as const;
export type TagKind = (typeof TAG_KINDS)[number];

/**
 * The non-system kinds in the order a dropdown should list them, with the
 * heading each gets.
 *
 * The study scope's "Drug list" axis is one select over every non-system tag,
 * which was fine while that meant a sheet edition and three year levels. With
 * classes and exams in it -- and a lecture import creating both at once -- a
 * flat list stops saying what kind of thing each entry is, and *Exam 3* beside
 * *Top Drugs 2026* beside *P2* reads as one muddle.
 *
 * Shared by both study screens rather than written twice: they ask the same
 * question and must not drift into answering it differently.
 */
export const TAG_KIND_GROUPS: { kind: TagKind; label: string }[] = [
  { kind: 'top_list', label: 'Drug lists' },
  { kind: 'school_year', label: 'Year' },
  { kind: 'course', label: 'Classes' },
  { kind: 'exam', label: 'Exams' },
  { kind: 'custom', label: 'Other' },
];

/* ------------------------------------------------- filtering by several -- */

/**
 * The browse rail's tag axis, spelled as one URL parameter.
 *
 * Comma-joined rather than a repeated `?tag=a&tag=b` because the browser's
 * filter state is a flat object of strings -- its URL sync, its *is anything
 * on* check and its advanced-filter count all walk that object generically, and
 * an array value is truthy when empty, which would leave the rail permanently
 * in its filtered state. A comma cannot collide: a tag slug is `[a-z0-9-]` and
 * cannot begin with a dash.
 */
export const tagList = (value: string) => value.split(',').filter(Boolean);

/**
 * Does this drug's tags satisfy the picked set?
 *
 * **All of them by default.** A browse filter narrows -- which is what every
 * other control on that rail does, and what *Top Drugs 2026 and Heme/Onc Exam
 * 3* asks for: the drugs on both lists. `any` is the opt-in, for the other real
 * question (*Exam 2 or Exam 3*, revising two at once).
 *
 * The study screens default the other way round, and that is the job differing
 * rather than an inconsistency: a study scope *collects* material, where an
 * intersection can hand back an empty deck and a union never can, so there the
 * loose reading is the safe one. Here an over-wide filter is merely a list you
 * then have to read.
 *
 * Nothing picked matches everything, so the caller does not have to special-case
 * an empty filter -- and `every` over an empty list would say so anyway.
 */
export function matchesTags(
  rowTags: readonly string[],
  picked: readonly string[],
  mode: 'all' | 'any' = 'all',
): boolean {
  if (picked.length === 0) return true;
  return mode === 'any'
    ? picked.some((slug) => rowTags.includes(slug))
    : picked.every((slug) => rowTags.includes(slug));
}
