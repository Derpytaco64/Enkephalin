/**
 * Client-safe half of the variant vocabulary: no database imports, so the
 * picker on a profile can read these without dragging the postgres driver into
 * the browser bundle. `variants.ts` holds everything that touches the database
 * and re-exports this, the same split `lib/fields/constants.ts` and
 * `lib/tags/constants.ts` already use.
 */

/**
 * The kinds of tag that can carry a variant of a drug profile, **in overlay
 * order**: widest first, so the narrowest one applies last and wins.
 *
 * Two rather than one because that is how the material is addressed -- *PHRM
 * 535*, and *Exam 3* within it -- and a drug is usually in both at once. The
 * order is a rule about meaning, not a preference about display: every query
 * sorts by this list rather than by the tag's own sort order.
 *
 * **`topic` was here and was taken out.** A topic is a thing the drug *is for*
 * -- melanoma is an indication, and indications are already a field, already
 * searchable and already their own axis in the study scope. Making it a third
 * scope meant one idea recorded in two places, where the tag and the field
 * could disagree about the same drug and neither was wrong. A class and the
 * exams inside it are the levels at which *wording* actually differs, which is
 * all a variant is. The enum value survives in the database because dropping
 * one is not worth a migration; nothing offers it any more.
 */
export const VARIANT_KINDS = ['course', 'exam'] as const;
export type VariantKind = (typeof VARIANT_KINDS)[number];

/** Where a kind sits in the overlay. Unknown kinds never reach this. */
export const KIND_RANK = new Map<string, number>(VARIANT_KINDS.map((kind, at) => [kind, at]));

/**
 * What a reader is shown. "Class" rather than "Course" because that is the word
 * the owner uses for it; `course` stays the stored value, since it is the tag
 * kind migration 0000 created and renaming an enum value is not worth a word.
 */
/**
 * The `?as=` value that asks for every version side by side rather than one of
 * them.
 *
 * A `~` because a tag slug cannot contain one -- slugs are `[a-z0-9-]` with no
 * leading dash, so this can never be mistaken for a class somebody named
 * "All". A sentinel that a user could collide with by naming a tag badly is
 * not a sentinel.
 */
export const ALL_VARIANTS = '~all';

export const VARIANT_KIND_LABELS: Record<VariantKind, string> = {
  course: 'Class',
  exam: 'Exam',
};
