/**
 * Reads every drug's dosing prose into `dosing_regimens`.
 *
 * Every drug gets a row, including the ones whose wording the parser cannot
 * decompose. Those arrive with no components, `needs_review` set and the
 * reason recorded, carrying their prose in `source_text` -- so the dosing is
 * present and askable rather than absent, which is what the quiz needs and
 * what a blank row could not give it.
 *
 * What a component-less row cannot support is the strict distractor check: with
 * nothing to compare, the engine cannot prove a wrong option is not also right
 * for this drug. Those rows are marked, and phase 6 falls back to comparing the
 * wording. See PLAN.md.
 *
 * Safe to re-run: the prose is the source and these rows are a reading of it,
 * so every run replaces them. Improving the parser is a re-run rather than a
 * migration.
 *
 *   node --experimental-strip-types scripts/backfill-dosing.ts
 */
import './env.ts';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { dosingRegimens, drugs } from '../db/schema.ts';
import { activesOf, parseDosing } from '../lib/dosing/parse.ts';
import { toSig } from '../lib/dosing/sig.ts';

const rows = await db
  .select({
    id: drugs.id,
    generic: drugs.genericName,
    fields: drugs.fields,
  })
  .from(drugs);

const report = {
  parsed: 0,
  needsReview: 0,
  refused: 0,
  noDosing: 0,
  regimens: 0,
};
const refusedNames: string[] = [];

for (const drug of rows) {
  const prose = String(drug.fields.dosing?.value ?? '').trim();
  if (!prose) {
    report.noDosing += 1;
    continue;
  }

  const existing = await db
    .select({ id: dosingRegimens.id })
    .from(dosingRegimens)
    .where(eq(dosingRegimens.drugId, drug.id));

  if (existing.length > 0) {
    await db.delete(dosingRegimens).where(inArray(dosingRegimens.id, existing.map((row) => row.id)));
  }

  const result = parseDosing(prose, activesOf(drug.generic));
  report[result.status === 'parsed' ? 'parsed' : result.status === 'refused' ? 'refused' : 'needsReview'] += 1;
  if (result.status === 'refused') refusedNames.push(drug.generic);

  // A refused parse still becomes a row. Its components are empty, because
  // nothing was read that can be trusted, and its prose is the content.
  const regimens = result.regimens.length > 0
    ? result.regimens
    : [{
      sourceText: prose,
      alternative: 0,
      step: 0,
      label: null,
      amounts: [],
      routes: [],
      site: null,
      frequency: { kind: 'unspecified' as const },
      modifiers: [],
      duration: null,
      ceiling: null,
      qualifiers: [],
    }];

  await db.insert(dosingRegimens).values(regimens.map((regimen) => ({
    drugId: drug.id,
    alternative: regimen.alternative,
    step: regimen.step,
    label: regimen.label,
    sourceText: regimen.sourceText || prose,
    amounts: regimen.amounts,
    routes: regimen.routes,
    site: regimen.site,
    frequency: regimen.frequency,
    modifiers: regimen.modifiers,
    duration: regimen.duration,
    ceiling: regimen.ceiling,
    qualifiers: regimen.qualifiers,
    needsReview: result.status !== 'parsed',
    reviewNotes: result.status === 'refused'
      ? [...result.notes, 'Stored with no components so the dosing is still askable; the wording is the answer.']
      : result.notes,
    source: 'class sheet dosing text, parsed',
  })));

  report.regimens += regimens.length;
}

console.log(`drugs:     ${report.parsed} parsed, ${report.needsReview} need review, ${report.refused} refused`);
console.log(`           ${report.noDosing} with no dosing text`);
console.log(`regimens:  ${report.regimens} rows written`);

// A spot check in the output, so a run that silently mangles everything is
// visible without opening psql.
const sample = await db
  .select({ sourceText: dosingRegimens.sourceText, amounts: dosingRegimens.amounts, frequency: dosingRegimens.frequency, routes: dosingRegimens.routes, modifiers: dosingRegimens.modifiers, duration: dosingRegimens.duration, ceiling: dosingRegimens.ceiling, qualifiers: dosingRegimens.qualifiers, site: dosingRegimens.site, label: dosingRegimens.label, step: dosingRegimens.step, alternative: dosingRegimens.alternative })
  .from(dosingRegimens)
  .limit(3);
console.log('\nsample:');
for (const row of sample) {
  console.log(`  ${row.sourceText}`);
  console.log(`    -> ${toSig(row as never) || '(no components)'}`);
}

if (refusedNames.length > 0) {
  console.log(`\nstored with no components, flagged for review (${refusedNames.length}):`);
  for (const name of refusedNames) console.log(`  ${name}`);
}

process.exit(0);
