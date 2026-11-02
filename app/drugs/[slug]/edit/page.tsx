import { asc, eq, ne } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { tags } from '@/db/schema';
import { getDrugProfile } from '@/lib/drugs/profile';
import { listFieldDefs } from '@/lib/fields/registry';
import { requireAdmin } from '@/lib/session';
import { saveDrugAction } from '../../actions';
import { DrugForm, type EditableField } from '../../drug-form';

export const dynamic = 'force-dynamic';

export default async function EditDrugPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { slug } = await params;
  const { created } = await searchParams;
  await requireAdmin();

  // Every field, not the viewer's visible subset: this is the editor, and a
  // field you have hidden on profiles is still one you can fill in here.
  const [profile, defs, assignable] = await Promise.all([
    getDrugProfile(slug),
    listFieldDefs(),
    db
      .select({ slug: tags.slug, label: tags.label, kind: tags.kind })
      .from(tags)
      .where(ne(tags.kind, 'system'))
      .orderBy(asc(tags.kind), asc(tags.label)),
  ]);
  if (!profile) notFound();

  const { drug, brands, indications, tags: current } = profile;

  const fields: EditableField[] = defs
    .filter((def) => !def.isCore)
    .map((def) => ({ def, value: drug.fields[def.key] }));

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href={`/drugs/${drug.slug}`} className="text-sm text-[var(--accent)] underline">
        ← {drug.genericName}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Edit {drug.genericName}</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {created
          ? 'Added. Everything else about it can go in here.'
          : 'Every field, with where it came from and whether anyone has checked it.'}
      </p>

      {/* The importer is the other writer here, and it only ever adds: a brand
          or indication deleted here comes back on the next sheet import if the
          sheet still lists it. Worth knowing before wondering why. */}
      <p className="mt-4 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-xs text-[var(--muted)]">
        The sheet importer adds but never deletes. If you remove a brand or indication the sheet
        still carries, the next import puts it back.
      </p>

      <DrugForm
        action={saveDrugAction}
        submitLabel="Save"
        drug={{
          slug: drug.slug,
          genericName: drug.genericName,
          drugClass: drug.drugClass,
          schedule: drug.schedule,
          scheduleNote: drug.scheduleNote,
          dosingUnique: drug.dosingUnique,
        }}
        brands={brands.map((brand) => brand.name)}
        indications={indications}
        fields={fields}
        allTags={assignable}
        tagSlugs={current.filter((tag) => tag.kind !== 'system').map((tag) => tag.slug)}
        systemTags={current.filter((tag) => tag.kind === 'system').map((tag) => tag.label)}
      />
    </main>
  );
}
