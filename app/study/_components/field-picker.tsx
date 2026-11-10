'use client';

import { useState } from 'react';
import { YEAR_LEVELS } from '@/lib/fields/constants';

export type PickerField = { key: string; label: string; yearLevels: string[] };

/**
 * The year is a shortcut over the checkboxes, not a parallel setting, so
 * choosing one ticks its fields there and then. Left to a round trip the two
 * disagree: the submitted boxes win over the year, and picking P2 appears to
 * do nothing.
 */
export function FieldPicker({
  fields,
  selected,
  year,
  control,
}: {
  fields: PickerField[];
  selected: string[];
  year: string;
  control: string;
}) {
  const [chosen, setChosen] = useState<string[]>(selected);
  const [activeYear, setActiveYear] = useState(year);

  function pickYear(next: string) {
    setActiveYear(next);
    if (!next) return;
    setChosen(fields.filter((field) => field.yearLevels.includes(next)).map((field) => field.key));
  }

  function toggle(key: string) {
    setChosen((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );
    // Hand-adjusting means the set is no longer that year's set.
    setActiveYear('');
  }

  // The sheet's own columns, and everything an import brought with it. A year
  // is responsible for each of the former and for none of the latter, which is
  // the only honest line between them the data draws.
  const sheet = fields.filter((field) => field.yearLevels.length > 0);
  const extra = fields.filter((field) => field.yearLevels.length === 0);

  const box = (field: PickerField) => (
    <label key={field.key} className="flex items-center gap-2 text-sm">
      <input
        type="checkbox" name="fields" value={field.key}
        checked={chosen.includes(field.key)}
        onChange={() => toggle(field.key)}
      />
      {field.label}
      {field.yearLevels.length > 0 && (
        <span className="text-xs text-[var(--muted)]">{field.yearLevels.join('·')}</span>
      )}
    </label>
  );

  return (
    <>
      <div>
        <label htmlFor="year" className="block text-sm font-medium">Year</label>
        <select
          id="year" name="year" value={activeYear}
          onChange={(event) => pickYear(event.target.value)}
          className={control}
        >
          <option value="">Pick fields myself</option>
          {YEAR_LEVELS.map((level) => (
            <option key={level} value={level}>{level}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Ticks the fields that year is responsible for.
        </p>
      </div>

      <fieldset className="sm:col-span-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <legend className="text-sm font-medium">Fields</legend>
          {chosen.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setChosen([]);
                setActiveYear('');
              }}
              className="pill pill-xs"
            >
              Clear fields
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {chosen.length === 0
            ? 'Pick at least one. How they become cards depends on the card shape.'
            : `${chosen.length} selected. How they become cards depends on the card shape.`}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {sheet.map(box)}
        </div>

        {/* Everything a lecture added, folded away.

            The sheet's columns are the thing this app is for and there are six
            of them. Fields arrive from imported lectures -- adverse effects,
            monitoring, pearls -- and a flat row mixes *what are the top drugs*
            with *what did one class say about twenty of them*, which is two
            different study sessions. Told apart by `yearLevels`: a program year
            is responsible for every column of the sheet, and for nothing a
            lecture declared.

            A closed `<details>` still submits the boxes inside it, so folding
            this away can never silently drop a field from the deck -- which is
            also why the summary counts the ticked ones, and why it opens itself
            when any are. */}
        {extra.length > 0 && (
          <details open={extra.some((field) => chosen.includes(field.key))} className="mt-3">
            <summary className="cursor-pointer text-sm">
              Added by a class
              <span className="ml-2 text-xs text-[var(--muted)]">
                {(() => {
                  const on = extra.filter((field) => chosen.includes(field.key)).length;
                  return on === 0
                    ? `${extra.length} more`
                    : `${on} of ${extra.length} selected`;
                })()}
              </span>
            </summary>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
              {extra.map(box)}
            </div>
          </details>
        )}
      </fieldset>
    </>
  );
}
