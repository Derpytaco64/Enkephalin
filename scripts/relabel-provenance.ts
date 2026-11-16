/**
 * Rewrites the *from X content* line on a backup's values to name the exam
 * rather than the class.
 *
 * Context: `provenanceOf` used to stamp every imported value with the widest
 * scope, so a class running four exams produced four layers whose values all
 * read *from PHRM 532 content* -- true of all four and so distinguishing none.
 * It names the narrowest scope since 2026-11-16, which fixes every future
 * import and no value already written. This is the other half.
 *
 *   node --experimental-strip-types scripts/relabel-provenance.ts <backup.json>
 *   node --experimental-strip-types scripts/relabel-provenance.ts <backup.json> --write
 *
 * Without `--write` it prints what it would change and touches nothing. With
 * it, the corrected backup is written beside the original as
 * `<name>.relabelled.json` unless `--out` says otherwise -- never over the
 * original, because a backup is the thing you fall back to and a script that
 * overwrites one has taken that away.
 *
 * **It operates on a backup file, not on the database.** Restoring the result
 * is how the correction lands, which makes the whole thing reviewable as a
 * diff before anything is live.
 *
 * Two kinds of value, and only one of them is certain:
 *
 * - **A layer's values** are exactly recoverable. The layer belongs to a tag,
 *   that tag is the exam, so the line is read off where the value lives.
 * - **A base profile's values** are recoverable where the drug came in with
 *   one lecture: `baseVariant` records whose words the base is. The hazard is
 *   a *later* lecture filling a gap on the base -- `fill` writes a field
 *   nobody has recorded to the drug itself, so an Exam 3 import can leave a
 *   value in an Exam 1 base and nothing in the row says which. The timestamps
 *   do: an import writes its values within a second of each other and the
 *   imports are hours or days apart, so a base value written near another
 *   exam's layer is held back and reported rather than guessed at.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import type { Backup, BackupDrug, BackupVariantLayer } from '../lib/data/backup.ts';

/** How close to another exam's import a base value has to be to be suspect. */
const SUSPICION_WINDOW_MS = 2 * 60 * 1000;

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const path = process.argv[2];
if (!path || path.startsWith('--')) {
  console.error('usage: relabel-provenance.ts <backup.json> [--write] [--out file.json]');
  process.exit(1);
}

const write = process.argv.includes('--write');
const out = arg('--out') ?? path.replace(/(\.json)?$/i, '.relabelled.json');

const backup: Backup = JSON.parse(readFileSync(path, 'utf8'));

const labelOf = new Map(backup.tags.map((tag) => [tag.slug, tag.label]));
const kindOf = new Map(backup.tags.map((tag) => [tag.slug, tag.kind]));

/**
 * The phrases this rewrites, and nothing else.
 *
 * Only ever a line `provenanceOf` wrote under the old rule: *from <a course in
 * this backup> content*. A citation somebody typed -- an FDA notice, a
 * guideline, a package insert -- is a better source than any tag and is left
 * exactly as it is, as are *class sheet* and *the sheet dosing text*.
 */
const courseLines = new Set(
  backup.tags
    .filter((tag) => tag.kind === 'course')
    .map((tag) => `from ${tag.label} content`),
);

const contentLine = (slug: string) => `from ${labelOf.get(slug) ?? slug} content`;

const at = (stamp: string | undefined) => (stamp ? Date.parse(stamp) : Number.NaN);

type Change = { drug: string; where: string; key: string; from: string; to: string };
type Held = { drug: string; key: string; source: string; why: string };

const changed: Change[] = [];
const held: Held[] = [];

/** When each layer of this drug was written, per exam, for the hazard check. */
function layerTimes(layers: BackupVariantLayer[]): { slug: string; times: number[] }[] {
  return layers.map((layer) => ({
    slug: layer.variant,
    times: Object.values(layer.fields)
      .map((value) => at(value.updatedAt))
      .filter((time) => !Number.isNaN(time)),
  }));
}

function relabel(drug: BackupDrug) {
  const layers = drug.variants ?? [];

  // A layer's own values: the tag it lives on is the answer.
  for (const layer of layers) {
    const target = contentLine(layer.variant);
    for (const [key, value] of Object.entries(layer.fields)) {
      if (!value.source || !courseLines.has(value.source) || value.source === target) continue;
      changed.push({
        drug: drug.slug, where: labelOf.get(layer.variant) ?? layer.variant, key,
        from: value.source, to: target,
      });
      value.source = target;
    }
  }

  // The base profile's values: whose the profile is, where that is a class or
  // an exam. A base attributed to a list is the sheet's and has no lecture to
  // name, so those values keep whatever they say.
  const base = drug.baseVariant ?? null;
  if (base === null) return;
  const baseKind = kindOf.get(base);
  if (baseKind !== 'course' && baseKind !== 'exam') return;

  const target = contentLine(base);
  const others = layerTimes(layers).filter((layer) => layer.slug !== base);

  for (const [key, value] of Object.entries(drug.fields)) {
    if (!value.source || !courseLines.has(value.source) || value.source === target) continue;

    // Written while another exam's lecture was being imported: that import
    // could have filled this gap on the base, and `baseVariant` would then be
    // the wrong name to put on it. Reported, not guessed.
    const stamp = at(value.updatedAt);
    const near = others.find((layer) => layer.times
      .some((time) => Math.abs(time - stamp) <= SUSPICION_WINDOW_MS));
    if (near) {
      held.push({
        drug: drug.slug, key, source: value.source,
        why: `written within ${SUSPICION_WINDOW_MS / 1000}s of the `
          + `${labelOf.get(near.slug) ?? near.slug} import`,
      });
      continue;
    }

    changed.push({
      drug: drug.slug, where: `${labelOf.get(base) ?? base} (base)`, key,
      from: value.source, to: target,
    });
    value.source = target;
  }
}

for (const drug of backup.drugs) relabel(drug);

const byTarget = new Map<string, number>();
for (const change of changed) byTarget.set(change.to, (byTarget.get(change.to) ?? 0) + 1);

console.log(`${path}`);
console.log(`  ${changed.length} value${changed.length === 1 ? '' : 's'} relabelled`);
for (const [line, n] of [...byTarget].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(n).padStart(5)}  ${line}`);
}
if (held.length > 0) {
  console.log(`  ${held.length} left alone, because the exam cannot be told from the row:`);
  for (const row of held) console.log(`    ${row.drug} · ${row.key} — ${row.why}`);
}

if (!write) {
  console.log('\nnothing written. Re-run with --write to produce the corrected file.');
  process.exit(0);
}

writeFileSync(out, JSON.stringify(backup, null, 2), 'utf8');
console.log(`\nwrote ${out}`);
console.log('Restore it from /admin/data, or scripts/restore-backup.ts, to apply the change.');
