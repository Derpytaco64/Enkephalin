'use client';

import Link from 'next/link';
import { useState } from 'react';
import { submitTo } from '@/app/_components/submit';
import type { Result } from '@/lib/drugs/mutations';
import type { Setup, Surface } from '@/lib/study/presets';

export type SetupRow = {
  id: string;
  name: string;
  surface: Surface;
  /** Where loading it goes: the study page with its settings in the query. */
  path: string;
  query: Record<string, string | string[]>;
  surfaceLabel: string;
  /** What it selects, in words, so a name you forgot is still readable. */
  summary: string;
};

/**
 * The saved setups, with the one you arrived to save at the top.
 *
 * Nothing here is optimistic. Saving over a setup replaces what the study
 * pages will load next time, so the row waits for the server and the page
 * revalidates rather than showing a name the database may have refused.
 */
export function SetupManager({
  rows,
  incoming,
  save,
  remove,
}: {
  rows: SetupRow[];
  /** Present only when you came from a study page with settings to keep. */
  incoming: { surface: Surface; surfaceLabel: string; summary: string; params: Setup['params'] } | null;
  save: (formData: FormData) => Promise<Result<Setup>>;
  remove: (formData: FormData) => Promise<Result>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  /** One runner for both, so a refusal always lands somewhere visible. */
  const run = (action: (formData: FormData) => Promise<Result<unknown>>, name?: string) =>
    async (formData: FormData) => {
      setPending(true);
      setError(null);
      const result = await action(formData);
      setPending(false);
      if (result.ok) setSaved(name ?? null);
      else setError(result.message);
    };

  const existing = new Set(rows.map((row) => row.name.toLowerCase()));
  const [name, setName] = useState('');
  const overwrites = existing.has(name.trim().toLowerCase());

  const control = 'rounded border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-sm';

  return (
    <div className="mt-6">
      {incoming !== null && (
        <form
          onSubmit={submitTo(run(save, name.trim()))}
          className="rounded border border-[var(--border)] p-4"
        >
          <h2 className="text-sm font-medium">Save this setup</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {incoming.surfaceLabel} — {incoming.summary}
          </p>

          <input type="hidden" name="surface" value={incoming.surface} />
          {/* The settings themselves, exactly as the page you came from had
              them. Repeated keys stay repeated, which is how a field list and
              a category list arrive in a query. */}
          {Object.entries(incoming.params).flatMap(([key, value]) =>
            (Array.isArray(value) ? value : [value]).map((item, at) => (
              <input key={`${key}-${at}`} type="hidden" name={key} value={item} />
            )))}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="P2 drill"
              aria-label="Name for this setup"
              maxLength={60}
              className={control}
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-[var(--accent-fg)] disabled:opacity-60"
            >
              {overwrites ? 'Replace' : 'Save'}
            </button>
            {overwrites && (
              <span className="text-xs text-[var(--muted)]">
                A setup called that already exists — saving replaces its settings.
              </span>
            )}
          </div>
        </form>
      )}

      {error !== null && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
      {error === null && saved !== null && (
        <p className="mt-3 text-sm text-[var(--ok)]">
          {saved === '' ? 'Setup removed.' : `Saved as “${saved}”.`}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--muted)]">
          No setups saved yet. Set a quiz or a deck up the way you like it, then use{' '}
          <span className="font-medium">Save this setup</span> on that page.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
              <Link
                href={{ pathname: row.path, query: row.query }}
                className="font-medium text-[var(--accent)] underline"
              >
                {row.name}
              </Link>
              <span className="text-xs uppercase tracking-wide text-[var(--muted)]">
                {row.surfaceLabel}
              </span>
              <span className="w-full text-xs text-[var(--muted)] sm:w-auto sm:flex-1">
                {row.summary}
              </span>
              <form onSubmit={submitTo(run(remove, ''))}>
                <input type="hidden" name="id" value={row.id} />
                <button
                  type="submit"
                  disabled={pending}
                  className="text-xs text-[var(--danger)] underline disabled:opacity-60"
                >
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
