import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import { IMPORT_FORMAT } from '@/lib/drugs/import-format';
import { importDrugsAction } from './actions';
import { ImportForm } from './import-form';

export const metadata = { title: 'Import drugs' };
export const dynamic = 'force-dynamic';

/**
 * Importing a lecture's worth of drug profiles from one file.
 *
 * The file is written by somebody -- usually some other model -- reading
 * `docs/drug-import.md` and a slide deck. That document is the contract, and
 * this screen is deliberately thin: paste, check, import. Everything that
 * decides what a file means lives in `lib/drugs/import-format.ts`, so the
 * rules are the same whether a file arrives through this box or a test.
 */
export default async function ImportPage() {
  await requireAdmin();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin" className="pill">← Admin</Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Import drugs</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        One <span className="font-mono text-xs">{IMPORT_FORMAT}</span> file: what a lecture says
        about the drugs in it. <strong>Nothing is overwritten.</strong> A field the drug has no
        value for is filled in; a field the lecture says <em>differently</em> is recorded as what
        that class says, which is the version you can read from the dropdown on the profile and
        study by picking the class in Flashcards or Quiz.
      </p>
      <p className="mt-2 text-sm text-[var(--muted)]">
        To have a file written: hand whoever is writing it{' '}
        <span className="font-mono text-xs">docs/drug-import.md</span> from this repository, the
        notes or slides, and nothing else. It is the authoring guide, and it is written to be the
        only thing they need.
      </p>

      <ImportForm action={importDrugsAction} />
    </main>
  );
}
