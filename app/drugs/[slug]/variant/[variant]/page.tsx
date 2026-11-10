import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/session';
import { getDrugProfile } from '@/lib/drugs/profile';
import { variantLayerFor, VARIANT_KIND_LABELS } from '@/lib/drugs/variants';
import { saveVariantLayerAction } from './actions';
import { VariantForm, type VariantField } from './variant-form';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Params) {
  const { slug, variant } = await params;
  return { title: `${slug} — ${variant}` };
}

type Params = { params: Promise<{ slug: string; variant: string }> };

/**
 * Editing one class's or exam's version of one drug.
 *
 * A screen of its own rather than a layer switch inside the drug editor, and
 * deliberately: that form owns the drug — its brands, its indications, its
 * dosing prose and the regimens read out of it — and none of those can be
 * differed on by a class. What a class differs on is the plain fields, so this
 * is a list of exactly those and nothing else.
 *
 * Reached from the profile's variant picker, which is where somebody notices
 * that a class says something different.
 */
export default async function VariantProfileEditPage({ params }: Params) {
  const session = await requireAdmin();
  const { slug, variant: variantSlug } = await params;

  const profile = await getDrugProfile(slug, session.user.id);
  if (!profile) notFound();

  // The drug has to carry the tag. Not a guard against mischief so much as
  // against a stale link: a drug dropped from a class keeps no layer that
  // anything would ever read, so editing one would be writing into a void.
  const layer = await variantLayerFor(profile.drug.id, variantSlug);
  if (!layer) notFound();

  // Every field a variant may differ on, in the order the registry sorts them.
  // `isCore` is out because those live in their own columns -- a class
  // claiming a different generic name is a different drug, not a variation --
  // and so is a field somebody has hidden, since the profile would not show it.
  const fields: VariantField[] = profile.defs
    .filter((def) => !def.isCore)
    .map((def) => ({
      def,
      base: profile.drug.fields[def.key],
      own: layer.fields[def.key]?.value ?? '',
    }));

  // One source for the layer, taken from whatever it already says: every value
  // in a layer carries the same one, so the first is the layer's. An empty
  // layer starts on the phrase the importer uses, so a hand-written layer and
  // an imported one read the same on a profile -- see `provenanceOf`.
  const source = Object.values(layer.fields)[0]?.source ?? `from ${layer.label} content`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/drugs/${profile.drug.slug}`} className="pill">← {profile.drug.genericName}</Link>
        <Link href={`/drugs/${profile.drug.slug}/edit`} className="pill pill-edge">
          Edit the drug itself
        </Link>
      </div>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {profile.drug.genericName} as {layer.label} teaches it
      </h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        {VARIANT_KIND_LABELS[layer.kind]}. Fill in only what it says <em>differently</em>. An empty
        box means it says what the drug says — and keeps saying it as the drug’s profile improves,
        which is why this is a layer and not a copy. Clearing a box removes this version of that
        field.
      </p>

      {fields.length === 0 ? (
        <p className="mt-6 rounded border border-[var(--border)] bg-[var(--surface)] p-4 text-sm">
          There are no fields to differ on. Every field is either core — the name, the brands, the
          indications, the class, the schedule, which a variant cannot override — or hidden in your
          own settings.
        </p>
      ) : (
        <VariantForm
          action={saveVariantLayerAction}
          drug={{ slug: profile.drug.slug, generic: profile.drug.genericName }}
          variant={{ slug: layer.slug, label: layer.label, kind: layer.kind }}
          fields={fields}
          source={source}
          note={layer.note ?? ''}
        />
      )}
    </main>
  );
}
