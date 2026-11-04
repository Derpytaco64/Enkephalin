'use client';

import { useActionState, useState } from 'react';
import { submitTo } from '@/app/_components/submit';
import type { FieldValue } from '@/db/schema';
import { activesOf, parseDosing } from '@/lib/dosing/parse';
import { indicationSlug, nearestIndication } from '@/lib/drugs/indications';
import type { Result } from '@/lib/drugs/mutations';
import type { FieldDef } from '@/lib/fields/registry';
import { DosingPreview } from './dosing-preview';
import { SigGlossary } from './sig-glossary';

const control = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';
const hint = 'mt-1 text-xs text-[var(--muted)]';
/** A textarea's line break. */
const NEWLINE = String.fromCharCode(10);

export type EditableField = { def: FieldDef; value: FieldValue | undefined };
export type AssignableTag = { slug: string; label: string; kind: string };

const KIND_LABELS: Record<string, string> = {
  top_list: 'Drug lists',
  school_year: 'Years',
  course: 'Courses',
  custom: 'Custom',
};

/**
 * Three states, because that is all a value can be: recorded, doubted, or
 * deliberately empty. Saving is what records it -- there is no separate act of
 * verifying, and nothing waits on one.
 */
const STATUS_CHOICES = [
  { value: 'ok', label: 'Recorded' },
  { value: 'flagged', label: 'Flagged — looks wrong' },
  { value: 'none', label: 'None to record' },
];

const SCHEDULES = ['CI', 'CII', 'CIII', 'CIV', 'CV'];

/**
 * Border colours for how the parser took the dosing prose. Only the dosing box
 * gets them: it is the one field whose wording has to survive being decoded,
 * and the colour is the fastest way to see that the sentence you just typed
 * went in whole. Never the only signal -- the preview underneath says the same
 * thing in words, for the same reason every badge in this app carries text.
 */
const PARSE_BORDERS: Record<string, string> = {
  parsed: 'var(--verified)',
  needs_review: 'var(--unverified)',
  refused: 'var(--flagged)',
};

/**
 * The indications box, with the one thing a plain textarea could not tell you:
 * which lines join an indication that already exists, and which would make a
 * new one.
 *
 * Making one is allowed -- it is how the vocabulary grows -- but it used to be
 * indistinguishable from a typo. Writing "Panic disorderr" really did create a
 * study filter holding one drug, with nobody told. Now it says so before you
 * save, matched by slug so case and the alias table behave the same way here
 * as they will in the database.
 */
function IndicationsField({
  indications,
  known,
}: {
  indications: string[];
  known: string[];
}) {
  const [text, setText] = useState(indications.join(NEWLINE));

  const bySlug = new Map(known.map((label) => [indicationSlug(label), label]));
  const joining: string[] = [];
  const creating: { text: string; near: string | null }[] = [];
  const seen = new Set<string>();

  for (const line of text.split(NEWLINE)) {
    const slug = indicationSlug(line);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);

    const match = bySlug.get(slug);
    if (match) {
      joining.push(match);
      continue;
    }
    // A new wording within a couple of edits of one we have is nearly always a
    // slip -- and used to be indistinguishable from a deliberate addition.
    creating.push({ text: line.trim(), near: nearestIndication(line, known)?.label ?? null });
  }

  return (
    <div>
      <label htmlFor="indications" className="block text-sm font-medium">Indications</label>
      <textarea
        id="indications" name="indications" rows={4}
        value={text} onChange={(event) => setText(event.target.value)}
        className={control}
      />
      <p className={hint}>
        One per line. These are a study filter as well as a fact, so they come from one shared
        list of {known.length}: match a phrase and the drug joins that filter.
      </p>

      {joining.length > 0 && <p className={hint}>Joining: {joining.join(' · ')}</p>}
      {creating.length > 0 && (
        <div className="mt-1 text-xs" style={{ color: 'var(--unverified)' }}>
          <p>
            New to the list, so saving adds {creating.length === 1 ? 'it' : 'them'}:{' '}
            {creating.map((entry) => entry.text).join(' · ')}. Right if this really is a new
            indication &mdash; a typo if not, and fixable under Admin &rarr; Indications.
          </p>
          {creating.filter((entry) => entry.near).map((entry) => (
            <p key={entry.text} className="mt-1">
              &ldquo;{entry.text}&rdquo; is a character or two from
              &ldquo;{entry.near}&rdquo;, which already exists. Did you mean that one?
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function FieldRow({
  field,
  generic,
  dosingUnique,
}: {
  field: EditableField;
  generic: string;
  dosingUnique: boolean;
}) {
  const { def, value } = field;
  const [text, setText] = useState(value?.value ?? '');
  const [unique, setUnique] = useState(dosingUnique);
  const multiline = def.dataType === 'markdown' || def.dataType === 'list';
  // The same parse the preview shows and the save will store. Suppressed once
  // the sig is marked unique: the colour is feedback for prose that is *meant*
  // to decode, and nagging about prose nobody expects to decode is noise.
  const parse = def.key === 'dosing' && text.trim() && !unique
    ? parseDosing(text, activesOf(generic))
    : null;

  return (
    <div className="rounded border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <label htmlFor={`f_${def.key}`} className="text-sm font-medium">{def.label}</label>
        <span className="text-xs text-[var(--muted)]">{def.dataType}</span>
        {value?.status === 'flagged' && (
          <span className="text-xs text-[var(--flagged)]">flagged</span>
        )}
      </div>

      {def.helpText && <p className={hint}>{def.helpText}</p>}

      {multiline ? (
        <textarea
          id={`f_${def.key}`}
          name={`f_${def.key}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={def.dataType === 'list' ? 3 : 4}
          className={`${control} font-sans`}
          style={parse ? { borderColor: PARSE_BORDERS[parse.status], borderWidth: 2 } : undefined}
          aria-describedby={parse ? `parse_${def.key}` : undefined}
        />
      ) : (
        <input
          id={`f_${def.key}`}
          name={`f_${def.key}`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          className={control}
        />
      )}

      {def.dataType === 'list' && <p className={hint}>One per line.</p>}
      {def.blankMeansNone && (
        <p className={hint}>Leaving this blank records “none”, which is itself an answer.</p>
      )}

      {/* The dosing prose is what the structured regimens are read from, so
          what the parser makes of it belongs next to the box you type it in --
          not discovered on a re-run after the wording is already saved. */}
      {def.key === 'dosing' && (
        <>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox" name="dosing_unique" checked={unique}
              onChange={(event) => setUnique(event.target.checked)}
              className="mt-1"
            />
            <span>
              Unique or complicated sig
              <span className="block text-xs text-[var(--muted)]">
                Tick this when the dosing is simply like that — a staged infusion, a taper, a
                protocol. The wording is kept and still asked as free recall; it stops being
                review work, and multiple choice leaves it alone rather than inventing options
                for it.
              </span>
            </span>
          </label>

          {!unique && (
            <>
              <DosingPreview prose={text} generic={generic} id={`parse_${def.key}`} />
              <SigGlossary />
            </>
          )}
        </>
      )}

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <label htmlFor={`src_${def.key}`} className="block text-xs text-[var(--muted)]">Source</label>
          <input
            id={`src_${def.key}`}
            name={`src_${def.key}`}
            defaultValue={value?.source ?? ''}
            placeholder="Micromedex, lecture, package insert"
            className={control}
          />
        </div>
        <div>
          <label htmlFor={`st_${def.key}`} className="block text-xs text-[var(--muted)]">Status</label>
          <select
            id={`st_${def.key}`} name={`st_${def.key}`}
            defaultValue={value?.status ?? (def.blankMeansNone ? 'none' : 'ok')}
            className={control}
          >
            {STATUS_CHOICES.map((choice) => (
              <option key={choice.value} value={choice.value}>{choice.label}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export function DrugForm({
  action,
  submitLabel,
  drug,
  brands,
  indications,
  knownIndications,
  fields,
  allTags,
  tagSlugs,
  systemTags,
}: {
  action: (formData: FormData) => Promise<Result<string>>;
  submitLabel: string;
  drug?: {
    slug: string;
    genericName: string;
    drugClass: string | null;
    schedule: string | null;
    scheduleNote: string | null;
    dosingUnique: boolean;
  };
  brands: string[];
  indications: string[];
  /** Every indication the database already holds, so a new one is visible. */
  knownIndications: string[];
  /** Empty when creating: there is nothing to attach a value to yet. */
  fields: EditableField[];
  allTags: AssignableTag[];
  tagSlugs: string[];
  /** Read-only, because the category seeder owns them. */
  systemTags: string[];
}) {
  const [state, formAction, pending] = useActionState(
    async (_previous: Result<string> | null, formData: FormData) => action(formData),
    null,
  );
  // Controlled, because the dosing preview labels a combination's amounts from
  // the actives in this name: typing "amoxicillin/clavulanate" has to reach
  // the preview before the drug is saved.
  const [generic, setGeneric] = useState(drug?.genericName ?? '');
  const dosingUnique = drug?.dosingUnique ?? false;

  const byKind = new Map<string, AssignableTag[]>();
  for (const tag of allTags) {
    const list = byKind.get(tag.kind);
    if (list) list.push(tag);
    else byKind.set(tag.kind, [tag]);
  }

  return (
    <form onSubmit={submitTo(formAction)} className="mt-8 space-y-8">
      {drug && <input type="hidden" name="slug" value={drug.slug} />}

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Identity</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="genericName" className="block text-sm font-medium">Generic name</label>
            <input
              id="genericName" name="genericName" required
              value={generic} onChange={(event) => setGeneric(event.target.value)}
              className={control}
            />
            {drug ? (
              <p className={hint}>
                The address stays <span className="font-mono">/drugs/{drug.slug}</span>: it is in
                every saved link and every card&rsquo;s history.
              </p>
            ) : (
              <p className={hint}>The address is made from this name and then fixed.</p>
            )}
          </div>

          <div>
            <label htmlFor="drugClass" className="block text-sm font-medium">Drug class</label>
            <input
              id="drugClass" name="drugClass" defaultValue={drug?.drugClass ?? ''}
              placeholder="Benzodiazepine" className={control}
            />
            <p className={hint}>
              The FDA class. Blank shows as Uncategorized, which is a fine answer — it is not a
              quizzed field.
            </p>
          </div>

          <div>
            <label htmlFor="schedule" className="block text-sm font-medium">Controlled schedule</label>
            <select id="schedule" name="schedule" defaultValue={drug?.schedule ?? ''} className={control}>
              <option value="">Not controlled</option>
              {SCHEDULES.map((schedule) => (
                <option key={schedule} value={schedule}>{schedule}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="scheduleNote" className="block text-sm font-medium">Schedule note</label>
            <input
              id="scheduleNote" name="scheduleNote" defaultValue={drug?.scheduleNote ?? ''}
              placeholder="CV in some states" className={control}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Names and uses</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="brands" className="block text-sm font-medium">Brand names</label>
            <textarea
              id="brands" name="brands" rows={4} defaultValue={brands.join('\n')} className={control}
            />
            <p className={hint}>
              One per line, in the order they should read. Editing a line keeps that brand&rsquo;s
              own dosing and indication pairings; deleting it removes them with it.
            </p>
          </div>

          <IndicationsField indications={indications} known={knownIndications} />
        </div>
      </section>

      {allTags.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Tags</h2>
          {[...byKind].map(([kind, kindTags]) => (
            <fieldset key={kind}>
              <legend className="text-xs text-[var(--muted)]">{KIND_LABELS[kind] ?? kind}</legend>
              <div className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {kindTags.map((tag) => (
                  <label key={tag.slug} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox" name="tag" value={tag.slug}
                      defaultChecked={tagSlugs.includes(tag.slug)}
                    />
                    {tag.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}

          {systemTags.length > 0 && (
            <p className={hint}>
              Therapeutic categories ({systemTags.join(', ')}) come from the category map in
              <span className="font-mono"> scripts/seed-categories.ts</span> and are rebuilt on every
              run, so they are not editable here — a change made by hand would last until the next
              run and then vanish.
            </p>
          )}
        </section>
      )}

      {fields.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Fields</h2>
          {fields.map((field) => (
            <FieldRow
              key={field.def.key} field={field} generic={generic} dosingUnique={dosingUnique}
            />
          ))}
        </section>
      )}

      {!drug && (
        <section>
          <label htmlFor="dosing" className="block text-sm font-medium">Dosing</label>
          <DosingOnCreate generic={generic} />
        </section>
      )}

      {state && !state.ok && (
        <p className="rounded border border-[var(--flagged)] bg-[var(--surface)] p-3 text-sm">
          {state.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="submit" disabled={pending}
          className="btn btn-primary"
        >
          {pending ? 'Saving…' : submitLabel}
        </button>
        {/* Beside the save, so it is the save's shape: a link that reads as
            the button next to it should be the button next to it. */}
        {drug && (
          <a href={`/drugs/${drug.slug}`} className="btn btn-quiet">
            Back to the profile
          </a>
        )}
      </div>
    </form>
  );
}

/** The one field a new drug can carry straight away, preview included. */
function DosingOnCreate({ generic }: { generic: string }) {
  const [prose, setProse] = useState('');
  const [unique, setUnique] = useState(false);

  return (
    <>
      <textarea
        id="dosing" name="dosing" rows={3} value={prose}
        onChange={(event) => setProse(event.target.value)}
        placeholder="10 mg by mouth once daily" className={control}
      />

      <label className="mt-2 flex items-center gap-2 text-sm">
        <input
          type="checkbox" name="dosing_unique" checked={unique}
          onChange={(event) => setUnique(event.target.checked)}
        />
        Unique or complicated sig
      </label>

      {!unique && (
        <>
          <DosingPreview prose={prose} generic={generic} />
          <SigGlossary />
        </>
      )}
      <p className={hint}>Everything else is on the edit screen, which opens next.</p>
    </>
  );
}
