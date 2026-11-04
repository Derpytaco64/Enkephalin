import Link from 'next/link';
import { Suspense } from 'react';
import { getDrugIndex } from '@/lib/drugs/browse';
import { requireUser } from '@/lib/session';
import { getSiteSettings } from '@/lib/settings';
import { getPreferences } from '@/lib/theme/preferences';
import { DrugBrowser } from './drug-browser';

export const metadata = { title: 'Drugs' };

export default async function DrugsPage() {
  const session = await requireUser();
  const [{ rows, facets }, preferences, settings] = await Promise.all([
    getDrugIndex(),
    // The axis travels to the client rather than a colour per row: the row
    // already carries its class, schedule and tags, and `lib/theme/palette.ts`
    // is client-safe precisely so both sides compute the same answer.
    getPreferences(session.user.id),
    getSiteSettings(),
  ]);
  const disclaimer = settings?.disclaimerText;

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Drugs</h1>
        {session.user.role === 'admin' && (
          <Link href="/drugs/new" className="pill pill-edge">
            Add a drug
          </Link>
        )}
      </div>
      {/* The admin's own wording out of site settings. It used to be this
          sentence hard-coded, which meant rewording the disclaimer on the
          front page left the page people actually read drug facts on still
          saying the old thing. */}
      <p className="mt-2 text-sm text-[var(--muted)]">{disclaimer}</p>

      {/* useSearchParams needs a boundary; the rail renders as soon as the
          index is in the payload. */}
      <Suspense fallback={<p className="mt-8 text-[var(--muted)]">Loading…</p>}>
        <DrugBrowser
          rows={rows}
          facets={facets}
          axis={preferences.colorAxis}
          overrides={preferences.paletteOverrides}
        />
      </Suspense>
    </main>
  );
}
