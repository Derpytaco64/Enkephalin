'use client';

import { useActionState, useMemo, useState } from 'react';
import { submitTo } from '@/app/_components/submit';
import type { Result } from '@/lib/drugs/mutations';

export type MemberDrug = {
  id: string;
  slug: string;
  generic: string;
  drugClass: string | null;
  brands: string[];
};

const control = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

/**
 * Every drug in the database, in columns, with a box each: ticked means on
 * this list.
 *
 * The whole roster rather than a search-and-add, because the question being
 * answered is "is this list right?", and you can only see that against the
 * drugs that are *not* on it. 236 checkboxes is a lot of DOM and no trouble at
 * all to read -- three columns of class-annotated names, filterable, with the
 * running count at the top.
 *
 * Filtering never hides a tick: an unticked drug matching no filter is out of
 * sight, but a ticked one stays, so what the form is about to submit is always
 * visible. Submitting sends the ticked ids, and the server replaces the
 * membership with exactly those.
 */
export function MemberPicker({
  action,
  tag,
  drugs,
  members,
}: {
  action: (formData: FormData) => Promise<Result>;
  tag: { slug: string; label: string; kind: string };
  drugs: MemberDrug[];
  members: string[];
}) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result | null, formData: FormData) => action(formData),
    null,
  );
  const [chosen, setChosen] = useState<string[]>(members);
  const [filter, setFilter] = useState('');
  const [onlyMembers, setOnlyMembers] = useState(false);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return drugs.filter((drug) => {
      const ticked = chosen.includes(drug.id);
      if (onlyMembers && !ticked) return false;
      if (!needle) return true;
      if (ticked) return true;
      return (
        drug.generic.toLowerCase().includes(needle)
        || drug.brands.some((brand) => brand.toLowerCase().includes(needle))
        || (drug.drugClass ?? '').toLowerCase().includes(needle)
      );
    });
  }, [drugs, chosen, filter, onlyMembers]);

  function toggle(id: string) {
    setChosen((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  /** Acts on what is on screen, which is what "all" can honestly mean here. */
  function setShown(ticked: boolean) {
    const ids = new Set(shown.map((drug) => drug.id));
    setChosen((current) => {
      const kept = current.filter((id) => !ids.has(id));
      return ticked ? [...kept, ...ids] : kept;
    });
  }

  return (
    <form onSubmit={submitTo(formAction)} className="mt-6">
      <input type="hidden" name="slug" value={tag.slug} />

      <div className="flex flex-wrap items-end gap-4">
        <div className="min-w-56 flex-1">
          <label htmlFor="label" className="block text-sm font-medium">List name</label>
          <input id="label" name="label" defaultValue={tag.label} required className={control} />
          <p className="mt-1 text-xs text-[var(--muted)]">
            The address stays <span className="font-mono">{tag.slug}</span>, so saved study links
            keep working.
          </p>
        </div>

        <div className="min-w-56 flex-1">
          <label htmlFor="filter" className="block text-sm font-medium">Filter</label>
          <input
            id="filter" type="search" value={filter} placeholder="Name, brand or class"
            onChange={(event) => setFilter(event.target.value)}
            className={control} autoComplete="off"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-[var(--border)] py-2 text-sm">
        <span className="font-medium">
          {chosen.length} of {drugs.length} on this list
        </span>
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          <input
            type="checkbox" checked={onlyMembers}
            onChange={(event) => setOnlyMembers(event.target.checked)}
          />
          Show only what is on it
        </label>
        <span className="ml-auto flex gap-3 text-xs">
          <button type="button" onClick={() => setShown(true)} className="pill pill-xs">
            Tick these {shown.length}
          </button>
          <button type="button" onClick={() => setShown(false)} className="pill pill-xs">
            Untick these
          </button>
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--muted)]">Nothing matches.</p>
      ) : (
        <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((drug) => (
            <label key={drug.id} className="flex items-baseline gap-2 py-0.5 text-sm">
              <input
                type="checkbox" name="drug" value={drug.id}
                checked={chosen.includes(drug.id)}
                onChange={() => toggle(drug.id)}
                className="mt-1"
              />
              <span className="truncate" title={drug.brands.join(', ') || undefined}>
                {drug.generic}
                {drug.drugClass && (
                  <span className="ml-1 text-xs text-[var(--muted)]">· {drug.drugClass}</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}

      {state && (
        <p
          className="mt-4 rounded border p-3 text-sm"
          style={{ borderColor: state.ok ? 'var(--border)' : 'var(--flagged)' }}
        >
          {state.ok ? 'Saved.' : state.message}
        </p>
      )}

      <button
        type="submit" disabled={pending}
        className="btn btn-primary mt-4"
      >
        {pending ? 'Saving…' : 'Save list'}
      </button>
    </form>
  );
}
