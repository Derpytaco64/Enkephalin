'use server';

import { revalidatePath } from 'next/cache';
import { restoreBackup, type RestoreReport } from '@/lib/data/backup';
import { asMegabytes, MAX_BACKUP_BYTES } from '@/lib/data/limits';
import { requireAdmin } from '@/lib/session';

export type RestoreState =
  | { ok: true; report: RestoreReport }
  | { ok: false; message: string };

export async function restoreAction(formData: FormData): Promise<RestoreState> {
  await requireAdmin();

  const file = formData.get('backup');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: 'Choose a backup file first.' };
  }
  if (file.size > MAX_BACKUP_BYTES) {
    return {
      ok: false,
      message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is `
        + `${asMegabytes(MAX_BACKUP_BYTES)}.`,
    };
  }

  // Replace deletes drugs the file does not mention, so it takes both the mode
  // and a typed confirmation -- a mis-click should not be able to empty the
  // database.
  const mode = formData.get('mode') === 'replace' ? ('replace' as const) : ('merge' as const);
  if (mode === 'replace' && String(formData.get('confirm') ?? '').trim().toUpperCase() !== 'REPLACE') {
    return { ok: false, message: 'Type REPLACE to confirm deleting what the file does not contain.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    return { ok: false, message: 'That file is not readable JSON.' };
  }

  /**
   * A thrown restore is a message, not a digest.
   *
   * `restoreBackup` reports what it refuses, but a query it did not expect
   * throws -- and a server action that throws reaches the browser as *an error
   * occurred in the Server Components render, the specific message is omitted
   * in production builds*. Which is the correct default for a public page and
   * useless here: this screen is admin-only, self-hosted, and the thing a
   * person needs on a bad day is the database's own words. So they are caught,
   * logged where `docker logs` will show them, and handed back.
   */
  let result: Awaited<ReturnType<typeof restoreBackup>>;
  try {
    result = await restoreBackup(parsed, mode);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    console.error('[restore] failed', error);
    // The first line only: drizzle prefixes a failed query with the whole SQL
    // statement and its parameters, which is for the log, not for a person.
    const [first] = why.split(/\r?\n/);
    return { ok: false, message: `The restore stopped: ${first}` };
  }
  if (!result.ok) return result;

  revalidatePath('/drugs');
  revalidatePath('/admin/tags');
  revalidatePath('/study/flashcards');
  return { ok: true, report: result.report };
}
