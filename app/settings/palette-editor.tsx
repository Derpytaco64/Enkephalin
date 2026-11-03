'use client';

import { useMemo, useState } from 'react';
import type { Result } from '@/lib/drugs/mutations';
import {
  checkFill, MIN_FILL_CONTRAST, normalizeHex, readableTextOn,
} from '@/lib/theme/palette';
import type { Swatch } from '@/lib/theme/swatches';

/**
 * The colour of each value on the chosen axis, one row at a time.
 *
 * The contrast numbers are computed here with the same functions the server
 * uses, so the figure beside a swatch is the figure the check was made on
 * rather than an illustration of it. They update as you type, which is the
 * point: a warning that only arrives after saving teaches nothing about which
 * direction to move.
 *
 * One row expands at a time rather than 119 colour pickers on a page. The
 * question anyone arrives with is about one class -- usually the one they just
 * saw a colour they disliked on.
 *
 * Nothing is optimistic. A colour reaches every page that shows a drug, so the
 * row waits for the server and the route revalidates.
 */
export function PaletteEditor({
  swatches,
  axisLabel,
  setColor,
  clearAll,
}: {
  swatches: Swatch[];
  axisLabel: string;
  setColor: (formData: FormData) => Promise<Result<{ color: string | null }>>;
  clearAll: () => Promise<Result>;
}) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return swatches;
    return swatches.filter((entry) => entry.label.toLowerCase().includes(needle));
  }, [swatches, filter]);

  const run = (action: () => Promise<Result<unknown>>) => async () => {
    setPending(true);
    setError(null);
    const result = await action();
    setPending(false);
    if (result.ok) setOpen(null);
    else setError(result.message);
  };

  const control = 'rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm';
  const overridden = swatches.filter((entry) => entry.overridden);

  // What the live text in the box would look like, or the stored colour while
  // the box is untouched or holds something not yet a colour.
  const preview = (entry: Swatch) =>
    (open === entry.key ? normalizeHex(draft) : null) ?? entry.color;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={`Filter ${axisLabel.toLowerCase()}`}
          aria-label={`Filter ${axisLabel.toLowerCase()}`}
          className={control}
        />
        <span className="text-sm text-[var(--muted)]">
          {shown.length} of {swatches.length}
          {overridden.length > 0 && ` · ${overridden.length} changed`}
        </span>
        {overridden.length > 0 && (
          <button
            type="button"
            onClick={run(clearAll)}
            disabled={pending}
            className="ml-auto text-xs text-[var(--danger)] underline disabled:opacity-60"
          >
            Reset every colour
          </button>
        )}
      </div>

      {error !== null && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}

      <ul className="mt-4 divide-y divide-[var(--border)] border-y border-[var(--border)]">
        {shown.map((entry) => {
          const color = preview(entry);
          const check = checkFill(color);
          const isOpen = open === entry.key;

          return (
            <li key={entry.key} className="py-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(isOpen ? null : entry.key);
                  setDraft(isOpen ? '' : entry.color);
                  setError(null);
                }}
                className="flex w-full flex-wrap items-center gap-3 text-left"
              >
                {/* The swatch is a badge, not a square: it is shown the way it
                    is used, with its own text on it. */}
                <span
                  className="rounded px-1.5 py-0.5 text-xs"
                  style={{ backgroundColor: color, color: readableTextOn(color) }}
                >
                  {entry.label.slice(0, 18)}
                </span>
                <span className="text-sm">{entry.label}</span>
                <span className="text-xs text-[var(--muted)]">
                  {entry.drugs} drug{entry.drugs === 1 ? '' : 's'}
                </span>
                {entry.overridden && <span className="text-xs text-[var(--muted)]">changed</span>}
                {!check.ok && (
                  <span className="text-xs text-[var(--unverified)]">hard to see</span>
                )}
              </button>

              {isOpen && (
                <div className="mt-2 pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="color"
                      value={normalizeHex(draft) ?? entry.color}
                      onChange={(event) => setDraft(event.target.value)}
                      aria-label={`Colour for ${entry.label}`}
                      className="h-8 w-12 rounded border border-[var(--border)] bg-[var(--surface)]"
                    />
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      aria-label={`Hex code for ${entry.label}`}
                      placeholder="#2563eb"
                      className={`${control} font-mono`}
                    />
                    <button
                      type="button"
                      disabled={pending}
                      onClick={run(() => {
                        const form = new FormData();
                        form.set('key', entry.key);
                        form.set('color', draft);
                        return setColor(form);
                      })}
                      className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-[var(--accent-fg)] disabled:opacity-60"
                    >
                      Save
                    </button>
                    {entry.overridden && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={run(() => {
                          const form = new FormData();
                          form.set('key', entry.key);
                          form.set('color', '');
                          return setColor(form);
                        })}
                        className="text-xs text-[var(--muted)] underline disabled:opacity-60"
                      >
                        Back to default
                      </button>
                    )}
                  </div>

                  {/* Both grounds, always, because a colour that works on one
                      is the usual way to make something invisible on the
                      other. */}
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    On light {check.light.toFixed(1)}:1 · on dark {check.dark.toFixed(1)}:1 ·
                    its own text {check.text.toFixed(1)}:1
                  </p>
                  {!check.ok && (
                    <p className="mt-1 text-xs text-[var(--unverified)]">
                      Under {MIN_FILL_CONTRAST}:1 against the{' '}
                      {check.light < check.dark ? 'light' : 'dark'} background, so this will be
                      hard to pick out there. It will still save — the label on it stays readable
                      either way.
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
