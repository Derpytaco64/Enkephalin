/**
 * Twenty of the 237 have no FDA Established Pharmacologic Class, which is the
 * one class vocabulary this project trusts. They are not unresolved -- every
 * one has an ATC or VA candidate recorded -- but promoting those would mix
 * vocabularies on an axis that drives both colour coding and same-class
 * distractor generation, so none is assigned.
 *
 * `drugs.drug_class` therefore stays null, which is the truth, and these drugs
 * group under one visible heading rather than appearing as a blank. Anyone who
 * later wants a class has `class_candidates` and `class_suggestion` waiting.
 *
 * See PLAN.md open item 1.
 */
export const UNCATEGORIZED = 'Uncategorized';

/** What to show where a class would go. */
export function classLabel(drugClass: string | null | undefined): string {
  return drugClass?.trim() || UNCATEGORIZED;
}

/** Whether a filter value is asking for the drugs that have no class. */
export function isUncategorized(filter: string): boolean {
  return filter.trim().toLowerCase() === UNCATEGORIZED.toLowerCase();
}
