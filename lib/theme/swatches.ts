/**
 * Everything on an axis that has a colour, with the colour it currently wears.
 *
 * The list is read from the data rather than kept anywhere: the classes are
 * whatever the drugs say they are, and a palette with entries for classes
 * nobody carries would be a list of colours for nothing.
 */
import { asc, count, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { drugTags, drugs, tags } from '@/db/schema';
import { colorFor, paletteKey, type ColorAxis } from './palette';

export type Swatch = {
  /** How the override is addressed, as `paletteKey` builds it. */
  key: string;
  label: string;
  /** How many drugs wear it, so a colour worth choosing is obvious. */
  drugs: number;
  color: string;
  /** Whether this colour was chosen rather than assigned. */
  overridden: boolean;
};

/** The schedules in ordinal order, with "not controlled" last. */
const SCHEDULE_ORDER = ['CII', 'CIII', 'CIV', 'CV'];

export async function listSwatches(
  axis: ColorAxis,
  overrides: Record<string, string>,
): Promise<Swatch[]> {
  if (axis === 'none') return [];

  const swatch = (key: string, label: string, drugCount: number, subject: Parameters<typeof colorFor>[1]): Swatch => ({
    key,
    label,
    drugs: drugCount,
    color: colorFor(axis, subject, overrides) ?? '#000000',
    overridden: key in overrides,
  });

  if (axis === 'schedule') {
    const rows = await db
      .select({ schedule: drugs.schedule, drugs: count(drugs.id) })
      .from(drugs)
      .groupBy(drugs.schedule);
    const counted = new Map(rows.map((row) => [row.schedule ?? 'none', Number(row.drugs)]));

    // Every schedule the vocabulary has, present in the data or not: a palette
    // you can only edit where drugs happen to exist is a palette that changes
    // shape as the content does.
    return [
      ...SCHEDULE_ORDER.map((schedule) => swatch(
        paletteKey('schedule', schedule),
        schedule,
        counted.get(schedule) ?? 0,
        { schedule },
      )),
      swatch(paletteKey('schedule', 'none'), 'Not controlled', counted.get('none') ?? 0, {
        schedule: null,
      }),
    ];
  }

  if (axis === 'class') {
    const rows = await db
      .select({ label: drugs.drugClass, drugs: count(drugs.id) })
      .from(drugs)
      .where(isNotNull(drugs.drugClass))
      .groupBy(drugs.drugClass)
      .orderBy(asc(drugs.drugClass));

    return rows
      .filter((row): row is { label: string; drugs: number } => Boolean(row.label))
      .map((row) => swatch(
        paletteKey('class', row.label),
        row.label,
        Number(row.drugs),
        { drugClass: row.label },
      ));
  }

  const rows = await db
    .select({ slug: tags.slug, label: tags.label, drugs: count(drugTags.drugId) })
    .from(tags)
    .leftJoin(drugTags, eq(drugTags.tagId, tags.id))
    .groupBy(tags.slug, tags.label)
    .orderBy(asc(tags.label));

  return rows.map((row) => swatch(
    paletteKey('tag', row.slug),
    row.label,
    Number(row.drugs),
    { tags: [row.slug] },
  ));
}

/**
 * A handful of drugs to show the axis on, so a colour choice can be seen
 * where it will be used rather than only as a square.
 *
 * Deliberately the same handful every time. A preview that reshuffled on each
 * render would make two colours impossible to compare, which is the one thing
 * a preview is for.
 */
export async function sampleDrugs(limit = 6) {
  return db
    .select({
      slug: drugs.slug,
      generic: drugs.genericName,
      drugClass: drugs.drugClass,
      schedule: drugs.schedule,
    })
    .from(drugs)
    // Controlled first, so the schedule axis has something to show.
    .orderBy(sql`${drugs.schedule} nulls last`, asc(drugs.genericName))
    .limit(limit);
}
