/**
 * Puts a backup back.
 *
 *   node --experimental-strip-types scripts/restore-backup.ts path/to/file.json
 *   node --experimental-strip-types scripts/restore-backup.ts path/to/file.json --replace
 *
 * Merge is the default and only writes what the file contains. --replace also
 * deletes every drug the file does not mention, which is what moving a database
 * wants and what an accident does not: it asks for confirmation unless --yes is
 * passed, so a cron job can still use it deliberately.
 */
import './env.ts';
import { createInterface } from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { restoreBackup } from '../lib/data/backup.ts';

const [path, ...flags] = process.argv.slice(2);
if (!path) {
  console.error('usage: restore-backup.ts <file.json> [--replace] [--yes]');
  process.exit(1);
}

const mode = flags.includes('--replace') ? 'replace' as const : 'merge' as const;

if (mode === 'replace' && !flags.includes('--yes')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    'Replace deletes every drug this file does not contain, with its brands, dosing and schedules.\nType REPLACE to go ahead: ',
  );
  rl.close();
  if (answer.trim().toUpperCase() !== 'REPLACE') {
    console.log('Nothing was written.');
    process.exit(1);
  }
}

const result = await restoreBackup(JSON.parse(await readFile(path, 'utf8')), mode);

if (!result.ok) {
  console.error(`refused: ${result.message}`);
  process.exit(1);
}

const { report } = result;
console.log(`restored (${report.mode}) from ${path}`);
console.log(`  drugs      ${report.drugsInserted} added, ${report.drugsUpdated} updated, ${report.drugsDeleted} deleted`);
console.log(`  tags       ${report.tagsInserted}`);
console.log(`  fields     ${report.fieldDefsWritten}`);
if (report.progressRestored.length > 0) console.log(`  progress   ${report.progressRestored.join(', ')}`);
if (report.progressSkipped.length > 0) {
  console.log(`  no account for ${report.progressSkipped.join(', ')} -- their progress stays in the file`);
}

process.exit(0);
