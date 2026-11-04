import { asc, count, eq } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { drugTags, tags } from '@/db/schema';
import { requireAdmin } from '@/lib/session';
import { createTagAction } from './actions';
import { NewTagForm } from './new-tag-form';

export const metadata = { title: 'Tags' };
export const dynamic = 'force-dynamic';

const KIND_LABELS: Record<string, string> = {
  top_list: 'Drug list',
  school_year: 'Year',
  course: 'Course',
  system: 'Category',
  custom: 'Custom',
};

export default async function TagsPage() {
  await requireAdmin();

  const rows = await db
    .select({ slug: tags.slug, label: tags.label, kind: tags.kind, drugs: count(drugTags.drugId) })
    .from(tags)
    .leftJoin(drugTags, eq(drugTags.tagId, tags.id))
    .groupBy(tags.slug, tags.label, tags.kind)
    .orderBy(asc(tags.kind), asc(tags.label));

  const editable = rows.filter((row) => row.kind !== 'system');
  const categories = rows.filter((row) => row.kind === 'system');

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin" className="pill">← Admin</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Tags</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        A tag is a list you can study by: the sheet edition, a course, or anything you gather
        yourself. Open one to tick the drugs on it.
      </p>

      <ul className="mt-6 divide-y divide-[var(--border)]">
        {editable.map((row) => (
          <li key={row.slug} className="flex flex-wrap items-baseline gap-x-3 py-2">
            <Link href={`/admin/tags/${row.slug}`} className="text-[var(--accent)] underline">
              {row.label}
            </Link>
            <span className="text-xs text-[var(--muted)]">{KIND_LABELS[row.kind] ?? row.kind}</span>
            <span className="ml-auto text-sm text-[var(--muted)]">
              {row.drugs} drug{row.drugs === 1 ? '' : 's'}
            </span>
          </li>
        ))}
        {editable.length === 0 && (
          <li className="py-2 text-sm text-[var(--muted)]">No lists yet.</li>
        )}
      </ul>

      <NewTagForm action={createTagAction} />

      {categories.length > 0 && (
        <section className="mt-12">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
            Therapeutic categories
          </h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {categories.length} of them, from the map in{' '}
            <span className="font-mono">scripts/seed-categories.ts</span>. Readable here, edited
            there — the seeder rebuilds their membership on every run.
          </p>
          <ul className="mt-3 flex flex-wrap gap-1">
            {categories.map((row) => (
              <li key={row.slug}>
                <Link href={`/admin/tags/${row.slug}`} className="pill pill-xs pill-edge">
                  {row.label}
                </Link>
                <span className="ml-1 text-xs text-[var(--muted)]">{row.drugs}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
