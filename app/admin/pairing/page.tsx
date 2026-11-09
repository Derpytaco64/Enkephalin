import Link from 'next/link';
import { pairingCounts, pairingDrugs } from '@/lib/admin/pairing';
import { PairingGrid } from './pairing-grid';

export const metadata = { title: 'Brand pairing' };
export const dynamic = 'force-dynamic';

/**
 * The brand-to-indication pairing editor.
 *
 * `brand_indications` had no writer outside the importer and the merge path, so
 * a pairing was unchangeable once asserted -- and seven of them were asserted
 * by `scripts/fill-review-gaps.ts` from FDA labelling rather than read off the
 * sheet. An assertion nobody can correct is the wrong kind of fact to have in a
 * study aid, and these rows are the ones *Direction decides what counts as
 * correct* turns brand questions on: get Zyban wrong here and the app teaches
 * that Wellbutrin is for smoking cessation.
 *
 * Six drugs, because pairing is only a question where a drug has more than one
 * brand *and* more than one indication. The screen says which six rather than
 * listing 236 and letting somebody find out.
 */
export default async function PairingPage() {
  const [counts, queue] = await Promise.all([pairingCounts(), pairingDrugs()]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <Link href="/admin" className="pill">← Admin</Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Brand pairing</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Which of a drug&rsquo;s brands is for which of its conditions. Only drugs with more than
        one brand and more than one condition appear — everywhere else there is nothing to pair.
        A brand with nothing ticked <strong>covers all of them</strong>, which is the normal case:
        Proventil, Ventolin and Proair are all albuterol for all three of its indications.
      </p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <Figure
          figure={String(counts.pairable)}
          label="drugs to pair"
          note="more than one brand and one condition"
        />
        <Figure
          figure={String(counts.needsReview)}
          label="flagged by the importer"
          note={counts.needsReview === 0 ? 'the sheet was clear enough' : 'the sheet could not say'}
        />
        <Figure
          figure={String(counts.unnarrowed)}
          label="not narrowed"
          note="every brand covers everything"
        />
      </dl>

      {queue.length === 0 ? (
        <p className="mt-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6
          text-sm text-[var(--muted)]">
          No drug has both several brands and several conditions, so there is nothing to pair.
          This fills up as brands are added in the drug editor.
        </p>
      ) : (
        <div className="mt-10 space-y-4">
          {queue.map((drug) => (
            <section
              key={drug.id}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
            >
              <div className="flex flex-wrap items-baseline gap-x-2">
                <Link
                  href={`/drugs/${drug.slug}`}
                  className="font-medium text-[var(--accent)] underline"
                >
                  {drug.generic}
                </Link>
                {drug.needsReview && (
                  <span className="pill pill-xs pill-edge text-[var(--unverified)]">
                    importer asked for a human
                  </span>
                )}
                <span className="ml-auto text-xs text-[var(--muted)]">
                  {drug.brands.length} brand{drug.brands.length === 1 ? '' : 's'}
                  {' · '}
                  {drug.indications.length} condition{drug.indications.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="mt-3">
                <PairingGrid drug={drug} />
              </div>
            </section>
          ))}
        </div>
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
