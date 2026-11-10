'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { FIELD_FLAGS, type FieldFlag, type Result } from '@/lib/fields/constants';

export type ListedField = {
  id: string;
  key: string;
  label: string;
  group: string | null;
  dataType: string;
  yearLevels: string[];
  isCore: boolean;
  blankMeansNone: boolean;
  isQuizzable: boolean;
  defaultVisible: boolean;
};

/**
 * The fields, in the order they appear, with the three settings people change.
 *
 * Why this is a client component when the page around it is not: appearance
 * order is only expressible as *the whole order*, so a drag has to be able to
 * show the list rearranged before the server has agreed to it. The alternative
 * -- a number box per row, which is what this replaced -- made the one question
 * anybody asks of this page ("what comes after what") into arithmetic.
 *
 * **Within a group only.** A profile renders fields grouped, so a field
 * dragged between two members of another group would appear on the page in a
 * place the profile will not put it. Moving a field to a different group is an
 * edit to the field, and the editor is where that lives.
 */
export function FieldList({
  fields,
  reorder,
  setFlag,
  remove,
}: {
  fields: ListedField[];
  reorder: (ids: string[]) => Promise<Result>;
  setFlag: (id: string, flag: string, value: boolean) => Promise<Result>;
  remove: (formData: FormData) => Promise<void>;
}) {
  /**
   * The order on screen, which leads the database by as long as a write takes.
   *
   * Seeded from the server's order and *not* resynced on every render: a
   * revalidate landing mid-drag would otherwise snatch the row back. The two
   * only disagree when a write failed, and that path says so and puts it back.
   */
  const [order, setOrder] = useState(fields);
  const [dragging, setDragging] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [, start] = useTransition();

  const groupOf = (field: ListedField) => field.group ?? 'Other';

  // Groups in the order their first field appears, the same rule
  // `groupFieldDefs` applies on a profile -- and `fields` arrives already
  // flattened through it, so each group is one contiguous run here and the
  // arrows below can move a row by its neighbour in this same array.
  const groups: [string, ListedField[]][] = [];
  for (const field of order) {
    const name = groupOf(field);
    const existing = groups.find(([key]) => key === name);
    if (existing) existing[1].push(field);
    else groups.push([name, [field]]);
  }

  const commit = (next: ListedField[]) => {
    setOrder(next);
    setProblem(null);
    start(async () => {
      const result = await reorder(next.map((field) => field.id));
      if (!result.ok) {
        setOrder(fields);
        setProblem(result.message);
      }
    });
  };

  /** Moves `id` to where `over` sits, both of them in one group. */
  const moveOnto = (id: string, over: string) => {
    if (id === over) return;
    const from = order.findIndex((field) => field.id === id);
    const to = order.findIndex((field) => field.id === over);
    if (from < 0 || to < 0) return;
    if (groupOf(order[from]) !== groupOf(order[to])) return;

    const next = [...order];
    next.splice(to, 0, ...next.splice(from, 1));
    setOrder(next);
  };

  /** The keyboard and touch path, since neither can drag. */
  const nudge = (id: string, by: -1 | 1) => {
    const at = order.findIndex((field) => field.id === id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= order.length) return;
    if (groupOf(order[at]) !== groupOf(order[to])) return;

    const next = [...order];
    [next[at], next[to]] = [next[to], next[at]];
    commit(next);
  };

  const toggle = (field: ListedField, flag: FieldFlag, value: boolean) => {
    setOrder((rows) => rows.map((row) => (row.id === field.id ? { ...row, [flag]: value } : row)));
    setProblem(null);
    start(async () => {
      const result = await setFlag(field.id, flag, value);
      if (!result.ok) {
        setOrder((rows) =>
          rows.map((row) => (row.id === field.id ? { ...row, [flag]: !value } : row)));
        setProblem(result.message);
      }
    });
  };

  return (
    <>
      <p className="mt-6 text-xs text-[var(--muted)]">
        Drag a row by its handle to reorder it, or use the arrows — within its group, which is how a
        profile reads them. {FIELD_FLAGS.map((flag, at) => (
          <span key={flag.key}>
            {at > 0 ? ' · ' : ''}
            <strong className="font-medium text-[var(--fg)]">{flag.short}</strong> {flag.label.toLowerCase()}
          </span>
        ))}.
      </p>

      {problem !== null && (
        <p className="mt-3 rounded border border-[var(--danger)] bg-[var(--surface)] p-3 text-sm">
          {problem}
        </p>
      )}

      {groups.map(([group, rows]) => (
        <section key={group} className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
            {group}
          </h2>
          <ul className="mt-2 divide-y divide-[var(--border)]">
            {rows.map((field, at) => (
              <li
                key={field.id}
                draggable
                onDragStart={(event) => {
                  setDragging(field.id);
                  event.dataTransfer.effectAllowed = 'move';
                  // Firefox will not start a drag without data on it.
                  event.dataTransfer.setData('text/plain', field.id);
                }}
                onDragOver={(event) => {
                  if (dragging === null || dragging === field.id) return;
                  event.preventDefault();
                  moveOnto(dragging, field.id);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  commit(order);
                }}
                className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 ${
                  dragging === field.id ? 'opacity-50' : ''}`}
              >
                <span
                  aria-hidden
                  title="Drag to reorder"
                  className="cursor-grab select-none font-mono text-xs text-[var(--muted)]"
                >
                  ⠿
                </span>
                <Link href={`/admin/fields/${field.id}`} className="text-[var(--accent)] underline">
                  {field.label}
                </Link>
                <code className="text-xs text-[var(--muted)]">{field.key}</code>
                <span className="text-xs text-[var(--muted)]">{field.dataType}</span>
                {field.yearLevels.length > 0 && (
                  <span className="text-xs text-[var(--muted)]">{field.yearLevels.join(' · ')}</span>
                )}

                <span className="ml-auto flex items-center gap-3 text-xs">
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => nudge(field.id, -1)}
                      disabled={at === 0}
                      title={`Move ${field.label} up`}
                      className="pill pill-xs pill-edge disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => nudge(field.id, 1)}
                      disabled={at === rows.length - 1}
                      title={`Move ${field.label} down`}
                      className="pill pill-xs pill-edge disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </span>

                  {FIELD_FLAGS.map((flag) => (
                    <label
                      key={flag.key}
                      title={`${flag.label} — ${flag.hint}`}
                      className="flex items-center gap-1 text-[var(--muted)]"
                    >
                      <input
                        type="checkbox"
                        checked={field[flag.key]}
                        onChange={(event) => toggle(field, flag.key, event.target.checked)}
                      />
                      {flag.short}
                    </label>
                  ))}

                  {field.isCore ? (
                    <span className="text-[var(--muted)]">core</span>
                  ) : (
                    <form action={remove}>
                      <input type="hidden" name="id" value={field.id} />
                      <button type="submit" className="pill pill-xs pill-danger">Remove</button>
                    </form>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
