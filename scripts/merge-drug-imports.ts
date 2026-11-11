/**
 * Merges several `enkephalin.drugs/1` files that scope to the same exam into
 * one file.
 *
 *   npx tsx scripts/merge-drug-imports.ts out.json in1.json in2.json [...]
 *
 * **Why this exists.** A lecture is the unit an author reads; a *version* is
 * the unit the app stores. A course that splits pneumonia into CAP and HAP/VAP,
 * and skin infections into two more decks, produces four files that all name
 * one exam -- so all four write to one variant layer, and the same drug is in
 * three of them with a different dosing block each time. The importer holds the
 * later wordings rather than overwriting them (see the `held` branch in
 * `lib/drugs/import.ts`), which keeps the first file's facts but drops the
 * rest. Neither behaviour is what the reader wants: they want every lecture's
 * dose under the drug, which means the files have to become one file.
 *
 * **It merges, it does not choose.** Two blocks that disagree are both kept, as
 * sibling bullets -- because a disagreement between two sections is almost
 * never a contradiction. CAP's *15 mg/kg every 12 hours* and SSTI's *5 days
 * outpatient* are a dose and a duration for different infections, and the
 * merged bullet list is exactly what the deck set would have said if one person
 * had written it. Where that reading is wrong, the report says what was joined
 * so it can be edited by hand before importing.
 *
 * **It touches no database.** Files in, one file out, and the output is parsed
 * back through `parseDrugImport` before it is written, so a merge that produces
 * something the importer would refuse fails here instead of on the screen.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { parseDosing } from '../lib/dosing/parse.ts';
import { CORE_FIELD_DEFS } from '../lib/fields/core-fields.ts';
import {
  IMPORT_FORMAT, parseDrugImport,
  type ImportDrug, type ImportFile, type ImportRegimen, type ImportValue,
} from '../lib/drugs/import-format.ts';

/**
 * The same reduction `drugSlug` makes, repeated rather than imported: that one
 * lives in `lib/drugs/mutations.ts`, which opens a database connection on
 * import, and this script has no business needing one. Keep them in step.
 */
const slug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

/** What was joined, for the report -- the only output a person has to read. */
type Note = { drug: string; what: string; parts: string[] };
const notes: Note[] = [];
const warnings: string[] = [];

/* --------------------------------------------------------------- reading -- */

function read(path: string): ImportFile {
  const parsed = parseDrugImport(readFileSync(path, 'utf8'));
  if (!parsed.ok) {
    console.error(`\n${path} is not a file this can merge:`);
    for (const problem of parsed.problems) console.error(`  ${problem.where}: ${problem.message}`);
    process.exit(1);
  }
  return parsed.file;
}

/* -------------------------------------------------------------- markdown -- */

/**
 * One markdown value's top-level items, each with the lines that belong to it.
 *
 * A group is a paragraph or a bullet plus everything indented or bulleted under
 * it, up to the next blank line -- which is how `lib/fields/prose.ts` reads it
 * too. Splitting here is what lets two values be merged item by item rather
 * than concatenated as two opaque blobs, so a repeated indication dedupes.
 */
function groups(text: string): string[] {
  const out: string[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    let current: string[] = [];
    for (const line of lines) {
      /**
       * A top-level bullet starts a new group **only when the group it would
       * leave is itself a bullet.** Where the group opens with a paragraph, the
       * bullets under it are qualifying it, not listing beside it:
       *
       *     Hospital-acquired pneumonia: 15 mg/kg IV q8-12h
       *     - Consider a 25-30 mg/kg x1 loading dose in severe illness
       *
       * is one item, and splitting it produced a merged list where a loading
       * dose stood as its own indication.
       */
      const opensWithBullet = current.length > 0 && /^- /.test(current[0]);
      if (/^- /.test(line) && opensWithBullet) {
        out.push(current.join('\n'));
        current = [line];
      } else {
        current.push(line);
      }
    }
    if (current.length > 0) out.push(current.join('\n'));
  }
  return out;
}

/**
 * A group as a bullet, so two values can be one list.
 *
 * A paragraph becomes `- <paragraph>` and everything under it is pushed in two
 * spaces, which is what keeps *Consider a loading dose in severe illness*
 * attached to the dose it qualifies instead of becoming a sibling of it. A
 * group that is already a bullet is left exactly as it is.
 *
 * Numbered steps are the one thing never promoted: `1.` inside a bullet list is
 * no longer a sequence, and a taper read out of order is worse than a taper in
 * its own paragraph. They are kept whole and the caller is told.
 */
function asBullet(group: string): { text: string; promoted: boolean; steps: boolean } {
  const lines = group.split('\n');
  const [first] = lines;
  if (/^- /.test(first)) return { text: group, promoted: false, steps: false };
  if (/^\d+\.\s/.test(first.trim())) return { text: group, promoted: false, steps: true };

  const rest = lines.slice(1).map((line) => `  ${line}`);
  return { text: [`- ${first}`, ...rest].join('\n'), promoted: true, steps: false };
}

/** The deepest indent in a value, in levels -- three is all the renderer reads. */
const depth = (text: string) => Math.max(
  ...text.split('\n').map((line) => Math.floor((line.match(/^ */)?.[0].length ?? 0) / 2) + 1),
);

/**
 * Two markdown values as one.
 *
 * Deduplicated by group: the four files repeat whole bullets about the same
 * drug -- *Empiric MRSA use in children only where resistance is under 10-15%*
 * is in two of them word for word -- and a merged value that says it twice
 * reads as a mistake in the app rather than as a merge.
 */
function mergeMarkdown(values: string[], drug: string, what: string): string {
  const items: string[] = [];
  const seen = new Set<string>();
  let anySteps = false;

  for (const value of values) {
    for (const group of groups(value)) {
      const { text, steps } = asBullet(group);
      anySteps = anySteps || steps;
      const key = text.replace(/\s+/g, ' ').trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(text);
    }
  }

  /**
   * Dosing gets one more try before it settles for bullets.
   *
   * `parseDosing` reads *one line per indication* -- `Impetigo: 7 days PO` --
   * and files each dose under that indication, which is what makes a drug with
   * four indications four rows rather than one blob. A bullet in front of the
   * line stops it reading, and the merged value is exactly where that matters:
   * four lectures each giving one indication is precisely the shape the parser
   * wants, and it only arrives here.
   *
   * So the flat form is offered to the real parser, and kept only if the parser
   * says it read every line as its own indication. No copy of its rules lives
   * here -- a copy would drift, and this is cheap to ask.
   */
  if (what === 'dosing' && items.every((item) => !item.includes('\n'))) {
    const flat = items.map((item) => item.replace(/^- /, '')).join('\n');
    if (parseDosing(flat).branches.length === items.length) return flat;
  }

  const merged = items.join('\n');
  if (anySteps) {
    warnings.push(`${drug} ${what}: one part is a numbered sequence and was left as its own `
      + 'paragraph. Check it still reads in order.');
  }
  if (depth(merged) > 3) {
    warnings.push(`${drug} ${what}: the merge is ${depth(merged)} levels deep and the renderer `
      + 'reads three. Flatten it by hand.');
  }
  return merged;
}

/* ---------------------------------------------------------------- fields -- */

const DATA_TYPE = new Map(CORE_FIELD_DEFS.map((def) => [def.key, def.dataType ?? 'markdown']));

/** A list value is one item per line, which is what `readList` left behind. */
const isList = (key: string) => DATA_TYPE.get(key) === 'list';

/**
 * One key's value, from however many files said something about it.
 *
 * The order of the rules is the argument:
 *
 * - **A value beats *none*.** `null` is a file saying *this drug has no black
 *   box warning*; another file naming one knows something the first did not,
 *   and two lectures cannot both be right about that. Reported, because it is
 *   the one case where merging drops something.
 * - **A list is a union.** Routes are a set -- PO from one deck, topical from
 *   another -- and a drug's routes are all of them.
 * - **Everything else is appended**, deduplicated by item.
 * - **Flagged is contagious.** If any file was unsure, the merged value is
 *   unsure: the import screen's Flagged list is where that gets settled, and
 *   quietly dropping the flag is how an unsure value passes for a sure one.
 */
function mergeValue(key: string, from: { file: string; value: ImportValue }[], drug: string): ImportValue {
  const spoken = from.filter((entry) => entry.value.value !== null);
  const status = from.some((entry) => entry.value.status === 'flagged') ? 'flagged' : 'ok';

  if (spoken.length === 0) return { value: null, status: from[0].value.status, source: null };
  if (spoken.length < from.length) {
    warnings.push(`${drug} ${key}: ${from.length - spoken.length} file(s) said there is none and `
      + `${spoken.length} gave a value. The value was kept.`);
  }

  const values = spoken.map((entry) => entry.value.value as string);
  if (new Set(values).size === 1) return { value: values[0], status, source: null };

  const merged = isList(key)
    ? [...new Set(values.flatMap((value) => value.split('\n')))].join('\n')
    : mergeMarkdown(values, drug, key);

  notes.push({
    drug,
    what: key,
    parts: spoken.map((entry) => `${entry.file}: ${entry.value.value}`),
  });
  return { value: merged, status, source: null };
}

/* ----------------------------------------------------------------- drugs -- */

const union = (lists: string[][]) => {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of lists.flat()) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

function mergeDrug(entries: { file: string; drug: ImportDrug }[]): ImportDrug {
  const [first] = entries;
  const name = first.drug.generic;
  const keys = [...new Set(entries.flatMap((entry) => Object.keys(entry.drug.fields)))];

  const fields: Record<string, ImportValue> = {};
  for (const key of keys) {
    const from = entries
      .filter((entry) => entry.drug.fields[key] !== undefined)
      .map((entry) => ({ file: entry.file, value: entry.drug.fields[key] }));
    fields[key] = from.length === 1 ? from[0].value : mergeValue(key, from, name);
  }

  // Identity: the first file that names one wins, and a disagreement is said
  // out loud rather than resolved. Two lectures calling a drug two classes is a
  // thing for a person to look at, not for a merge to average.
  const identity = <K extends 'drugClass' | 'schedule'>(field: K) => {
    const given = entries.filter((entry) => entry.drug[field] !== null);
    const distinct = new Set(given.map((entry) => entry.drug[field]));
    if (distinct.size > 1) {
      warnings.push(`${name} ${field}: ${given.map((e) => `${e.file} says ${e.drug[field]}`).join(', ')}`
        + `. Kept ${given[0].drug[field]}.`);
    }
    return given[0]?.drug[field] ?? null;
  };

  return {
    generic: name,
    aliases: union(entries.map((entry) => entry.drug.aliases)),
    brands: union(entries.map((entry) => entry.drug.brands)),
    indications: union(entries.map((entry) => entry.drug.indications)),
    drugClass: identity('drugClass'),
    schedule: identity('schedule'),
    fields,
    // Dropped on purpose where the files disagree: a per-entry source is "where
    // this drug's facts came from", and the merged file's own source block now
    // names every deck.
    source: new Set(entries.map((entry) => entry.drug.source)).size === 1 ? first.drug.source : null,
  };
}

/* -------------------------------------------------------------- regimens -- */

const shape = (regimen: ImportRegimen) => JSON.stringify({
  when: regimen.when,
  components: regimen.components,
  flow: regimen.flow,
  notes: regimen.notes,
});

/**
 * Every regimen, with the ones that are the same protocol collapsed.
 *
 * Two files describing *Vancomycin + piperacillin/tazobactam* identically is
 * one protocol named twice. Two files describing it differently -- one listing
 * the debridement sequence, the other the surgical inspection -- are two
 * readings of it, and both are kept with the deck in the name, because a
 * regimen's name is what the drug's `regimen` field is keyed on and a silent
 * merge would make one deck's protocol disappear.
 */
function mergeRegimens(files: { file: string; regimens: ImportRegimen[] }[]): ImportRegimen[] {
  const byName = new Map<string, { file: string; regimen: ImportRegimen }[]>();
  for (const { file, regimens } of files) {
    for (const regimen of regimens) {
      const list = byName.get(regimen.name) ?? [];
      list.push({ file, regimen });
      byName.set(regimen.name, list);
    }
  }

  const out: ImportRegimen[] = [];
  for (const [name, rows] of byName) {
    const distinct = new Map(rows.map((row) => [shape(row.regimen), row]));
    if (distinct.size === 1) {
      out.push(rows[0].regimen);
      continue;
    }
    for (const row of distinct.values()) {
      const stem = basename(row.file).replace(/\.drugs\.json$|\.json$/, '');
      out.push({ ...row.regimen, name: `${name} (${stem})` });
    }
    warnings.push(`regimen "${name}": ${distinct.size} files describe it differently, so each was `
      + 'kept with its file in the name. Merge them by hand if they are one protocol.');
  }
  return out;
}

/* ------------------------------------------------------------- the output -- */

/** Back to the shape a file has, which is not the shape the parser returns. */
function emit(file: ImportFile, outPath: string) {
  const scope: Record<string, string> = {};
  for (const entry of file.scope) scope[entry.kind] = entry.label;

  const value = (key: string, value: ImportValue): unknown => {
    const body = value.value === null
      ? null
      : isList(key) ? value.value.split('\n') : value.value;
    if (value.status === 'flagged') return { value: body, status: 'flagged' };
    return body;
  };

  return {
    format: IMPORT_FORMAT,
    scope,
    source: {
      file: basename(outPath),
      ...(file.source.deck ? { deck: file.source.deck } : {}),
      ...(file.source.pages ? { pages: file.source.pages } : {}),
      ...(file.source.accessed ? { accessed: file.source.accessed } : {}),
    },
    write: file.write,
    ...(file.declare.length > 0
      ? {
        declare: file.declare.map((def) => ({
          key: def.key,
          label: def.label,
          type: def.dataType,
          ...(def.group ? { group: def.group } : {}),
          ...(def.promptTemplate ? { prompt: def.promptTemplate } : {}),
          ...(def.enumOptions ? { options: def.enumOptions } : {}),
          ...(def.blankMeansNone ? { blank_means_none: true } : {}),
        })),
      }
      : {}),
    drugs: file.drugs.map((drug) => ({
      generic: drug.generic,
      ...(drug.aliases.length > 0 ? { aliases: drug.aliases } : {}),
      ...(drug.brands.length > 0 ? { brands: drug.brands } : {}),
      ...(drug.indications.length > 0 ? { indications: drug.indications } : {}),
      ...(drug.drugClass ? { class: drug.drugClass } : {}),
      ...(drug.schedule ? { schedule: drug.schedule } : {}),
      ...(drug.source ? { source: drug.source } : {}),
      ...(Object.keys(drug.fields).length > 0
        ? {
          fields: Object.fromEntries(
            Object.entries(drug.fields).map(([key, held]) => [key, value(key, held)]),
          ),
        }
        : {}),
    })),
    ...(file.regimens.length > 0
      ? {
        regimens: file.regimens.map((regimen) => ({
          name: regimen.name,
          ...(regimen.when ? { when: regimen.when } : {}),
          components: regimen.components.map((component) => ({
            drug: component.drug,
            ...(component.dose ? { dose: component.dose } : {}),
            ...(component.role !== 'component' ? { role: component.role } : {}),
          })),
          ...(regimen.flow ? { flow: regimen.flow } : {}),
          ...(regimen.notes ? { notes: regimen.notes } : {}),
          ...(regimen.source ? { source: regimen.source } : {}),
        })),
      }
      : {}),
    ...(file.issues.length > 0 ? { issues: file.issues } : {}),
  };
}

/* ----------------------------------------------------------------- main ---- */

function main() {
  const [outPath, ...inPaths] = process.argv.slice(2);
  if (!outPath || inPaths.length < 2) {
    console.error('Usage: npx tsx scripts/merge-drug-imports.ts out.json in1.json in2.json [...]');
    process.exit(1);
  }

  const files = inPaths.map((path) => ({ file: basename(path), path, parsed: read(path) }));

  // One exam or nothing. Merging across scopes would put one lecture's wording
  // into another class's version, which is the mistake this whole feature is
  // built to make impossible.
  const scopes = new Set(files.map(({ parsed }) =>
    parsed.scope.map((entry) => `${entry.kind}=${entry.label}`).join(' / ')));
  if (scopes.size > 1) {
    console.error('\nThese files do not name the same scope, so they are not one version:');
    for (const { file, parsed } of files) {
      console.error(`  ${file}: ${parsed.scope.map((e) => `${e.kind}=${e.label}`).join(' / ')}`);
    }
    console.error('\nImport them separately, or make the scope lines match if they are one exam.');
    process.exit(1);
  }

  // Declared fields: the same key declared two ways is a refusal, not a merge.
  // The app keys stored values on it, so a label or a type is not something two
  // files get to disagree about quietly.
  const declare = new Map<string, ImportFile['declare'][number]>();
  for (const { file, parsed } of files) {
    for (const def of parsed.declare) {
      const held = declare.get(def.key);
      if (held && JSON.stringify(held) !== JSON.stringify(def)) {
        console.error(`\n"${def.key}" is declared differently in ${file} than in an earlier file. `
          + 'Make the two declarations identical and run this again.');
        process.exit(1);
      }
      declare.set(def.key, def);
    }
  }

  const byDrug = new Map<string, { file: string; drug: ImportDrug }[]>();
  for (const { file, parsed } of files) {
    for (const drug of parsed.drugs) {
      const key = slug(drug.generic);
      byDrug.set(key, [...(byDrug.get(key) ?? []), { file, drug }]);
    }
  }

  const merged: ImportFile = {
    ...files[0].parsed,
    source: {
      file: basename(outPath),
      // Every deck, so the layer's note names all of them rather than only the
      // last file imported -- which is what it did when these were four files.
      deck: files
        .map(({ parsed }) => parsed.source.deck ?? parsed.source.file)
        .join(' · '),
      pages: null,
      accessed: files.map(({ parsed }) => parsed.source.accessed).filter(Boolean).sort().pop() ?? null,
    },
    declare: [...declare.values()],
    drugs: [...byDrug.values()].map((entries) =>
      entries.length === 1 ? entries[0].drug : mergeDrug(entries)),
    regimens: mergeRegimens(files.map(({ file, parsed }) => ({ file, regimens: parsed.regimens }))),
    issues: union(files.map(({ parsed }) => parsed.issues)),
  };

  const text = `${JSON.stringify(emit(merged, outPath), null, 2)}\n`;

  // The output is an input file, so it is read as one before it is written. A
  // merge that produces something the importer refuses is a bug here.
  const check = parseDrugImport(text);
  if (!check.ok) {
    console.error('\nThe merged file would be refused by the importer:');
    for (const problem of check.problems) console.error(`  ${problem.where}: ${problem.message}`);
    process.exit(1);
  }

  writeFileSync(outPath, text, 'utf8');

  /* ------------------------------------------------------------- report -- */
  const multi = [...byDrug.values()].filter((entries) => entries.length > 1).length;
  console.log(`\n${outPath}`);
  console.log(`  ${files.length} files -> ${merged.drugs.length} drugs `
    + `(${multi} appeared in more than one), ${merged.regimens.length} regimens, `
    + `${merged.declare.length} declared fields.`);
  console.log(`  scope: ${merged.scope.map((e) => `${e.kind}=${e.label}`).join(' / ')}`);

  if (notes.length > 0) {
    console.log(`\n  ${notes.length} values were joined from more than one file. Read these:`);
    for (const note of notes) {
      console.log(`\n  --- ${note.drug} / ${note.what}`);
      for (const part of note.parts) {
        console.log(`      ${part.replace(/\n/g, '\n      ')}`);
      }
    }
  }

  if (warnings.length > 0) {
    console.log(`\n  ${warnings.length} thing(s) to check by hand:`);
    for (const warning of warnings) console.log(`    - ${warning}`);
  }
}

main();
