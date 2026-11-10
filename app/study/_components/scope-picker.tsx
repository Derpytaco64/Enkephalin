'use client';

import { useMemo, useState } from 'react';

export type ScopeOption = {
  slug: string;
  label: string;
  count: number;
  /**
   * A heading to sit this option under, where the axis holds more than one
   * kind of thing.
   *
   * Only the lists axis uses it, and it has to: *Top Drugs 2026*, *P2*,
   * *PHRM 535* and *Heme/Onc Exam 3* are four different questions, and a flat
   * list of them reads as one. Absent on the other axes, which hold sixty-five
   * of exactly one thing.
   */
  group?: string;
};

/**
 * One narrowing axis -- categories, indications -- as a collapsible list of
 * checkboxes.
 *
 * Checkboxes rather than a select, for two reasons: more than one can be in
 * play at once, and a native multi-select needs ctrl-click to use, which is
 * undiscoverable on a laptop and absent on a phone.
 *
 * Every box shares the same `name`, so the surrounding GET form submits
 * `cat=statins&cat=beta-blockers` with no JavaScript involved. A closed
 * `<details>` only hides its contents, so the boxes inside still submit --
 * which is what lets this collapse without quietly dropping the filter.
 *
 * Collapsed by default, because two axes of sixty-odd options each would
 * otherwise be the whole settings panel and push Start off the screen. The
 * summary stays readable while closed -- name, description, and how many are
 * ticked -- so a collapsed axis can never be a filter you cannot see.
 */
export function ScopePicker({
  name,
  legend,
  description,
  filterLabel,
  options,
  selected,
  control,
  all,
}: {
  name: string;
  legend: string;
  description: string;
  filterLabel: string;
  options: ScopeOption[];
  selected: string[];
  control: string;
  /**
   * Offers *every one picked* alongside the default *any of them*, for an axis
   * where both are real questions.
   *
   * Within an axis the default is **or** -- two exams mean revising both --
   * and across axes it is **and**, so a list and a category give the drugs in
   * both. That holds for categories and indications, where a drug has one
   * class and one list of uses. It breaks on lists, which now hold four kinds
   * of thing: *Top Drugs 2026 and PHRM 535* is a reasonable thing to want and
   * means the intersection, while *Exam 2 and Exam 3* means the union. One
   * fixed operator would be wrong half the time, so the axis that needs it
   * says which it is -- visibly, next to the boxes, because an operator you
   * cannot see is worse than one you cannot change.
   */
  all?: { name: string; checked: boolean; label: string };
}) {
  const [chosen, setChosen] = useState<string[]>(selected);
  const [filter, setFilter] = useState('');
  // Opens itself when the link it arrived on already has picks: the default is
  // closed, but an axis doing work is not something to hide.
  const [open, setOpen] = useState(selected.length > 0);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return options;
    // An option already ticked stays visible whatever the filter says, so
    // narrowing the list can never hide what it is about to submit.
    return options.filter(
      (option) => option.label.toLowerCase().includes(needle) || chosen.includes(option.slug),
    );
  }, [options, filter, chosen]);

  function toggle(slug: string) {
    setChosen((current) =>
      current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug],
    );
  }

  /**
   * The shown options under their headings, in the order the options arrived.
   *
   * A Map keyed by heading rather than a sort, so the caller's order is the
   * order on screen -- for lists that is lists, year, classes, exams, other,
   * which is widest-first and not alphabetical. One entry keyed `''` when no
   * option carries a group, which renders exactly as the flat list did.
   */
  const groups = useMemo(() => {
    const held = new Map<string, ScopeOption[]>();
    for (const option of shown) {
      const key = option.group ?? '';
      const list = held.get(key);
      if (list) list.push(option);
      else held.set(key, [option]);
    }
    return [...held.entries()];
  }, [shown]);

  const picked = options.filter((option) => chosen.includes(option.slug));
  const total = picked.reduce((sum, option) => sum + option.count, 0);

  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="rounded border border-[var(--border)] sm:col-span-2"
    >
      <summary className="cursor-pointer px-3 py-2">
        <span className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-sm font-medium">{legend}</span>
          <span className="text-xs text-[var(--muted)]">
            {chosen.length === 0
              ? 'Any'
              : `${chosen.length} picked — up to ${total} drug${total === 1 ? '' : 's'}`}
          </span>
        </span>
        <span className="mt-1 block text-xs text-[var(--muted)]">
          {chosen.length === 0
            ? description
            : picked.map((option) => option.label).join(', ')}
        </span>
      </summary>

      <fieldset className="border-t border-[var(--border)] px-3 pb-3">
        <legend className="sr-only">{legend}</legend>

        <div className="flex items-end gap-2">
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={filterLabel}
            aria-label={filterLabel}
            className={control}
            autoComplete="off"
          />
          {chosen.length > 0 && (
            <button
              type="button"
              onClick={() => setChosen([])}
              className="pill pill-xs mt-1 shrink-0"
            >
              Clear
            </button>
          )}
        </div>

        <div className="mt-2 max-h-48 overflow-y-auto rounded border border-[var(--border)] p-2">
          {shown.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">Nothing matches “{filter}”.</p>
          ) : (
            groups.map(([group, groupOptions]) => (
              <div key={group} className="mt-2 first:mt-0">
                {group && (
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                    {group}
                  </p>
                )}
                <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                  {groupOptions.map((option) => (
                    <label key={option.slug} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        name={name}
                        value={option.slug}
                        checked={chosen.includes(option.slug)}
                        onChange={() => toggle(option.slug)}
                      />
                      <span className="truncate" title={option.label}>{option.label}</span>
                      <span className="ml-auto text-xs text-[var(--muted)]">{option.count}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Only where more than one is ticked: with one pick the two readings
            are the same question, and a control that changes nothing is a
            control you have to think about for no reason. */}
        {all && chosen.length > 1 && (
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name={all.name} value="1" defaultChecked={all.checked} />
            {all.label}
          </label>
        )}
      </fieldset>
    </details>
  );
}
