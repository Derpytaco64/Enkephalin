import Link from 'next/link';
import { notFound } from 'next/navigation';
import { emptyLabel, formatFieldValue } from '@/lib/fields/format';
import { groupFieldDefs, type FieldDef } from '@/lib/fields/registry';
import { getDrugProfile } from '@/lib/drugs/profile';
import { scheduleColor } from '@/lib/drugs/schedule';
import { requireUser } from '@/lib/session';
import type { FieldValue } from '@/db/schema';
import { markFieldAction } from './actions';

const STATUS_TOKENS = {
  verified: 'var(--verified)',
  unverified: 'var(--unverified)',
  flagged: 'var(--flagged)',
  not_applicable: 'var(--not-applicable)',
} as const;

const STATUS_LABELS = {
  verified: 'verified',
  unverified: 'unverified',
  flagged: 'flagged',
  not_applicable: 'none to record',
} as const;

/** Colour is never the only signal: the marker carries its word too. */
function StatusMarker({ status }: { status: FieldValue['status'] }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
      <span
        aria-hidden
        className="inline-block h-2 w-2 rounded-full"
        style={{ backgroundColor: STATUS_TOKENS[status] }}
      />
      {STATUS_LABELS[status]}
    </span>
  );
}

function FieldBody({ def, value }: { def: FieldDef; value: FieldValue | undefined }) {
  const formatted = formatFieldValue(def, value);

  switch (formatted.kind) {
    case 'none':
    case 'missing':
      return <p className="text-[var(--muted)]">{emptyLabel(formatted.kind, def)}</p>;
    case 'list':
      return (
        <ul className="list-inside list-disc">
          {formatted.items.map((item) => <li key={item}>{item}</li>)}
        </ul>
      );
    case 'markdown':
      return (
        <div className="space-y-2">
          {formatted.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </div>
      );
    case 'bool':
      return <p>{formatted.value ? 'Yes' : 'No'}</p>;
    case 'enum':
      return <p>{formatted.option}</p>;
    case 'number':
      return <p>{formatted.text}</p>;
    default:
      return <p>{formatted.text}</p>;
  }
}

export default async function DrugProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await requireUser();
  const profile = await getDrugProfile(slug, session.user.id);
  if (!profile) notFound();

  const { drug, brands, indications, tags, defs, siblings } = profile;
  const isAdmin = session.user.role === 'admin';

  // Core fields read from their own columns; the rest come out of the JSONB.
  const coreValues: Record<string, string | null> = {
    generic: drug.genericName,
    drug_class: drug.drugClass,
    controlled: drug.schedule,
    brand: brands.map((brand) => brand.name).join('\n'),
    indication: indications.join('\n'),
  };

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <Link href="/drugs" className="text-sm text-[var(--accent)] underline">← Drugs</Link>

      <header className="mt-4 flex flex-wrap items-baseline gap-x-3 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{drug.genericName}</h1>
        {drug.drugClass && (
          <span className="rounded border border-[var(--border)] px-2 py-0.5 text-sm text-[var(--muted)]">
            {drug.drugClass}
          </span>
        )}
        {drug.schedule && (
          <span
            className="rounded px-2 py-0.5 text-sm text-[var(--accent-fg)]"
            style={{ backgroundColor: scheduleColor(drug.schedule) }}
          >
            {drug.schedule}
          </span>
        )}
        {drug.needsClassReview && (
          <span className="text-xs text-[var(--unverified)]">class needs review</span>
        )}
      </header>

      {drug.needsPairingReview && (
        <p className="mt-4 rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
          This drug has competing brands across several indications, and the pairing has not been
          confirmed. Brand-to-indication cards stay switched off until it is.
        </p>
      )}

      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_14rem] lg:items-start">
        <div className="space-y-10">
          {brands.length > 0 && (
            <section>
              <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Brands</h2>
              <ul className="mt-2 divide-y divide-[var(--border)]">
                {brands.map((brand) => (
                  <li key={brand.id} className="py-2">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{brand.name}</span>
                      {brand.route && <span className="text-sm text-[var(--muted)]">{brand.route}</span>}
                      <span className="text-sm text-[var(--muted)]">
                        {brand.indications.length > 0
                          ? `for ${brand.indications.join(', ')}`
                          : 'covers all indications'}
                      </span>
                    </div>
                    {brand.dosingOverride && (
                      <p className="mt-1 text-sm">{brand.dosingOverride}</p>
                    )}
                    {brand.defaultPairingSuspect && (
                      <p className="mt-1 text-xs text-[var(--unverified)]">
                        {brand.suspectReason ?? 'Covers-all default needs confirming.'}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {groupFieldDefs(defs).map(([group, groupDefs]) => (
            <section key={group}>
              <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">{group}</h2>
              <dl className="mt-2 divide-y divide-[var(--border)]">
                {groupDefs.map((def) => {
                  const value: FieldValue | undefined = def.isCore
                    ? {
                        value: coreValues[def.key] ?? null,
                        status: 'verified',
                        source: 'class sheet',
                        updatedAt: drug.updatedAt.toISOString(),
                        updatedBy: null,
                      }
                    : drug.fields[def.key];

                  return (
                    <div key={def.key} className="py-3">
                      <dt className="flex flex-wrap items-baseline gap-x-3">
                        <span className="text-sm font-medium">{def.label}</span>
                        {value && !def.isCore && <StatusMarker status={value.status} />}
                        {value?.source && (
                          <span className="text-xs text-[var(--muted)]">from {value.source}</span>
                        )}

                        {isAdmin && !def.isCore && value && value.status !== 'verified' && (
                          <form action={markFieldAction} className="ml-auto">
                            <input type="hidden" name="slug" value={drug.slug} />
                            <input type="hidden" name="key" value={def.key} />
                            <input type="hidden" name="status" value="verified" />
                            <button type="submit" className="text-xs text-[var(--accent)] underline">
                              Mark verified
                            </button>
                          </form>
                        )}
                      </dt>
                      <dd className="mt-1">
                        <FieldBody def={def} value={value} />
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </section>
          ))}
        </div>

        <aside className="space-y-8">
          {tags.length > 0 && (
            <section>
              <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Tags</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {tags.map((tag) => (
                  <li key={tag.slug}>
                    <Link href={`/drugs?tag=${tag.slug}`} className="text-[var(--accent)] underline">
                      {tag.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {siblings.length > 0 && (
            <section>
              <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
                Same class
              </h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Where distractors come from, so compare them here.
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {siblings.map((sibling) => (
                  <li key={sibling.slug}>
                    <Link href={`/drugs/${sibling.slug}`} className="text-[var(--accent)] underline">
                      {sibling.generic}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
