import { asc, eq } from 'drizzle-orm';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db';
import { drugBrands, drugTags, drugs, tags } from '@/db/schema';
import { requireAdmin } from '@/lib/session';
import { deleteTagAction, saveTagMembersAction } from '../actions';
import { numberedVariantsByDrug } from '@/lib/drugs/variants';
import { MemberPicker, type MemberDrug, type MemberVariants } from './member-picker';

export const dynamic = 'force-dynamic';

export default async function TagMembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAdmin();

  const [tag] = await db.select().from(tags).where(eq(tags.slug, slug));
  if (!tag) notFound();

  const [drugRows, brandRows, memberRows, variantsByDrug] = await Promise.all([
    db
      .select({ id: drugs.id, slug: drugs.slug, generic: drugs.genericName, drugClass: drugs.drugClass })
      .from(drugs)
      .orderBy(asc(drugs.genericName)),
    db
      .select({ drugId: drugBrands.drugId, name: drugBrands.name })
      .from(drugBrands)
      .orderBy(asc(drugBrands.sortOrder)),
    db
      .select({ drugId: drugTags.drugId, variantTagId: drugTags.variantTagId })
      .from(drugTags)
      .where(eq(drugTags.tagId, tag.id)),
    // Every drug's alternate profiles, numbered -- so an option can say
    // *amoxicillin [V-2] Infectious Disease* and mean the same V-2 the browse
    // list shows.
    numberedVariantsByDrug(),
  ]);

  const brandsByDrug = new Map<string, string[]>();
  for (const brand of brandRows) {
    const list = brandsByDrug.get(brand.drugId);
    if (list) list.push(brand.name);
    else brandsByDrug.set(brand.drugId, [brand.name]);
  }

  const roster: MemberDrug[] = drugRows.map((drug) => ({
    ...drug,
    brands: brandsByDrug.get(drug.id) ?? [],
    variants: (variantsByDrug.get(drug.id) ?? []).map(({ slug: variantSlug, label, n, overrides }) => ({
      slug: variantSlug, label, n, overrides,
    })),
  }));
  const members = memberRows.map((row) => row.drugId);

  // Which version this list already reads each drug as. The row stores a tag
  // id; the form speaks in slugs, because that is what it will send back and
  // the picker should not have to know ids at all.
  const tagSlugByTagId = new Map(
    (await db.select({ id: tags.id, slug: tags.slug }).from(tags)).map((row) => [row.id, row.slug]),
  );
  const readAs: MemberVariants = {};
  for (const row of memberRows) {
    const slugOfVariant = row.variantTagId ? tagSlugByTagId.get(row.variantTagId) : null;
    if (slugOfVariant) readAs[row.drugId] = slugOfVariant;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/admin/tags" className="pill">← Tags</Link>

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{tag.label}</h1>
        <span className="text-sm text-[var(--muted)]">{tag.kind.replace('_', ' ')}</span>
      </div>

      {tag.kind === 'system' ? (
        <>
          <p className="mt-4 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
            This is a therapeutic category, and its membership comes from the map in{' '}
            <span className="font-mono">scripts/seed-categories.ts</span>, which rebuilds every
            category link each time it runs. Editing it here would last until the next run and then
            vanish, so the list below is read-only — change the map instead.
          </p>
          <ul className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-3">
            {roster
              .filter((drug) => members.includes(drug.id))
              .map((drug) => (
                <li key={drug.id}>
                  <Link href={`/drugs/${drug.slug}`} className="pill pill-xs pill-edge">
                    {drug.generic}
                  </Link>
                </li>
              ))}
          </ul>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Tick a drug to put it on this list. Everything in the database is here, because the only
            way to see whether a list is right is against what is missing from it.
          </p>

          <MemberPicker
            action={saveTagMembersAction}
            tag={{ slug: tag.slug, label: tag.label, kind: tag.kind }}
            drugs={roster}
            members={members}
            readAs={readAs}
          />

          <form action={deleteTagAction} className="mt-10 border-t border-[var(--border)] pt-4">
            <input type="hidden" name="slug" value={tag.slug} />
            <button type="submit" className="pill pill-xs pill-danger">
              Delete this list
            </button>
            <span className="ml-2 text-xs text-[var(--muted)]">
              The drugs stay; only the list goes.
            </span>
          </form>
        </>
      )}
    </main>
  );
}
