import { count } from 'drizzle-orm';
import Link from 'next/link';
import { db } from '@/db';
import { drugBrands, drugIndications, dosingRegimens, drugs, studyCards, tags } from '@/db/schema';
import { requireAdmin } from '@/lib/session';
import { restoreAction } from './actions';
import { RestoreForm } from './restore-form';

export const metadata = { title: 'Data — Enkephalin' };
export const dynamic = 'force-dynamic';

export default async function DataPage() {
  await requireAdmin();

  const [[drugCount], [brandCount], [indicationCount], [regimenCount], [tagCount], [cardCount]] =
    await Promise.all([
      db.select({ n: count() }).from(drugs),
      db.select({ n: count() }).from(drugBrands),
      db.select({ n: count() }).from(drugIndications),
      db.select({ n: count() }).from(dosingRegimens),
      db.select({ n: count() }).from(tags),
      db.select({ n: count() }).from(studyCards),
    ]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin" className="text-sm text-[var(--accent)] underline">← Admin</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Data</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Everything you have written lives in one Postgres volume. This is how you get a copy of it
        out, and how you put one back.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Export</h2>
        <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <li>{drugCount.n} drugs</li>
          <li>{brandCount.n} brands</li>
          <li>{indicationCount.n} indications</li>
          <li>{regimenCount.n} dosing rows</li>
          <li>{tagCount.n} tags</li>
          <li>{cardCount.n} card schedules</li>
        </ul>

        <p className="mt-3 text-xs text-[var(--muted)]">
          One JSON file, keyed by slug rather than by database id, so it restores into a database it
          did not come from. It carries the content, the tags, the field definitions, the site
          settings and each person&rsquo;s study progress — and deliberately no passwords, sessions
          or invite codes, so it is a file you can keep anywhere.
        </p>

        {/* A plain link, not a fetch: the browser saves the response itself. */}
        <a
          href="/api/admin/export"
          className="mt-4 inline-block rounded bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)]"
        >
          Download backup
        </a>
      </section>

      <section className="mt-12 border-t border-[var(--border)] pt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">Restore</h2>
        <p className="mt-2 text-xs text-[var(--muted)]">
          A drug&rsquo;s brands, indications, dosing rows and tags are taken wholesale from the file
          — they describe that one drug, and keeping some of the old ones would quietly resurrect a
          brand you had deleted. Study progress is matched to accounts by email; a person with no
          account here is reported rather than invented.
        </p>

        <RestoreForm action={restoreAction} />
      </section>

      <section className="mt-12 border-t border-[var(--border)] pt-6">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
          From a terminal
        </h2>
        <pre className="mt-2 overflow-x-auto rounded border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
{`npm run export                       # writes backups/enkephalin-backup_<stamp>.json
npm run export -- path/to/file.json  # or somewhere you choose
npm run restore -- path/to/file.json
npm run restore -- path/to/file.json --replace`}
        </pre>
        <p className="mt-2 text-xs text-[var(--muted)]">
          The same code as the buttons above. Worth a scheduled task if you want a copy without
          remembering to click.
        </p>
      </section>
    </main>
  );
}
