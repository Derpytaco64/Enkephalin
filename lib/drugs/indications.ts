/**
 * Indications as a filter axis.
 *
 * Unlike categories, this needs no curated map: the sheet's indication column
 * is already a short controlled vocabulary -- 95 distinct strings over 249
 * rows, "Hypertension" sixteen times and "Depression" fifteen -- so the texts
 * group themselves. What they do not do is agree with themselves about plurals
 * and abbreviations, and a filter is exactly where that bites: picking
 * "Seizure" and silently missing the two drugs the sheet wrote "Seizures" for
 * is a wrong deck, not an untidy one.
 *
 * So `ALIASES` folds the handful of same-phrase variants together, and nothing
 * else. Anything that needs a judgement about what a phrase *means* is left
 * alone -- "Chronic pain" stays apart from "Pain", "Acute ischemic stroke"
 * from "Ischemic stroke prevention" -- because that is a clinical claim and
 * this file is not where one gets made. The drug's own profile always shows
 * the sheet's wording; only the filter groups.
 *
 * Client-safe: no database imports, so the picker and the editor derive the
 * same slug from the same code rather than agreeing by coincidence. The
 * vocabulary itself is a table since migration 0005 -- see
 * lib/drugs/indication-store.ts, which is the only thing that writes to it,
 * and which canonicalises through this file on the way in.
 */

/**
 * Sheet wording -> the one wording to use. Keyed by the exact text, and
 * deliberately short: every entry is the same indication spelled two ways.
 *
 * This is not only a comparison table. Every writer canonicalises through it --
 * the importer, the drug editor, and migration 0004 which rewrote the rows
 * already stored -- so the database holds one spelling and a profile, a filter
 * and a quiz option all read the same words. The table stays because the sheet
 * does not: a re-import would otherwise put the old spelling back.
 *
 * Plural wins where the sheet disagrees with itself, which is the owner's call.
 * BPH is not a plural question: the expansion wins there because it teaches
 * what the abbreviation stands for.
 */
const ALIASES: Record<string, string> = {
  'Bacterial infection': 'Bacterial infections',
  Seizure: 'Seizures',
  BPH: 'Benign prostatic hypertrophy (BPH)',
};

/** The wording an indication is filed under, which may be another row's. */
export function canonicalIndication(text: string): string {
  const trimmed = text.trim();
  return ALIASES[trimmed] ?? trimmed;
}

/**
 * The URL-safe key for an indication. Scope holds these rather than the prose,
 * so a saved session link stays readable and survives the sheet fixing a typo
 * that does not change the slug.
 */
export function indicationSlug(text: string): string {
  return canonicalIndication(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export type IndicationOption = { slug: string; label: string; count: number };

/**
 * Folds the stored `(drugId, slug, label)` rows into the picker's options: one
 * entry per indication, counting drugs rather than rows.
 *
 * Since migration 0005 the slug is stored rather than derived here, so the
 * picker and the deck builder read the same key off the same row instead of
 * agreeing by running the same string function twice. The count is still over
 * a Set, because a drug reached by two different joins is one drug.
 */
export function indicationOptions(
  rows: { drugId: string; slug: string; label: string }[],
): IndicationOption[] {
  const bySlug = new Map<string, { label: string; drugIds: Set<string> }>();

  for (const row of rows) {
    if (!row.slug) continue;

    const entry = bySlug.get(row.slug);
    if (entry) entry.drugIds.add(row.drugId);
    else bySlug.set(row.slug, { label: row.label, drugIds: new Set([row.drugId]) });
  }

  return [...bySlug]
    .map(([slug, entry]) => ({ slug, label: entry.label, count: entry.drugIds.size }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
