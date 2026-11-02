/**
 * Writes a backup to a file.
 *
 *   node --experimental-strip-types scripts/export-backup.ts
 *   node --experimental-strip-types scripts/export-backup.ts path/to/file.json
 *
 * With no path it lands in backups/ with a timestamped name, which is the form
 * a scheduled task wants: run it on a timer and the directory becomes history.
 */
import './env.ts';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { backupFilename, exportBackup } from '../lib/data/backup.ts';

const target = process.argv[2] ?? join('backups', backupFilename());

const backup = await exportBackup();
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(backup, null, 2), 'utf8');

console.log(`wrote ${target}`);
for (const [what, n] of Object.entries(backup.counts)) {
  console.log(`  ${what.padEnd(18)} ${n}`);
}

process.exit(0);
