/**
 * Client-safe tag constants: the kinds a person can create.
 *
 * `system` is absent on purpose. Therapeutic categories are system tags and
 * `scripts/seed-categories.ts` owns them, rebuilding every link on each run,
 * so offering the kind in a form would invite work that the next run undoes.
 */
export const TAG_KINDS = ['top_list', 'school_year', 'course', 'custom'] as const;
export type TagKind = (typeof TAG_KINDS)[number];
