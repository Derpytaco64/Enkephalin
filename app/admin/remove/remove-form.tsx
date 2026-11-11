'use client';

import { useActionState, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { submitTo } from '@/app/_components/submit';
import { matchesTags, TAG_KIND_GROUPS } from '@/lib/tags/constants';
import type { RemoveState } from './actions';

/** A tag, as a pill on a row. */
export type RowTag = { slug: string; label: string };

export type RemovableDrug = {
  slug: string;
  generic: string;
  /**
   * The drug's **own** memberships: the ones no version has claimed.
   *
   * `curated` is the ones that outlive a lecture -- a list, a year -- which is
   * what makes a drug an import merely touched look different from a drug an
   * import created. See `page.tsx`, which decides this.
   */
  tags: (RowTag & { curated: boolean })[];
  variants: {
    slug: string;
    label: string;
    fields: number;
    /** Memberships that go off the drug with this version. */
    takes: RowTag[];
    /** Memberships that stay and only stop reading it. */
    keeps: RowTag[];
  }[];
};

export type FacetTag = { slug: string; label: string; kind: string; count: number };

const CARD = 'rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4';
const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

const contains = (haystack: string, needle: string) =>
  haystack.toLowerCase().includes(needle.trim().toLowerCase());

const layerKey = (drugSlug: string, variantSlug: string) => `${drugSlug}:${variantSlug}`;
const drugOf = (key: string) => key.slice(0, key.indexOf(':'));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Tick what should go, type DELETE, press the button.
 *
 * The ticks are plain checkboxes sharing one name, so the whole selection
 * travels as `drug=a&drug=b` -- the same device the study scope pickers use.
 * What is held in state is the filtering, and **Tick every drug shown** is the
 * control this screen exists for: undoing a bad import means filtering to the
 * tag it created and taking all of them, and doing that by hand twenty-four
 * times is how the twenty-fifth gets missed.
 *
 * A drug and its versions are separate ticks on purpose. A lecture that wrote
 * its wording over the wrong class leaves drugs that should stay and layers
 * that should not, and a screen that could only delete whole drugs would make
 * the only fix for that worse than the problem.
 *
 * **Three things here exist because this screen deleted a drug nobody meant to
 * delete.** Prednisone was on Top Drugs 2026 and a heme/onc lecture had worded
 * it; the version was ticked, the drug was ticked too, and the drug went.
 *
 * 1. *A tick the filter hides still travels.* Checkboxes are DOM fields, so
 *    `new FormData` collects only the rows on screen -- while the count beside
 *    the button counted every tick. The count was right and the deletion was a
 *    subset of it, which is the worst possible pairing: a tick made under one
 *    filter sat invisible and went out with a later press. Hidden ticks are
 *    rendered as hidden inputs, and the panel says how many there are.
 * 2. *The summary names what is about to go.* Counts cannot be checked by
 *    eye. "1 drug" reads as the one you were thinking about; *Prednisone --
 *    off Top Drugs 2026* does not.
 * 3. *The ticks are cleared when the form is sent.* They used to survive it,
 *    so the next press carried whatever the last one had left behind.
 */
export function RemoveForm({
  rows,
  facetTags,
  action,
}: {
  rows: RemovableDrug[];
  facetTags: FacetTag[];
  action: (formData: FormData) => Promise<RemoveState>;
}) {
  const [state, formAction, pending] = useActionState<RemoveState, FormData>(
    async (_previous, formData) => action(formData),
    { kind: 'idle' },
  );

  const [query, setQuery] = useState('');
  /**
   * The tags filtered on, several at a time and `all` of them by default.
   *
   * A class is a tag like any other here, which is the point: an import tags
   * what it touches with a course *and* an exam, so *PHRM 535 and Heme/Onc Exam
   * 3* is the exact slice a bad one left behind, and a single-select could only
   * ever show one half of it. Same control and same default as the drug list's
   * tag filter -- `matchesTags` is the shared rule -- because this screen asks
   * the same question of the same data, and narrowing rather than collecting
   * matters more here than anywhere else: this list is what gets deleted.
   */
  const [tagPicks, setTagPicks] = useState<string[]>([]);
  const [tagsAny, setTagsAny] = useState(false);
  const [onlyVersions, setOnlyVersions] = useState(false);
  const [drugPicks, setDrugPicks] = useState<string[]>([]);
  const [layerPicks, setLayerPicks] = useState<string[]>([]);

  /**
   * What the last press took, so the list stops offering it.
   *
   * Read off the report rather than refetched: a server component's list is
   * fixed for the life of the render, and a row for a drug that is already gone
   * is a row somebody re-ticks.
   */
  const gone = useMemo(() => ({
    drugs: new Set(state.kind === 'done' ? state.report.drugs : []),
    layers: new Set(state.kind === 'done' ? state.report.layers : []),
  }), [state]);

  const live = useMemo(() => rows
    .filter((row) => !gone.drugs.has(row.slug))
    .map((row) => ({
      ...row,
      variants: row.variants.filter((variant) => !gone.layers.has(layerKey(row.slug, variant.slug))),
    })), [rows, gone]);

  const shown = useMemo(() => live.filter((row) => {
    const held = [
      ...row.tags.map((entry) => entry.slug),
      // A version's tags are the drug's memberships too -- they are only drawn
      // on the version's line -- so filtering by the class an import created
      // has to find the drug it worded as well as the drugs it made.
      ...row.variants.flatMap((variant) => [...variant.takes, ...variant.keeps]
        .map((entry) => entry.slug)),
    ];
    if (!matchesTags(held, tagPicks, tagsAny ? 'any' : 'all')) return false;
    if (onlyVersions && row.variants.length === 0) return false;
    if (query.trim() && !contains(row.generic, query) && !contains(row.slug, query)) return false;
    return true;
  }), [live, query, tagPicks, tagsAny, onlyVersions]);

  const tagLabels = useMemo(
    () => new Map(facetTags.map((entry) => [entry.slug, entry.label])),
    [facetTags],
  );
  const bySlug = useMemo(() => new Map(rows.map((row) => [row.slug, row])), [rows]);

  const addTag = (slug: string) =>
    setTagPicks((picks) => (picks.includes(slug) ? picks : [...picks, slug]));

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  const tickAllShown = () =>
    setDrugPicks([...new Set([...drugPicks, ...shown.map((row) => row.slug)])]);

  const tickAllVersionsShown = () =>
    setLayerPicks([...new Set([
      ...layerPicks,
      ...shown.flatMap((row) => row.variants.map((variant) => layerKey(row.slug, variant.slug))),
    ])]);

  // Ticks on rows the last press removed are dropped rather than re-sent.
  const drugTicks = drugPicks.filter((slug) => !gone.drugs.has(slug));
  const layerTicks = layerPicks.filter(
    (key) => !gone.layers.has(key) && !gone.drugs.has(drugOf(key)),
  );

  const picked = drugTicks.length + layerTicks.length;
  // Counted over every tick rather than only the shown ones: a filter changing
  // is not a reason for a tick to be forgotten, and a count that moved when you
  // typed would be the one number here nobody could trust. What makes that safe
  // is that a hidden tick is still submitted -- see the hidden inputs below.
  const goingAnyway = layerTicks.filter((key) => drugTicks.includes(drugOf(key)));
  const layersGoing = layerTicks.filter((key) => !drugTicks.includes(drugOf(key)));

  const onScreen = new Set(shown.map((row) => row.slug));
  const hiddenDrugs = drugTicks.filter((slug) => !onScreen.has(slug));
  const hiddenLayers = layerTicks.filter((key) => !onScreen.has(drugOf(key)));

  const curatedGoing = drugTicks
    .map((slug) => ({ slug, lists: (bySlug.get(slug)?.tags ?? []).filter((tag) => tag.curated) }))
    .filter((entry) => entry.lists.length > 0);

  const nameOf = (slug: string) => bySlug.get(slug)?.generic ?? slug;
  const labelOf = (key: string) => {
    const row = bySlug.get(drugOf(key));
    const variant = row?.variants.find((entry) => layerKey(row.slug, entry.slug) === key);
    return `${row?.generic ?? drugOf(key)} — ${variant?.label ?? key.slice(key.indexOf(':') + 1)}`;
  };

  /**
   * Sent, then forgotten.
   *
   * `submitTo` builds the `FormData` synchronously before it dispatches, so
   * emptying the ticks here cannot race the submission -- and leaving them
   * behind is how a tick from one press went out with the next.
   */
  const send = submitTo(formAction);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    send(event);
    setDrugPicks([]);
    setLayerPicks([]);
  };

  return (
    <form onSubmit={onSubmit} className="mt-6">
      <div className={CARD}>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="q" className="block text-sm font-medium">Find</label>
            <input
              id="q" value={query} onChange={(event) => setQuery(event.target.value)}
              placeholder="name" className={control} autoComplete="off"
            />
          </div>
          <div>
            <label htmlFor="tag" className="block text-sm font-medium">Tags</label>
            {/* Add-and-pill, the same device the drug list uses: the picked few
                on screen, the rest behind the select, and the select empties
                itself after each pick so it reads as *add*. Grouped by kind,
                because a drug list and a class are two different questions --
                and because a course tag sitting in a box labelled *on a list*
                told the person undoing an import that what they were looking
                for was not here. */}
            <select
              id="tag" value="" className={control}
              onChange={(event) => { if (event.target.value) addTag(event.target.value); }}
            >
              <option value="">{tagPicks.length > 0 ? 'Add another…' : 'Any'}</option>
              {TAG_KIND_GROUPS.map(({ kind, label }) => {
                const group = facetTags.filter(
                  (entry) => entry.kind === kind && !tagPicks.includes(entry.slug),
                );
                if (group.length === 0) return null;
                return (
                  <optgroup key={kind} label={label}>
                    {group.map((entry) => (
                      <option key={entry.slug} value={entry.slug}>
                        {entry.label} ({entry.count})
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>

            {tagPicks.length > 0 && (
              <ul className="mt-2 flex flex-wrap items-center gap-1">
                {tagPicks.map((slug, at) => (
                  <li key={slug} className="flex items-center gap-1">
                    {/* The operator where it applies, so the filter reads as
                        "PHRM 535 and Heme/Onc Exam 3". */}
                    {at > 0 && (
                      <button
                        type="button"
                        onClick={() => setTagsAny(!tagsAny)}
                        title={tagsAny
                          ? 'On any of these tags. Press for drugs on all of them.'
                          : 'On all of these tags. Press for drugs on any of them.'}
                        className="pill pill-xs pill-soft pill-edge font-mono"
                      >
                        {tagsAny ? 'or' : 'and'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setTagPicks(tagPicks.filter((other) => other !== slug))}
                      title={'Stop filtering by ' + (tagLabels.get(slug) || slug)}
                      className="pill pill-xs pill-on"
                    >
                      {tagLabels.get(slug) ?? slug}
                      <span aria-hidden className="text-[var(--muted)]">&times;</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox" checked={onlyVersions}
                onChange={() => setOnlyVersions(!onlyVersions)}
              />
              Only drugs with a version
            </label>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          <span className="text-xs text-[var(--muted)]">
            {shown.length} of {live.length} shown · {picked} ticked
          </span>
          <button type="button" onClick={tickAllShown} className="pill pill-xs pill-edge">
            Tick the {plural(shown.length, 'drug')} shown
          </button>
          <button type="button" onClick={tickAllVersionsShown} className="pill pill-xs pill-edge">
            Tick the{' '}
            {plural(shown.reduce((sum, row) => sum + row.variants.length, 0), 'version')} shown
          </button>
          {picked > 0 && (
            <button
              type="button"
              onClick={() => { setDrugPicks([]); setLayerPicks([]); }}
              className="pill pill-xs pill-edge"
            >
              Clear ticks
            </button>
          )}
        </div>

        {/* Ticked, off screen, and still going out. Said here because the
            alternative -- a count that includes rows you cannot see -- is what
            made a stale tick invisible in the first place. */}
        {hiddenDrugs.length + hiddenLayers.length > 0 && (
          <p className="mt-2 text-xs text-[var(--danger)]">
            {plural(hiddenDrugs.length + hiddenLayers.length, 'tick')} the filter is hiding{' '}
            {hiddenDrugs.length + hiddenLayers.length === 1 ? 'is' : 'are'} still part of this
            deletion. They are named below.{' '}
            <button
              type="button"
              onClick={() => { setQuery(''); setTagPicks([]); setOnlyVersions(false); }}
              className="underline"
            >
              Show everything
            </button>
          </p>
        )}
      </div>

      <ul className={`${CARD} mt-4 divide-y divide-[var(--border)]`}>
        {shown.map((row) => {
          const withDrug = drugTicks.includes(row.slug);
          return (
            <li key={row.slug} className="py-2 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox" name="drug" value={row.slug}
                    checked={withDrug}
                    onChange={() => setDrugPicks(toggle(drugTicks, row.slug))}
                  />
                  <span className={withDrug ? 'font-medium line-through' : 'font-medium'}>
                    {row.generic}
                  </span>
                </label>
                <Link href={`/drugs/${row.slug}`} className="text-xs text-[var(--muted)] underline">
                  look
                </Link>
                {/* The drug's own tags, and only those: a tag a version brought
                    is drawn on that version's line instead. Each adds itself to
                    the filter, because that is the motion this screen is for:
                    you find one drug an import should not have touched, and
                    what you want next is every other drug it tagged the same
                    way. */}
                {row.tags.map((entry) => (
                  <button
                    key={entry.slug} type="button" onClick={() => addTag(entry.slug)}
                    title={entry.curated
                      ? `${entry.label} is a list, not a lecture's scope. Deleting the drug takes it off it.`
                      : 'Show everything tagged ' + entry.label}
                    className={[
                      'pill pill-xs',
                      tagPicks.includes(entry.slug) ? 'pill-on' : 'pill-edge',
                      entry.curated && withDrug ? 'pill-danger' : '',
                    ].join(' ')}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>

              {row.variants.length > 0 && (
                <ul className="mt-1 ml-6 space-y-0.5">
                  {row.variants.map((variant) => {
                    const key = layerKey(row.slug, variant.slug);
                    const ticked = layerTicks.includes(key);
                    return (
                      <li key={key} className="flex flex-wrap items-baseline gap-x-2">
                        <label className="flex items-center gap-2 text-xs">
                          <input
                            type="checkbox" name="layer" value={key}
                            checked={ticked}
                            onChange={() => setLayerPicks(toggle(layerTicks, key))}
                          />
                          <span className={ticked || withDrug ? 'line-through' : ''}>
                            what {variant.label} says
                          </span>
                          <span className="text-[var(--muted)]">
                            {plural(variant.fields, 'field')}
                          </span>
                        </label>
                        {/* Which tag belongs to which version, which is the
                            question a row of pills above the versions could not
                            answer. `variantScope` decides these two lists and
                            `clearVariantLayer` acts on the same rule. */}
                        {variant.takes.map((entry) => (
                          <button
                            key={entry.slug} type="button" onClick={() => addTag(entry.slug)}
                            title={`${entry.label} came with this version and goes off the drug with it.`}
                            className={[
                              'pill pill-xs',
                              tagPicks.includes(entry.slug) ? 'pill-on' : 'pill-edge',
                              ticked || withDrug ? 'pill-danger' : '',
                            ].join(' ')}
                          >
                            {entry.label}
                          </button>
                        ))}
                        {variant.keeps.length > 0 && (
                          <span className="text-xs text-[var(--muted)]">
                            read by {variant.keeps.map((entry) => entry.label).join(', ')}, which
                            {variant.keeps.length === 1 ? ' stays' : ' stay'}
                          </span>
                        )}
                        {withDrug && (
                          <span className="text-xs text-[var(--danger)]">
                            goes with the drug
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="text-sm text-[var(--muted)]">Nothing matches that.</li>
        )}

      </ul>

      {/* A tick is a tick whether or not the filter is showing its row. The
          checkboxes above are DOM fields, so a hidden row contributes nothing
          to `new FormData`; these put it back, and the panel above says how
          many there are. Outside the list, because a `ul` takes only `li`. */}
      {hiddenDrugs.map((slug) => (
        <input key={`hidden-drug-${slug}`} type="hidden" name="drug" value={slug} />
      ))}
      {hiddenLayers.map((key) => (
        <input key={`hidden-layer-${key}`} type="hidden" name="layer" value={key} />
      ))}

      <div className={`${CARD} mt-4`}>
        {picked === 0 ? <p className="text-sm">Tick a drug or a version above.</p> : (
          <div className="space-y-2 text-sm">
            {/* Named, not counted. A count is a number you cannot check; a
                name is the one thing that would have shown that the drug
                under the ticked version was ticked as well. */}
            {drugTicks.length > 0 && (
              <div>
                <p>
                  <strong>{plural(drugTicks.length, 'drug')}</strong> will be deleted whole, with
                  every version, list membership, card and answer on them:
                </p>
                <ul className="mt-1 flex flex-wrap gap-1">
                  {drugTicks.map((slug) => {
                    const lists = (bySlug.get(slug)?.tags ?? []).filter((tag) => tag.curated);
                    return (
                      <li
                        key={slug}
                        className={lists.length > 0
                          ? 'pill pill-xs pill-edge pill-danger'
                          : 'pill pill-xs pill-edge'}
                        title={lists.length > 0
                          ? `On ${lists.map((tag) => tag.label).join(', ')} — deleting it takes it off ${lists.length === 1 ? 'that' : 'those'} too.`
                          : undefined}
                      >
                        {nameOf(slug)}
                        {lists.length > 0 && ` — off ${lists.map((tag) => tag.label).join(', ')}`}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* The mistake this screen made once, said plainly. A ticked
                version whose drug is also ticked is not a version being
                deleted -- it is a drug being deleted. */}
            {goingAnyway.length > 0 && (
              <p className="text-[var(--danger)]">
                {plural(goingAnyway.length, 'ticked version')} belongs to a drug that is ticked
                too, so the whole drug goes, not just the version:{' '}
                {goingAnyway.map((key) => nameOf(drugOf(key))).join(', ')}. Untick the drug if
                you meant only its version.
              </p>
            )}

            {layersGoing.length > 0 && (
              <div>
                <p>
                  <strong>{plural(layersGoing.length, 'version')}</strong> will be deleted, the
                  drug kept. A version takes the class and exam tags that came with it; lists
                  stay.
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-[var(--muted)]">
                  {layersGoing.map((key) => {
                    const row = bySlug.get(drugOf(key));
                    const variant = row?.variants.find(
                      (entry) => layerKey(row.slug, entry.slug) === key,
                    );
                    return (
                      <li key={key}>
                        {labelOf(key)}
                        {variant && variant.takes.length > 0
                          && ` — off ${variant.takes.map((entry) => entry.label).join(', ')}`}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {curatedGoing.length > 0 && (
              <p className="text-[var(--danger)]">
                {curatedGoing.length === 1
                  ? `${nameOf(curatedGoing[0].slug)} is on `
                  : `${curatedGoing.length} of the ticked drugs are on `}
                {[...new Set(curatedGoing.flatMap(
                  (entry) => entry.lists.map((tag) => tag.label),
                ))].join(', ')}, which no lecture put {curatedGoing.length === 1 ? 'it' : 'them'}{' '}
                on. Deleting {curatedGoing.length === 1 ? 'it takes it' : 'them takes them'} off
                that too &mdash; a drug an import only touched was here before it.
              </p>
            )}
          </div>
        )}
        <div className="mt-3 sm:flex sm:items-end sm:gap-3">
          <div className="sm:w-48">
            <label htmlFor="confirm" className="block text-sm font-medium">Type DELETE</label>
            <input
              id="confirm" name="confirm" autoComplete="off" placeholder="DELETE"
              className={control}
            />
          </div>
          <button
            type="submit" disabled={pending || picked === 0}
            className="btn btn-quiet mt-2 text-[var(--danger)] sm:mt-0"
          >
            {pending ? 'Deleting…' : 'Delete what is ticked'}
          </button>
        </div>
      </div>

      {state.kind === 'error' && (
        <p className="mt-4 rounded-lg border border-[var(--danger)] bg-[var(--surface)] p-4 text-sm">
          {state.message}
        </p>
      )}

      {state.kind === 'done' && (
        <div className={`${CARD} mt-4 text-sm`}>
          <p className="font-medium">
            {plural(state.report.drugs.length, 'drug')} and{' '}
            {plural(state.report.layers.length, 'version')} deleted.
          </p>
          {state.report.withTheDrug > 0 && (
            <p className="mt-1 text-[var(--muted)]">
              {plural(state.report.withTheDrug, 'ticked version')} went with{' '}
              {state.report.withTheDrug === 1 ? 'its' : 'their'} drug.
            </p>
          )}
          {/* A deletion nobody ticked, so it is said out loud and the
              memberships are named -- see `RemoveReport.untagged`. */}
          {state.report.untagged.length > 0 && (
            <>
              <p className="mt-1 text-[var(--muted)]">
                {plural(state.report.untagged.length, 'class or exam tag')} went with{' '}
                {state.report.layers.length === 1 ? 'it' : 'them'}. Lists are untouched.
              </p>
              <p className="mt-1 font-mono text-xs text-[var(--muted)]">
                {state.report.untagged.join(', ')}
              </p>
            </>
          )}
          {state.report.drugs.length > 0 && (
            <p className="mt-1 font-mono text-xs text-[var(--muted)]">
              {state.report.drugs.join(', ')}
            </p>
          )}
          {state.report.problems.length > 0 && (
            <ul className="mt-2 space-y-1 text-[var(--danger)]">
              {state.report.problems.map((problem) => <li key={problem}>{problem}</li>)}
            </ul>
          )}
          <p className="mt-2 text-xs text-[var(--muted)]">
            What went is off the list and the ticks are clear. Reload for the counts beside each
            tag.
          </p>
        </div>
      )}
    </form>
  );
}
