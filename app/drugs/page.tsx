import { Suspense } from 'react';
import { getDrugIndex } from '@/lib/drugs/browse';
import { requireUser } from '@/lib/session';
import { DrugBrowser } from './drug-browser';

export const metadata = { title: 'Drugs — Enkephalin' };

export default async function DrugsPage() {
  await requireUser();
  const { rows, facets } = await getDrugIndex();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Drugs</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Enkephalin is a study aid, not a clinical reference.
      </p>

      {/* useSearchParams needs a boundary; the rail renders as soon as the
          index is in the payload. */}
      <Suspense fallback={<p className="mt-8 text-[var(--muted)]">Loading…</p>}>
        <DrugBrowser rows={rows} facets={facets} />
      </Suspense>
    </main>
  );
}
