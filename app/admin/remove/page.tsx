import Link from 'next/link';
import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { drugTags, drugVariantValues, drugs, tags } from '@/db/schema';
import { isVariantKind, overriddenKeys, variantScope } from '@/lib/drugs/variants';
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
 *
 * Four flat reads and the shape built here rather than in SQL. The rows are
 * small -- one per membership, one per layer -- and what the screen needs is
 * **which tag belongs to which version**, which is `variantScope` applied per
 * version. Doing it in SQL would mean writing that rule a third time.
 */
export default async function RemoveDrugsPage() {
  const [drugRows, tagRows, memberRows, layerRows] = await Promise.all([
    db
      .select({ slug: drugs.slug, generic: drugs.genericName, id: drugs.id })
      .from(drugs)
      .orderBy(asc(drugs.genericName)),
    db
      .select({ id: tags.id, slug: tags.slug, label: tags.label, kind: tags.kind })
      .from(tags),
    db
      .select({
        drugId: drugTags.drugId,
        tagId: drugTags.tagId,
        readsVariant: drugTags.variantTagId,
      })
      .from(drugTags),
    db
      .select({
        drugId: drugVariantValues.drugId,
        tagId: drugVariantValues.tagId,
        fields: drugVariantValues.fields,
      })
      .from(drugVariantValues),
  ]);

  const tagById = new Map(tagRows.map((row) => [row.id, row]));

  const membersByDrug = new Map<string, typeof memberRows>();
  for (const row of memberRows) {
    membersByDrug.set(row.drugId, [...(membersByDrug.get(row.drugId) ?? []), row]);
  }

  const layersByDrug = new Map<string, typeof layerRows>();
  for (const row of layerRows) {
    layersByDrug.set(row.drugId, [...(layersByDrug.get(row.drugId) ?? []), row]);
  }

  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);

  const rows: RemovableDrug[] = drugRows.map((drug) => {
    const members = membersByDrug.get(drug.id) ?? [];
    const layers = layersByDrug.get(drug.id) ?? [];
    const layerTagIds = new Set(layers.map((layer) => layer.tagId));
    // The kind comes off the vocabulary rather than out of a fifth join: the
    // scope rule needs it to tell a list from a class.
    const scoped = members.map((member) => ({
      tagId: member.tagId,
      kind: tagById.get(member.tagId)?.kind ?? '',
      readsVariant: member.readsVariant,
    }));

    const named = (tagId: string) => {
      const tag = tagById.get(tagId);
      return tag === undefined ? null : { slug: tag.slug, label: tag.label };
    };
    const names = (ids: string[]) => ids
      .map(named)
      .filter((entry): entry is { slug: string; label: string } => entry !== null)
      .sort(byLabel);

    /**
     * One line per stored layer, each saying what deleting it would reach.
     *
     * `variantScope` is the same rule `clearVariantLayer` acts on, so what the
     * line says and what the button does cannot disagree.
     */
    const variants = layers.map((layer) => {
      const scope = variantScope(layer.tagId, scoped, layerTagIds);
      const tag = tagById.get(layer.tagId);
      return {
        slug: tag?.slug ?? layer.tagId,
        label: tag?.label ?? layer.tagId,
        // The count of fields it words differently, which is the only honest
        // measure of what clearing it would throw away.
        fields: overriddenKeys(layer.fields).length,
        takes: names(scope.takes),
        keeps: names(scope.keeps),
      };
    }).sort(byLabel);

    // Everything a version has claimed is shown on that version's line, so the
    // drug's own row carries only what belongs to the drug itself -- and for a
    // drug a lecture merely touched, that is the curated list it was already
    // on, standing alone where it reads as the warning it is.
    const claimed = new Set(variants.flatMap(
      (variant) => [...variant.takes, ...variant.keeps].map((entry) => entry.slug),
    ));

    const own = members
      .map((member) => {
        const tag = tagById.get(member.tagId);
        if (tag === undefined || claimed.has(tag.slug)) return null;
        return {
          slug: tag.slug,
          label: tag.label,
          // A list or a year is a curation decision that outlives any lecture,
          // so deleting the drug for being in an import takes it off something
          // nobody was undoing. The form says so before the button does it.
          curated: !isVariantKind(tag.kind),
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort(byLabel);

    return { slug: drug.slug, generic: drug.generic, tags: own, variants };
  });

  /**
   * Every tag anything is on, with how many drugs carry it.
   *
   * A course and an exam are the two an import creates, so they are what
   * undoing one has to be able to filter by -- the count beside each is the
   * size of the mistake, and the first thing you want to see before ticking
   * two hundred boxes.
   */
  const counted = new Map<string, number>();
  for (const row of memberRows) {
    const tag = tagById.get(row.tagId);
    if (tag !== undefined) counted.set(tag.slug, (counted.get(tag.slug) ?? 0) + 1);
  }
  const facetTags = tagRows
    .filter((row) => (counted.get(row.slug) ?? 0) > 0)
    .sort(byLabel)
    .map((row) => ({
      slug: row.slug, label: row.label, kind: row.kind, count: counted.get(row.slug) ?? 0,
    }));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Remove drugs</h1>
        <Link href="/admin" className="pill pill-edge">Admin</Link>
      </div>
      <p className="mt-2 text-sm text-[var(--muted)]">
        For undoing an import. Deleting a drug takes its brands, its list memberships, its dosing
        rows, its versions and every card and answer recorded against it &mdash; including the lists
        it was on before any lecture touched it. Deleting a version takes the class and exam tags
        that arrived with it, and leaves the drug&rsquo;s lists alone. There is no undo, and{' '}
        <Link href="/admin/data" className="underline">/admin/data</Link> exports the whole
        database as one file first.
      </p>

      <RemoveForm rows={rows} facetTags={facetTags} action={removeAction} />
    </main>
  );
}
