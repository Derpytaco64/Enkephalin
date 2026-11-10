import Link from 'next/link';
import { asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { drugTags, drugVariantValues, drugs, tags } from '@/db/schema';
import { overriddenKeys } from '@/lib/drugs/variants';
import { removeAction } from './actions';
import { RemoveForm, type RemovableDrug } from './remove-form';

export const metadata = { title: 'Remove drugs' };

/**
 * Every drug, every version, and a tick box each.
 *
 * The screen a bad import needs. `/drugs/<slug>/edit` can delete one drug at a
 * time behind its own confirmation, which is the right shape for retiring a
 * drug on purpose and the wrong one for undoing twenty-four of them -- and a
 * lecture that wrote its wording over the wrong class leaves a mess that
 * deleting drugs cannot clean up at all.
 *
 * Read whole rather than paged: 260 drugs with their versions is a small
 * payload, and the filtering that makes a list this long usable has to be
 * instant to be worth having -- the same reasoning as the browse index.
 */
export default async function RemoveDrugsPage() {
  const [drugRows, tagRows, layerRows] = await Promise.all([
    db
      .select({ slug: drugs.slug, generic: drugs.genericName, id: drugs.id })
      .from(drugs)
      .orderBy(asc(drugs.genericName)),
    db
      .select({ drugId: drugTags.drugId, slug: tags.slug, label: tags.label })
      .from(drugTags)
      .innerJoin(tags, eq(tags.id, drugTags.tagId)),
    db
      .select({
        drugId: drugVariantValues.drugId,
        slug: tags.slug,
        label: tags.label,
        fields: drugVariantValues.fields,
      })
      .from(drugVariantValues)
      .innerJoin(tags, eq(tags.id, drugVariantValues.tagId)),
  ]);

  const tagsByDrug = new Map<string, { slug: string; label: string }[]>();
  for (const row of tagRows) {
    tagsByDrug.set(row.drugId, [...(tagsByDrug.get(row.drugId) ?? []), row]);
  }

  const layersByDrug = new Map<string, RemovableDrug['variants']>();
  for (const row of layerRows) {
    // The count of fields it words differently, which is the only honest
    // measure of what clearing it would throw away.
    const entry = { slug: row.slug, label: row.label, fields: overriddenKeys(row.fields).length };
    layersByDrug.set(row.drugId, [...(layersByDrug.get(row.drugId) ?? []), entry]);
  }

  const rows: RemovableDrug[] = drugRows.map((drug) => ({
    slug: drug.slug,
    generic: drug.generic,
    tags: (tagsByDrug.get(drug.id) ?? []).map((tag) => tag.label),
    tagSlugs: (tagsByDrug.get(drug.id) ?? []).map((tag) => tag.slug),
    variants: (layersByDrug.get(drug.id) ?? []).sort((a, b) => a.label.localeCompare(b.label)),
  }));

  const facetTags = [...new Map(tagRows.map((row) => [row.slug, row])).values()]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((row) => ({ slug: row.slug, label: row.label }));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Remove drugs</h1>
        <Link href="/admin" className="pill pill-edge">Admin</Link>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">
        For undoing an import. Deleting a drug takes its brands, its list memberships, its dosing
        rows, its versions and every card and answer recorded against it — there is no undo, and{' '}
        <Link href="/admin/data" className="underline">/admin/data</Link> exports the whole
        database as one file first.
      </p>

      <RemoveForm rows={rows} facetTags={facetTags} action={removeAction} />
    </main>
  );
}
