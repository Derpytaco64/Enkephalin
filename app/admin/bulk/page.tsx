import Link from 'next/link';
import type { Route } from 'next';
import { bulkFields, bulkTargets } from '@/lib/admin/bulk';
import { listFieldDefs } from '@/lib/fields/registry';
import { BulkForm } from './bulk-form';

export const metadata = { title: 'Bulk field set' };
export const dynamic = 'force-dynamic';

/**
 * Setting one field across many drugs at once.
 *
 * The case it exists for is the sheet's own shape: a field that is the same
 * answer for most of the list. Most drugs have no black box warning, and
 * recording that by opening 180 editors is how a true fact stays unrecorded --
 * where an unrecorded *none* is indistinguishable from a gap, which is the one
 * confusion the field system is built to avoid.
 *
 * Pick the field first, then the drugs. That order is not arbitrary: the
 * roster is only readable once it can show what each drug currently holds, and
 * it cannot show that until it knows which field is meant.
 */
export default async function BulkPage({
  searchParams,
}: {
  searchParams: Promise<{ field?: string }>;
}) {
  const { field: wanted } = await searchParams;
  const defs = await listFieldDefs();
  const fields = bulkFields(defs);
  const def = fields.find((each) => each.key === wanted);
  const targets = def ? await bulkTargets(def) : [];

  return (
    <main className="mx-auto max-w-4xl px-4 py-16">
      <Link href="/admin" className="pill">← Admin</Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Bulk field set</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        One value, many drugs. Every write goes through the drug editor&rsquo;s own writer, one
        drug at a time — so this is a stack of ordinary edits with an audit row each, not a
        shortcut past the rules. The roster shows what each drug holds now, because what a bulk
        set <em>overwrites</em> matters more than what it writes.
      </p>

      <nav className="mt-6 flex flex-wrap gap-2">
        {fields.map((each) => (
          <Link
            key={each.key}
            href={{ pathname: '/admin/bulk' as Route, query: { field: each.key } }}
            aria-current={def?.key === each.key ? 'page' : undefined}
            className={`pill pill-xs ${def?.key === each.key
              ? 'pill-on'
              : 'pill-edge pill-soft'}`}
          >
            {each.label}
          </Link>
        ))}
      </nav>

      {!def ? (
        <p className="mt-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6
          text-sm text-[var(--muted)]">
          Pick a field above. Only stored fields appear — the generic name, brands, indications,
          controlled schedule and class live in their own columns and are edited per drug or in
          their own screens.
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm">
            <strong>{def.label}</strong>
            {def.blankMeansNone && (
              <span className="text-[var(--muted)]">
                {' — '}a blank value on this field means the drug has none, which is an answer
                worth recording and worth quizzing.
              </span>
            )}
          </p>
          <BulkForm
            field={{
              key: def.key,
              label: def.label,
              dataType: def.dataType,
              enumOptions: def.enumOptions,
              blankMeansNone: def.blankMeansNone,
            }}
            targets={targets}
          />
        </>
      )}
    </main>
  );
}
