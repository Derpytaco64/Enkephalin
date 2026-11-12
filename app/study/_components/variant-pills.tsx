import type { CardVariant } from '@/lib/study/cards';

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
 */
export function VariantPills({ variants }: { variants: CardVariant[] }) {
  if (variants.length === 0) return null;

  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {variants.map((variant) => (
        <li
          key={variant.slug}
          title={`Worded by ${variant.label} — version ${variant.n} of this drug`}
          className="flex items-baseline gap-1 rounded border border-[var(--border)]
            px-1.5 py-0.5 text-xs text-[var(--muted)]"
        >
          {/* V-1 is the drug's own profile, named after the lecture it came
              from; the layers are V-2 up. Same numbers as the profile's picker
              and the browse badge, so one pill means one thing. */}
          <span className="font-mono text-[0.6875rem]">V-{variant.n}</span>
          <span>{variant.label}</span>
        </li>
      ))}
    </ul>
  );
}
