import type { ReactNode } from 'react';

/**
 * A field label with its explanation behind a `?` beside it.
 *
 * Three of the quiz settings need a paragraph to be honest about what they do,
 * and three paragraphs stacked down the form bury the controls they describe.
 * So the prose is a popover, and the `?` is the only thing that opens it --
 * the title is left alone, because a hint that appears whenever the pointer
 * crosses a word is a hint that appears while you are on your way somewhere
 * else.
 *
 * No JavaScript: hover and focus state on the `?`, which matters because this
 * renders inside a server component and a tooltip is not worth a client
 * boundary.
 *
 * Reachable without a mouse, which plain hover text is not:
 *
 * - **Keyboard** -- the `?` is a real button, so it takes focus in sequence
 *   and opens the hint when it does.
 * - **Touch** -- tapping it focuses it, which is the same thing. It sits
 *   outside the `<label>` on purpose: inside one, a tap would be forwarded to
 *   the select and open its options instead.
 * - **Screen readers** -- the caller points the control's `aria-describedby`
 *   at the hint, so the explanation is read out with the field whether or not
 *   it is visible, and is never hover-gated for someone who cannot hover.
 *
 * Absolutely positioned against the title row rather than against the `?`
 * itself: anchored to the mark it would start halfway across the column and
 * run off the right of a two-column form. `pointer-events-none` keeps it from
 * standing between the pointer and the select underneath it.
 */
export function HintedLabel({ htmlFor, title, hint }: {
  htmlFor: string;
  title: string;
  hint: ReactNode;
}) {
  return (
    <div className="relative flex w-fit items-center gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">{title}</label>

      {/* The group is the mark alone. The tooltip lives inside it so the
          variant can see it -- `group-hover` only matches descendants -- and
          is positioned against the row above, which is what `relative` up
          there is for. */}
      <span className="group/hint">
        <button
          type="button"
          aria-label={`What ${title} means`}
          className="flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-[var(--border)] text-[10px] leading-none text-[var(--muted)]"
        >
          ?
        </button>

        <span
          id={`${htmlFor}-hint`}
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-20 mt-1 hidden w-[min(18rem,calc(100vw-3rem))] rounded border border-[var(--border)] bg-[var(--surface)] p-2 text-xs font-normal leading-relaxed text-[var(--muted)] shadow-lg group-hover/hint:block group-focus-within/hint:block"
        >
          {hint}
        </span>
      </span>
    </div>
  );
}
