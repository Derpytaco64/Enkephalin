'use client';

import { useActionState } from 'react';
import { FIELD_DATA_TYPES, YEAR_LEVELS, type Result } from '@/lib/fields/constants';
import type { FieldDef } from '@/lib/fields/registry';

const input = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2';
const hint = 'mt-1 text-xs text-[var(--muted)]';

export function FieldForm({
  action,
  field,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<Result>;
  field?: FieldDef;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result | null, formData: FormData) => action(formData),
    null,
  );

  return (
    <form action={formAction} className="mt-8 space-y-6">
      {field && <input type="hidden" name="id" value={field.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="key" className="block text-sm">Key</label>
          {field ? (
            <>
              <p className="mt-1 font-mono text-sm">{field.key}</p>
              <p className={hint}>
                Keys never change: stored values are filed under this one.
              </p>
            </>
          ) : (
            <>
              <input id="key" name="key" required className={`${input} font-mono`} placeholder="half_life" />
              <p className={hint}>Lower snake_case. Permanent once saved.</p>
            </>
          )}
        </div>

        <div>
          <label htmlFor="label" className="block text-sm">Label</label>
          <input id="label" name="label" required defaultValue={field?.label} className={input} />
          <p className={hint}>Safe to rename at any time.</p>
        </div>

        <div>
          <label htmlFor="group" className="block text-sm">Group</label>
          <input id="group" name="group" defaultValue={field?.group ?? ''} className={input} placeholder="Clinical" />
        </div>

        <div>
          <label htmlFor="sortOrder" className="block text-sm">Sort order</label>
          <input
            id="sortOrder" name="sortOrder" type="number" defaultValue={field?.sortOrder ?? 100}
            className={input}
          />
        </div>

        <div>
          <label htmlFor="dataType" className="block text-sm">Data type</label>
          <select id="dataType" name="dataType" defaultValue={field?.dataType ?? 'markdown'} className={input}>
            {FIELD_DATA_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="enumOptions" className="block text-sm">Enum options</label>
          <input
            id="enumOptions" name="enumOptions" defaultValue={(field?.enumOptions ?? []).join(', ')}
            className={input} placeholder="CI, CII, CIII"
          />
          <p className={hint}>Comma separated. Only used by enum fields.</p>
        </div>
      </div>

      <fieldset>
        <legend className="text-sm">Year levels responsible</legend>
        <div className="mt-2 flex gap-4">
          {YEAR_LEVELS.map((year) => (
            <label key={year} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" name={`year_${year}`}
                defaultChecked={(field?.yearLevels ?? []).includes(year)}
              />
              {year}
            </label>
          ))}
        </div>
        <p className={hint}>Leave all clear for a field no program year owns.</p>
      </fieldset>

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="blankMeansNone" defaultChecked={field?.blankMeansNone ?? false} className="mt-1" />
          <span>
            Blank means none
            <span className="block text-xs text-[var(--muted)]">
              Tick where empty is the answer rather than a gap, as with a drug that has no black
              box warning. Unticked, an empty value reads as “not recorded yet”.
            </span>
          </span>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isQuizzable" defaultChecked={field?.isQuizzable ?? true} />
          Can be quizzed
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="defaultVisible" defaultChecked={field?.defaultVisible ?? true} />
          Visible on profiles by default
        </label>
      </div>

      <div>
        <label htmlFor="promptTemplate" className="block text-sm">Prompt template</label>
        <input
          id="promptTemplate" name="promptTemplate" defaultValue={field?.promptTemplate ?? ''}
          className={input} placeholder="What is the mechanism of action of {{generic}}?"
        />
      </div>

      <div>
        <label htmlFor="helpText" className="block text-sm">Help text</label>
        <input id="helpText" name="helpText" defaultValue={field?.helpText ?? ''} className={input} />
      </div>

      {state && !state.ok && (
        <p role="alert" className="text-sm text-[var(--danger)]">{state.message}</p>
      )}
      {state?.ok && <p className="text-sm text-[var(--ok)]">Saved.</p>}

      <button
        type="submit" disabled={pending}
        className="rounded bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)] disabled:opacity-60"
      >
        {pending ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
