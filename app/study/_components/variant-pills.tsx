import type { CardVariant } from '@/lib/study/cards';

/** How many version colours `app/globals.css` defines. */
const VERSION_COLOURS = 8;

/**
 * Which of the eight colours this version wears.
 *
 * FNV-1a over the tag's slug, which is deliberately the same hash
 * `lib/theme/palette.ts` runs over the same string -- so *Heme/Onc Exam 3
 * 2026* is the same hue on a flashcard as it is on the browse list, without
 * the study side importing the palette, which it may not do
 * (`tests/colour-is-cosmetic.test.ts`). Duplicated rather than shared for
 * that reason, and `tests/study-colour.test.ts` pins the two together so the
 * copy cannot drift.
 *
 * Stable across sessions, because a colour that moves means nothing: the slug
 * is the input, not the version number, so a class keeps its colour whether it
 * is V-2 on one drug and V-3 on another.
 */
function tintOf(slug: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < slug.length; at += 1) {
    hash ^= slug.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % VERSION_COLOURS) + 1;
}

/**
 * Whose wording this is: **V-2 · PHRM 535**.
 *
 * The gap it closes is the one the variant feature left open for a day: the
 * values were overlaid correctly and the screen you spend your time in said
 * nothing about it. A deck scoped to a list that names a version per drug can
 * be reading three classes' wording in one session, and without this there is
 * nothing on screen to tell you which answer you are being asked for.
 *
 * **The drug's name is deliberately not in it.** Asked the other way round the
 * drug *is* the answer, so a pill reading *amoxicillin [V-2]* on the question
 * side would hand it over. The number and the class are safe on both sides: the
 * number is only meaningful next to a drug you have already been told, and the
 * class is a fact about the source rather than about the answer.
 *
 * Shown on the question and on the answer rather than on one of them, because
 * both are that class's -- the question is *what does PHRM 535 say the
 * mechanism is*, and the answer is what PHRM 535 says.
 *
 * **Filled with that version's own colour**, so one glance at the corner of a
 * card says where its words came from. The colour never carries the fact by
 * itself: the number and the class are printed on the pill whatever the fill
 * is, which is what keeps this on the right side of *colour is decoration* --
 * and the options of a quiz question are never tinted, because the option
 * whose colour matched the prompt would be the answer.
 */
export function VariantPills({
  variants,
  align = 'start',
}: {
  variants: CardVariant[];
  /** `end` is the card's top-right corner; `start` is inline beside a label. */
  align?: 'start' | 'end';
}) {
  if (variants.length === 0) return null;

  return (
    <ul className={`flex flex-wrap items-center gap-1.5 ${align === 'end' ? 'justify-end' : ''}`}>
      {variants.map((variant) => {
        const tint = tintOf(variant.slug);
        return (
          <li
            key={variant.slug}
            title={`Worded by ${variant.label} — version ${variant.n} of this drug`}
            className="flex items-baseline gap-1 rounded px-1.5 py-0.5 text-xs font-medium"
            style={{
              backgroundColor: `var(--version-${tint})`,
              color: `var(--version-${tint}-ink)`,
            }}
          >
            {/* V-1 is the drug's own profile, named after the lecture it came
                from; the layers are V-2 up. Same numbers as the profile's picker
                and the browse badge, so one pill means one thing. */}
            <span className="font-mono text-[0.6875rem]">V-{variant.n}</span>
            <span>{variant.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
