/**
 * Indications as a filter axis.
 *
 * Two mechanisms, for two different problems, and the order they were added
 * in is the order the vocabulary grew.
 *
 * **`ALIASES` is for a wording written two ways.** The class sheet's
 * indication column was already a short controlled vocabulary -- 95 distinct
 * strings over 249 rows, "Hypertension" sixteen times -- so the texts grouped
 * themselves, and all they needed was to be made to agree about plurals and
 * abbreviations. A filter is exactly where that bites: picking "Seizure" and
 * silently missing the two drugs the sheet wrote "Seizures" for is a wrong
 * deck, not an untidy one.
 *
 * **`indicationHeads` is for a wording that qualifies a condition**, which is
 * what the lecture imports brought: 730 distinct wordings over 1,266 rows,
 * nine of them gonorrhea and 35 pneumonia. Nothing there is mistyped and
 * nothing is a duplicate, so no alias could help -- what those need is to be
 * grouped without being collapsed, and that is the second half of this file.
 *
 * Neither one makes a judgement about what a phrase *means* on its own.
 * "Chronic pain" stays a different wording from "Pain" and "Acute ischemic
 * stroke" from "Ischemic stroke prevention"; where they share a head, a head
 * is all they share. The drug's own profile always shows the source's wording
 * -- only the grouping groups.
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
 *
 * The second group is the sheet being wrong rather than inconsistent, which is
 * the same kind of fix and belongs in the same place. Two are the PDF breaking
 * a word across a line and the extractor keeping the break; one is a
 * misspelling the sheet itself made. None of them is a judgement about what a
 * phrase means -- that is still refused, and still belongs to the merge screen.
 */
const ALIASES: Record<string, string> = {
  'Bacterial infection': 'Bacterial infections',
  Seizure: 'Seizures',
  BPH: 'Benign prostatic hypertrophy (BPH)',

  // Broken across a line in the source PDF, p6 and p19.
  'Keratoconjuncti vitis sicca (Dry eye syndrome)': 'Keratoconjunctivitis sicca (Dry eye syndrome)',
  'Ophthalmic anti- inflammatory': 'Ophthalmic anti-inflammatory',
  // The sheet's own spelling, p12. Pruritus is the word.
  Pruritis: 'Pruritus',
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

/**
 * The closest existing wording to a new one, if it is close enough to be a
 * slip rather than a different indication.
 *
 * Matching by slug catches the near-duplicates that matter and misses nothing:
 * two is a generous distance on a phrase, so "Dyslipidimia" finds
 * "Dyslipidemia" and "Pruritis" finds "Pruritus", while "Chronic pain" stays
 * four away from "Pain" and "Rhinitis" nine from "Allergic rhinitis" -- two
 * genuinely different indications in each case.
 *
 * This only ever *warns*. Folding automatically is the one thing it must not
 * do: nothing here can tell a typo from an indication the vocabulary has not
 * met yet, and a silent fold would quietly file a drug under the wrong
 * condition, which is worse than the untidiness it tidied. The decision stays
 * with the person typing, who is the only one who knows which they meant.
 */
export function nearestIndication(
  text: string,
  labels: string[],
): { label: string; distance: number } | null {
  const slug = indicationSlug(text);
  // Below five characters an edit of two is most of the word, so everything
  // looks like everything.
  if (slug.length < 5) return null;

  let best: { label: string; distance: number } | null = null;
  for (const label of labels) {
    const other = indicationSlug(label);
    if (other === slug) return null; // not new at all
    // Lengths this far apart cannot be within the budget, and the check is
    // free next to the matrix.
    if (Math.abs(other.length - slug.length) > 2) continue;

    const distance = editDistance(slug, other);
    if (distance <= 2 && (best === null || distance < best.distance)) {
      best = { label, distance };
    }
  }
  return best;
}

/** Levenshtein, one row at a time: the strings are short and there are ~92. */
function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }

  return previous[b.length];
}

/* --------------------------------------------- heads and qualifiers ----- */

/**
 * Condition names to group under even where the vocabulary holds no such
 * entry of its own.
 *
 * The containment rule in `indicationHeads` can only nominate a head it can
 * *see* -- a label that occurs inside another label -- which covers most of
 * the library and misses two shapes badly.
 *
 * Oncology is the first. It writes the stage, the mutation and the line of
 * therapy into the indication, so the bare condition is never a label of its
 * own: 66 non-small cell lung cancer indications sat under 40 different heads,
 * not one of which was lung cancer. The second is a condition the sources name
 * two ways where neither spelling contains the other as a *word* --
 * "rhinosinusitis" is one word, so no amount of boundary matching finds
 * "sinusitis" inside it.
 *
 * Every entry is a clinical statement, which is why they are written out here
 * rather than inferred: a rule that folded "Chronic pain" into "Pain" by
 * measuring string distance would fold "Rhinitis" into "Allergic rhinitis"
 * just as readily, and `nearestIndication` refuses that for the same reason.
 * Matched longest first, so "non-small cell lung cancer" is never read as the
 * "small cell lung cancer" sitting inside it.
 */
const HEAD_PHRASES: { phrase: string; head: string }[] = [
  { phrase: 'non-small cell lung cancer', head: 'Non-small cell lung cancer (NSCLC)' },
  { phrase: 'small cell lung cancer', head: 'Small cell lung cancer (SCLC)' },
  { phrase: 'colorectal cancer', head: 'Colorectal cancer' },
  { phrase: 'ovarian cancer', head: 'Ovarian cancer' },
  { phrase: 'melanoma', head: 'Melanoma' },
  { phrase: 'rhinosinusitis', head: 'Sinusitis' },
  // "Skin infections" and "Skin and soft tissue infections" are one axis
  // written two ways, and the longer one is the wording the guidelines use.
  { phrase: 'skin and soft tissue infection', head: 'Skin and soft tissue infections' },
  { phrase: 'skin infection', head: 'Skin and soft tissue infections' },
  // Expedited partner therapy is how a drug is given, not what it treats, and
  // it is a label in its own right -- so without these it wins the position
  // tie below and takes two infections with it.
  { phrase: 'expedited partner therapy for gonorrhea', head: 'Gonorrhea' },
  { phrase: 'expedited partner therapy for chlamydia', head: 'Chlamydia' },
];

/**
 * Plural-insensitive lower case, so "Skin and soft tissue infections" is found
 * inside "...skin and soft tissue infection due to MSSA".
 *
 * Only words of four letters or more lose a trailing s: taking it off "signs"
 * is harmless, taking it off "as" is not.
 */
function foldPlurals(text: string): string {
  return text.toLowerCase().replace(/([a-z]{3,})s(?![a-z])/g, '$1');
}

/**
 * Where `needle` sits inside `haystack` as a phrase, or -1.
 *
 * Boundaries on both sides, and a **hyphen counts as part of a word** on the
 * left: without that, "small cell lung cancer" matches inside "non-small cell
 * lung cancer" and every NSCLC indication files itself under SCLC, which is a
 * different disease with a different treatment.
 */
function phraseAt(haystack: string, needle: string): number {
  const pattern = new RegExp(
    `(?<![a-z0-9-])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`,
  );
  return foldPlurals(haystack).search(pattern);
}

/**
 * Every label's head, by the one rule there is.
 *
 * **The vocabulary names its own heads.** A label that turns up inside another
 * label is a condition the library already treats as a thing -- "Gonorrhea"
 * inside "Gonorrhea in pregnancy", "Otitis media" inside "Acute otitis media
 * (first line in children)" -- so no curated list of conditions is needed for
 * the 95 heads the library found that way, and none can go stale as the
 * vocabulary grows. `HEAD_PHRASES` adds only what containment cannot see.
 *
 * Nominations are settled by **position, earliest first**, because a clinical
 * phrase names its condition before it qualifies it. That one rule is what
 * stops "Severe purulent skin and soft tissue infection (failed incision and
 * drainage plus oral antibiotics)" being filed under *Antibiotic*, which is a
 * real label, genuinely present, and 87 characters in. Ties go to
 * `HEAD_PHRASES`, then to the longer phrase.
 *
 * Chains are followed to their root, so a head is always a condition and never
 * another qualified indication: *Adjunct for hypoxemic Pneumocystis
 * pneumonia* nominates *Pneumocystis pneumonia*, which nominates *Pneumonia*,
 * and the drug is reachable by picking the condition anybody would think to
 * pick.
 */
export function indicationHeads(labels: string[]): Map<string, string> {
  const unique = [...new Set(labels.map((label) => canonicalIndication(label)))];

  /*
   * Only short labels can be heads. A condition is a phrase, not a sentence,
   * and the cut is what keeps this from being 730 x 730 regexes on every call:
   * it leaves around 150 candidates, and no label it drops was ever going to
   * win on position anyway.
   */
  const short = unique.filter((label) => label.split(/\s+/).length <= 7);
  const candidates = short.filter(
    (label) => unique.some((other) => other !== label && phraseAt(other, foldPlurals(label)) >= 0),
  );

  const phrases = [...HEAD_PHRASES].sort((a, b) => b.phrase.length - a.phrase.length);

  /** The head this label nominates for itself, or null to be its own. */
  const nominate = (label: string): string | null => {
    type Bid = { at: number; curated: boolean; length: number; head: string };
    const bids: Bid[] = [];

    for (const { phrase, head } of phrases) {
      const at = phraseAt(label, foldPlurals(phrase));
      // A label that *is* the head keeps it, rather than nominating itself.
      if (at >= 0 && head !== label) {
        bids.push({ at, curated: true, length: phrase.length, head });
      }
    }
    for (const candidate of candidates) {
      if (candidate === label) continue;
      const at = phraseAt(label, foldPlurals(candidate));
      if (at >= 0) bids.push({ at, curated: false, length: candidate.length, head: candidate });
    }
    if (bids.length === 0) return null;

    bids.sort((a, b) => a.at - b.at
      || Number(b.curated) - Number(a.curated)
      || b.length - a.length);
    return bids[0].head;
  };

  const nominated = new Map<string, string | null>();
  for (const label of unique) nominated.set(label, nominate(label));

  // Follow each chain to its root. `seen` is the cycle guard: two labels can
  // nominate each other once `HEAD_PHRASES` is in play, and a quiz page is not
  // the place to find out.
  const heads = new Map<string, string>();
  for (const label of unique) {
    let head = label;
    const seen = new Set<string>([label]);
    for (;;) {
      const next = nominated.get(head) ?? null;
      if (next === null || seen.has(next)) break;
      seen.add(next);
      head = next;
    }
    heads.set(label, head);
  }
  return heads;
}

/**
 * What a label says *beyond* its head, where that can be read off cleanly.
 *
 * Only a head at the very start or the very end is removed. Cutting one out of
 * the middle reads as damage -- "Uncomplicated gonorrhea (first line)" becomes
 * "Uncomplicated (first line)" -- so that case returns null and the caller
 * shows the label whole, which is never wrong, only longer.
 *
 * The connective left behind goes with it: "Expedited partner therapy for
 * gonorrhea" is qualified by "Expedited partner therapy", not by "Expedited
 * partner therapy for".
 */
export function qualifierOf(label: string, head: string): string | null {
  const text = canonicalIndication(label);
  const lower = text.toLowerCase();
  const needle = head.toLowerCase();

  /*
   * Matched verbatim here rather than through `foldPlurals`, unlike
   * `indicationHeads`. Folding changes the length of the string, so an offset
   * measured in the folded text cannot be used to cut the real one, and a
   * qualifier is the one place the exact characters matter. The cost is that
   * "...infections" against a singular head returns null and the label shows
   * whole -- which is the safe direction.
   */
  const rest = lower.startsWith(needle)
    ? text.slice(needle.length)
    : (lower.endsWith(needle) ? text.slice(0, text.length - needle.length) : '');

  /*
   * Brackets are left alone on purpose. Stripping them by character class ate
   * the closing one off "alternative to ceftriaxone (with azithromycin)",
   * which is a worse read than the punctuation it tidied.
   *
   * The connective only goes where the head was *last*: "Expedited partner
   * therapy for gonorrhea" is qualified by "Expedited partner therapy", not by
   * "...for". Where the head came first the connective is the qualifier's own
   * first word and carries its meaning -- "in pregnancy" and "when chlamydia
   * has not been ruled out" say more than "pregnancy" and "chlamydia has not
   * been ruled out".
   */
  const trimmed = (lower.startsWith(needle)
    ? rest.replace(/^[\s,:;-]+/, '')
    : rest.replace(/[\s,:;-]+$/, '').replace(/\s*\b(?:for|in|with|when|of|due to|after)$/i, ''))
    .trim();

  return trimmed.length > 0 ? trimmed : null;
}

export type IndicationOption = {
  slug: string;
  label: string;
  count: number;
  /**
   * The ways this condition is written up, where it is written up more than
   * one way -- longest-serving first, then alphabetical.
   *
   * The picker shows them under the head, so a reader can see that *Pneumonia*
   * covers CAP, HAP/VAP and PJP before ticking it. Empty where the head is the
   * only wording there is, which is most of the vocabulary.
   */
  qualifiers: string[];
};

/**
 * Folds the stored `(drugId, slug, label)` rows into the picker's options:
 * **one entry per condition**, counting drugs rather than rows.
 *
 * This used to be one entry per *label*, which was right while the vocabulary
 * was the class sheet's 95 short strings and wrong the moment the lectures
 * arrived with 730. Two things went wrong at that size, and the second is the
 * serious one. A list of 730 options is not a list anybody reads -- 68% of
 * them were worth a single drug. And picking one of them *narrowed to that
 * one wording*: typing "pneumonia" offered 35 suggestions for one condition,
 * and taking any of them turned a 41-drug deck into a 1-drug deck. A
 * suggestion list that punishes you for using it is worse than none.
 *
 * So the options are heads -- see `indicationHeads` -- and every label under a
 * head rides along. The count is over a Set of drug ids, because one drug
 * written up for a condition three ways is one drug.
 */
export function indicationOptions(
  rows: { drugId: string; slug: string; label: string }[],
): IndicationOption[] {
  const heads = indicationHeads(rows.map((row) => row.label));

  const byHead = new Map<string, { label: string; drugIds: Set<string>; labels: Set<string> }>();
  for (const row of rows) {
    if (!row.slug) continue;

    const head = heads.get(canonicalIndication(row.label)) ?? row.label;
    const slug = indicationSlug(head);
    const entry = byHead.get(slug);
    if (entry) {
      entry.drugIds.add(row.drugId);
      entry.labels.add(row.label);
    } else {
      byHead.set(slug, {
        label: head, drugIds: new Set([row.drugId]), labels: new Set([row.label]),
      });
    }
  }

  return [...byHead]
    .map(([slug, entry]) => ({
      slug,
      label: entry.label,
      count: entry.drugIds.size,
      // The head's own wording is not a qualifier of itself, and a label that
      // reads the same as the head once trimmed is not one either.
      qualifiers: [...entry.labels]
        .filter((label) => label !== entry.label)
        .map((label) => qualifierOf(label, entry.label) ?? label)
        .filter((text, at, all) => all.indexOf(text) === at)
        .sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
