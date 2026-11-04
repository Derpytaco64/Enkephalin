import { asc, ne } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { tags } from '@/db/schema';
import { listIndications } from '@/lib/drugs/indication-store';
import { requireAdmin } from '@/lib/session';
import { createDrugAction } from '../actions';
import { DrugForm } from '../drug-form';

export const metadata = { title: 'Add a drug — Enkephalin' };
export const dynamic = 'force-dynamic';

export default async function NewDrugPage() {
  await requireAdmin();

  const [assignable, vocabulary] = await Promise.all([
    db
      .select({ slug: tags.slug, label: tags.label, kind: tags.kind })
      .from(tags)
      .where(ne(tags.kind, 'system'))
      .orderBy(asc(tags.kind), asc(tags.label)),
    listIndications(),
  ]);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/drugs" className="pill">← Drugs</Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Add a drug</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        For what the sheet does not carry. Nothing typed here is attributed to the sheet — it is
        recorded as unverified, from whoever added it, until someone checks it against a source.
      </p>

      <DrugForm
        action={createDrugAction}
        submitLabel="Add drug"
        brands={[]}
        indications={[]}
        knownIndications={vocabulary.map((row) => row.label)}
        fields={[]}
        allTags={assignable}
        tagSlugs={[]}
        systemTags={[]}
      />
    </main>
  );
}
