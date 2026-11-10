'use client';

import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ALL_VARIANTS, VARIANT_KIND_LABELS, type VariantKind } from '@/lib/drugs/variant-kinds';

export type PickerVariant = {
  slug: string;
  label: string;
  kind: VariantKind;
  overrides: number;
  /** The `n` in V-n, or null for a class with nothing of its own. */
  n: number | null;
};

/** Class, then exam — the order they overlay in, so the list reads widest first. */
const ORDER: VariantKind[] = ['course', 'exam'];

/**
 * Which version of this profile to read: the drug's own, or one a class or one
 * of its exams teaches.
 *
 * A dropdown rather than the row of pills this started as, on the owner's
 * call. A drug in two classes, each with three exams, has versions enough that
 * a pill apiece turns the top of the page into a second navigation bar. A
 * select stays one control however many there are, says which one is in force
 * without needing a fill colour, and groups them by kind so *Class / Exam* is
 * visible rather than inferred.
 *
 * The count beside a name is how many fields that version says differently,
 * because *this one has its own wording for 3 fields* is the thing worth
 * knowing before choosing it. A version with none is still offered: the drug is
 * tagged with it, and that is a true answer to "what does my class say about
 * this" -- it says what the drug says.
 *
 * Navigation, not state: the overlay happens on the server in
 * `getDrugProfile`, so this changes the URL and the page comes back assembled.
 * Which also makes every version linkable, and `?as=` the whole of the memory.
 */
export function VariantPicker({
  slug,
  variants,
  current,
}: {
  slug: string;
  variants: PickerVariant[];
  current: string | null;
}) {
  const router = useRouter();
  // Held locally so the select moves the instant it is used rather than when
  // the server comes back with the overlaid profile.
  const [chosen, setChosen] = useState(current ?? '');

  return (
    <select
      aria-label="Which version of this profile"
      value={chosen}
      onChange={(event) => {
        const next = event.target.value;
        setChosen(next);
        // `as Route` is the repo's idiom for a dynamic path under typedRoutes:
        // the shape is known, the slug is not known at build time.
        router.push(
          (next === '' ? `/drugs/${slug}` : `/drugs/${slug}?as=${encodeURIComponent(next)}`) as Route,
        );
      }}
      className="h-9 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
    >
      {/* Its own thing at the top, in its own group, and deliberately not the
          default: the table answers *how do these differ*, which is a question
          you ask on purpose. Landing on it would put a comparison in front of
          somebody who opened a drug to read it. Offered only where there is
          something to compare -- two versions, one of which says something. */}
      {variants.some((variant) => variant.n !== null) && (
        <optgroup label="Compare">
          <option value={ALL_VARIANTS}>Every version side by side</option>
        </optgroup>
      )}
      <option value="">The drug’s own profile</option>
      {ORDER.map((kind) => {
        const group = variants.filter((variant) => variant.kind === kind);
        if (group.length === 0) return null;
        return (
          <optgroup key={kind} label={VARIANT_KIND_LABELS[kind]}>
            {group.map((variant) => (
              <option key={variant.slug} value={variant.slug}>
                {/* The number first, where it is the identifier a card showed
                    you. A study card says *V-2 PHRM 535*; without the number
                    here, the control you came to this page to use does not
                    answer to the name you arrived with. A class with nothing
                    of its own has no number -- it is not another version. */}
                {variant.n !== null ? `V-${variant.n} ` : ''}{variant.label}
                {variant.overrides > 0 ? ` — ${variant.overrides} of its own` : ' — nothing of its own'}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
