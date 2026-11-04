import Link from 'next/link';
import { notFound } from 'next/navigation';
import { emptyLabel, formatFieldValue } from '@/lib/fields/format';
import { groupFieldDefs, type FieldDef } from '@/lib/fields/registry';
import { getDrugProfile } from '@/lib/drugs/profile';
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
      return (
        <div className="space-y-2 leading-relaxed">
          {formatted.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
      );
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

export default async function DrugProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await requireUser();
  const profile = await getDrugProfile(slug, session.user.id);
  if (!profile) notFound();

  const { drug, brands, indications, tags, defs, siblings } = profile;
  const isAdmin = session.user.role === 'admin';

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
        <Link href="/drugs" className="text-sm text-[var(--accent)] underline">← Drugs</Link>
        {isAdmin && (
          <Link href={`/drugs/${drug.slug}/edit`} className="text-sm text-[var(--accent)] underline">
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
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {siblings.map((sibling) => (
                    <li key={sibling.slug}>
                      <Link href={`/drugs/${sibling.slug}`} className="text-[var(--accent)] underline">
                        {sibling.generic}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>

          {groupFieldDefs(defs.filter((def) => !SHOWN_ABOVE.has(def.key)))
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
                            <button type="submit" className="text-xs text-[var(--accent)] underline">
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
          {tags.length > 0 && (
            <section className={CARD}>
              <SectionHead>Tags</SectionHead>
              <ul className="mt-3 space-y-1 text-sm">
                {tags.map((tag) => (
                  <li key={tag.slug}>
                    <Link href={`/drugs?tag=${tag.slug}`} className="text-[var(--accent)] underline">
                      {tag.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

        </aside>
      </div>
    </main>
  );
}
