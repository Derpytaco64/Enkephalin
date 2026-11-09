'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import type { SetProblem } from '@/lib/sets/format';
import { importSet, type ImportMode, type ImportReport } from '@/lib/sets/import';
import { parseBatch, type FailedEntry, type SetInput } from '@/lib/sets/batch';

/** What happened to one file. The name is what the person will look for. */
export type FileResult =
  | { name: string; ok: true; report: ImportReport }
  /** Read, but not a valid set. Every problem, not the first. */
  | { name: string; ok: false; problems: SetProblem[] }
  /** Never got as far as parsing, or the importer refused it. */
  | { name: string; ok: false; message: string };

export type ImportState =
  | { kind: 'results'; files: FileResult[] }
  /** Nothing to work with -- said once rather than once per file. */
  | { kind: 'nothing'; message: string };

/**
 * Reading sets out of the form.
 *
 * Several files at once, because lecture material arrives that way: nine
 * endocrine decks are nine files, and a form that takes one of them turns an
 * afternoon's work into nine afternoons of clicking.
 *
 * The textarea is still here, and still wins. A paste is what you do at eleven
 * at night with one set on your clipboard; when there is something in it, that
 * is the thing you just put there and the file picker is stale by comparison.
 *
 * Each file is imported on its own, and a bad one does not stop the others --
 * see `lib/sets/batch.ts` for why that is the right shape and for the one
 * exception, two files claiming the same slug.
 */
export async function importSetAction(formData: FormData): Promise<ImportState> {
  const session = await requireAdmin();

  const pasted = String(formData.get('pasted') ?? '').trim();
  const mode: ImportMode = formData.get('mode') === 'replace' ? 'replace' : 'merge';

  const inputs: SetInput[] = [];
  if (pasted) {
    inputs.push({ name: 'pasted', text: pasted });
  } else {
    // getAll, not get: a `multiple` input sends one entry per file, and `get`
    // would quietly import the first and drop the rest.
    for (const upload of formData.getAll('file')) {
      if (upload instanceof File && upload.size > 0) {
        inputs.push({ name: upload.name, text: await upload.text() });
      }
    }
  }

  if (inputs.length === 0) {
    return {
      kind: 'nothing',
      message: 'Nothing to import — choose one or more files, or paste the JSON.',
    };
  }

  const entries = parseBatch(inputs);
  const files: FileResult[] = [];
  const imported: string[] = [];

  // Sequential on purpose. These are writes against the same tables, and a
  // report that reads in the order the files were listed is worth more than
  // the second or two concurrency would save.
  for (const entry of entries) {
    if (!entry.ok) {
      files.push(asFileResult(entry));
      continue;
    }

    const result = await importSet(entry.set, session.user.id, mode);
    if (!result.ok) {
      files.push({ name: entry.name, ok: false, message: result.message });
      continue;
    }

    files.push({ name: entry.name, ok: true, report: result.report });
    imported.push(result.report.slug);
  }

  if (imported.length > 0) {
    revalidatePath('/admin/sets');
    revalidatePath('/sets');
    for (const slug of imported) revalidatePath(`/sets/${slug}`);
  }

  return { kind: 'results', files };
}

/**
 * A failed batch entry is already the shape of a failed result.
 *
 * Not a cast: the two types are structurally the same today, and writing the
 * conversion out means the compiler says so if one of them changes.
 */
function asFileResult(entry: FailedEntry): FileResult {
  return 'problems' in entry
    ? { name: entry.name, ok: false, problems: entry.problems }
    : { name: entry.name, ok: false, message: entry.message };
}
