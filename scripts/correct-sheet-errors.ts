/**
 * Corrects the handful of places where the class sheet itself is wrong, so the
 * app stops teaching the error.
 *
 * This is **not** the extractor's business. `data/top-drugs-2026.json` is a
 * faithful reading of the PDF and has to stay one -- it is how we can tell a
 * bad value in the app from a bad value on the sheet, and it is regenerated
 * whenever the sheet is re-extracted. So a correction is a *human's value*
 * written over the sheet's, with its own source, exactly as if somebody had
 * typed it into the drug editor. `updatedBy` is what makes it stick: the
 * importer keeps a human's value over the sheet's unless run with --force.
 *
 * The case that forced it: **dofetilide**. The sheet prints *500 mg by mouth
 * twice daily*. The dose is 500 **mcg** -- a thousandfold error, in a drug
 * whose own black box warning is about hospitalising patients to watch for the
 * arrhythmia it can induce. Verified against the PDF (page 8) before deciding
 * where the fix belonged: the sheet really does say mg, so this is the sheet's
 * error faithfully transcribed rather than ours.
 *
 * Deliberately narrow. This file is for values that are *wrong*, not values
 * that are thin: a terse dosing line stays terse, because rewriting the sheet
 * into a better reference is a different project and the sheet is what the
 * class is examined on. Dofetilide's renal and QTc adjustments are not added
 * here for that reason.
 *
 * Re-running is safe and writes nothing the second time.
 *
 *   npx tsx scripts/correct-sheet-errors.ts
 */
import './env.ts';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { dosingRegimens, drugs, users } from '../db/schema.ts';
import { rebuildRegimens, setDrugField } from '../lib/drugs/mutations.ts';
import { listFieldDefs } from '../lib/fields/registry.ts';

type Correction = {
  generic: string;
  /** The sheet's wording, for the log -- so a reader can see what moved. */
  was: string;
  value: string;
  /** Recorded on the value: what was asserted, and on whose authority. */
  source: string;
  why: string;
};

/**
 * Dosing only, for now. A correction to another field would want the same
 * shape with a `field` key; there is nothing to correct in another field yet,
 * and a key with one possible value is a key nobody reads.
 */
const CORRECTIONS: Correction[] = [
  {
    generic: 'Dofetilide',
    was: '500 mg by mouth twice daily',
    value: '500 mcg by mouth twice daily',
    source: 'FDA labelling for Tikosyn; the class sheet prints mg where the label says mcg',
    why: 'Dofetilide is dosed in micrograms. The sheet\'s milligrams are a thousandfold '
      + 'overdose of a drug that is started in hospital on a monitor, and both the quiz and '
      + 'the profile were repeating it.',
  },
];

/** Wrapped because tsx compiles a .ts file in this package as CJS, where there is no top-level await. */
async function main() {
  // Every write here lands in `audit_log`, whose actor is a real user by
  // foreign key -- so the run is attributed to the env-seeded admin rather
  // than to a made-up name. Somebody reading the log later should see who was
  // accountable for the assertion.
  const [admin] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, process.env.ADMIN_EMAIL ?? ''));
  if (!admin) {
    console.error('No account for ADMIN_EMAIL, so there is nobody to attribute this to.');
    return;
  }
  const actorId = admin.id;
  console.log(`attributing to ${admin.email}`);

  const defs = await listFieldDefs();
  const dosing = defs.find((def) => def.key === 'dosing');
  if (!dosing) throw new Error('No dosing field is defined.');

  let written = 0;
  let unchanged = 0;

  for (const fix of CORRECTIONS) {
    const [drug] = await db.select().from(drugs).where(eq(drugs.genericName, fix.generic));
    if (!drug) {
      console.error(`  ! ${fix.generic}: no such drug`);
      continue;
    }

    const current = drug.fields.dosing?.value ?? '';

    // Refuse rather than correct a value that is no longer the one this entry
    // was written against. An edit in the admin UI, or a corrected sheet in
    // next year's edition, should not be silently reverted to a fix for a
    // sentence that is already gone.
    if (current !== fix.was && current !== fix.value) {
      console.error(`  ! ${fix.generic}: dosing now reads ${JSON.stringify(current)},`);
      console.error('      which is neither the sheet\'s wording nor the correction.');
      console.error('      Check it by hand and update or drop this entry.');
      continue;
    }

    // Idempotent on the *result*, not just on the prose: the field and the rows
    // read off it must both be current. Matching prose with a stale regimen row
    // behind it is a half-done run -- the state a failed audit write after a
    // saved field leaves -- and calling that done would leave the parsed dose
    // wrong for good.
    const [row] = await db
      .select({ sourceText: dosingRegimens.sourceText })
      .from(dosingRegimens)
      .where(eq(dosingRegimens.drugId, drug.id));

    if (current === fix.value && row?.sourceText === fix.value) {
      unchanged += 1;
      console.log(`  = ${fix.generic}: already corrected`);
      continue;
    }

    const result = await setDrugField(
      drug.slug,
      dosing,
      { key: 'dosing', value: fix.value, source: fix.source, status: 'ok' },
      actorId,
    );
    if (!result.ok) {
      console.error(`  ! ${fix.generic}: ${result.message}`);
      continue;
    }

    // `setDrugField` re-reads the regimens itself when it writes the dosing
    // field -- but it returns early *without* writing when the value, source
    // and status already all match, which is exactly the half-done state above.
    // Then the rows are still the old prose's and nothing else will fix them,
    // so the repair path has to re-read them here. Only here: calling it
    // unconditionally logs a second `dosing.reparsed` for one edit, and loses
    // `unique` -- the human saying "the sig is simply like that" -- by not
    // passing it, which would push a settled drug back into the review queue.
    let rows = await db
      .select({
        sourceText: dosingRegimens.sourceText,
        needsReview: dosingRegimens.needsReview,
        notes: dosingRegimens.reviewNotes,
      })
      .from(dosingRegimens)
      .where(eq(dosingRegimens.drugId, drug.id));

    if (rows[0]?.sourceText !== fix.value) {
      await rebuildRegimens(
        drug.id, drug.genericName, fix.value, actorId, { unique: drug.dosingUnique },
      );
      rows = await db
        .select({
          sourceText: dosingRegimens.sourceText,
          needsReview: dosingRegimens.needsReview,
          notes: dosingRegimens.reviewNotes,
        })
        .from(dosingRegimens)
        .where(eq(dosingRegimens.drugId, drug.id));
    }

    written += 1;
    console.log(`  + ${fix.generic}: ${JSON.stringify(fix.was)} -> ${JSON.stringify(fix.value)}`);
    for (const r of rows) {
      console.log(`      ${r.sourceText}${r.needsReview ? '  [needs review]' : ''}`);
      for (const note of r.notes) console.log(`        ${note}`);
    }
    console.log(`      why: ${fix.why}`);
  }

  console.log(`\n${written} corrected, ${unchanged} already correct`);
}

void main().then(() => process.exit(0));
