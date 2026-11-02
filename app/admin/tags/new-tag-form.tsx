'use client';

import { useActionState } from 'react';
import type { Result } from '@/lib/drugs/mutations';
import { TAG_KINDS } from '@/lib/tags/constants';

const control = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

const KIND_LABELS: Record<string, string> = {
  top_list: 'Drug list — a sheet edition or a top-200',
  school_year: 'Year — P1, P2, P3',
  course: 'Course',
  custom: 'Custom',
};

/** `system` is absent on purpose: categories come from the seeder's map. */
export function NewTagForm({ action }: { action: (formData: FormData) => Promise<Result<string>> }) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<string> | null, formData: FormData) => action(formData),
    null,
  );

  return (
    <form action={formAction} className="mt-8 border-t border-[var(--border)] pt-6">
      <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">New list</h2>

      <div className="mt-2 grid gap-4 sm:grid-cols-[2fr_1fr]">
        <div>
          <label htmlFor="label" className="block text-sm font-medium">Name</label>
          <input id="label" name="label" required placeholder="Top Drugs 2027" className={control} />
        </div>
        <div>
          <label htmlFor="kind" className="block text-sm font-medium">Kind</label>
          <select id="kind" name="kind" defaultValue="top_list" className={control}>
            {TAG_KINDS.map((kind) => (
              <option key={kind} value={kind}>{KIND_LABELS[kind] ?? kind}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="mt-1 text-xs text-[var(--muted)]">
        The kind decides where it appears: drug lists and courses are their own dropdown in a study
        session, kept apart from the therapeutic categories.
      </p>

      {state && !state.ok && (
        <p className="mt-3 rounded border border-[var(--flagged)] p-3 text-sm">{state.message}</p>
      )}

      <button
        type="submit" disabled={pending}
        className="mt-3 rounded bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)] disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create and pick drugs'}
      </button>
    </form>
  );
}
