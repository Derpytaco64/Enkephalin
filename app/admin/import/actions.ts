'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import {
  applyDrugImport, planDrugImport, type ImportPlan, type ImportReport,
} from '@/lib/drugs/import';
import {
  applyFieldMap, likeliestField, parseDrugImport, WRITE_MODES,
  type ImportProblem, type WriteMode,
} from '@/lib/drugs/import-format';

/** A field the file asks for that the database has not got. */
export type AskedField = { key: string; label: string; suggest: string | null };

export type ImportState =
  | { kind: 'idle' }
  | { kind: 'problems'; problems: ImportProblem[] }
  /**
   * `asked` and `map` travel with the plan because the plan has already had
   * the mapping applied to it: a field sent to an existing one is no longer
   * declared, so it is gone from `plan.declare`. Without these two the
   * dropdown that did the sending would disappear from the screen on the next
   * Check, and the choice would be silently forgotten between checking and
   * importing -- which is the one thing this control exists to prevent.
   */
  | { kind: 'plan'; plan: ImportPlan; asked: AskedField[]; map: Record<string, string> }
  | { kind: 'done'; report: ImportReport };

/**
 * Check it, then import it, from one form.
 *
 * The two buttons post the same text and differ by `intent`, so what gets
 * imported is always the text in the box rather than a plan held somewhere
 * from a minute ago. `applyDrugImport` re-plans against the database for the
 * same reason: a preview is a screenshot, not a lock.
 *
 * `write` comes from the screen when the screen sent one, overriding the
 * file's own. Whether a lecture fills gaps or becomes an alternate profile is
 * a decision about *this* database -- the file's author only read a deck -- so
 * it belongs to the person watching the preview, and it has to be changeable
 * without editing the JSON by hand.
 *
 * `field_map` is the same idea for the fields a file declares: the author asks
 * for *Adverse effects*, and the person importing either creates it or sends it
 * to the field that already means that. Applied as a rewrite of the file before
 * anything is planned, so the preview shown is the preview of what will happen.
 */
export async function importDrugsAction(formData: FormData): Promise<ImportState> {
  const session = await requireAdmin();

  const text = String(formData.get('file') ?? '');
  if (text.trim() === '') {
    return { kind: 'problems', problems: [{ where: 'the file', message: 'Paste a file first.' }] };
  }

  const parsed = parseDrugImport(text);
  if (!parsed.ok) return { kind: 'problems', problems: parsed.problems };

  const chosen = String(formData.get('write') ?? '');
  const withMode = (WRITE_MODES as readonly string[]).includes(chosen)
    ? { ...parsed.file, write: chosen as WriteMode }
    : parsed.file;

  // "<declaredKey>:<existingKey>" pairs; an empty target means create it.
  const map: Record<string, string> = {};
  for (const entry of formData.getAll('field_map').map(String)) {
    const at = entry.indexOf(':');
    if (at < 1) continue;
    const target = entry.slice(at + 1);
    if (target !== '') map[entry.slice(0, at)] = target;
  }

  const mapped = applyFieldMap(withMode, map);
  if (!mapped.ok) return { kind: 'problems', problems: mapped.problems };
  const file = mapped.file;

  if (String(formData.get('intent')) !== 'apply') {
    const plan = await planDrugImport(file);
    // Everything the file asked for that the database has not got -- including
    // the ones this mapping has already sent somewhere, so their dropdowns stay
    // on screen with the choice visible.
    const asked: AskedField[] = withMode.declare
      .filter((entry) => !plan.assignable.some((field) => field.key === entry.key))
      .map((entry) => ({
        key: entry.key,
        label: entry.label,
        suggest: likeliestField(entry, plan.assignable),
      }));
    return { kind: 'plan', plan, asked, map };
  }

  const result = await applyDrugImport(file, session.user.id);
  if (!result.ok) return { kind: 'problems', problems: result.problems };

  revalidatePath('/drugs');
  for (const slug of [...result.report.created, ...result.report.updated]) {
    revalidatePath(`/drugs/${slug}`);
  }

  return { kind: 'done', report: result.report };
}
