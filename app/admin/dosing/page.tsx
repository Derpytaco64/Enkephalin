import Link from 'next/link';
import type { Route } from 'next';
import {
  benchCounts, benchQueue, BENCH_KINDS, BENCH_LABELS, splitDrugs, type BenchKind,
} from '@/lib/dosing/bench';
import { markUniqueAction, saveDosingAction } from './actions';
import { BenchRowPanel } from './bench-row';

export const metadata = { title: 'Dosing review' };
export const dynamic = 'force-dynamic';

function isKind(value: unknown): value is BenchKind {
  return typeof value === 'string' && (BENCH_KINDS as string[]).includes(value);
}

/**
 * The dosing review bench.
 *
 * The one queue in this app with real work in it. 76 of 252 regimens carry a
 * reading the parser would not stand behind, across 72 drugs, and until this
 * screen existed no page listed them -- so the work was both known and
 * unreachable, which is the worst state for a to-do to be in.
 *
 * It is a queue, not a report: every row opens onto the two things that settle
 * it. Rewrite the prose, which re-reads it; or say the source really is like
 * that, which leaves the wording alone and takes it out of the queue. Both go
 * through the drug editor's own writers, so this cannot become a second way
 * for dosing to reach the database.
 *
 * Worst first, and "worst" is ordered by what it costs to leave: an
 * unrecognised indication is somebody's typo and takes seconds; a dosing with
 * no sig cannot be asked as multiple choice at all; a dosing that read with a
 * caveat may need nothing but a human saying so. Within each, the drugs
 * somebody has actually been asked about lead, which is the same rule the
 * flagged queue uses -- a bad reading that has already reached a person is
 * worth more than one that has not.
 */
export default async function DosingBenchPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind: raw } = await searchParams;
  const kind = isKind(raw) ? raw : undefined;

  const [counts, queue, split] = await Promise.all([
    benchCounts(),
    benchQueue(kind),
    splitDrugs(),
  ]);

  const done = counts.total - counts.regimens;
  const pill = 'rounded-full border px-3 py-1 text-sm';

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Dosing review</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Dosing is stored twice: the prose a profile shows, and the components a quiz compares
        answers against. These are the ones where the second reading came out incomplete. Nothing
        here is missing — every one of them is on its drug&rsquo;s profile and asked as free
        recall — but a dosing with no sig cannot be a multiple-choice answer.
      </p>

      {/* The number first, because the first question anyone has about a queue
          is how long it is. */}
      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <Figure
          figure={String(counts.regimens)}
          label="rows to look at"
          note={`of ${counts.total} · ${counts.drugs} drug${counts.drugs === 1 ? '' : 's'}`}
        />
        <Figure
          figure={String(done)}
          label="settled"
          note={counts.total === 0 ? 'nothing stored yet' : `${Math.round((done / counts.total) * 100)}% read cleanly or confirmed`}
        />
        <Figure
          figure={String(split.length)}
          label="split by indication"
          note={split.length === 0 ? 'none yet' : split.map((row) => row.generic).join(', ')}
        />
      </dl>

      <nav className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/admin/dosing"
          aria-current={kind === undefined ? 'page' : undefined}
          className={`${pill} ${kind === undefined
            ? 'border-[var(--fg)] bg-[var(--border)] font-medium text-[var(--fg)]'
            : 'border-[var(--border)]'}`}
        >
          Everything ({counts.byKind['unresolved-indication'] + counts.byKind['no-sig'] + counts.byKind['needs-look']})
        </Link>
        {BENCH_KINDS.map((each) => (
          <Link
            key={each}
            href={{ pathname: '/admin/dosing' as Route, query: { kind: each } }}
            aria-current={kind === each ? 'page' : undefined}
            className={`${pill} ${kind === each
              ? 'border-[var(--fg)] bg-[var(--border)] font-medium text-[var(--fg)]'
              : 'border-[var(--border)]'}`}
          >
            {BENCH_LABELS[each].title} ({counts.byKind[each]})
          </Link>
        ))}
      </nav>

      {kind !== undefined && (
        <p className="mt-3 text-sm text-[var(--muted)]">{BENCH_LABELS[kind].blurb}</p>
      )}

      {queue.length === 0 ? (
        <p className="mt-8 rounded border border-[var(--border)] p-4 text-sm text-[var(--muted)]">
          {kind === undefined
            ? 'Nothing to review. Every dosing in the database either reads cleanly or has been '
              + 'confirmed as being exactly what the source says.'
            : 'Nothing of that kind left.'}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-[var(--border)] border-y border-[var(--border)]">
          {queue.map((row) => (
            <BenchRowPanel
              key={row.slug}
              row={row}
              save={saveDosingAction}
              markUnique={markUniqueAction}
            />
          ))}
        </ul>
      )}

      <p className="mt-8 text-xs text-[var(--muted)]">
        {/* Worth saying once: somebody working this queue will wonder whether
            emptying it is the goal, and for a third of it the answer is no. */}
        Emptying this is not the goal. Seventeen of the drugs are dosed
        &ldquo;individualised&rdquo; or &ldquo;titrated to effect&rdquo;, which is the true answer
        and has no sig — those want <em>The source really is like that</em>, not a rewrite.
      </p>
    </main>
  );
}

function Figure({ figure, label, note }: { figure: string; label: string; note: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <dt className="sr-only">{label}</dt>
      <dd>
        <p className="text-2xl font-semibold tabular-nums">{figure}</p>
        <p className="mt-0.5 text-sm font-medium">{label}</p>
        <p className="mt-1 text-xs text-[var(--muted)]">{note}</p>
      </dd>
    </div>
  );
}
