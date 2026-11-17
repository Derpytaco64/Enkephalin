/**
 * Turns a dosing field written as `- Indication: dose` bullets into the
 * `### Indication` sections the profile folds.
 *
 * Context: a dosing or regimen field folds on its headings -- see PLAN.md, "A
 * regimen folds on its protocols" -- so a drug dosed six ways is six
 * collapsible sections you can land in rather than a wall of bullets. That
 * only happens where the source wrote headings. One lecture import did not:
 * **22 of the 24 values this finds come from Infectious Disease Exam 3**,
 * which wrote every indication as a labelled top-level bullet instead. The
 * information is identical and the reading is much worse, and it is worse
 * exactly where there is most of it (doxycycline V-5 has seven).
 *
 *   node --experimental-strip-types scripts/dosing-sections.ts <backup.json>
 *   node --experimental-strip-types scripts/dosing-sections.ts <backup.json> --write
 *
 * Dry-run unless `--write`, and the result is written beside the original as
 * `<name>.sections.json` unless `--out` says otherwise -- never over the
 * original, which is the thing you fall back to.
 *
 * **It operates on a backup file, not on the database**, so the whole change
 * is a reviewable diff before any of it is live. Restore the result with
 * merge.
 *
 * ## The one judgement it makes
 *
 * A value is converted when **two or more** top-level bullets read as
 * `Label: something`, where the label carries no dose in it -- a label with
 * `mg` or a number in it is a dose that happens to contain a colon, not an
 * indication.
 *
 * Five of the twenty-four have one bullet that is *not* labelled, and those
 * are the whole reason this script prints what it did. A stray bullet cannot
 * stay where it is: everything after a heading belongs to that heading, so
 * leaving oseltamivir's "- Renally adjust" in place files it under
 * *Children*, which is false. There is no position after the last section
 * either -- `groupProse` would put it in that one. So a stray is **hoisted
 * above the first heading**, where `splitSections` leaves it out of every
 * section and the profile shows it always, unfolded. Doxycycline's "With
 * comorbidities... See Regimens." moves up from second place; that is a
 * change of reading order, and it is the reason every hoisted line is printed
 * in full.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** `- Label: the rest`, where the label is short enough to be a name. */
const LABELLED = /^- ([^:]{3,70}): ?(.*)$/;
/** A label with a dose in it is a dose, not an indication. */
const DOSE_IN_LABEL = /\d|\bmg\b|\bmcg\b|\bunits?\b|\bmL\b/i;

const NEWLINE = String.fromCharCode(10);

type Field = { value?: string | null } & Record<string, unknown>;
type Fields = Record<string, Field>;
type Backup = {
  drugs: {
    slug: string;
    fields?: Fields;
    variants?: { variant: string; fields?: Fields }[];
  }[];
};

type Change = {
  where: string;
  sections: string[];
  /** Top-level bullets moved above the first heading, in full. */
  hoisted: string[];
};

/**
 * The value rewritten, or null where there is nothing to do.
 *
 * Sub-bullets ride with the bullet above them: an indented line is the
 * qualifier of the dose it sits under, and it stays in that section.
 */
function toSections(raw: string): { text: string; change: Omit<Change, 'where'> } | null {
  const lines = raw.split(NEWLINE);
  // Already folds, or was never a list.
  if (lines.some((line) => line.startsWith('#'))) return null;

  const tops = lines.filter((line) => line.startsWith('- '));
  const labelled = tops.filter((line) => {
    const match = LABELLED.exec(line);
    return match !== null && !DOSE_IN_LABEL.test(match[1]);
  });
  if (labelled.length < 2) return null;

  const lede: string[] = [];
  const sections: { heading: string; body: string[] }[] = [];
  const hoisted: string[] = [];

  for (const line of lines) {
    if (line.trim() === '') continue;

    const match = line.startsWith('- ') ? LABELLED.exec(line) : null;
    if (match && !DOSE_IN_LABEL.test(match[1])) {
      sections.push({ heading: match[1].trim(), body: match[2].trim() ? [`- ${match[2].trim()}`] : [] });
      continue;
    }

    /*
     * An indented line belongs to the bullet above it, and keeps its indent.
     *
     * De-indenting by one level looked right -- the parent bullet's label has
     * become the heading, so everything under it moves up -- and it is wrong.
     * The parent's *value* is still a bullet in the body: doxycycline's
     * "- 1-2 weeks" with "  - Up to 3-4 weeks if improving" under it is a
     * rule and its exception, and flattened to two siblings it reads as two
     * alternatives.
     */
    if (/^\s/.test(line) && sections.length > 0) {
      sections[sections.length - 1].body.push(line);
      continue;
    }

    // A top-level bullet with no label of its own, or loose prose. Above the
    // first heading it is already a lede and stays one; anywhere else it
    // would be swallowed by the section it follows, so it comes up here.
    if (sections.length > 0) hoisted.push(line);
    lede.push(line);
  }

  const text = [
    ...lede,
    ...sections.flatMap((section) => [`### ${section.heading}`, ...section.body, '']),
  ].join(NEWLINE).trim();

  return { text, change: { sections: sections.map((section) => section.heading), hoisted } };
}

function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error('usage: dosing-sections.ts <backup.json> [--write] [--out <path>]');
    process.exit(1);
  }
  const write = flags.includes('--write');
  const outAt = flags.indexOf('--out');
  const out = outAt >= 0 ? flags[outAt + 1] : file.replace(/\.json$/, '') + '.sections.json';

  const backup = JSON.parse(readFileSync(file, 'utf8')) as Backup;
  const changes: Change[] = [];

  for (const drug of backup.drugs) {
    const places: { where: string; fields: Fields | undefined }[] = [
      { where: `${drug.slug} V-1`, fields: drug.fields },
      ...(drug.variants ?? []).map((variant, at) => ({
        where: `${drug.slug} V-${at + 2} ${variant.variant}`,
        fields: variant.fields,
      })),
    ];

    for (const place of places) {
      for (const key of ['dosing', 'regimen']) {
        const field = place.fields?.[key];
        const raw = typeof field?.value === 'string' ? field.value : null;
        if (raw === null) continue;

        const result = toSections(raw);
        if (result === null || field === undefined) continue;

        field.value = result.text;
        changes.push({ where: `${place.where} / ${key}`, ...result.change });
      }
    }
  }

  for (const change of changes) {
    console.log(`${change.where}  ->  ${change.sections.length} sections`);
    for (const heading of change.sections) console.log(`      ### ${heading}`);
    for (const line of change.hoisted) console.log(`   HOISTED ABOVE THE SECTIONS: ${line}`);
  }

  const hoisted = changes.reduce((sum, change) => sum + change.hoisted.length, 0);
  console.log();
  console.log(`${changes.length} value(s) rewritten, ${hoisted} line(s) hoisted — read those.`);

  if (!write) {
    console.log('Dry run. Pass --write to produce the corrected file.');
    return;
  }
  writeFileSync(out, JSON.stringify(backup, null, 2));
  console.log(`Wrote ${out}`);
}

main();
