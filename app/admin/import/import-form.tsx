'use client';

import { useActionState, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { submitTo } from '@/app/_components/submit';
import type { AskedField, ImportState } from './actions';
import type { ImportPlan, PlannedDrug } from '@/lib/drugs/import';
import {
  TARGET_DRUG, TARGET_UNDECIDED, WRITE_MODES, WRITE_MODE_COPY,
  type ImportProblem, type WriteMode,
} from '@/lib/drugs/import-format';

const CARD = 'rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4';

/** A value cut to the length a person reads, and *none* said as a word. */
const trim = (text: string | null) =>
  text === null ? 'none to record' : text.length > 140 ? `${text.slice(0, 140)}…` : text;

/**
 * What a value would replace, in the two lines a person actually reads.
 *
 * Only for a write that lands on the drug's own profile with something already
 * there -- which under the default `fill` mode is never, and under `base` is
 * the whole point of looking.
 */
function Change({ from, to }: { from: string | null; to: string | null }) {
  return (
    <div className="mt-1 space-y-0.5 text-xs">
      {from !== null && <p className="text-[var(--muted)] line-through">{trim(from)}</p>}
      <p>{trim(to)}</p>
    </div>
  );
}

function DrugRow({
  drug, variant, correcting,
}: { drug: PlannedDrug; variant: string | null; correcting: boolean }) {
  const toDrug = drug.writes.filter((write) => write.to === 'drug');
  const toVariant = drug.writes.filter((write) => write.to === 'variant');
  const held = drug.writes.filter((write) => write.to === 'held');
  const same = drug.writes.filter((write) => write.to === 'unchanged').length;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="font-medium">{drug.generic}</span>
        <span className={drug.exists ? 'text-xs text-[var(--muted)]' : 'text-xs text-[var(--accent)]'}>
          {drug.exists ? 'already here' : 'new drug'}
        </span>
        {drug.identity.drugClass && (
          <span className="text-xs text-[var(--muted)]">class: {drug.identity.drugClass}</span>
        )}
        {drug.identity.schedule && (
          <span className="text-xs text-[var(--muted)]">schedule: {drug.identity.schedule}</span>
        )}
      </div>

      {(drug.brands.adding.length > 0 || drug.indications.adding.length > 0 || drug.tags.length > 0) && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          {drug.brands.adding.length > 0 && <>brands + {drug.brands.adding.join(', ')}. </>}
          {drug.indications.adding.length > 0 && <>indications + {drug.indications.adding.join('; ')}. </>}
          {drug.tags.length > 0 && <>tagged {drug.tags.join(', ')}.</>}
        </p>
      )}

      {toDrug.length > 0 && (
        <dl className="mt-2 space-y-1.5">
          {toDrug.map((write) => (
            <div key={write.key}>
              <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                {write.label}
                {write.status === 'flagged' && (
                  <span className="ml-2 text-[var(--flagged)]">flagged</span>
                )}
              </dt>
              <dd><Change from={write.from} to={write.value} /></dd>
            </div>
          ))}
        </dl>
      )}

      {toVariant.length > 0 && (
        <div className="mt-2 rounded border border-[var(--border)] p-2">
          <p className="text-xs text-[var(--muted)]">
            {correcting ? (
              <>
                Overwriting what{' '}
                <span className="font-medium text-[var(--fg)]">{variant}</span> says. The drug’s
                own profile is left as it is:
              </>
            ) : (
              <>
                Said differently here, so it goes to{' '}
                <span className="font-medium text-[var(--fg)]">{variant}</span> rather than over
                the drug’s own:
              </>
            )}
          </p>
          <dl className="mt-1.5 space-y-1.5">
            {toVariant.map((write) => (
              <div key={write.key}>
                <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  {write.label}
                </dt>
                <dd><Change from={write.from} to={write.value} /></dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {/* The write that is not a write. Its own box, and the one place the
          struck-through line is the *file's* wording rather than the app's:
          what the version holds is what survives. */}
      {held.length > 0 && (
        <div className="mt-2 rounded border border-[var(--flagged)] p-2">
          <p className="text-xs text-[var(--muted)]">
            Another lecture already wrote this into{' '}
            <span className="font-medium text-[var(--fg)]">{variant}</span>, so this file’s wording
            is <span className="font-medium text-[var(--fg)]">left out</span>. Merge them in the
            file, or import again with <em>Correct the drug itself</em> aimed at that version:
          </p>
          <dl className="mt-1.5 space-y-1.5">
            {held.map((write) => (
              <div key={write.key}>
                <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                  {write.label}
                  {write.heldBy && (
                    <span className="ml-2 font-normal normal-case tracking-normal">
                      kept from {write.heldBy}
                    </span>
                  )}
                </dt>
                <dd className="mt-1 space-y-0.5 text-xs">
                  <p>{write.from === null ? 'none to record' : trim(write.from)}</p>
                  <p className="text-[var(--muted)] line-through">{trim(write.value)}</p>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {same > 0 && (
        <p className="mt-1 text-xs text-[var(--muted)]">
          {same} field{same === 1 ? '' : 's'} already say{same === 1 ? 's' : ''} exactly this.
        </p>
      )}
    </li>
  );
}

/**
 * The things to fix, and what that means for the file.
 *
 * `note` is a parameter because the two callers mean opposite things by a
 * problem and this box used to say *Nothing was written* to both of them. A
 * refusal found while checking stops the whole import; a problem in the report
 * is one entry that did not land out of a file that otherwise did -- a slug
 * collision, say. Telling somebody nothing was written when most of it was is
 * worse than saying nothing, because they re-import on the strength of it.
 */
function Problems({ problems, note }: { problems: ImportProblem[]; note: string }) {
  return (
    <div className="mt-6 rounded-lg border border-[var(--danger)] bg-[var(--surface)] p-4">
      <p className="text-sm font-medium">
        {problems.length === 1 ? 'One thing' : `${problems.length} things`} to fix. {note}
      </p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {problems.map((problem, at) => (
          <li key={`${problem.where}-${at}`}>
            <span className="font-mono text-xs text-[var(--muted)]">{problem.where}</span>
            <br />
            {problem.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What to tidy, which is not what to fix.
 *
 * Its own box rather than a line in the refusal one, because the two call for
 * opposite things: a refusal is read before the import happens, and this is
 * read before the *next file* is written. Same naming as a refusal --
 * `drugs[3] (Ciprofloxacin).fields.bbw` -- so it points at the same place in
 * the file, and no *nothing was written* line, because everything will be.
 */
function Warnings({ warnings }: { warnings: ImportProblem[] }) {
  return (
    <div className={`${CARD} border-[var(--accent)]`}>
      <p className="text-sm font-medium">
        {warnings.length === 1 ? 'One thing' : `${warnings.length} things`} to tidy. The import
        will go ahead.
      </p>
      <ul className="mt-2 space-y-1.5 text-sm">
        {warnings.map((warning, at) => (
          <li key={`${warning.where}-${at}`}>
            <span className="font-mono text-xs text-[var(--muted)]">{warning.where}</span>
            <br />
            {warning.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Preview({ plan, declared }: { plan: ImportPlan; declared: ReactNode }) {
  const fresh = plan.drugs.filter((drug) => !drug.exists).length;
  const toDrug = plan.drugs.reduce((n, drug) => n + drug.writes.filter((w) => w.to === 'drug').length, 0);
  const toVariant = plan.drugs.reduce((n, drug) => n + drug.writes.filter((w) => w.to === 'variant').length, 0);
  const held = plan.drugs.reduce((n, drug) => n + drug.writes.filter((w) => w.to === 'held').length, 0);

  return (
    <div className="mt-6 space-y-4">
      <div className={CARD}>
        <p className="text-sm">
          <strong>{plan.drugs.length} drugs</strong> — {fresh} new, {plan.drugs.length - fresh}{' '}
          already here. {toDrug} value{toDrug === 1 ? '' : 's'} onto the drugs themselves,{' '}
          {toVariant}{' '}
          {plan.correcting ? 'overwriting what' : 'into'}{' '}
          {plan.variant?.label ?? 'no variant'}
          {plan.correcting ? ' says' : ''}.
          {held > 0 && (
            <>
              {' '}
              <span className="text-[var(--flagged)]">
                {held} left out: another lecture already said something else there.
              </span>
            </>
          )}
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Every value will read <em>from {plan.provenance}</em> on the profile.
        </p>
        <ul className="mt-2 flex flex-wrap gap-1">
          {plan.scope.map((scope) => (
            <li key={scope.slug} className="pill pill-xs pill-edge">
              {scope.kind}: {scope.label}
              {!scope.exists && <span className="text-[var(--accent)]">new</span>}
            </li>
          ))}
          {plan.declare.filter((field) => field.exists).map((field) => (
            <li key={field.key} className="pill pill-xs pill-edge">
              field: {field.label}
            </li>
          ))}
        </ul>
      </div>

      {plan.warnings.length > 0 && <Warnings warnings={plan.warnings} />}

      {declared}

      {plan.regimens.length > 0 && (
        <div className={CARD}>
          <p className="text-sm font-medium">{plan.regimens.length} regimens</p>
          <ul className="mt-1.5 space-y-1 text-sm text-[var(--muted)]">
            {plan.regimens.map((regimen) => (
              <li key={regimen.name}>
                <span className="text-[var(--fg)]">{regimen.name}</span> — {regimen.members.join(' + ')}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Written into the Regimens field of every drug in them, this drug’s own dose marked.
          </p>
        </div>
      )}

      <div className={CARD}>
        <ul className="divide-y divide-[var(--border)]">
          {plan.drugs.map((drug) => (
            <DrugRow
              key={drug.slug}
              drug={drug}
              variant={plan.variant?.label ?? null}
              correcting={plan.correcting}
            />
          ))}
        </ul>
      </div>

      {plan.issues.length > 0 && (
        <div className={CARD}>
          <p className="text-sm font-medium">What the author could not resolve</p>
          <ul className="mt-1.5 list-outside list-disc space-y-1 pl-5 text-sm text-[var(--muted)]">
            {plan.issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The fields this file is asking for, and where each one should go.
 *
 * **Declaring a field is a request, not a decision.** The file's author read a
 * slide deck; they have no way to know this database already has a field that
 * means what they are asking for, and three lectures left to themselves will
 * invent `adverse_effects`, `ae` and `toxicity` for one idea. So each request
 * gets a dropdown: create it, or send its values to a field that already
 * exists.
 *
 * It defaults to the suggestion where the names look alike, and to *create* in
 * every other case -- creating a duplicate is recoverable (merge the two fields
 * later), while silently folding a lecture's toxicity notes into somebody's
 * black box warning is not.
 *
 * Changing a dropdown and pressing **Check it** re-reads the file through the
 * new mapping, so the preview below always describes what would actually
 * happen.
 */
function Declared({
  asked,
  map,
  assignable,
}: {
  asked: AskedField[];
  map: Record<string, string>;
  assignable: ImportPlan['assignable'];
}) {
  if (asked.length === 0) return null;

  const byGroup = new Map<string, ImportPlan['assignable']>();
  for (const field of assignable) {
    const group = field.group ?? 'Other';
    byGroup.set(group, [...(byGroup.get(group) ?? []), field]);
  }

  return (
    <div className={CARD}>
      <p className="text-sm font-medium">
        {asked.length} field{asked.length === 1 ? '' : 's'} this file asks for
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Create it, or send it to a field you already have — so one idea does not end up as three
        fields with different names.
      </p>

      <ul className="mt-3 space-y-2">
        {asked.map((field) => (
          <li key={field.key} className="sm:flex sm:items-baseline sm:gap-3">
            <span className="text-sm sm:w-56 sm:shrink-0">
              {field.label}
              <span className="ml-1 font-mono text-xs text-[var(--muted)]">{field.key}</span>
            </span>
            {/* The choice already made, then the suggestion, then create. */}
            <select
              name="field_map"
              defaultValue={`${field.key}:${map[field.key] ?? field.suggest ?? ''}`}
              className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)]
                px-2 py-1 text-sm sm:mt-0"
            >
              <option value={`${field.key}:`}>
                Create it as a new field{field.suggest ? '' : ' — nothing here looks like it'}
              </option>
              {[...byGroup].map(([group, fields]) => (
                <optgroup key={group} label={group}>
                  {fields.map((existing) => (
                    <option key={existing.key} value={`${field.key}:${existing.key}`}>
                      Use {existing.label}
                      {existing.key === field.suggest ? ' — looks like the same thing' : ''}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-[var(--muted)]">
        Press <em>Check it</em> again after changing one of these.
      </p>
    </div>
  );
}

/**
 * Paste a file, see what it would do, then do it.
 *
 * One box, one choice and two buttons rather than a wizard: the file is
 * nearly the whole input, and the only question worth asking before writing is
 * *what would this change*. The preview answers it per field, with what each
 * value replaces, which is the same thing the bulk field set screen shows for
 * the same reason.
 *
 * The choice is what the file does to a drug the app already holds, and it
 * starts on *fill the gaps*: the safe one, and the one the format defaults to.
 * Changing it re-reads the same text, so flipping between *fill* and *alternate
 * profile* and pressing Check is how you see both outcomes before picking one.
 */
export function ImportForm({ action }: { action: (formData: FormData) => Promise<ImportState> }) {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(
    async (_previous, formData) => action(formData),
    { kind: 'idle' },
  );

  /**
   * The chosen mode, held in state only so the target select can appear with
   * *Correct the drug itself* and stay out of the way otherwise.
   *
   * Which version to overwrite is a question that only exists for a
   * correction: the other two modes write what a class says, and that class is
   * the file's own scope. Rendering it always would ask everyone a question
   * that means nothing in two cases out of three.
   */
  const [mode, setMode] = useState<WriteMode>('fill');

  /**
   * The scopes this file names, read off whatever the last Check came back
   * with. The file's own scope is the only honest set of options -- a layer for
   * a class these drugs are not tagged with is a layer no reader applies -- and
   * it is unknown until the file has been parsed, which is why the select
   * appears after the first Check rather than beside the box from the start.
   */
  const scopes = state.kind === 'plan' ? state.plan.scope : [];

  /**
   * What to correct, starting at *nobody has said*.
   *
   * Controlled rather than left to the select's own default so the Import
   * button can be turned off until it holds an answer. An overwrite aimed at
   * nothing in particular is the one mistake on this screen that destroys
   * somebody's wording, and it is the one a default would make quietly.
   */
  const [target, setTarget] = useState<string>(TARGET_UNDECIDED);

  /**
   * Whether the question is real yet, from what the last check came back with:
   * drugs the app already holds (so there is something to overwrite) and scopes
   * to choose between. Both are facts about a file that may have been edited
   * since, which is why this only turns the button off -- `applyDrugImport`
   * re-plans and refuses on its own.
   */
  const held = state.kind === 'plan' && state.plan.drugs.some((row) => row.exists);
  const undecided = mode === 'base' && target === TARGET_UNDECIDED && scopes.length > 0 && held;

  return (
    <form onSubmit={submitTo(formAction)} className="mt-6">
      <label htmlFor="file" className="text-sm font-medium">The file</label>
      <textarea
        id="file" name="file" rows={14} spellCheck={false}
        placeholder='{ "format": "enkephalin.drugs/1", … }'
        className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] p-3
          font-mono text-xs"
      />

      <fieldset className="mt-4">
        <legend className="text-sm font-medium">For a drug the app already has</legend>
        <div className="mt-1 space-y-1">
          {WRITE_MODES.map((option) => (
            <label key={option} className="flex gap-2 text-sm">
              <input
                type="radio" name="write" value={option} checked={mode === option}
                onChange={() => setMode(option)}
                className="mt-1"
              />
              <span>
                {WRITE_MODE_COPY[option].label}
                <span className="block text-xs text-[var(--muted)]">
                  {WRITE_MODE_COPY[option].detail}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          A drug the app has never held takes everything as its own either way — there is
          nothing to differ from, and a new drug whose mechanism lived only in a class layer
          would read as an empty profile.
        </p>

        {/* Which thing is wrong.

            *Correct the drug itself* used to have nothing to say about a drug
            with versions: it wrote over the drug, and a class's own wording
            went on outranking the correction wherever it had any -- so the
            profile looked fixed and studying that class still taught the old
            value. The fix you want is often the class's, not the drug's, and
            only the person looking knows which. */}
        {mode === 'base' && scopes.length > 0 && (
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <label htmlFor="target" className="block text-sm font-medium">What to correct</label>
            <select
              id="target" name="target" value={target}
              onChange={(event) => setTarget(event.target.value)}
              className="mt-1 h-9 w-full rounded border border-[var(--border)]
                bg-[var(--surface)] px-2 text-sm"
            >
              <option value={TARGET_UNDECIDED}>Pick what this is replacing&hellip;</option>
              <option value={TARGET_DRUG}>The drug&rsquo;s own profile</option>
              {scopes.map((scope) => (
                <option key={scope.slug} value={scope.slug}>
                  What {scope.label} says — its {scope.kind} version
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[var(--muted)]">
              A version here is overwritten and the drug is left alone, which is the correction to
              make when it is the class that got it wrong. The drug&rsquo;s class and schedule are
              never corrected this way — a class cannot differ about what a drug <em>is</em>.
            </p>
            {undecided && (
              <p className="mt-2 text-xs text-[var(--danger)]">
                These drugs are already in the app and they have versions, so there is more than
                one wording this could be replacing. <em>Import it</em> stays off until you say
                which. Until then the preview below shows the drug&rsquo;s own profile being
                overwritten — pick a version and check it again to see that one instead.
              </p>
            )}
          </div>
        )}
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" name="intent" value="plan" disabled={pending} className="btn btn-primary">
          {pending ? 'Reading…' : 'Check it'}
        </button>
        <button
          type="submit" name="intent" value="apply" disabled={pending || undecided}
          className="btn btn-quiet"
        >
          Import it
        </button>
        {undecided && (
          <span className="text-xs text-[var(--muted)]">Say what to correct first.</span>
        )}
        <Link href="/drugs" className="pill">Drugs</Link>
      </div>

      {state.kind === 'problems' && (
        <Problems problems={state.problems} note="Nothing was written." />
      )}

      {state.kind === 'plan' && (
        <>
          {state.plan.problems.length > 0
            ? <Problems problems={state.plan.problems} note="Nothing was written." />
            : (
              <Preview
                plan={state.plan}
                declared={(
                  <Declared
                    asked={state.asked}
                    map={state.map}
                    assignable={state.plan.assignable}
                  />
                )}
              />
            )}
        </>
      )}

      {state.kind === 'done' && (
        <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          <p className="font-medium">Imported.</p>
          <p className="mt-1 text-[var(--muted)]">
            {state.report.created.length} drugs created, {state.report.updated.length} updated.{' '}
            {state.report.toDrug} values onto the drugs, {state.report.toVariant} into the variant,{' '}
            {state.report.unchanged} already identical
            {state.report.held > 0
              ? `, ${state.report.held} left out where this version already said something else.`
              : '.'}
            {state.report.fieldsDeclared.length > 0 && (
              <> New fields: {state.report.fieldsDeclared.join(', ')}.</>
            )}
            {state.report.tagsCreated.length > 0 && (
              <> New tags: {state.report.tagsCreated.join(', ')}.</>
            )}
            {state.report.listsPointed > 0 && (
              <> {state.report.listsPointed} membership
                {state.report.listsPointed === 1 ? '' : 's'} now read this version.</>
            )}
          </p>
          {state.report.created.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {state.report.created.map((slug) => (
                <li key={slug}>
                  <Link href={`/drugs/${slug}`} className="pill pill-xs pill-edge">{slug}</Link>
                </li>
              ))}
            </ul>
          )}
          {/* The one place a problem does not mean the file stopped: these
              entries did not land and the rest of it did, which is what the
              numbers above are counting. */}
          {state.report.problems.length > 0 && (
            <Problems
              problems={state.report.problems}
              note={state.report.problems.length === 1
                ? 'That entry was not written. Everything else in the file was.'
                : 'Those entries were not written. Everything else in the file was.'}
            />
          )}
        </div>
      )}
    </form>
  );
}
