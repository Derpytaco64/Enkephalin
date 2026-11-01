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
              className="text-xs text-[var(--accent)] underline"
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
          {fields.map((field) => (
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
          ))}
        </div>
      </fieldset>
    </>
  );
}
