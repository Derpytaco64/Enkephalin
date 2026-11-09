/**
 * Setting one field across many drugs at once.
 *
 * The case it exists for is the one the sheet keeps producing: a field that is
 * the *same answer* for most of the list. A black box warning most drugs do
 * not have, a route the sheet never stated for eighteen of them. Opening 180
 * drug editors to record *none* 180 times is how a true fact stays unrecorded,
 * and an unrecorded *none* is indistinguishable from a gap -- which is the one
 * confusion the whole field system is built to avoid.
 *
 * **Every write goes through `setDrugField`**, one drug at a time, so a bulk
 * set is exactly a stack of ordinary edits: same validation, same per-drug
 * audit row, same `updatedBy`. There is no bulk path into the database, which
 * is deliberate -- a second writer that skipped the field's own rules would be
 * the fastest way to put 236 bad values somewhere.
 *
 * **The roster shows what each drug holds now**, because the dangerous half of
 * a bulk set is not what it writes, it is what it overwrites. A screen that
 * took a value and a count of drugs would be a loaded gun; one that shows the
 * current value beside every tick is a review.
 */
import { asc } from 'drizzle-orm';
import { db } from '@/db';
import { drugs } from '@/db/schema';
import { setDrugField, type FieldInput, type Result } from '@/lib/drugs/mutations';
import { formatFieldValue } from '@/lib/fields/format';
import { listFieldDefs, type FieldDef } from '@/lib/fields/registry';

export type BulkTarget = {
  slug: string;
  generic: string;
  drugClass: string | null;
  /** What this drug holds for the chosen field, as a reader sees it. */
  current: string;
  /** True where there is no value and no explicit "none" -- a genuine gap. */
  empty: boolean;
  /** True where a person has edited this value, so overwriting undoes their work. */
  humanSet: boolean;
  status: string | null;
};

export type BulkOutcome = {
  changed: string[];
  /** Already held exactly this value, so nothing was written. */
  unchanged: string[];
  failed: { slug: string; message: string }[];
};

/** The fields a bulk set may touch: stored ones, since core fields are columns. */
export function bulkFields(defs: FieldDef[]): FieldDef[] {
  return defs.filter((def) => !def.isCore);
}

function textOf(def: FieldDef, value: Parameters<typeof formatFieldValue>[1]): string {
  const formatted = formatFieldValue(def, value);
  switch (formatted.kind) {
    case 'missing': return '';
    case 'none': return 'None';
    case 'list': return formatted.items.join('; ');
    case 'markdown': return formatted.paragraphs.join(' ');
    case 'enum': return formatted.option;
    case 'bool': return formatted.value ? 'Yes' : 'No';
    default: return formatted.text;
  }
}

export async function bulkTargets(def: FieldDef): Promise<BulkTarget[]> {
  const rows = await db
    .select({
      slug: drugs.slug,
      generic: drugs.genericName,
      drugClass: drugs.drugClass,
      fields: drugs.fields,
    })
    .from(drugs)
    .orderBy(asc(drugs.genericName));

  return rows.map((row) => {
    const value = row.fields[def.key];
    const formatted = formatFieldValue(def, value);
    return {
      slug: row.slug,
      generic: row.generic,
      drugClass: row.drugClass,
      current: textOf(def, value),
      empty: formatted.kind === 'missing',
      humanSet: Boolean(value?.updatedBy),
      status: value?.status ?? null,
    };
  });
}

/**
 * Applies one value to each named drug, reporting per drug.
 *
 * Sequential rather than concurrent on purpose. These are 236 short writes at
 * worst, each one also re-parsing its dosing where that is the field, and the
 * useful property is that the audit log reads in the order somebody chose --
 * not that the whole thing finishes 200ms sooner.
 *
 * A drug that already holds the value is reported as unchanged rather than
 * counted as written: `setDrugField` returns early without touching it, and
 * saying "180 changed" when 179 of them already agreed would make the screen
 * a liar.
 */
export async function setFieldAcross(
  def: FieldDef,
  slugs: string[],
  input: Omit<FieldInput, 'key'>,
  actorId: string,
): Promise<BulkOutcome> {
  const outcome: BulkOutcome = { changed: [], unchanged: [], failed: [] };

  const targets = await bulkTargets(def);
  const before = new Map(targets.map((row) => [row.slug, row]));
  const wanted = input.value.trim();

  for (const slug of slugs) {
    const was = before.get(slug);
    if (!was) {
      outcome.failed.push({ slug, message: 'No such drug.' });
      continue;
    }

    const result: Result = await setDrugField(
      slug,
      def,
      { key: def.key, value: input.value, source: input.source, status: input.status },
      actorId,
    );

    if (!result.ok) {
      outcome.failed.push({ slug, message: result.message ?? 'Refused.' });
      continue;
    }

    // Compared on the rendered value, which is what the roster showed and
    // what the person was deciding against.
    const same = textOf(def, {
      value: wanted || null,
      status: (input.status || was.status || 'ok') as never,
      source: null,
      updatedAt: '',
      updatedBy: null,
    }) === was.current;

    if (same) outcome.unchanged.push(slug);
    else outcome.changed.push(slug);
  }

  return outcome;
}
