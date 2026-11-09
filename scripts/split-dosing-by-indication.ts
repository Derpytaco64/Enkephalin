/**
 * Rewrites the dosing prose of the drugs whose dose depends on which condition
 * they are being given for, so the app stops teaching one branch as the whole
 * answer.
 *
 * The case that forced it: **sildenafil**. The sheet gives it one dosing line,
 * *20 mg by mouth three times a day*, which is Revatio's pulmonary-hypertension
 * dose. Viagra's *50 mg an hour before sexual activity* was recorded only on
 * the brand row, where the profile shows it and no card or question ever did.
 * Both brands are on the top-drugs list, so a student was being drilled on the
 * less familiar half and never shown the other.
 *
 * The prose is the source of truth for dosing and the structured rows are a
 * reading of it, so the fix belongs **in the prose**: one line per indication,
 * `Pulmonary hypertension: 20 mg by mouth three times a day`. `parseDosing`
 * reads the headings, `rebuildRegimens` files each row under that indication,
 * and nothing has to be preserved by hand across a re-read.
 *
 * Every value lands with `updatedBy` set, which is what stops a later
 * `npm run seed` putting the sheet's single line back: the importer keeps a
 * human's value over the sheet's unless run with --force.
 *
 * Re-running is safe and writes nothing the second time.
 *
 *   npx tsx scripts/split-dosing-by-indication.ts
 */
import './env.ts';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { dosingRegimens, drugs, users } from '../db/schema.ts';
import { rebuildRegimens, setDrugField } from '../lib/drugs/mutations.ts';
import { listFieldDefs } from '../lib/fields/registry.ts';

/** Recorded on the value, so what was asserted and on whose authority is auditable. */
const SOURCE = 'FDA labelling for each brand, applied in review';

type Split = {
  generic: string;
  /** Indication label -> that indication's dose, in the sheet's own register. */
  doses: Record<string, string>;
  why: string;
};

const SPLITS: Split[] = [
  {
    generic: 'Sildenafil',
    doses: {
      'Pulmonary hypertension': '20 mg by mouth three times a day',
      'Erectile dysfunction': '50 mg by mouth 1 hour prior to sexual activity',
    },
    why: 'One molecule, two labels and two brands, both on the list: Revatio for pulmonary '
      + 'arterial hypertension at 20 mg three times daily, Viagra for erectile dysfunction at '
      + '50 mg an hour beforehand. The sheet carries only the first, and the second was on the '
      + 'brand row where nothing studied could reach it.',
  },
];

/**
 * Wrapped rather than written at the top level because tsx compiles a .ts file
 * in this package as CJS, where top-level await is not available -- and the
 * run command people will copy is the one in the comment above, which needs
 * tsx for the `@/` paths that `lib/` imports itself with.
 */
async function main() {
  // Every write here lands in `audit_log`, whose actor is a real user by
  // foreign key -- so the run is attributed to the env-seeded admin rather
  // than to a made-up name. Somebody reading the log later should see who was
  // accountable for the assertion, and `source` on the value says what it was
  // read off.
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

  for (const split of SPLITS) {
    const [drug] = await db.select().from(drugs).where(eq(drugs.genericName, split.generic));
    if (!drug) {
      console.error(`  ! ${split.generic}: no such drug`);
      continue;
    }

    // Blank line between branches: `indicationBlocks` only needs the newline,
    // but the profile renders the field as markdown, and two paragraphs read as
    // two statements rather than as one wrapped sentence.
    const prose = Object.entries(split.doses)
      .map(([indication, dose]) => `${indication}: ${dose}`)
      .join('\n\n');

    // Idempotent on the *result*, not just on the prose. Matching prose with
    // no indication-scoped rows behind it is a half-done run -- which is
    // exactly the state the first attempt here left, when the audit write
    // failed after the field had already been saved -- and a script that
    // called that done would leave it broken for good.
    const before = await db
      .select({ indicationId: dosingRegimens.indicationId })
      .from(dosingRegimens)
      .where(eq(dosingRegimens.drugId, drug.id));
    const branched = before.filter((row) => row.indicationId !== null).length;

    if ((drug.fields.dosing?.value ?? '') === prose
      && branched === Object.keys(split.doses).length) {
      unchanged += 1;
      console.log(`  = ${split.generic}: already split`);
      continue;
    }

    const result = await setDrugField(
      drug.slug,
      dosing,
      { key: 'dosing', value: prose, source: SOURCE, status: 'ok' },
      actorId,
    );
    if (!result.ok) {
      console.error(`  ! ${split.generic}: ${result.message}`);
      continue;
    }

    // `setDrugField` re-reads the regimens itself when it writes the dosing
    // field -- but it returns early *without* writing when the value, source
    // and status already all match, which is exactly the half-done state the
    // check above exists for. Then the rows are still the unsplit prose's and
    // nothing else will fix them, so the repair path has to re-read them here.
    // Only here: calling it unconditionally logs a second `dosing.reparsed` for
    // one edit, and loses `unique` -- the human saying "the sig is simply like
    // that" -- by not passing it, which would push a settled drug back into the
    // review queue.
    const reread = await db
      .select({ indicationId: dosingRegimens.indicationId })
      .from(dosingRegimens)
      .where(eq(dosingRegimens.drugId, drug.id));
    if (reread.filter((row) => row.indicationId !== null).length
      !== Object.keys(split.doses).length) {
      await rebuildRegimens(
        drug.id, drug.genericName, prose, actorId, { unique: drug.dosingUnique },
      );
    }

    const rows = await db
      .select({
        indicationId: dosingRegimens.indicationId,
        sourceText: dosingRegimens.sourceText,
        needsReview: dosingRegimens.needsReview,
        notes: dosingRegimens.reviewNotes,
      })
      .from(dosingRegimens)
      .where(eq(dosingRegimens.drugId, drug.id));

    written += 1;
    console.log(`  + ${split.generic}: ${rows.length} rows`);
    for (const row of rows) {
      const branch = row.indicationId === null ? 'no indication' : row.indicationId.slice(0, 8);
      console.log(`      ${branch}  ${row.sourceText}${row.needsReview ? '  [needs review]' : ''}`);
      for (const note of row.notes) console.log(`        ${note}`);
    }
    console.log(`      why: ${split.why}`);
  }

  console.log(`\n${written} rewritten, ${unchanged} already split`);
}

void main().then(() => process.exit(0));
