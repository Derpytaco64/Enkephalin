'use client';

import { useMemo, useState } from 'react';

export type PickerCategory = { slug: string; label: string; count: number };

/**
 * Categories are checkboxes rather than a select, for two reasons: more than
 * one can be in play at once, and a native multi-select needs ctrl-click to
 * use, which is undiscoverable on a laptop and absent on a phone.
 *
 * Every box shares the name `cat`, so the surrounding GET form submits
 * `cat=statins&cat=beta-blockers` with no JavaScript involved. The filter box
 * is the only thing this component needs state for: sixty-five categories is
 * more than anyone wants to scroll past to find one.
 */
export function CategoryPicker({
  categories,
  selected,
  control,
}: {
  categories: PickerCategory[];
  selected: string[];
  control: string;
}) {
  const [chosen, setChosen] = useState<string[]>(selected);
  const [filter, setFilter] = useState('');

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return categories;
    // A category already ticked stays visible whatever the filter says, so
    // narrowing the list can never hide what it is about to submit.
    return categories.filter(
      (category) => category.label.toLowerCase().includes(needle) || chosen.includes(category.slug),
    );
  }, [categories, filter, chosen]);

  function toggle(slug: string) {
    setChosen((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  }

  const picked = categories.filter((category) => chosen.includes(category.slug));
  const total = picked.reduce((sum, category) => sum + category.count, 0);

  return (
    <fieldset className="sm:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <legend className="text-sm font-medium">Categories</legend>
        {chosen.length > 0 && (
          <button
            type="button"
            onClick={() => setChosen([])}
            className="text-xs text-[var(--accent)] underline"
          >
            Clear categories
          </button>
        )}
      </div>

      <p className="mt-1 text-xs text-[var(--muted)]">
        {chosen.length === 0
          ? 'Every category. Picking some narrows the drug list rather than replacing it.'
          : `${picked.map((category) => category.label).join(', ')} — up to ${total} drug${total === 1 ? '' : 's'}.`}
      </p>

      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filter categories"
        aria-label="Filter categories"
        className={control}
        autoComplete="off"
      />

      <div className="mt-2 max-h-48 overflow-y-auto rounded border border-[var(--border)] p-2">
        {shown.length === 0 ? (
          <p className="text-xs text-[var(--muted)]">Nothing matches “{filter}”.</p>
        ) : (
          <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
            {shown.map((category) => (
              <label key={category.slug} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="cat"
                  value={category.slug}
                  checked={chosen.includes(category.slug)}
                  onChange={() => toggle(category.slug)}
                />
                <span className="truncate">{category.label}</span>
                <span className="ml-auto text-xs text-[var(--muted)]">{category.count}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </fieldset>
  );
}
