/**
 * Loads data/drugs-seed.json into Postgres. Safe to re-run: it fills gaps and
 * corrects changed facts, but never blanks an existing value and never
 * overwrites a verified one without --force.
 *
 *   npm run seed
 *   npm run seed -- --force
 */
import { syncDrugsFromFile } from '../lib/content/sync.ts';

const force = process.argv.includes('--force');
const file = process.argv.find((arg) => arg.endsWith('.json')) ?? './data/drugs-seed.json';

const report = await syncDrugsFromFile(file, { force });

console.log(`drugs:        ${report.drugsInserted} new, ${report.drugsUpdated} updated, ${report.drugsUnchanged} unchanged`);
console.log(`brands:       ${report.brandsInserted} new, ${report.brandsUpdated} updated`);
console.log(`indications:  ${report.indicationsInserted} new`);
console.log(`brand links:  ${report.linksInserted} new`);
console.log(`tagged:       ${report.tagsLinked}`);

if (report.humanKept.length > 0) {
  console.log(`\nkept ${report.humanKept.length} hand-written value(s) over the sheet (use --force to overwrite):`);
  for (const key of report.humanKept) console.log(`  ${key}`);
}

if (report.mergedSlugs.length > 0) {
  console.log(`
listed more than once in the sheet, folded into one drug with per-brand pairing:`);
  for (const slug of report.mergedSlugs) console.log(`  ${slug}`);
}

if (report.variantsSkipped.length > 0) {
  console.log(`\nvariant dosing not imported, needs a human in the drug editor:`);
  for (const slug of report.variantsSkipped) console.log(`  ${slug}`);
}

for (const [label, rows] of [
  ['brands no longer in the sheet', report.orphanBrands],
  ['indications no longer in the sheet', report.orphanIndications],
] as const) {
  if (rows.length > 0) {
    console.log(`\n${label} (left in place):`);
    for (const row of rows) console.log(`  ${row}`);
  }
}

process.exit(0);
