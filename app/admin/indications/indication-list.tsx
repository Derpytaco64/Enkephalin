'use client';

import { useMemo, useState } from 'react';
import { submitTo } from '@/app/_components/submit';
import type { Result } from '@/lib/drugs/indication-store';

export type IndicationItem = { slug: string; label: string; drugs: number };

const control = 'rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm';

/**
 * The whole indication vocabulary, with the two repairs free text could not
 * do: rename one everywhere at once, and fold a near-duplicate into the one
 * you meant.
 *
 * One row expands at a time rather than ninety-two forms on the page, because
 * the question an admin arrives with is about one word -- usually one they
 * just noticed in a filter list and did not mean to create.
 *
 * Nothing here is optimistic. A rename reaches a browse rail, every profile
 * carrying it and both study pickers, so the row waits for the server and the
 * page revalidates rather than showing a new label the database may not have
 * taken.
 */
export function IndicationList({
  items,
  rename,
  merge,
  remove,
}: {
  items: IndicationItem[];
  rename: (formData: FormData) => Promise<Result>;
  merge: (formData: FormData) => Promise<Result<{ moved: number }>>;
  remove: (formData: FormData) => Promise<Result>;
}) {
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.label.toLowerCase().includes(needle));
  }, [items, filter]);

  /** One runner for all three, so a refusal always lands somewhere visible. */
  const run = (action: (formData: FormData) => Promise<Result<unknown>>) =>
    async (formData: FormData) => {
      setPending(true);
      setError(null);
      const result = await action(formData);
      setPending(false);
      if (result.ok) setOpen(null);
      else setError(result.message);
    };

  const unused = items.filter((item) => item.drugs === 0);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-baseline gap-3">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter indications"
          aria-label="Filter indications"
          className={control}
        />
        <span className="text-sm text-[var(--muted)]">
          {shown.length} of {items.length}
          {unused.length > 0 && ` · ${unused.length} on no drug`}
        </span>
      </div>

      {error && (
        <p className="mt-3 rounded border border-[var(--flagged)] p-3 text-sm">{error}</p>
      )}

      <ul className="mt-4 divide-y divide-[var(--border)]">
        {shown.map((item) => {
          const expanded = open === item.slug;

          return (
            <li key={item.slug} className="py-2">
              <div className="flex flex-wrap items-baseline gap-x-3">
                {/* A pill rather than a link, because it is not one: it
                    opens the row in place and goes nowhere. Filled while it is
                    open, which is the same thing the top bar's pill says. */}
                <button
                  type="button"
                  onClick={() => { setOpen(expanded ? null : item.slug); setError(null); }}
                  aria-expanded={expanded}
                  className={`pill ${expanded ? 'pill-on' : 'pill-soft'}`}
                >
                  {item.label}
                </button>
                <span className="font-mono text-xs text-[var(--muted)]">{item.slug}</span>
                <span className="ml-auto text-sm text-[var(--muted)]">
                  {item.drugs === 0
                    ? 'no drugs'
                    : `${item.drugs} drug${item.drugs === 1 ? '' : 's'}`}
                </span>
              </div>

              {expanded && (
                <div className="mt-3 grid gap-4 rounded border border-[var(--border)] p-3 sm:grid-cols-2">
                  <form onSubmit={submitTo(run(rename))}>
                    <input type="hidden" name="slug" value={item.slug} />
                    <label className="block text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      Rename
                    </label>
                    <input
                      name="label" defaultValue={item.label} required
                      className={`${control} mt-1 w-full`}
                    />
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Changes it on all {item.drugs} drug{item.drugs === 1 ? '' : 's'} at once. The
                      address stays <span className="font-mono">{item.slug}</span>, so a study link
                      you saved still works.
                    </p>
                    <button
                      type="submit" disabled={pending}
                      className="btn btn-primary btn-sm mt-2"
                    >
                      Rename
                    </button>
                  </form>

                  <form onSubmit={submitTo(run(merge))}>
                    <input type="hidden" name="from" value={item.slug} />
                    <label className="block text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                      Merge into
                    </label>
                    <select name="into" required defaultValue="" className={`${control} mt-1 w-full`}>
                      <option value="" disabled>Pick the one to keep…</option>
                      {items
                        .filter((other) => other.slug !== item.slug)
                        .map((other) => (
                          <option key={other.slug} value={other.slug}>
                            {other.label} ({other.drugs})
                          </option>
                        ))}
                    </select>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Every drug here joins the one you pick, and this entry goes. Use it for a
                      typo, or for two wordings of one thing — not to decide that two different
                      indications are the same.
                    </p>
                    <button
                      type="submit" disabled={pending}
                      className="btn btn-quiet btn-sm mt-2"
                    >
                      Merge
                    </button>
                  </form>

                  {item.drugs === 0 && (
                    <form onSubmit={submitTo(run(remove))} className="sm:col-span-2">
                      <input type="hidden" name="slug" value={item.slug} />
                      <p className="text-xs text-[var(--muted)]">
                        No drug carries this, so there is nothing to lose by removing it.
                      </p>
                      <button
                        type="submit" disabled={pending}
                        className="mt-2 rounded border border-[var(--flagged)] px-3 py-1.5 text-sm disabled:opacity-60"
                      >
                        Delete
                      </button>
                    </form>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="py-2 text-sm text-[var(--muted)]">Nothing matches that.</li>
        )}
      </ul>
    </div>
  );
}
