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

  const result = await restoreBackup(parsed, mode);
  if (!result.ok) return result;

  revalidatePath('/drugs');
  revalidatePath('/admin/tags');
  revalidatePath('/study/flashcards');
  return { ok: true, report: result.report };
}
