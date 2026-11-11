/**
 * Puts one drug from the sheet back, with its place on Top Drugs 2026.
 *
 *   npx tsx scripts/restore-sheet-drug.ts prednisone
 *
 * `tsx` rather than `node --experimental-strip-types`, which is what the other
 * scripts here use: this one reaches `rebuildRegimens` in `lib/drugs`, and the
 * app's own modules import each other through the `@/` alias that only a
 * TypeScript-aware loader resolves. The alternative was to copy the parser
 * plumbing out of `backfill-dosing.ts`, and one dosing writer is better than
 * two that can disagree. Hence `main()` as well, rather than the top-level
 * await its siblings use: `tsx` compiles a `.ts` file as CommonJS, where there
 * is no such thing.
 *
 * **Why this exists and `npm run seed` does not do it.** The database is the
 * content now and the sheet is the baseline it came from, so the seed is no
 * longer re-run: a full sync walks all 237 entries and would reach drugs nobody
 * asked it to touch. What was needed on 2026-11-10 was one drug -- Prednisone,
 * deleted by `/admin/remove` along with a heme/onc lecture's version of it,
 * when only the version was meant to go. Its own profile had never been edited
 * by hand, so the sheet is an exact answer for the one row that went.
 *
 * It is the same code path that made the other 235: `syncDrugs` over a list of
 * one, which inserts the drug, its brands, its indications and the Top Drugs
 * 2026 membership, then `rebuildRegimens` to read the dosing prose into
 * `dosing_regimens` the way `backfill-dosing.ts` does for everything -- the one
 * step the sync leaves to that script, and the reason a restored drug would
 * otherwise be the only one in the table with no dosing row.
 *
 * **It refuses a drug that already exists.** Overwriting a live profile with
 * the sheet's wording is a different operation with its own flag (`npm run
 * seed -- --force`), and it is not what *put it back* means.
 *
 * What it cannot bring back: anything that was never in the sheet. A lecture's
 * version of the drug comes back by importing that lecture again, and study
 * history recorded against the deleted row is gone with it.
 */
import './env.ts';
import { readFile } from 'node:fs/promises';
import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { drugs, users } from '../db/schema.ts';
import { syncDrugs, type SeedDrug } from '../lib/content/sync.ts';
import { rebuildRegimens } from '../lib/drugs/mutations.ts';

async function main() {
  const wanted = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  if (wanted.length === 0) {
    console.error('Give one or more drug slugs, e.g. prednisone.');
    process.exit(1);
  }

  const file = process.env.SHEET_FILE ?? './data/drugs-seed.json';
  const sheet = JSON.parse(await readFile(file, 'utf8')) as { drugs: SeedDrug[] };

  const found = wanted.map((slug) => sheet.drugs.find((drug) => drug.slug === slug));
  const missing = wanted.filter((_, at) => found[at] === undefined);
  if (missing.length > 0) {
    console.error(`Not in ${file}: ${missing.join(', ')}`);
    process.exit(1);
  }

  const already = await db
    .select({ slug: drugs.slug })
    .from(drugs)
    .where(inArray(drugs.slug, wanted));
  if (already.length > 0) {
    console.error(
      `Already in the database: ${already.map((row) => row.slug).join(', ')}.\n`
      + 'This restores a drug that is gone. Use the drug editor to change one that is here.',
    );
    process.exit(1);
  }

  // The regimen rows and their audit entry are attributed to somebody, and on a
  // single-owner install that is the owner.
  const [actor] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, 'admin'))
    .orderBy(asc(users.createdAt))
    .limit(1);
  if (!actor) {
    console.error('No admin account to attribute this to.');
    process.exit(1);
  }

  const entries = found as SeedDrug[];
  const report = await syncDrugs(entries);

  console.log(`restored ${report.drugsInserted} drug(s) from ${file}, as ${actor.email}`);
  console.log(`brands:       ${report.brandsInserted}`);
  console.log(`indications:  ${report.indicationsInserted} on drugs, ${report.newIndications.length} new wordings`);
  console.log(`tagged:       ${report.tagsLinked} on Top Drugs 2026`);

  for (const entry of entries) {
    const [drug] = await db
      .select({ id: drugs.id, generic: drugs.genericName, fields: drugs.fields })
      .from(drugs)
      .where(eq(drugs.slug, entry.slug));
    if (!drug) {
      console.error(`  ${entry.slug}: inserted and could not be read back. No dosing rows written.`);
      continue;
    }
    const prose = drug.fields.dosing?.value ?? null;
    const dosing = await rebuildRegimens(drug.id, drug.generic, prose, actor.id);
    console.log(`  ${entry.slug}: dosing ${dosing.status}, ${dosing.rows} regimen row(s)`);
  }
}

// `void`, not `await`: the same CommonJS output has no top-level await
// either, and an unhandled rejection here is a stack trace, which is the
// right output for an operator tool that failed.
void main().then(() => process.exit(0));
