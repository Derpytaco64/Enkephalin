/**
 * Moves a cephalosporin generation out of a backup's `drug_class` and into the
 * drug's notes, and unifies the class the group is filed under.
 *
 * Context: `class` held the generation for eleven cephalosporins and the FDA's
 * group name for five, so the library had sixteen cephalosporins in six classes
 * -- *Second-generation Cephalosporin*, *Third-generation Cephalosporin*,
 * *Fifth-generation Cephalosporin*, *Cephalosporin Antibacterial* and two
 * combinations -- none of which groups with any other. The class is the browse
 * filter, the colour axis and the pool a question draws its wrong answers
 * from, so that split is not cosmetic: a cefuroxime question drew its four
 * distractors from the four other second-generation cephalosporins.
 *
 * The asymmetry is worth understanding, because it is what made this look like
 * a deletion. Nothing deleted anything. A drug a lecture *created* kept the
 * class that lecture wrote, generation and all. A drug already on the class
 * sheet had RxNav's EPC -- *Cephalosporin Antibacterial*, which names no
 * generation by design -- and the class is filled and never corrected, so the
 * generation in the lecture's file was dropped on arrival. Five of the
 * twenty, and they are the five anybody actually sees: cefazolin, cephalexin,
 * ceftriaxone, cefepime, cefdinir.
 *
 *   node --experimental-strip-types scripts/class-generation-to-notes.ts <backup.json>
 *   node --experimental-strip-types scripts/class-generation-to-notes.ts <backup.json> --write
 *
 * Dry-run unless `--write`, and the result is written beside the original as
 * `<name>.generations.json` unless `--out` says otherwise -- never over the
 * original, which is the thing you fall back to.
 *
 * **It operates on a backup file, not on the database**, so the whole
 * correction is reviewable as a diff before any of it is live.
 *
 * Three decisions in here:
 *
 * - **The group's spelling is learned from the backup, not typed.** The class
 *   to file a cephalosporin under is whatever this library's cephalosporins
 *   that carry no generation are already called -- *Cephalosporin
 *   Antibacterial*, five of them. A class this file invented would be a
 *   sixteenth spelling of the thing it is trying to unify.
 * - **A generation already lost to the lookup is recovered from
 *   `class_candidates`.** RxClass gives ATC's *First-generation
 *   cephalosporins* and the VA's *CEPHALOSPORIN 1ST GENERATION* alongside the
 *   EPC, and the app records both for a human; they have been sitting on
 *   cefazolin the whole time. So the fact is read back out of the drug rather
 *   than written from memory, which is the same rule the class itself follows.
 * - **The note goes on every version the drug has.** A generation is true in
 *   every lecture that teaches the drug, and since 2026-11-16 a version shows
 *   and asks only what that version worded -- so a note left only on the base
 *   would be missing from the exam pages, which is the one place it is being
 *   revised. The attribution is the lecture whose version it lands in, which
 *   is honest for the eleven that wrote the generation themselves and is the
 *   fair reading for the five: the lecture that taught the group by generation
 *   taught these drugs too, and the import is what dropped it. A value that
 *   already exists keeps its own source line.
 *
 * What it leaves alone, and reports: a cephalosporin with no generation
 * anywhere in its row (cefadroxil has no class at all -- the drug editor's
 * lookup is the fix for that, not this), and a class that is a qualifier
 * rather than a generation. *Siderophore Cephalosporin* and
 * *Cephalosporin/beta-Lactamase Inhibitor* are the two: the combinations are
 * genuinely a different class, and cefiderocol is a judgement call for the
 * owner rather than a rewrite for a script.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { generationNote } from '../lib/drugs/drug-class.ts';
import type { Backup, BackupDrug } from '../lib/data/backup.ts';
import type { FieldValue } from '../db/schema.ts';

/** The field a fact about one drug goes in. */
const NOTES = 'notes';

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

const path = process.argv[2];
if (!path || path.startsWith('--')) {
  console.error('usage: class-generation-to-notes.ts <backup.json> [--write] [--out file.json]');
  process.exit(1);
}

const write = process.argv.includes('--write');
const out = arg('--out') ?? path.replace(/(\.json)?$/i, '.generations.json');

const backup: Backup = JSON.parse(readFileSync(path, 'utf8'));

const labelOf = new Map(backup.tags.map((tag) => [tag.slug, tag.label]));
const kindOf = new Map(backup.tags.map((tag) => [tag.slug, tag.kind]));
const lecture = (slug: string | null | undefined) =>
  slug != null && (kindOf.get(slug) === 'course' || kindOf.get(slug) === 'exam');

/** *Third-generation cephalosporin* -> *cephalosporin*: what it is one of. */
const groupOf = (note: string) => note.replace(/^\S+-generation\s+/, '');

/**
 * What this library calls the group, by how many of its drugs say so.
 *
 * Only classes that name no generation count, so the six-way split cannot vote
 * for itself, and the commonest wins: five drugs say *Cephalosporin
 * Antibacterial*, two say *Cephalosporin/beta-Lactamase Inhibitor* and one
 * says *Siderophore Cephalosporin*.
 */
function groupClasses(): Map<string, string> {
  const votes = new Map<string, Map<string, number>>();
  for (const drug of backup.drugs) {
    const className = drug.drugClass?.trim();
    if (!className || generationNote(className)) continue;
    const words = className.toLowerCase().match(/[a-z]+/g) ?? [];
    for (const word of words) {
      const tally = votes.get(word) ?? new Map<string, number>();
      tally.set(className, (tally.get(className) ?? 0) + 1);
      votes.set(word, tally);
    }
  }

  const best = new Map<string, string>();
  for (const [word, tally] of votes) {
    const winner = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (winner) best.set(word, winner[0]);
  }
  return best;
}

const groups = groupClasses();

type Written = { drug: string; where: string; note: string; created: boolean };
type Reclassed = { drug: string; from: string; to: string };
type Held = { drug: string; why: string };

const written: Written[] = [];
const reclassed: Reclassed[] = [];
const held: Held[] = [];

/** The first value this place already holds, to copy a stamp and an author off. */
function sibling(fields: Record<string, FieldValue>): FieldValue | undefined {
  return fields[NOTES] ?? Object.values(fields)[0];
}

/**
 * Puts the note at the top of this `notes` value, or makes one.
 *
 * First because it says what the drug *is* and the lines under it say what to
 * watch for, and as a bullet because that is how every note in this library is
 * written. The timestamp is the one already on the place it lands: the fact is
 * the lecture's and was written when the lecture was imported, and a fresh
 * stamp would both claim otherwise and throw off anything that reads import
 * times -- `relabel-provenance` reads them to tell two lectures apart.
 */
function addNote(
  fields: Record<string, FieldValue>,
  note: string,
  source: string,
): 'created' | 'added' | 'already' {
  const line = `- ${note}`;
  const existing = fields[NOTES];
  if (existing?.value?.toLowerCase().includes(note.toLowerCase())) return 'already';

  if (!existing || existing.value === null || existing.value.trim() === '') {
    const from = sibling(fields);
    fields[NOTES] = {
      value: line,
      status: 'ok',
      source: existing?.source ?? source,
      updatedAt: existing?.updatedAt ?? from?.updatedAt ?? new Date().toISOString(),
      updatedBy: existing?.updatedBy ?? from?.updatedBy ?? null,
    };
    return 'created';
  }

  // A bulleted value takes another bullet; prose keeps its own paragraph, so
  // the list does not swallow a sentence that was never in one.
  existing.value = existing.value.trimStart().startsWith('- ')
    ? `${line}\n${existing.value}`
    : `${line}\n\n${existing.value}`;
  return 'added';
}

function move(drug: BackupDrug) {
  const own = generationNote(drug.drugClass);
  const recovered = own ? null : drug.classCandidates.map(generationNote).find((note) => note);
  const note = own ?? recovered ?? null;

  if (note === null) return;

  // Unify the class first: a generation in the column is the thing being
  // undone, and the group it belongs to is what the rest of its kind is called.
  if (own) {
    const group = groups.get(groupOf(own));
    if (!group) {
      held.push({
        drug: drug.slug,
        why: `nothing in this backup is a ${groupOf(own)} without a generation, `
          + 'so there is no spelling of the group to file it under',
      });
      return;
    }
    if (group !== drug.drugClass) {
      reclassed.push({ drug: drug.slug, from: drug.drugClass ?? '', to: group });
      drug.drugClass = group;
    }
  }

  // Every version, because a version shows only what it worded, and the exam
  // pages are where this is revised.
  const places: { fields: Record<string, FieldValue>; where: string; source: string }[] = [];
  const base = drug.baseVariant ?? null;
  places.push({
    fields: drug.fields,
    where: lecture(base) ? `${labelOf.get(base!) ?? base} (base)` : 'the drug itself',
    // The sheet never taught generations, and RxClass is where this one was
    // read back from, so the sheet is not credited with it.
    source: lecture(base) ? `from ${labelOf.get(base!) ?? base}` : 'from RxClass',
  });
  for (const layer of drug.variants ?? []) {
    places.push({
      fields: layer.fields,
      where: labelOf.get(layer.variant) ?? layer.variant,
      source: `from ${labelOf.get(layer.variant) ?? layer.variant}`,
    });
  }

  for (const place of places) {
    const did = addNote(place.fields, note, place.source);
    if (did === 'already') continue;
    written.push({ drug: drug.slug, where: place.where, note, created: did === 'created' });
  }
}

for (const drug of backup.drugs) move(drug);

/**
 * What is still filed on its own once the generations are out.
 *
 * Reported and never rewritten, because the two kinds it finds are different
 * questions: a combination genuinely is not the class its cephalosporin half
 * is, and a qualifier like *Siderophore Cephalosporin* is the owner's call --
 * it is a real distinction, and whether it should be a class or a note is not
 * something a script can read off the row.
 */
for (const noun of new Set(reclassed.map((row) => groupOf(generationNote(row.from)!)))) {
  const group = groups.get(noun);
  for (const drug of backup.drugs) {
    const className = drug.drugClass?.trim();
    if (!className || className === group) continue;
    if (className.toLowerCase().includes(noun)) {
      held.push({ drug: drug.slug, why: `still ${className}, which groups with nothing else` });
    }
  }
}

console.log(`${path}`);
console.log(`  ${reclassed.length} class${reclassed.length === 1 ? '' : 'es'} unified`);
const byTo = new Map<string, string[]>();
for (const row of reclassed) byTo.set(`${row.from} -> ${row.to}`, [...(byTo.get(`${row.from} -> ${row.to}`) ?? []), row.drug]);
for (const [move_, drugs] of [...byTo].sort()) {
  console.log(`    ${move_}`);
  console.log(`      ${drugs.join(', ')}`);
}

const byDrug = new Map<string, Written[]>();
for (const row of written) byDrug.set(row.drug, [...(byDrug.get(row.drug) ?? []), row]);
console.log(`  ${written.length} note${written.length === 1 ? '' : 's'} written, `
  + `across ${byDrug.size} drug${byDrug.size === 1 ? '' : 's'}`);
for (const [drug, rows] of [...byDrug].sort()) {
  console.log(`    ${drug} — ${rows[0]!.note}`);
  for (const row of rows) console.log(`      ${row.created ? 'new ' : '+   '} ${row.where}`);
}

if (held.length > 0) {
  console.log(`  ${held.length} left alone:`);
  for (const row of held) console.log(`    ${row.drug} — ${row.why}`);
}

if (!write) {
  console.log('\nnothing written. Re-run with --write to produce the corrected file.');
  process.exit(0);
}

writeFileSync(out, JSON.stringify(backup, null, 2), 'utf8');
console.log(`\nwrote ${out}`);
console.log('Restore it from /admin/data, or scripts/restore-backup.ts, to apply the change.');
