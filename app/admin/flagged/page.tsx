import Link from 'next/link';
import { flaggedCounts, flaggedQueue } from '@/lib/admin/flagged';
import { sourceName } from '@/lib/fields/format';
import { ClearFlagButton } from './clear-flag-button';

export const metadata = { title: 'Flagged values' };
export const dynamic = 'force-dynamic';

/**
 * The flagged queue.
 *
 * The browse filter has offered *Flagged* since phase 7 and there was nowhere
 * to send anyone who used it. A flag means *somebody thinks this value is
 * wrong*, and a flagged value is **still studied** while it waits -- so a flag
 * with no queue behind it is a doubt recorded and then forgotten, which is
 * worse than not recording it.
 *
 * Worst first, by what it costs to leave: a value that has actually been asked
 * of somebody leads, because that is where a doubtful answer has already
 * reached a person. Same rule the dosing bench orders by.
 *
 * Two outcomes per row, and only one of them lives here. *Looks right* clears
 * the doubt and leaves the value alone, which is what most flags resolve to
 * and is one click. Actually correcting a value goes to the field's own editor,
 * because an enum picker, a list box and a markdown area with a preview are
 * what a value may need, and a second set of those on a queue screen would be
 * two editors disagreeing about what is allowed.
 */
export default async function FlaggedPage() {
  const [counts, queue] = await Promise.all([flaggedCounts(), flaggedQueue()]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <Link href="/admin" className="pill">← Admin</Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Flagged values</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Values somebody has marked as doubtful. Nothing here is hidden from study — a flag is a
        to-do, not a removal, so each of these is still being shown and still being asked while it
        sits in this list. That is why the ones that have actually reached somebody come first.
      </p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <Figure
          figure={String(counts.values)}
          label={counts.values === 1 ? 'value flagged' : 'values flagged'}
          note={counts.drugs === 0
            ? 'nothing doubted'
            : `across ${counts.drugs} drug${counts.drugs === 1 ? '' : 's'}`}
        />
        <Figure
          figure={String(counts.asked)}
          label="already asked"
          note={counts.asked === 0
            ? 'none has reached a quiz yet'
            : 'a doubtful answer somebody has seen'}
        />
        <Figure
          figure={String(counts.unquizzable)}
          label="profile only"
          note="on a field no quiz asks"
        />
      </dl>

      {queue.length === 0 ? (
        <div className="mt-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6">
          <p className="text-sm">Nothing is flagged.</p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Values get here from the drug editor, where any field can be marked{' '}
            <em>flagged</em> instead of <em>ok</em> — for when a value looks wrong and you do not
            have the right one yet. The browse list&rsquo;s <em>needs attention</em> filter shows
            the same thing per drug.
          </p>
        </div>
      ) : (
        <ol className="mt-10 space-y-3">
          {queue.map((row) => (
            <li
              key={`${row.drugId}:${row.fieldKey}`}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/drugs/${row.slug}`}
                  className="font-medium text-[var(--accent)] underline"
                >
                  {row.generic}
                </Link>
                <span className="pill pill-xs pill-edge">{row.fieldLabel}</span>
                {!row.quizzable && (
                  <span className="text-xs text-[var(--muted)]">not asked in quizzes</span>
                )}
                <span className="ml-auto text-xs text-[var(--muted)] tabular-nums">
                  {row.asked === 0
                    ? 'never asked'
                    : `asked ${row.asked}×${
                      row.lastAsked ? `, last ${row.lastAsked.toLocaleDateString()}` : ''}`}
                </span>
              </div>

              {/* The value itself, because the question "is this wrong?" cannot
                  be answered from a drug name and a field label. */}
              <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                {row.text || <span className="text-[var(--muted)]">(empty)</span>}
              </p>

              {row.source && (
                // The bare name here, because this line supplies its own
                // preposition: *Read off: from PHRM 532 content* reads as badly
                // as the doubled *from* did on the profile.
                <p className="mt-1 text-xs text-[var(--muted)]">Read off: {sourceName(row.source)}</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <ClearFlagButton slug={row.slug} fieldKey={row.fieldKey} />
                <Link href={`/drugs/${row.slug}/edit`} className="btn btn-quiet btn-sm">
                  Fix it
                </Link>
              </div>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}

function Figure({ figure, label, note }: { figure: string; label: string; note: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <dt className="text-sm text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{figure}</dd>
      <dd className="mt-1 text-xs text-[var(--muted)]">{note}</dd>
    </div>
  );
}
