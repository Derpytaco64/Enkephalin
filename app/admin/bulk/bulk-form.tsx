'use client';

import { useMemo, useState, useTransition } from 'react';
import { submitTo } from '@/app/_components/submit';
import type { BulkTarget } from '@/lib/admin/bulk';
import { bulkSetAction, type BulkResult } from './actions';

const control = 'mt-1 w-full rounded border border-[var(--border)]'
  + ' bg-[var(--surface)] px-3 py-2 text-sm';

export type BulkField = {
  key: string;
  label: string;
  dataType: string;
  enumOptions: string[] | null;
  blankMeansNone: boolean;
};

/**
 * The whole roster, each drug showing what it holds now, with a box each.
 *
 * Same shape as the tag member-picker and for the same reason: the question is
 * "is this selection right?", and that can only be seen against the drugs that
 * are *not* ticked. The addition here is the **current value beside every
 * name**, because the dangerous half of a bulk set is what it overwrites.
 *
 * Three quick selections do the work the screen exists for -- *gaps only* is
 * how you record a *none* across 180 drugs without touching the ones that have
 * an answer. **Only gaps is the default**, so the first click cannot overwrite
 * anything.
 *
 * `onSubmit={submitTo(...)}` and not `action=`: the form is seeded from stored
 * values and a reset would wipe the typed value while leaving it on screen.
 * See `app/_components/submit.tsx`.
 */
export function BulkForm({ field, targets }: { field: BulkField; targets: BulkTarget[] }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [value, setValue] = useState('');
  const [status, setStatus] = useState(field.blankMeansNone ? 'none' : 'ok');
  const [source, setSource] = useState('');
  const [result, setResult] = useState<BulkResult | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return targets;
    // A ticked drug is never hidden, so what Apply will write is always on
    // screen -- the member picker's rule, and it matters more here.
    return targets.filter((row) =>
      ticked.has(row.slug)
      || row.generic.toLowerCase().includes(needle)
      || (row.drugClass ?? '').toLowerCase().includes(needle)
      || row.current.toLowerCase().includes(needle));
  }, [targets, filter, ticked]);

  const toggle = (slug: string) => {
    setResult(null);
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const select = (rows: BulkTarget[]) => {
    setResult(null);
    setTicked(new Set(rows.map((row) => row.slug)));
  };

  // What Apply would actually do, counted before it is pressed.
  const chosen = targets.filter((row) => ticked.has(row.slug));
  const overwriting = chosen.filter((row) => !row.empty);
  const undoingHuman = chosen.filter((row) => row.humanSet);

  const submit = submitTo((formData) => {
    setResult(null);
    startTransition(async () => setResult(await bulkSetAction(formData)));
  });

  return (
    <form onSubmit={submit} className="mt-6">
      <input type="hidden" name="fieldKey" value={field.key} />
      {chosen.map((row) => (
        <input key={row.slug} type="hidden" name="slug" value={row.slug} />
      ))}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-[var(--muted)]">New value</span>
          {field.dataType === 'enum' && field.enumOptions ? (
            <select
              value={value}
              onChange={(event) => setValue(event.target.value)}
              name="value"
              className={control}
            >
              <option value="">(blank)</option>
              {field.enumOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          ) : (
            <textarea
              name="value"
              rows={2}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className={control}
              placeholder={field.blankMeansNone ? 'Leave blank to record "none"' : ''}
            />
          )}
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">Status</span>
          <select
            name="status"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className={control}
          >
            <option value="ok">ok</option>
            <option value="none">none — the drug has none</option>
            <option value="flagged">flagged — somebody should check</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-[var(--muted)]">Source</span>
          <input
            name="source"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            className={control}
            placeholder="what this was read off"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => select(targets.filter((row) => row.empty))}
          className="pill pill-xs pill-edge pill-soft"
        >
          Only the gaps ({targets.filter((row) => row.empty).length})
        </button>
        <button
          type="button"
          onClick={() => select(shown)}
          className="pill pill-xs pill-edge pill-soft"
        >
          Everything shown ({shown.length})
        </button>
        <button
          type="button"
          onClick={() => select([])}
          className="pill pill-xs pill-edge pill-soft"
        >
          Nothing
        </button>
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name, class or current value"
          className="ml-auto rounded border border-[var(--border)] bg-[var(--surface)]
            px-3 py-1 text-sm"
        />
      </div>

      {/* Said before Apply, not after: a count of what is about to be
          overwritten is the only thing standing between a typo and 236 of
          them. */}
      <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-sm">
          <strong className="tabular-nums">{chosen.length}</strong> ticked
          {overwriting.length > 0 && (
            <>
              {' · '}
              <span className="text-[var(--unverified)] tabular-nums">
                {overwriting.length} already {overwriting.length === 1 ? 'has' : 'have'} a value
                and would be overwritten
              </span>
            </>
          )}
          {undoingHuman.length > 0 && (
            <>
              {' · '}
              <span className="text-[var(--danger)] tabular-nums">
                {undoingHuman.length} {undoingHuman.length === 1 ? 'was' : 'were'} set by a person
              </span>
            </>
          )}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || chosen.length === 0}
            className="btn btn-primary btn-sm"
          >
            {pending ? 'Applying…' : `Set ${field.label} on ${chosen.length}`}
          </button>

          {result?.ok === false && (
            <span role="alert" className="text-sm text-[var(--danger)]">{result.message}</span>
          )}
          {result?.ok && (
            <span className="text-sm">
              <span className="text-[var(--verified)]">
                {result.outcome.changed.length} changed
              </span>
              {result.outcome.unchanged.length > 0
                && ` · ${result.outcome.unchanged.length} already matched`}
              {result.outcome.failed.length > 0 && (
                <span className="text-[var(--danger)]">
                  {' · '}{result.outcome.failed.length} refused
                </span>
              )}
            </span>
          )}
        </div>

        {result?.ok && result.outcome.failed.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-[var(--danger)]">
            {result.outcome.failed.map((row) => (
              <li key={row.slug}>{row.slug}: {row.message}</li>
            ))}
          </ul>
        )}
      </div>

      <ul className="mt-6 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {shown.map((row) => (
          <li key={row.slug}>
            <label className="flex items-baseline gap-2 py-1 text-sm">
              <input
                type="checkbox"
                checked={ticked.has(row.slug)}
                onChange={() => toggle(row.slug)}
                className="mt-1"
              />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{row.generic}</span>
                {row.humanSet && (
                  <span className="ml-1 text-xs text-[var(--unverified)]">edited</span>
                )}
                <span className="block truncate text-xs text-[var(--muted)]">
                  {row.current || '— no value'}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>

      {shown.length === 0 && (
        <p className="mt-6 text-sm text-[var(--muted)]">Nothing matches that filter.</p>
      )}
    </form>
  );
}
