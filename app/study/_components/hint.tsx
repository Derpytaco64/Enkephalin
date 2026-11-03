import type { ReactNode } from 'react';

/**
 * A field label that keeps its explanation out of the way until you point at
 * the title.
 *
 * Three of the quiz settings need a paragraph to be honest about what they do,
 * and three paragraphs stacked down the form bury the controls they describe.
 * So the prose is a popover on the title rather than a permanent block.
 *
 * No JavaScript: it is hover state on the label and focus state on the field,
 * which matters because this renders inside a server component and a tooltip
 * is not worth a client boundary.
 *
 * Reachable without a mouse, which plain hover text is not:
 *
 * - **Keyboard** -- tabbing to the control shows it, via the `group/field`
 *   wrapper the caller puts round the pair.
 * - **Touch** -- tapping the title focuses the control it labels, which is the
 *   same thing, so the hint opens on tap.
 * - **Screen readers** -- `aria-describedby` reads it out whether or not it is
 *   visible, so the explanation is never hover-gated for someone who cannot
 *   hover. The caller wires that, because the id has to land on the control.
 *
 * Absolutely positioned on purpose: a hint that pushed the form down every
 * time the pointer crossed a label would make the page jump under the cursor.
 */
export function HintedLabel({ htmlFor, hint, children }: {
  htmlFor: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="group/title relative inline-flex w-fit cursor-help items-baseline gap-1 text-sm font-medium"
    >
      {children}
      {/* The affordance. Hover text nobody knows is there is hidden text. */}
      <span aria-hidden="true" className="text-xs text-[var(--muted)]">?</span>

      <span
        id={`${htmlFor}-hint`}
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-[min(18rem,calc(100vw-3rem))] rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs font-normal leading-relaxed text-[var(--muted)] shadow-lg group-hover/title:block group-focus-within/field:block"
      >
        {hint}
      </span>
    </label>
  );
}
