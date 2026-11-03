import Link from 'next/link';
import { Suspense } from 'react';
import { getDrugIndex } from '@/lib/drugs/browse';
import { requireUser } from '@/lib/session';
import { getPreferences } from '@/lib/theme/preferences';
import { DrugBrowser } from './drug-browser';

export const metadata = { title: 'Drugs — Enkephalin' };

export default async function DrugsPage() {
  const session = await requireUser();
  const [{ rows, facets }, preferences] = await Promise.all([
    getDrugIndex(),
    // The axis travels to the client rather than a colour per row: the row
    // already carries its class, schedule and tags, and `lib/theme/palette.ts`
    // is client-safe precisely so both sides compute the same answer.
    getPreferences(session.user.id),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Drugs</h1>
        {session.user.role === 'admin' && (
          <Link href="/drugs/new" className="text-sm text-[var(--accent)] underline">
            Add a drug
          </Link>
        )}
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Enkephalin is a study aid, not a clinical reference.
      </p>

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
