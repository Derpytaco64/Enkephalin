'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import { parseSet, type SetProblem } from '@/lib/sets/format';
import { importSet, type ImportMode, type ImportReport } from '@/lib/sets/import';

export type ImportState =
  | { ok: true; report: ImportReport }
  /** The file was read but is not a valid set. Every problem, not the first. */
  | { ok: false; problems: SetProblem[] }
  /** It never got as far as parsing, or the importer refused it. */
  | { ok: false; message: string };

/**
 * Reading a set out of the form.
 *
 * A file input *and* a textarea, because both are real: a file is what a model
 * hands back, and a paste is what you do at eleven at night with the JSON on
 * your clipboard. The paste wins if both are filled, since it is the one you
 * just typed into.
 */
export async function importSetAction(formData: FormData): Promise<ImportState> {
  const session = await requireAdmin();

  const pasted = String(formData.get('pasted') ?? '').trim();
  const upload = formData.get('file');
  const mode: ImportMode = formData.get('mode') === 'replace' ? 'replace' : 'merge';

  let text = pasted;
  if (!text && upload instanceof File && upload.size > 0) {
    text = (await upload.text()).trim();
  }
  if (!text) return { ok: false, message: 'Nothing to import — choose a file or paste the JSON.' };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    // The message names the position, which is the one useful thing about a
    // JSON syntax error and the thing a generic "invalid file" hides.
    return {
      ok: false,
      message: `That is not valid JSON. ${error instanceof Error ? error.message : ''}`.trim(),
    };
  }

  const parsed = parseSet(json);
  if (!parsed.ok) return { ok: false, problems: parsed.problems };

  const result = await importSet(parsed.set, session.user.id, mode);
  if (!result.ok) return { ok: false, message: result.message };

  revalidatePath('/admin/sets');
  revalidatePath('/sets');
  revalidatePath(`/sets/${parsed.set.slug}`);
  return { ok: true, report: result.report };
}
