/**
 * Works out which version each of a drug's indications was taught by, from the
 * audit log, and files them there in a backup file.
 *
 * Context: `drug_indications` had no variant dimension until migration 0018 --
 * see PLAN.md, "An indication belongs to the version that taught it". So every
 * lecture that imported a drug appended to one shared list, and doxycycline
 * ended up with 26 indications all sitting on its own profile while each of the
 * five versions that taught it held none. This is the repair for the rows
 * already stored; the importer writes them to the right place from now on.
 *
 *   node --experimental-strip-types scripts/indication-variants.ts <backup.json>
 *   node --experimental-strip-types scripts/indication-variants.ts <backup.json> --write
 *
 * Dry-run unless `--write`, and the result is written beside the original as
 * `<name>.variants.json` unless `--out` says otherwise -- never over the
 * original. **It operates on a backup file, not on the database**, so the whole
 * attribution is a reviewable diff before any of it is live. Restore with merge.
 *
 * ## Where the answer comes from
 *
 * The audit log, which turns out to have kept exactly what is needed. Every
 * `setDrugIndications` wrote a `drug.indications` row holding the **whole list
 * after the write**, so replaying them in order gives the labels each import
 * added. And an import that put a drug on a new list wrote a `drug.tags` row in
 * the same breath, whose newly-present slug names the version doing the
 * teaching.
 *
 * Four rules, in order. The last three are what cover the imports that added
 * no tag -- a lecture's second and third PDF, where the drug was already on
 * the exam:
 *
 * 0. **The class sheet wins outright.** A label `data/top-drugs-2026.json`
 *    gives the drug is the drug's own, whatever the replay says. It has to
 *    come first because the seeder wrote no audit rows, so the first import to
 *    touch a seeded drug reports the sheet's indications inside its own list
 *    and the replay cannot tell them from what it added -- doxycycline's
 *    *Bacterial infections* is the sheet's one word on the subject and would
 *    otherwise become Infectious Disease Exam 1's.
 * 1. **The tag this drug gained in this batch**, narrowest first (exam before
 *    course). This is the exact pairing, and it covers 142 of the 200 events.
 * 2. **The tag the batch gained anywhere.** Audit rows cluster tightly -- an
 *    import of 37 drugs lands inside two seconds -- so rows within a minute of
 *    each other are one import, and the version is whatever at least one of
 *    those drugs was newly tagged with.
 * 3. **The base.** Nothing was newly tagged, so nothing claims these: they are
 *    the drug's own.
 *
 * A label attributed to the drug's **own** base variant stays on the drug
 * rather than becoming a layer, which is the same rule `variantLayerFor`
 * follows: a version cannot be a variation on itself. So can a label
 * attributed to a list rather than a class or an exam -- only those two kinds
 * can hold a layer, and *Top Drugs 2026* naming an indication means the sheet
 * does, which is the drug's own profile.
 *
 * ## What it refuses to guess
 *
 * A label the replay never sees added stays on the drug, and that is 676 of
 * the 1,266 -- which sounds alarming and is not. 484 of them belong to a drug
 * **a lecture created**, where the whole profile is that lecture's and the
 * indications are already in the right place; 189 are the class sheet's own
 * wording; the remaining 3 were typed or corrected by hand. In every one of
 * those cases the drug's own profile is where the label belongs, and where it
 * already is, so leaving them is a change of nothing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { canonicalIndication } from '../lib/drugs/indications.ts';

/** The class sheet, which is the one source that is nobody's lecture. */
const SHEET = 'data/top-drugs-2026.json';

/** Only these two kinds can hold a version's wording. */
const VARIANT_KINDS = new Set(['course', 'exam']);

/**
 * Tag slugs the audit log remembers, and what they are called now.
 *
 * `drug.tags` diffs hold the slug as it was written, and four tags have been
 * renamed since -- the exams gained their year, and Exam 3 lost an "FS26:"
 * prefix it was created with. Written out rather than matched by shape: there
 * are four, a person can check all four, and a rule that turned
 * `infectious-disease-exam-1` into the wrong exam would file a lecture's worth
 * of indications under it silently.
 */
const RENAMED: Record<string, string> = {
  'heme-onc-exam-3': 'heme-onc-exam-3-2026',
  'infectious-disease-exam-1': 'infectious-disease-exam-1-2026',
  'infectious-disease-exam-2': 'infectious-disease-exam-2-2026',
  'fs26-infectious-disease-exam-3': 'infectious-disease-exam-3-2026',
};

/** Narrowest first: an exam teaches a lecture, a course owns the exam. */
const KIND_RANK: Record<string, number> = { exam: 0, course: 1, top_list: 2, custom: 3 };

/** Rows this far apart in time are two imports rather than one. */
const BATCH_GAP_MS = 60_000;

type Audit = {
  at: string;
  action: string;
  target: string | null;
  diff: Record<string, unknown> | null;
};
type Variant = { variant: string; fields?: Record<string, unknown>; note?: string | null;
  indications?: string[] };
type Drug = {
  slug: string;
  indications?: string[];
  baseVariant?: string | null;
  tags?: (string | { tag: string; reads?: string | null })[];
  variants?: Variant[];
};
type Backup = {
  tags: { slug: string; kind: string }[];
  drugs: (Drug & { genericName?: string })[];
  audit?: Audit[];
};

function main() {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error('usage: indication-variants.ts <backup.json> [--write] [--out <path>]');
    process.exit(1);
  }
  const write = flags.includes('--write');
  const outAt = flags.indexOf('--out');
  const out = outAt >= 0 ? flags[outAt + 1] : file.replace(/\.json$/, '') + '.variants.json';

  const backup = JSON.parse(readFileSync(file, 'utf8')) as Backup;
  const kindOf = new Map(backup.tags.map((tag) => [tag.slug, tag.kind]));
  const current = (slug: string) => RENAMED[slug] ?? slug;

  /**
   * What the class sheet says each drug is for, by generic name.
   *
   * Keyed on the canonical wording, because the sheet's own column was
   * normalised on the way in -- the sheet says "Bacterial infection" and the
   * stored row is "Bacterial infections". `canonicalIndication` is the function
   * that did it, so asking it again is how the two are compared rather than
   * guessed at.
   */
  const sheet = JSON.parse(readFileSync(SHEET, 'utf8')) as {
    drugs: { generic: string; indications?: string[] }[];
  };
  const sheetBy = new Map(sheet.drugs.map((row) => [
    row.generic.trim().toLowerCase(),
    new Set((row.indications ?? []).map(canonicalIndication)),
  ]));

  /** The tag a version would be, out of the ones newly present. */
  const narrowest = (slugs: Iterable<string>): string | null => {
    const ranked = [...slugs]
      .filter((slug) => kindOf.has(slug))
      .sort((a, b) => (KIND_RANK[kindOf.get(a)!] ?? 9) - (KIND_RANK[kindOf.get(b)!] ?? 9));
    return ranked[0] ?? null;
  };

  const audit = (backup.audit ?? [])
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  /* Batches first, so rule 2 can ask about an import rather than about a row. */
  const batches: Audit[][] = [];
  let last = -Infinity;
  for (const row of audit) {
    const at = Date.parse(row.at);
    if (at - last > BATCH_GAP_MS) batches.push([]);
    batches[batches.length - 1].push(row);
    last = at;
  }

  /** drug slug -> label -> the tag that taught it, or null for the drug's own. */
  const taught = new Map<string, Map<string, string | null>>();
  const heldTags = new Map<string, string[]>();
  const heldIndications = new Map<string, string[]>();
  const report: { when: string; variant: string | null; rule: number; labels: number }[] = [];

  for (const batch of batches) {
    /* Pass one: who gained what, so rule 2 can be answered before it is asked. */
    const gainedByDrug = new Map<string, string[]>();
    const gainedInBatch = new Set<string>();
    for (const row of batch) {
      if (row.action !== 'drug.tags' || !row.target) continue;
      const slugs = ((row.diff?.tags as string[] | undefined) ?? []).map(current);
      const before = heldTags.get(row.target) ?? [];
      const gained = slugs.filter((slug) => !before.includes(slug));
      heldTags.set(row.target, slugs);
      if (gained.length > 0) {
        gainedByDrug.set(row.target, [...(gainedByDrug.get(row.target) ?? []), ...gained]);
        for (const slug of gained) gainedInBatch.add(slug);
      }
    }
    const batchVariant = narrowest(gainedInBatch);

    for (const row of batch) {
      if (row.action !== 'drug.indications' || !row.target) continue;
      const list = (row.diff?.indications as string[] | undefined) ?? [];
      const before = heldIndications.get(row.target) ?? [];
      const added = list.filter((label) => !before.includes(label));
      heldIndications.set(row.target, list);
      if (added.length === 0) continue;

      const mine = narrowest(gainedByDrug.get(row.target) ?? []);
      const variant = mine ?? batchVariant;
      const rule = mine !== null ? 1 : (batchVariant !== null ? 2 : 3);

      const forDrug = taught.get(row.target) ?? new Map<string, string | null>();
      // Last writer wins: an indication re-added by a later lecture is that
      // lecture's as much as the first one's, and the later import is the one
      // whose wording of the rest of the profile is on screen.
      for (const label of added) forDrug.set(label, variant);
      taught.set(row.target, forDrug);
      report.push({ when: row.at, variant, rule, labels: added.length });
    }
  }

  /* ------------------------------------------------------------- apply ---- */

  const counts = {
    base: 0, moved: 0, unexplained: 0, newLayers: 0, notMember: 0, sheet: 0, notAVariant: 0,
  };
  const perVariant = new Map<string, number>();
  const notMember: string[] = [];

  for (const drug of backup.drugs) {
    const byLabel = taught.get(drug.slug) ?? new Map<string, string | null>();
    const member = new Set((drug.tags ?? []).map(
      (entry) => (typeof entry === 'string' ? entry : entry.tag),
    ));
    const fromSheet = sheetBy.get((drug.genericName ?? '').trim().toLowerCase())
      ?? new Set<string>();

    const own: string[] = [];
    const byVariant = new Map<string, string[]>();

    for (const label of drug.indications ?? []) {
      // Rule 0, and first because the replay cannot see it: the seeder wrote no
      // audit rows, so a sheet indication looks exactly like one the first
      // import to touch the drug added.
      if (fromSheet.has(canonicalIndication(label))) {
        counts.sheet += 1; own.push(label); continue;
      }

      const variant = byLabel.get(label);
      if (variant === undefined) { counts.unexplained += 1; own.push(label); continue; }
      /*
       * Three ways a label stays the drug's own, and all three are the same
       * fact: there is no version here to be a variation on.
       *
       * Rule 3 found no version. The version found *is* the drug's own
       * profile, which is what `variantLayerFor` refuses for fields. Or the
       * drug has since left that class, where a layer would be unreadable --
       * the profile, the browse filter and the study scope all require
       * membership, so an indication filed there would simply vanish.
       */
      if (variant === null || variant === (drug.baseVariant ?? null)) {
        counts.base += 1; own.push(label); continue;
      }
      if (!VARIANT_KINDS.has(kindOf.get(variant) ?? '')) {
        counts.notAVariant += 1; own.push(label); continue;
      }
      if (!member.has(variant)) {
        counts.notMember += 1;
        notMember.push(`${drug.slug}: ${label} -> ${variant}`);
        own.push(label);
        continue;
      }
      byVariant.set(variant, [...(byVariant.get(variant) ?? []), label]);
      counts.moved += 1;
      perVariant.set(variant, (perVariant.get(variant) ?? 0) + 1);
    }

    if (byVariant.size === 0) continue;
    drug.indications = own;
    drug.variants = drug.variants ?? [];
    for (const [slug, labels] of byVariant) {
      const found = drug.variants.find((entry) => entry.variant === slug);
      if (found) { found.indications = labels; continue; }
      // A version that taught only which conditions the drug is for and
      // reworded nothing: a layer with no fields, which `variantOptionsFor`
      // numbers on the row existing rather than on what is in it.
      drug.variants.push({ variant: slug, fields: {}, note: null, indications: labels });
      counts.newLayers += 1;
    }
  }

  /* ------------------------------------------------------------ report ---- */

  const byRule = [1, 2, 3].map((rule) => report.filter((row) => row.rule === rule));
  console.log('Attribution events, by rule:');
  console.log(`  1 this drug gained the tag : ${byRule[0].length} events, ${byRule[0].reduce((n, r) => n + r.labels, 0)} labels`);
  console.log(`  2 the import gained the tag: ${byRule[1].length} events, ${byRule[1].reduce((n, r) => n + r.labels, 0)} labels`);
  console.log(`  3 nothing was tagged (base): ${byRule[2].length} events, ${byRule[2].reduce((n, r) => n + r.labels, 0)} labels`);
  console.log();
  console.log('Labels, as they end up:');
  console.log(`  moved to a version : ${counts.moved}`);
  console.log(`  stayed on the drug : ${counts.sheet} the class sheet's own wording`);
  console.log(`                     + ${counts.base} attributed to its own profile`);
  console.log(`                     + ${counts.unexplained} the audit log never explains`);
  console.log(`                     + ${counts.notAVariant} claimed by a list, which cannot hold a version`);
  console.log(`                     + ${counts.notMember} whose version the drug has since left`);
  console.log(`  layers created     : ${counts.newLayers} (a version that taught no field of its own)`);
  console.log();
  console.log('Per version:');
  for (const [slug, n] of [...perVariant].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${slug}`);
  }
  if (notMember.length > 0) {
    console.log();
    console.log('Left on the drug because it is no longer on that list:');
    for (const line of notMember) console.log(`  ${line}`);
  }

  if (!write) {
    console.log();
    console.log('Dry run. Pass --write to produce the attributed file.');
    return;
  }
  writeFileSync(out, JSON.stringify(backup, null, 2));
  console.log();
  console.log(`Wrote ${out}`);
}

main();
