'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { submitTo } from '@/app/_components/submit';
import type { FieldDef } from '@/lib/fields/registry';
import type { FieldValue } from '@/db/schema';
import type { VariantState } from './actions';

export type VariantField = {
  def: FieldDef;
  /** The drug's own value, which is what an empty box falls through to. */
  base: FieldValue | undefined;
  /** This variant's own text, or '' where it has none. */
  own: string;
};

const control =
  'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
const hint = 'mt-1 text-xs text-[var(--muted)]';

/**
 * One row: the drug's own value, and a box for what this class says instead.
 *
 * The base value is shown rather than linked to, because the judgement being
 * made is *does my class say this differently* — and that is unanswerable
 * without the two side by side. It is set quietly and the box is the loud
 * half, since the box is the thing being filled in.
 */
function Row({ field, baseLabel }: { field: VariantField; baseLabel: string | null }) {
  const { def, base, own } = field;
  const [text, setText] = useState(own);
  const multiline = def.dataType === 'markdown' || def.dataType === 'list';
  const baseText = base?.value ?? null;
  const same = text.trim() !== '' && text.trim() === (baseText ?? '').trim();

  return (
    <div className="rounded border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <label htmlFor={`field_${def.key}`} className="text-sm font-medium">{def.label}</label>
        <span className="text-xs text-[var(--muted)]">{def.dataType}</span>
        {text.trim() !== '' && (
          <span className="text-xs font-medium text-[var(--accent)]">its own</span>
        )}
      </div>

      {/* The drug's own value, quietly, as the thing being differed from --
          named where those words are themselves a class's, because *the drug
          says* is a thin answer to *differently from what*. */}
      <p className={hint}>
        {baseText
          ? (
            <>
              The drug says{baseLabel !== null && <>, from {baseLabel}</>}:{' '}
              <span className="text-[var(--fg)]">{baseText}</span>
            </>
          )
          : 'The drug has nothing recorded for this.'}
      </p>

      {multiline ? (
        <textarea
          id={`field_${def.key}`}
          name={`field_${def.key}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={def.dataType === 'list' ? 3 : 4}
          className={`${control} font-sans`}
        />
      ) : (
        <input
          id={`field_${def.key}`}
          name={`field_${def.key}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className={control}
        />
      )}

      {def.dataType === 'list' && <p className={hint}>One per line.</p>}
      {same && (
        // Worth saying rather than refusing: a class really can repeat the
        // sheet word for word, and the author may want it recorded as theirs.
        // But far more often it is a paste nobody meant to keep.
        <p className={hint}>
          Identical to the drug’s own value — clear the box unless this class really sources it
          separately.
        </p>
      )}
    </div>
  );
}

/**
 * What one class or exam says about one drug.
 *
 * **Every field is posted on every save, blanks included**, because a blank is
 * how an override is cleared: an empty box means *this class says what the drug
 * says*, and the fall-through is the whole design. Nothing here stores a copy
 * of a value the drug already holds.
 *
 * One `source` for the layer rather than one per field. The question a reader
 * asks of such a value is *which class, and from what* — and the answer is
 * the same for every field read off the same slide deck, so asking per field
 * would be eleven boxes for one answer.
 */
export function VariantForm({
  action,
  drug,
  variant,
  fields,
  source,
  note,
  baseLabel,
}: {
  action: (formData: FormData) => Promise<VariantState>;
  drug: { slug: string; generic: string };
  variant: { slug: string; label: string; kind: string };
  fields: VariantField[];
  source: string;
  note: string;
  /** The class the drug's own profile is the wording of, where it is one. */
  baseLabel: string | null;
}) {
  const [state, formAction, pending] = useActionState<VariantState | null, FormData>(
    async (_previous, formData) => action(formData),
    null,
  );

  return (
    <form onSubmit={submitTo(formAction)} className="mt-6 space-y-4">
      <input type="hidden" name="slug" value={drug.slug} />
      <input type="hidden" name="variant" value={variant.slug} />

      <div className="rounded border border-[var(--border)] bg-[var(--surface)] p-3">
        <label htmlFor="source" className="text-sm font-medium">Where these values come from</label>
        <input id="source" name="source" defaultValue={source} className={control}
          placeholder={`from ${variant.label} content`} />
        <p className={hint}>
          Shown on the profile beside every value this version supplies, and it is the same
          line on all of them — which is why it says the class rather than the deck. Put the
          file name in the note below instead; one layer, one note, rather than the same file
          name copied onto fourteen fields.
        </p>

        <label htmlFor="note" className="mt-3 block text-sm font-medium">Note</label>
        <input id="note" name="note" defaultValue={note} className={control} />
        <p className={hint}>
          One line shown at the top of this version of the profile. For what it does differently
          in general — <em>exam 3 only covers the thioamides</em>.
        </p>
      </div>

      {fields.map((field) => (
        <Row key={field.def.key} field={field} baseLabel={baseLabel} />
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? 'Saving…' : `Save ${variant.label}`}
        </button>
        <Link href={`/drugs/${drug.slug}?as=${encodeURIComponent(variant.slug)}`} className="pill">
          Read it
        </Link>

        {state?.ok === false && (
          <span className="text-sm text-[var(--danger)]">{state.message}</span>
        )}
        {state?.ok && (
          <span className="text-sm text-[var(--muted)]">
            {state.overrides === 0
              ? `Saved. ${variant.label} now says nothing of its own, so it reads as the drug’s own profile.`
              : `Saved. ${variant.label} has its own wording for ${state.overrides} field${
                state.overrides === 1 ? '' : 's'}.`}
          </span>
        )}
      </div>
    </form>
  );
}
