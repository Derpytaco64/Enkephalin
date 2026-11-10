import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Prose } from '@/app/_components/prose';
import { emptyLabel, formatFieldValue } from '@/lib/fields/format';
import { groupFieldDefs, type FieldDef } from '@/lib/fields/registry';
import { getDrugProfile } from '@/lib/drugs/profile';
import { ALL_VARIANTS } from '@/lib/drugs/variant-kinds';
import { overriddenKeys } from '@/lib/drugs/variants';
import type { VariantOption } from '@/lib/drugs/variants';
import { colorFor, readableTextOn, scheduleBadge } from '@/lib/theme/palette';
import { getPreferences } from '@/lib/theme/preferences';
import { requireUser } from '@/lib/session';
import type { FieldValue } from '@/db/schema';
import { markFieldAction } from './actions';

/**
 * One card, used eight or nine times down the page.
 *
 * Stated once rather than repeated per section so the sections cannot drift
 * apart -- the whole gain here is that they read as one stack of the same
 * thing.
 */
const CARD = 'rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5';

/**
 * The fields this page already says in its own chrome, and so does not repeat
 * as rows.
 *
 * All three were the *Identity* group, which on every drug restated the
 * heading, the Brands section and the class badge directly underneath them --
 * a card whose every line the reader had already passed. Removing them empties
 * that group, and an empty group renders nothing rather than a heading with a
 * gap under it.
 *
 * Keyed by field rather than by group name, so a custom field somebody files
 * under Identity later still appears.
 */
const SHOWN_ABOVE = new Set(['generic', 'brand', 'drug_class']);

const STATUS_TOKENS = {
  ok: 'var(--verified)',
  flagged: 'var(--flagged)',
  none: 'var(--not-applicable)',
} as const;

const STATUS_LABELS = {
  ok: 'recorded',
  flagged: 'flagged — check this',
  none: 'none to record',
} as const;

/**
 * Colour is never the only signal: the marker carries its word too.
 *
 * `ok` shows nothing. Every value in the database is one to study, so marking
 * them all "recorded" would be noise on every row and would make the flag --
 * the one state worth seeing -- harder to spot, not easier.
 */
function StatusMarker({ status }: { status: FieldValue['status'] }) {
  if (status === 'ok') return null;

  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: STATUS_TOKENS[status] }}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * A section heading, with a hairline running out of it to the edge of the
 * card.
 *
 * The profile is eight or nine sections of label-and-value, and with nothing
 * but a small caps line between them they ran together into one list. The rule
 * is what makes each one a block; it is drawn from the heading rather than
 * above it so the words and the line are the same object.
 */
function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide
        text-[var(--muted)]"
    >
      {children}
      <span aria-hidden="true" className="h-px flex-1 bg-[var(--border)]" />
    </h2>
  );
}

function FieldBody({ def, value }: { def: FieldDef; value: FieldValue | undefined }) {
  const formatted = formatFieldValue(def, value);

  switch (formatted.kind) {
    case 'none':
    case 'missing':
      return <p className="text-[var(--muted)]">{emptyLabel(formatted.kind, def)}</p>;
    case 'list':
      // A marker outside the text rather than inside it, so a wrapped item
      // lines up under its own first word instead of under the bullet.
      return (
        <ul className="list-outside list-disc space-y-0.5 pl-5">
          {formatted.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      );
    case 'markdown':
      // The raw text rather than the formatter's paragraphs: a regimen arrives
      // as a nested decision and `Prose` is the one reader that keeps the
      // nesting. Everything else -- cards, search, bulk previews -- wants the
      // flat paragraphs, which is why the formatter still produces them.
      return <Prose text={value?.value ?? ''} />;
    case 'bool':
      return <p>{formatted.value ? 'Yes' : 'No'}</p>;
    case 'enum':
      return <p>{formatted.option}</p>;
    case 'number':
      return <p>{formatted.text}</p>;
    default:
      return <p>{formatted.text}</p>;
  }
}

/**
 * Every version of this profile side by side.
 *
 * The one screen that answers *how do these differ* rather than *what does
 * this one say*. Reading that off the dropdown means opening each version in
 * turn and holding the last one in your head, which is exactly the task a
 * table is for -- and after an import writes a class's wording across twenty
 * drugs, it is the only way to see the shape of what was written.
 *
 * **Only the fields somebody words differently get a row.** A table of
 * forty-odd fields where every column repeats the drug's own value is a wall
 * with the answer hidden in it; the count of untouched fields goes underneath
 * instead, so nothing is silently dropped.
 *
 * **Only versions with a stored layer get a column**, for the same reason --
 * and because an empty column implies a class disagreed when it simply has
 * not been written up.
 *
 * An absent key is *the drug's own*, which the cell says in words. It is a
 * different fact from a class recording that there is none, and the two would
 * otherwise both render as an empty cell -- see `overlayFields`, which is the
 * code that treats them differently.
 */
function VariantTable({
  fields,
  updatedAt,
  defs,
  variants,
  layers,
}: {
  fields: Record<string, FieldValue>;
  updatedAt: Date;
  defs: FieldDef[];
  variants: VariantOption[];
  layers: Map<string, Record<string, FieldValue>>;
}) {
  const columns = variants.filter((variant) => variant.n !== null);
  const spoken = new Set(
    columns.flatMap((column) => overriddenKeys(layers.get(column.slug) ?? {})),
  );

  const overridable = defs.filter((def) => !def.isCore);
  const rows = overridable.filter((def) => spoken.has(def.key));
  const untouched = overridable.length - rows.length;

  const head = 'border border-[var(--border)] px-3 py-2 text-left align-top text-xs '
    + 'font-medium uppercase tracking-wide text-[var(--muted)]';
  const cell = 'border border-[var(--border)] px-3 py-2 align-top';

  return (
    <section className={CARD}>
      <SectionHead>Every version side by side</SectionHead>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          {columns.length === 0
            ? 'No class or exam has recorded its own wording for this drug yet, so there is nothing to compare.'
            : 'Every version of this drug currently reads exactly like the drug’s own profile.'}
        </p>
      ) : (
        <>
          {/* A table is the one thing on the page allowed to scroll sideways:
              four versions will not fit a phone, and folding the columns into
              stacked blocks would undo the comparison the table exists for. */}
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-sm">
              <thead>
                <tr>
                  <th scope="col" className={head}>Field</th>
                  <th scope="col" className={head}>The drug’s own</th>
                  {columns.map((column) => (
                    <th key={column.slug} scope="col" className={head}>
                      <span className="font-mono">V-{column.n}</span> {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((def) => (
                  <tr key={def.key}>
                    <th scope="row" className={head}>{def.label}</th>
                    <td className={cell}>
                      <FieldBody def={def} value={fields[def.key]} />
                    </td>
                    {columns.map((column) => {
                      const own = layers.get(column.slug)?.[def.key];
                      return (
                        <td key={column.slug} className={cell}>
                          {own
                            ? <FieldBody def={def} value={own} />
                            : <span className="text-[var(--muted)]">Same as the drug’s</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {untouched > 0 && (
            <p className="mt-3 text-xs text-[var(--muted)]">
              {untouched} other field{untouched === 1 ? '' : 's'} read the same in every version, so
              {untouched === 1 ? ' it is' : ' they are'} left out. The drug’s own profile has all of them.
            </p>
          )}
        </>
      )}

      <p className="mt-1 text-xs text-[var(--muted)]">
        Last change to the drug itself: {updatedAt.toLocaleDateString()}.
      </p>
    </section>
  );
}

export default async function DrugProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ as?: string | string[] }>;
}) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);
  const session = await requireUser();

  // One version at a time on a profile. Reading a drug *through* two classes at
  // once is a question nobody asks -- you are revising for one of them. (A
  // study session is the opposite case and does stack them: see
  // `variantSlugsAmong`.)
  const asked = Array.isArray(search.as) ? search.as[0] : search.as;
  const profile = await getDrugProfile(slug, session.user.id, asked);
  if (!profile) notFound();

  const {
    drug, brands, indications, tags, defs, siblings, variants, variant, overridden, layers,
  } = profile;

  /**
   * The versions, and the classes that are not versions.
   *
   * `variants` is every class and exam this drug is tagged with, which is
   * membership, not wording. A version is one that has said something of its
   * own -- the same rule the browse count and the study pills use, where `n`
   * comes from.
   */
  const worded = variants.filter((option) => option.n !== null);
  const silent = variants.filter((option) => option.n === null);
  const isAdmin = session.user.role === 'admin';

  /**
   * The tags, grouped by **what reading each one gets you**.
   *
   * A tag is on the drug -- it has to be, because that is what makes a version
   * readable at all: every reader of a layer joins membership -- but which
   * wording a list means is per membership, and the card used to print all of
   * them in one row whatever was on screen. So importing a lecture scoped to a
   * class and its exam made the drug's own profile claim both of them, and
   * swapping to the class's version showed the same row again: nothing on the
   * page distinguished *this drug is on PHRM 532* from *what you are reading is
   * what PHRM 532 says*.
   *
   * Grouped rather than filtered, because both halves are worth knowing: the
   * drug really is on the top-200 list while you are reading the ID class's
   * words, and that membership reads as the drug's own. The group that matches
   * what is on screen is marked; the others link to the reading they give.
   */
  const comparing = layers !== null;
  const reading = variant?.slug ?? null;
  const labelOfVariant = new Map(variants.map((option) => [option.slug, option.label]));

  const byReading = new Map<string | null, typeof tags>();
  for (const tag of tags) {
    byReading.set(tag.reads, [...(byReading.get(tag.reads) ?? []), tag]);
  }

  const tagGroups = [...byReading.entries()]
    .map(([reads, inGroup]) => ({
      key: reads ?? '',
      tags: inGroup,
      current: !comparing && reads === reading,
      label: reads === null
        ? 'The drug’s own words'
        : `What ${labelOfVariant.get(reads) ?? reads} says`,
      href: reads === null
        ? (`/drugs/${drug.slug}` as const)
        : (`/drugs/${drug.slug}?as=${encodeURIComponent(reads)}` as const),
    }))
    // What is on screen first, so the question *does this apply to what I am
    // looking at* is answered by the top of the card.
    .sort((a, b) => Number(b.current) - Number(a.current) || a.label.localeCompare(b.label));

  const { colorAxis: axis, paletteOverrides } = await getPreferences(session.user.id);
  const color = colorFor(axis, { ...drug, tags: tags.map((tag) => tag.slug) }, paletteOverrides);

  // Core fields read from their own columns; the rest come out of the JSONB.
  const coreValues: Record<string, string | null> = {
    generic: drug.genericName,
    drug_class: drug.drugClass,
    controlled: drug.schedule,
    brand: brands.map((brand) => brand.name).join('\n'),
    indication: indications.join('\n'),
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href="/drugs" className="pill">← Drugs</Link>
        {isAdmin && (
          <Link href={`/drugs/${drug.slug}/edit`} className="pill pill-edge">
            Edit this drug
          </Link>
        )}
      </div>

      {/* The identity, in its own card.

          It was a bare row of text at the top of a long column of other rows
          of text, which gave the name of the drug no more weight than the
          heading of its eighth section. The card is what says *this is the
          thing, and everything below is about it*.

          The name, the class and the schedule, and nothing else. A "Sold as"
          line lived here briefly and came straight back out by the owner's
          call: the Brands section below is three inches away and says the same
          names with the detail attached, so repeating them here was two
          answers to one question with the shorter one first. */}
      <header className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">{drug.genericName}</h1>
          {/* Filled when the class is the axis, neutral otherwise: the colour
              on a page should mean one thing, and which thing is the reader's
              choice in Settings. */}
          {drug.drugClass && (
            <span
              className={axis === 'class' && color !== null
                ? 'rounded px-2 py-0.5 text-sm'
                : 'rounded border border-[var(--border)] px-2 py-0.5 text-sm text-[var(--muted)]'}
              style={axis === 'class' && color !== null
                ? { backgroundColor: color, color: readableTextOn(color) }
                : undefined}
            >
              {drug.drugClass}
            </span>
          )}
          {/* Always filled, on every axis: see scheduleBadge. */}
          {drug.schedule && (
            <span className="rounded px-2 py-0.5 text-sm"
              style={scheduleBadge(drug.schedule, paletteOverrides) ?? undefined}>
              {drug.schedule}
            </span>
          )}
          {axis === 'tag' && color !== null && (
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
          )}
          {drug.needsClassReview && (
            <span className="text-xs text-[var(--unverified)]">class needs review</span>
          )}
        </div>
      </header>

      {variant !== null && (
        <p className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm text-[var(--muted)]">
          Reading this drug as <span className="font-medium text-[var(--fg)]">{variant.label}</span>{' '}
          teaches it.{' '}
          {overridden.size === 0
            ? 'It has nothing of its own recorded yet, so every value below is the drug’s own.'
            : `${overridden.size} field${overridden.size === 1 ? '' : 's'} below ${
              overridden.size === 1 ? 'is' : 'are'} its own wording; the rest are the drug’s.`}
          {variant.note && <> {variant.note}</>}
        </p>
      )}

      {drug.needsPairingReview && (
        <p className="mt-4 rounded-xl border border-[var(--unverified)] bg-[var(--surface)] p-4 text-sm">
          This drug has competing brands across several indications, and which brand carries which
          has not been settled. Worth fixing in the editor — the cards are built either way.
        </p>
      )}

      {/* Tighter than it was, because the sections draw their own edges now:
          40px of air between two bordered cards is a gap, where between two
          unbordered lists it was the only thing separating them. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_15rem] lg:items-start">
        <div className="space-y-4">
          {brands.length > 0 && (
            <section className={CARD}>
              <SectionHead>Brands</SectionHead>
              <ul className="mt-3 divide-y divide-[var(--border)]">
                {brands.map((brand) => (
                  <li key={brand.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      {/* The name a box in a pharmacy says, set like one. */}
                      <span className="text-base font-semibold tracking-tight">{brand.name}</span>
                      {brand.route && <span className="text-sm text-[var(--muted)]">{brand.route}</span>}
                      <span className="text-sm text-[var(--muted)]">
                        {brand.indications.length > 0
                          ? `for ${brand.indications.join(', ')}`
                          : 'covers all indications'}
                      </span>
                    </div>
                    {brand.dosingOverride && (
                      <p className="mt-1 text-sm">{brand.dosingOverride}</p>
                    )}
                    {brand.defaultPairingSuspect && (
                      <p className="mt-1 text-xs text-[var(--unverified)]">
                        {brand.suspectReason ?? 'Covers-all default needs confirming.'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* The class, where the Identity group used to be.

              Dropping Identity took the only *labelled* statement of the class
              with it -- the badge in the header is a colour with a word in it,
              and on the `tag` or `none` axis it is not even that. So the class
              says itself here, with the drugs that share it: the two belong
              together, and "Same class" was a sidebar list of names with no
              heading saying what the class actually was. */}
          <section className={`${CARD}`}>
            <SectionHead>Drug class</SectionHead>
            <p className="mt-3 text-lg font-medium tracking-tight">
              {drug.drugClass ?? 'Uncategorized'}
            </p>
            {drug.drugClass === null && (
              <p className="mt-1 text-sm text-[var(--muted)]">
                Resolved from RxNorm, which has no FDA class for this one. It is still browsable and
                still quizzed; only the class axis is blank.
              </p>
            )}
            {siblings.length > 0 && (
              <>
                <p className="mt-4 text-xs text-[var(--muted)]">
                  {siblings.length} other{siblings.length === 1 ? '' : 's'} in it — where a quiz draws
                  its near-miss from, so compare them here.
                </p>
                {/* Chips rather than a row of blue underlines. A handful of
                    names side by side is a set of targets, and underlining
                    each one made the sentence above it read as a paragraph
                    with six links loose in it. */}
                <ul className="mt-2 flex flex-wrap gap-1">
                  {siblings.map((sibling) => (
                    <li key={sibling.slug}>
                      <Link href={`/drugs/${sibling.slug}`} className="pill pill-xs pill-edge">
                        {sibling.generic}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {layers ? (
            <VariantTable
              fields={drug.fields}
              updatedAt={drug.updatedAt}
              defs={defs.filter((def) => !SHOWN_ABOVE.has(def.key))}
              variants={variants}
              layers={layers}
            />
          ) : groupFieldDefs(defs.filter((def) => !SHOWN_ABOVE.has(def.key)))
            .filter(([, groupDefs]) => groupDefs.length > 0)
            .map(([group, groupDefs]) => (
            <section key={group} className={CARD}>
              <SectionHead>{group}</SectionHead>
              <dl className="mt-3 divide-y divide-[var(--border)]">
                {groupDefs.map((def) => {
                  const value: FieldValue | undefined = def.isCore
                    ? {
                        value: coreValues[def.key] ?? null,
                        status: 'ok',
                        source: 'class sheet',
                        updatedAt: drug.updatedAt.toISOString(),
                        updatedBy: null,
                      }
                    : drug.fields[def.key];

                  return (
                    <div key={def.key} className="py-3.5 first:pt-0 last:pb-0">
                      {/* The label is the quiet half. It used to be set in the
                          same weight and size as the value beside it, which on
                          a page that is nothing but labels and values left no
                          way to tell at a glance which was the answer. */}
                      <dt className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                          {def.label}
                        </span>
                        {value && !def.isCore && <StatusMarker status={value.status} />}
                        {/* Which layer this line came from, said where the
                            provenance already is. Without it a class's version
                            is indistinguishable from the drug's own, and the
                            whole point of opening it is to see what the class
                            says differently. */}
                        {overridden.has(def.key) && (
                          <span className="text-xs font-medium text-[var(--accent)]">
                            {variant?.label}
                          </span>
                        )}
                        {value?.source && (
                          <span className="text-xs text-[var(--muted)]">from {value.source}</span>
                        )}

                        {/* One button, because there is one judgement left to
                            record: this looks wrong. Everything else about a
                            value is edited, not stamped. */}
                        {isAdmin && !def.isCore && value && (
                          <form action={markFieldAction} className="ml-auto">
                            <input type="hidden" name="slug" value={drug.slug} />
                            <input type="hidden" name="key" value={def.key} />
                            <input
                              type="hidden" name="status"
                              value={value.status === 'flagged' ? 'ok' : 'flagged'}
                            />
                            <button type="submit" className="pill pill-xs">
                              {value.status === 'flagged' ? 'Clear flag' : 'Flag this'}
                            </button>
                          </form>
                        )}
                      </dt>
                      <dd className="mt-1.5 leading-relaxed">
                        <FieldBody def={def} value={value} />
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </div>

        {/* Sticky from `lg` up, where it is a column beside the fields rather
            than a block under them: the tags and the class-mates are what you
            reach for *while* reading a field, and scrolling back up for them
            loses your place. */}
        <aside className="space-y-4 lg:sticky lg:top-6">
          {/* Which version of this profile to read, in the column where the
              tags already live and in their format -- pills, because each one
              stands for a thing and goes to a place.

              It was a dropdown at the top of the page, which replaced a row of
              pills at the top of the page, and the objection that killed the
              pills was about the *top of the page*: a drug in two classes with
              three exams apiece put a second navigation bar above the profile.
              A column absorbs the same pills without that, and sitting beside
              the tags says what they are -- the tags are the classes this drug
              is in, and these are what those classes say.

              Links, not a control: every version is a URL, so this needs no
              JavaScript and `?as=` stays the whole of the memory. */}
          {(worded.length > 0 || (isAdmin && silent.length > 0)) && (
            <section className={CARD}>
              <SectionHead>Versions</SectionHead>
              <ul className="mt-3 flex flex-wrap gap-1">
                <li>
                  <Link
                    href={`/drugs/${drug.slug}`}
                    className={`pill pill-xs pill-soft ${
                      variant === null && !layers ? 'pill-on' : 'pill-edge'}`}
                  >
                    The drug&rsquo;s own
                  </Link>
                </li>
                {worded.map((option) => (
                  <li key={option.slug}>
                    <Link
                      href={`/drugs/${drug.slug}?as=${encodeURIComponent(option.slug)}`}
                      title={`${option.overrides} field${option.overrides === 1 ? '' : 's'} its own way`}
                      className={`pill pill-xs pill-soft ${
                        variant?.slug === option.slug ? 'pill-on' : 'pill-edge'}`}
                    >
                      {/* The number is the identifier a card showed you, so it
                          leads. A class with nothing of its own has none --
                          see PLAN, *V-n is the version*. */}
                      {option.n !== null && <span className="font-mono">V-{option.n}</span>}
                      {option.n !== null ? ' ' : ''}{option.label}
                    </Link>
                  </li>
                ))}
                {worded.length > 0 && (
                  <li>
                    <Link
                      href={`/drugs/${drug.slug}?as=${ALL_VARIANTS}`}
                      className={`pill pill-xs pill-soft ${layers ? 'pill-on' : 'pill-edge'}`}
                    >
                      Compare all
                    </Link>
                  </li>
                )}
              </ul>
              {worded.length > 0 && (
                <p className="mt-2 text-xs text-[var(--muted)]">
                  A class or exam is read in <em>its own words</em> where it has them, and the
                  drug&rsquo;s everywhere else.
                </p>
              )}
              {isAdmin && variant !== null && (
                <Link
                  href={`/drugs/${drug.slug}/variant/${encodeURIComponent(variant.slug)}`}
                  className="pill pill-xs pill-edge mt-2"
                >
                  Edit what {variant.label} says
                </Link>
              )}

              {/* The classes this drug is in that have said nothing of their
                  own, offered to admins only and as *write one*, not as a
                  version to read.

                  They used to sit in the row above as ordinary version pills,
                  which is what made two tags look like two copies of the drug:
                  importing a lecture scoped to a class and an exam tagged
                  ipilimumab twice, and the profile answered with two versions
                  where the lecture had worded nothing differently at all. A
                  class with nothing of its own is not another version -- which
                  is the rule `numberedVariantsByDrug` has always applied to the
                  browse count and the study pills, written down in
                  `lib/drugs/browse.ts`, and this card was the one place
                  disagreeing with it. */}
              {isAdmin && silent.length > 0 && (
                <div className={worded.length > 0 ? 'mt-3 border-t border-[var(--border)] pt-3' : ''}>
                  <p className="text-xs text-[var(--muted)]">
                    {worded.length > 0 ? 'Nothing of their own yet' : 'No class words this drug differently'}
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {silent.map((option) => (
                      <li key={option.slug}>
                        <Link
                          href={`/drugs/${drug.slug}/variant/${encodeURIComponent(option.slug)}`}
                          title={`Write what ${option.label} says about ${drug.genericName}`}
                          className="pill pill-xs pill-edge"
                        >
                          {option.label} +
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {tags.length > 0 && (
            <section className={CARD}>
              <SectionHead>Tags</SectionHead>
              {/* A tag is the clearest chip in the app: it stands for a
                  thing, not a place, and it was a stack of blue underlines.
                  Each still links to the list it stands for; what the heading
                  above it says is which wording that list reads this drug as. */}
              {tagGroups.map((group, at) => (
                <div
                  key={group.key}
                  className={at > 0 ? 'mt-3 border-t border-[var(--border)] pt-3' : 'mt-3'}
                >
                  <p className="text-xs text-[var(--muted)]">
                    {group.current ? (
                      <>
                        <span className="text-[var(--fg)]">{group.label}</span>
                        {' '}&mdash; what is on screen
                      </>
                    ) : (
                      <Link href={group.href} className="underline">
                        {group.label}
                      </Link>
                    )}
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {group.tags.map((tag) => (
                      <li key={tag.slug}>
                        <Link
                          href={`/drugs?tag=${tag.slug}`}
                          title={group.current
                            ? `${tag.label} reads this drug the way it is on screen`
                            : `${tag.label} reads this drug as ${group.label.toLowerCase()}`}
                          className={`pill pill-xs ${group.current ? 'pill-on' : 'pill-edge'}`}
                        >
                          {tag.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {comparing && (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  Every version at once, so no one of these is what is on screen.
                </p>
              )}
            </section>
          )}

        </aside>
      </div>
    </main>
  );
}
