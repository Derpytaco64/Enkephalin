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
 * Client-safe: no database imports, so the picker and the deck builder derive
 * the same slug from the same code rather than agreeing by coincidence.
 */

/**
 * Sheet wording -> the wording to file it under. Keyed by the exact text, and
 * deliberately short: every entry is the same indication spelled two ways.
 */
const ALIASES: Record<string, string> = {
  'Bacterial infections': 'Bacterial infection',
  Seizures: 'Seizure',
  // The sheet gives both the abbreviation alone and the expansion carrying it;
  // the expansion is the better label because it teaches what BPH stands for.
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
 * Folds `(drugId, text)` rows into the picker's options: one entry per slug,
 * labelled with the canonical wording, counting *drugs* rather than rows so a
 * drug written up under both "Seizure" and "Seizures" counts once.
 */
export function indicationOptions(rows: { drugId: string; text: string }[]): IndicationOption[] {
  const bySlug = new Map<string, { label: string; drugIds: Set<string> }>();

  for (const row of rows) {
    const slug = indicationSlug(row.text);
    if (!slug) continue;

    const entry = bySlug.get(slug);
    if (entry) entry.drugIds.add(row.drugId);
    else bySlug.set(slug, { label: canonicalIndication(row.text), drugIds: new Set([row.drugId]) });
  }

  return [...bySlug]
    .map(([slug, entry]) => ({ slug, label: entry.label, count: entry.drugIds.size }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
