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

const ORDINALS = new Map([
  ['first', 'First'], ['1st', 'First'],
  ['second', 'Second'], ['2nd', 'Second'],
  ['third', 'Third'], ['3rd', 'Third'],
  ['fourth', 'Fourth'], ['4th', 'Fourth'],
  ['fifth', 'Fifth'], ['5th', 'Fifth'],
]);

/** *Third-generation cephalosporin*, as a lecture leads with it. */
const LEADING =
  /^(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)[-\s]generation\s+(.+)$/i;
/** *CEPHALOSPORIN 3RD GENERATION*, as ATC and VA spell the same thing. */
const TRAILING =
  /^(.+?)[,\s]+\(?(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th)[-\s]generation\)?$/i;

/**
 * The generation a class name states, written the way a note reads, or null.
 *
 * **A generation is not a class, and putting one in `drug_class` costs more
 * than it looks.** The class is stored as written and compared as a whole
 * string, so it is the browse rail's filter, the colour-by-class axis and the
 * pool the quiz draws same-class distractors from. Five generations of
 * cephalosporin are therefore five classes that never group: filtering to
 * cephalosporins is impossible, each generation gets its own colour, and a
 * cefuroxime question draws its wrong answers only from other
 * second-generation cephalosporins -- which is a narrower, easier question
 * than the one the lecture asked.
 *
 * It split this library sixteen ways before 2026-11-16, and asymmetrically:
 * the eleven cephalosporins a lecture created kept the generation it wrote,
 * while the five already on the class sheet had the FDA's own
 * *Cephalosporin Antibacterial* and nothing to say which generation they
 * were. The generation is real and exam-relevant, so it moved to `notes`,
 * where a fact about one drug belongs and where nothing groups by it.
 *
 * Both spellings are read because both are in the data: a lecture leads with
 * the generation, ATC and VA trail it, and either way it comes back as the one
 * form a note is written in -- sentence case and singular, beside
 * *- Cephamycin* and *- Cross-reactivity with penicillins*.
 */
export function generationNote(className: string | null | undefined): string | null {
  const trimmed = className?.trim();
  if (!trimmed) return null;

  const leading = LEADING.exec(trimmed);
  const trailing = leading ? null : TRAILING.exec(trimmed);
  const ordinal = leading?.[1] ?? trailing?.[2];
  const of = leading?.[2] ?? trailing?.[1];
  if (!ordinal || !of) return null;

  // Singular, because the note is about this drug. ATC names the group.
  const noun = of.trim().toLowerCase().replace(/s$/, '');
  return `${ORDINALS.get(ordinal.toLowerCase())}-generation ${noun}`;
}
