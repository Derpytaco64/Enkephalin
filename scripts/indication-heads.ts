/**
 * What every indication in a backup files under, and which ones to look at.
 *
 * Context: the class sheet's indication column was 95 short strings over 249
 * rows, so it grouped itself and needed no curation. The lecture imports made
 * it **730 distinct wordings over 1,266 rows**, 68% of them used exactly once,
 * because a lecture writes the indication as a whole clinical situation --
 * nine wordings of gonorrhea, 35 of pneumonia, 66 of non-small cell lung
 * cancer. Nothing is mistyped and nothing is a duplicate, so no alias table
 * could help and merging them would delete the difference between *Gonorrhea*
 * and *Gonorrhea in pregnancy*.
 *
 * The fix is to group without collapsing: every indication keeps its words and
 * gains a **head**, the condition it is a kind of. See
 * `lib/drugs/indications.ts`, which holds the one rule there is, and PLAN.md,
 * "An indication has a condition and a qualifier".
 *
 *   node --experimental-strip-types scripts/indication-heads.ts <backup.json>
 *   node --experimental-strip-types scripts/indication-heads.ts <backup.json> --all
 *
 * **It reports and writes nothing.** There is nothing to write: the head is
 * derived from the labels rather than stored, so a backup restored into a
 * build that has this grouping comes up grouped, and a backup made before it
 * is not missing anything. What this is for is the other half -- reading the
 * 343 decisions the rule just made, and finding the ones that are wrong. A
 * wording filed under the wrong condition is a wording nobody will find, and
 * the only way to notice is to look at the two side by side.
 *
 * `--all` lists every head; the default lists only those carrying more than
 * one wording, which are the ones where the grouping did any work. The last
 * section is the one to read first: wordings whose head is a *strategy* rather
 * than a condition, which is the mistake the import guide now has a rule
 * about.
 */
import { readFileSync } from 'node:fs';
import { indicationHeads, indicationOptions } from '../lib/drugs/indications.ts';

/**
 * Words that say how a drug is given rather than what it treats.
 *
 * Matched only where one **leads** the head, which is the whole signal:
 * "Expedited partner therapy for gonorrhea" files under *Expedited partner
 * therapy* and takes a sexually transmitted infection with it, while
 * "Influenza prophylaxis" and "Necrotizing fasciitis, empiric, with
 * cefotaxime" name their condition first and are fine. Matching anywhere in
 * the head flagged 22 wordings, nearly all of them correct, which is a report
 * nobody reads twice.
 *
 * "Prevention of" is deliberately absent. It leads a dozen heads and every one
 * of them is a real indication -- *Prevention of niacin flushing* is what the
 * drug is for, not how it is given.
 */
const STRATEGY_LEDE = [
  'expedited partner therapy', 'step-down', 'empiric', 'defined therapy', 'targeted therapy',
  'adjunct', 'inhaled adjunct', 'monotherapy', 'switch', 'premedication', 'desensitization',
];

function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error('usage: indication-heads.ts <backup.json> [--all]');
    process.exit(1);
  }
  const all = flags.includes('--all');

  const backup = JSON.parse(readFileSync(file, 'utf8')) as {
    drugs: { slug: string; indications?: string[] }[];
  };

  const rows = backup.drugs.flatMap((drug) =>
    (drug.indications ?? []).map((label) => ({ drugId: drug.slug, slug: '', label })));
  const labels = [...new Set(rows.map((row) => row.label))];
  const heads = indicationHeads(labels);
  // The options are what a picker offers, so reporting them rather than the
  // raw grouping is reporting what a reader will actually see.
  const options = indicationOptions(rows.map((row) => ({ ...row, slug: 'x' })));

  console.log(`${rows.length} indication rows, ${labels.length} distinct wordings`);
  console.log(`${options.length} conditions to pick from `
    + `(${options.filter((option) => option.qualifiers.length > 0).length} of them grouping `
    + 'more than one wording)');
  console.log();

  const shown = all ? options : options.filter((option) => option.qualifiers.length > 0);
  for (const option of [...shown].sort((a, b) => b.count - a.count)) {
    console.log(`${String(option.count).padStart(3)} drugs  ${option.label}`);
    for (const qualifier of option.qualifiers) console.log(`           - ${qualifier}`);
  }

  const strategic = labels.filter((label) => {
    const head = (heads.get(label) ?? label).toLowerCase();
    return STRATEGY_LEDE.some((word) => head.startsWith(word));
  });
  console.log();
  console.log(`--- ${strategic.length} wording(s) filed under a strategy rather than a condition`);
  for (const label of strategic) console.log(`    [${heads.get(label)}]  ${label}`);
  if (strategic.length > 0) {
    console.log();
    console.log('    Each of these needs the condition moved to the front of the wording, or');
    console.log('    a HEAD_PHRASES entry in lib/drugs/indications.ts saying what it is for.');
  }
}

main();
