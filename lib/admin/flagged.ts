/**
 * The flagged queue: every stored field value somebody has doubted.
 *
 * `status: 'flagged'` means *somebody thinks this value is wrong*. It is a
 * to-do, and the value is **still studied** while it sits there -- which is the
 * whole reason this screen has to exist. A flag with no queue behind it is a
 * doubt recorded and then forgotten, and the browse filter has offered
 * *Flagged* since phase 7 with no screen to send anyone to.
 *
 * **Ordered by what it costs to leave wrong**, which is the same rule the
 * dosing bench uses: a field that has actually been asked of somebody leads,
 * because that is where a doubtful value has already reached a person. Among
 * fields asked the same number of times, the ones asked most recently lead --
 * a flag on something that came up yesterday is more urgent than one on
 * something last seen in October. Everything untouched falls back to
 * alphabetical, which is where the queue starts life.
 *
 * Only *stored* fields can appear. The core fields live in their own columns
 * and carry no per-value status, so there is nothing there to flag.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import type { FieldValue } from '@/db/schema';
import { drugs, quizAnswers } from '@/db/schema';
import { setDrugField, type Result } from '@/lib/drugs/mutations';
import { formatFieldValue } from '@/lib/fields/format';
import { listFieldDefs, type FieldDef } from '@/lib/fields/registry';

export type FlaggedRow = {
  drugId: string;
  slug: string;
  generic: string;
  fieldKey: string;
  fieldLabel: string;
  /** Rendered the way the profile renders it, so the queue shows what a reader sees. */
  text: string;
  /** What the value was read off, where anything said so. */
  source: string | null;
  updatedAt: string | null;
  /** How many quiz questions have been keyed on this drug-and-field. */
  asked: number;
  /** When it was last asked, or null if it never has been. */
  lastAsked: Date | null;
  /** Whether the field is asked at all -- class and route are not. */
  quizzable: boolean;
};

export type FlaggedCounts = {
  /** Flagged values. */
  values: number;
  /** Drugs carrying at least one. */
  drugs: number;
  /** Of those values, how many have reached somebody in a quiz. */
  asked: number;
  /** Flagged values on fields that are never asked -- a profile problem, not a quiz one. */
  unquizzable: number;
};

/**
 * Finds the flagged values in SQL rather than by walking 236 drugs in JS.
 *
 * `browse.ts` does walk them, and is right to: it needs every field of every
 * drug anyway to compute the gaps. Here the answer is a handful of rows out of
 * a few thousand values, and `jsonb_each` with a status test is the query the
 * question actually is.
 *
 * Raw, because Drizzle's builder cannot express a lateral over a jsonb column:
 * putting the table in a `sql` FROM makes it invisible to the select, which
 * fails with "the table drugs is not part of the query". The same place
 * migration 0010 ended up for its `coalesce` index -- written out, and pinned
 * by a test rather than by the type system.
 */
async function flaggedValues() {
  return db.execute<{
    drug_id: string;
    slug: string;
    generic_name: string;
    field_key: string;
    value: { value?: string | null; status?: string; source?: string | null; updatedAt?: string | null } | null;
  }>(sql`
    select d.id as drug_id, d.slug, d.generic_name,
           entry.key as field_key, entry.value as value
    from ${drugs} d, jsonb_each(d.fields) as entry(key, value)
    where entry.value->>'status' = 'flagged'
    order by d.generic_name, entry.key
  `);
}

/** Asked-count and last-asked per (drug, field), in one pass over the answers. */
async function askedByField(drugIds: string[]) {
  if (drugIds.length === 0) return new Map<string, { asked: number; lastAsked: Date | null }>();

  const rows = await db
    .select({
      drugId: quizAnswers.drugId,
      fieldKey: quizAnswers.fieldKey,
      asked: sql<number>`count(*)::int`,
      // `mapWith` and not a bare `sql<Date>`: that is only a type assertion,
      // and the driver hands an aggregate back as a string -- which reached
      // the sort as `.getTime is not a function`. This reuses the column's
      // own decoder.
      lastAsked: sql`max(${quizAnswers.answeredAt})`.mapWith(quizAnswers.answeredAt),
    })
    .from(quizAnswers)
    .where(and(inArray(quizAnswers.drugId, drugIds), sql`${quizAnswers.fieldKey} is not null`))
    .groupBy(quizAnswers.drugId, quizAnswers.fieldKey);

  const by = new Map<string, { asked: number; lastAsked: Date | null }>();
  for (const row of rows) {
    by.set(`${row.drugId}:${row.fieldKey}`, { asked: row.asked, lastAsked: row.lastAsked });
  }
  return by;
}

/**
 * The value as a reader sees it, flattened to one string for a queue row.
 *
 * Every arm of `FormattedField` is handled rather than falling back to a
 * `.text` that only three of them have: a flagged enum or boolean rendering as
 * an empty row would make the queue look like it had nothing to show.
 */
function textOf(def: FieldDef | undefined, value: unknown): string {
  if (!def) {
    // No definition to format against, so show the raw string rather than
    // nothing -- the value is still on the drug's profile.
    const raw = (value as { value?: unknown } | null)?.value;
    return typeof raw === 'string' ? raw : '';
  }

  const formatted = formatFieldValue(def, value as FieldValue | undefined);
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

export async function flaggedQueue(): Promise<FlaggedRow[]> {
  const [values, defs] = await Promise.all([flaggedValues(), listFieldDefs()]);
  const byKey = new Map(defs.map((def) => [def.key, def]));
  const asked = await askedByField([...new Set(values.map((row) => row.drug_id))]);

  const rows: FlaggedRow[] = values.map((row) => {
    const def = byKey.get(row.field_key);
    const stat = asked.get(`${row.drug_id}:${row.field_key}`);
    const value = row.value;

    return {
      drugId: row.drug_id,
      slug: row.slug,
      generic: row.generic_name,
      fieldKey: row.field_key,
      // A field deleted from the registry can still have a flagged value
      // behind it. Showing the bare key is better than hiding the row: the
      // value is still on the profile.
      fieldLabel: def?.label ?? row.field_key,
      text: textOf(def, row.value),
      source: value?.source ?? null,
      updatedAt: value?.updatedAt ?? null,
      asked: stat?.asked ?? 0,
      lastAsked: stat?.lastAsked ?? null,
      quizzable: def?.isQuizzable ?? false,
    };
  });

  return rows.sort((a, b) => {
    if (b.asked !== a.asked) return b.asked - a.asked;
    const at = a.lastAsked?.getTime() ?? 0;
    const bt = b.lastAsked?.getTime() ?? 0;
    if (bt !== at) return bt - at;
    return a.generic.localeCompare(b.generic) || a.fieldLabel.localeCompare(b.fieldLabel);
  });
}

export async function flaggedCounts(): Promise<FlaggedCounts> {
  const rows = await flaggedQueue();
  return {
    values: rows.length,
    drugs: new Set(rows.map((row) => row.drugId)).size,
    asked: rows.filter((row) => row.asked > 0).length,
    unquizzable: rows.filter((row) => !row.quizzable).length,
  };
}

/**
 * "I looked, and this value is fine."
 *
 * Clears the doubt and leaves the value exactly as it was -- which is the
 * common outcome, because a flag is a question and most questions resolve to
 * *no change needed*. It goes through `setDrugField`, the drug editor's own
 * writer, so the clearing is audited like any other edit and this screen never
 * becomes a second way for a field to reach the database.
 *
 * Fixing a value is deliberately **not** here. That needs the typed input the
 * field's own editor has -- an enum picker, a list box, a markdown area with a
 * preview -- and a second implementation of those on a queue screen would be
 * two editors disagreeing about what a value may be. The row links to the
 * editor instead.
 */
export async function clearFlag(
  slug: string,
  fieldKey: string,
  actorId: string,
): Promise<Result> {
  const [drug] = await db.select().from(drugs).where(eq(drugs.slug, slug));
  if (!drug) return { ok: false, message: 'That drug no longer exists.' };

  const current = drug.fields[fieldKey];
  if (!current) return { ok: false, message: 'That field has no value to unflag.' };
  if (current.status !== 'flagged') return { ok: true };

  const defs = await listFieldDefs();
  const def = defs.find((each) => each.key === fieldKey);
  if (!def) return { ok: false, message: 'That field is no longer defined.' };

  return setDrugField(
    slug,
    def,
    { key: fieldKey, value: current.value ?? '', source: current.source ?? '', status: 'ok' },
    actorId,
  );
}
