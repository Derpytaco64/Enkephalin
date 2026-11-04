import { eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import {
  auditLog, dosingRegimens, drugBrands, drugIndications, drugTags, drugs, fieldDefs,
  indications, sessions, users,
} from '@/db/schema';
import { notesFor, parseDosing } from '@/lib/dosing/parse';
import { indicationSlug } from '@/lib/drugs/indications';
import { createDrug, rebuildRegimens, setDrugIndications } from '@/lib/drugs/mutations';
import { CORE_FIELD_DEFS } from '@/lib/fields/core-fields';

/**
 * A dose can belong to one indication.
 *
 * Sildenafil is the reason: 20 mg three times a day for pulmonary hypertension
 * as Revatio, 50 mg an hour beforehand for erectile dysfunction as Viagra, and
 * both brands on the top-drugs list. It carried one dosing row -- the pulmonary
 * one -- and the quiz keyed it as *the* answer, so the app drilled the less
 * familiar half and never mentioned the other.
 *
 * The branch lives in the prose, one line per indication, because these rows
 * are a *reading* of the prose and are replaced wholesale whenever it is
 * edited. A column somebody ticked beside them would be lost on the next
 * re-read; a sentence cannot be.
 */

const ADMIN = 'user-admin';
const NL = String.fromCharCode(10);

/** The two-branch prose, written the way the editor would type it. */
const SPLIT = [
  'Pulmonary hypertension: 20 mg by mouth three times a day',
  'Erectile dysfunction: 50 mg by mouth 1 hour prior to sexual activity',
].join(NL + NL);

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(dosingRegimens);
  await db.delete(drugTags);
  await db.delete(drugBrands);
  await db.delete(drugIndications);
  await db.delete(indications);
  await db.delete(drugs);
  await db.delete(fieldDefs);
  await db.delete(sessions);
  await db.delete(users);

  await db.insert(users).values({ id: ADMIN, email: 'admin@example.test', role: 'admin' });
  await db.insert(fieldDefs).values(CORE_FIELD_DEFS);
});

describe('reading a branch out of the prose', () => {
  it('splits one line per indication', () => {
    const read = parseDosing(SPLIT);
    expect(read.regimens.map((regimen) => regimen.indication))
      .toEqual(['Pulmonary hypertension', 'Erectile dysfunction']);
  });

  it('leaves an ordinary dosing alone', () => {
    const read = parseDosing('20 mg by mouth three times a day');
    expect(read.status).toBe('parsed');
    expect(read.regimens.every((regimen) => regimen.indication === null)).toBe(true);
  });

  it('is not fooled by the colons the sheet already ships', () => {
    // All five of them, verbatim. Every one is a phase or a product form on a
    // single line, which is why requiring two labelled *lines* is safe.
    const sheet = [
      'Initial dose: 2-5 mcg/kg/minute IV titrated to clinical effect',
      'IV bolus: 5-10 mg once, may repeat dose (MAX total 50 mg)',
      'Initial: 0.5-1 milliunit/min IV; gradually increase dose in increments of 1-2 milliunits',
      'Immediate release product: 5 mg by mouth every 4-6 hours as needed '
        + 'Extended release product: 10-20 mg by mouth two times a day',
      'Initial IV bolus: 0.1-0.2 mg/kg, Continuous infusion: 1-3 mcg/kg/min',
    ];
    for (const prose of sheet) {
      expect(parseDosing(prose).regimens.every((regimen) => regimen.indication === null), prose)
        .toBe(true);
    }
  });

  it('refuses the form unless every line is labelled', () => {
    // Half-written is not half-read: one bare line and the whole thing is read
    // the old way, which is the only reading that cannot be wrong.
    const mixed = `Pulmonary hypertension: 20 mg by mouth three times a day${NL}50 mg by mouth once a day`;
    expect(parseDosing(mixed).regimens.every((regimen) => regimen.indication === null)).toBe(true);
  });

  it('refuses a phase word as a heading, even on two lines', () => {
    const phases = `Initial: 200 mg by mouth once${NL}Maintenance: 100 mg by mouth once a day`;
    expect(parseDosing(phases).regimens.every((regimen) => regimen.indication === null)).toBe(true);
  });

  it('refuses the same indication twice', () => {
    // Two lines naming one condition are a mistake, not a branch, and would
    // collide on the unique index.
    const twice = `Anxiety: 1 mg by mouth once a day${NL}Anxiety: 2 mg by mouth once a day`;
    expect(parseDosing(twice).regimens.every((regimen) => regimen.indication === null)).toBe(true);
  });

  it('recurses exactly one level, because a branch has no newline', () => {
    // The block path calls parseDosing again per branch. If a branch could
    // itself look like blocks this would not terminate.
    const read = parseDosing(SPLIT);
    expect(read.regimens).toHaveLength(2);
    for (const regimen of read.regimens) expect(regimen.sourceText).not.toContain(NL);
  });

  it('keeps alternatives and sequences working inside a branch', () => {
    const prose = [
      'Diabetes: 10 mg by mouth once a day OR 70 mg by mouth once weekly',
      'Weight management: 2.5 mg subcutaneously once weekly',
    ].join(NL);
    const read = parseDosing(prose);
    expect(read.regimens.map((regimen) => [regimen.indication, regimen.alternative])).toEqual([
      ['Diabetes', 0], ['Diabetes', 1], ['Weight management', 0],
    ]);
  });
});

describe('a branch that cannot be read keeps its place', () => {
  it('stores the unreadable one and the readable one both', () => {
    // Sildenafil exactly. "1 hour prior to sexual activity" is a timing this
    // model has no shape for, and inventing one to fit one drug is what the
    // parser refuses to do -- but failing the pair would throw away the good
    // branch *and* the split, which is the thing being fixed.
    const read = parseDosing(SPLIT);
    expect(read.status).toBe('needs_review');
    expect(read.regimens).toHaveLength(2);

    const [pulmonary, erectile] = read.regimens;
    expect(pulmonary.amounts).toHaveLength(1);
    expect(erectile.amounts).toHaveLength(0);
    expect(erectile.sourceText).toContain('50 mg by mouth 1 hour prior to sexual activity');
  });

  it('is refused only when every branch is', () => {
    const prose = `Anxiety: as directed${NL}Insomnia: per protocol`;
    expect(parseDosing(prose).status).toBe('refused');
    expect(parseDosing(prose).regimens).toEqual([]);
  });

  it('files each note under the branch it came from', () => {
    const read = parseDosing(SPLIT);
    expect(notesFor(read, 'Erectile dysfunction')).toEqual([
      expect.stringContaining('Left unread'),
    ]);
    // The clean branch has none, which is the whole point of filing them.
    expect(notesFor(read, 'Pulmonary hypertension')).toEqual([]);
    // And nothing is attributed to the drug as a whole.
    expect(notesFor(read, null)).toEqual([]);
  });

  it('still prints every note with its branch named, for a reader', () => {
    // `notes` is what the editor and the bench show, so it has to say which
    // branch each one is about even though nothing reads it back.
    expect(parseDosing(SPLIT).notes).toEqual([
      expect.stringMatching(/^Erectile dysfunction: /),
    ]);
  });
});

describe('notesFor', () => {
  it('reads the structure, not the spelling of a note', () => {
    // The version this replaced tagged the strings and read them back with a
    // regex. Notes contain colons of their own, so `Left unread: kg.` parsed
    // as a branch called "Left unread" and the row that owned it got nothing
    // -- which made a refused dosing look settled.
    const refused = parseDosing('50 mg by mouth 1 hour prior to sexual activity');
    expect(refused.status).toBe('refused');
    expect(refused.notes.join(' ')).toContain('Left unread');
    expect(notesFor(refused, null)).toEqual(refused.notes);
  });

  it('hands an unsplit dosing all of its notes, whatever is asked for', () => {
    const read = parseDosing('apply to the affected area');
    expect(read.branches).toEqual([]);
    expect(notesFor(read, null)).toEqual(read.notes);
    expect(notesFor(read, 'Anxiety')).toEqual(read.notes);
  });

  it('matches a branch by name, case aside', () => {
    const read = parseDosing(SPLIT);
    expect(notesFor(read, 'erectile dysfunction')).toEqual(notesFor(read, 'Erectile dysfunction'));
  });
});

describe('storing a branch', () => {
  async function sildenafil() {
    const created = await createDrug({
      genericName: 'Sildenafil',
      drugClass: 'Phosphodiesterase 5 Inhibitor',
      schedule: '',
      scheduleNote: '',
      brands: `Revatio${NL}Viagra`,
      indications: `Pulmonary hypertension${NL}Erectile dysfunction`,
      dosing: '20 mg by mouth three times a day',
      dosingUnique: false,
      tagSlugs: [],
    }, ADMIN);
    if (!created.ok || created.value === undefined) throw new Error('fixture failed');

    const [drug] = await db.select().from(drugs).where(eq(drugs.slug, created.value));
    return drug;
  }

  /** Each row with the indication it is filed under, by label. */
  async function rows(drugId: string) {
    const found = await db
      .select({
        label: indications.label,
        sourceText: dosingRegimens.sourceText,
        needsReview: dosingRegimens.needsReview,
        notes: dosingRegimens.reviewNotes,
      })
      .from(dosingRegimens)
      .leftJoin(drugIndications, eq(drugIndications.id, dosingRegimens.indicationId))
      .leftJoin(indications, eq(indications.id, drugIndications.indicationId))
      .where(eq(dosingRegimens.drugId, drugId));
    return found;
  }

  it('files each dose under one of the drug’s own indications', async () => {
    const drug = await sildenafil();
    await rebuildRegimens(drug.id, drug.genericName, SPLIT, ADMIN);

    const found = await rows(drug.id);
    expect(found.map((row) => row.label).sort())
      .toEqual(['Erectile dysfunction', 'Pulmonary hypertension']);
  });

  it('gives each row only its own notes', async () => {
    // The bug this prevents: the branch that read perfectly being listed as
    // review work because a different branch did not, which would fill the
    // dosing bench with phantom work.
    const drug = await sildenafil();
    await rebuildRegimens(drug.id, drug.genericName, SPLIT, ADMIN);

    const found = await rows(drug.id);
    const clean = found.find((row) => row.label === 'Pulmonary hypertension');
    const messy = found.find((row) => row.label === 'Erectile dysfunction');

    expect(clean?.needsReview).toBe(false);
    expect(clean?.notes).toEqual([]);
    expect(messy?.needsReview).toBe(true);
    expect(messy?.notes.join(' ')).toContain('Left unread');
  });

  it('will not file a dose under an indication the drug does not have', async () => {
    // Not dropped and not guessed at: the dose stores with no indication and
    // says why, so it reaches the bench instead of quietly becoming a dose for
    // the whole drug.
    const drug = await sildenafil();
    const prose = [
      'Pulmonary hypertension: 20 mg by mouth three times a day',
      'Hair loss: 1 mg by mouth once a day',
    ].join(NL);
    await rebuildRegimens(drug.id, drug.genericName, prose, ADMIN);

    const found = await rows(drug.id);
    const orphan = found.find((row) => row.label === null);
    expect(orphan).toBeDefined();
    expect(orphan?.needsReview).toBe(true);
    expect(orphan?.notes.join(' ')).toContain('"Hair loss" is not one of this drug');
  });

  it('matches a heading through the alias table, not by spelling', async () => {
    const drug = await sildenafil();
    await setDrugIndications(drug.slug, `Pulmonary hypertension${NL}Seizures`, ADMIN);
    // The sheet writes this indication both ways and the vocabulary stores the
    // plural, so a dosing line written the other way has to reach it through
    // the alias table rather than by matching the stored label.
    await rebuildRegimens(
      drug.id, drug.genericName,
      `Seizure: 1 mg by mouth once a day${NL}Pulmonary hypertension: 20 mg by mouth three times a day`,
      ADMIN,
    );

    // Both filed, neither orphaned -- and the seizure row landed on the
    // vocabulary's own wording rather than on the one the dosing line used,
    // which is the alias table doing its job in a third place.
    const found = await rows(drug.id);
    expect(found.filter((row) => row.label === null)).toEqual([]);
    expect(found.map((row) => indicationSlug(row.label ?? '')).sort())
      .toEqual(['pulmonary-hypertension', 'seizures']);
  });

  it('loses the branch when the prose stops naming one', async () => {
    // Which is the point of keeping it in the prose: there is one source of
    // truth, and editing it is how you change the answer.
    const drug = await sildenafil();
    await rebuildRegimens(drug.id, drug.genericName, SPLIT, ADMIN);
    await rebuildRegimens(drug.id, drug.genericName, '20 mg by mouth three times a day', ADMIN);

    const found = await rows(drug.id);
    expect(found).toHaveLength(1);
    expect(found[0].label).toBeNull();
  });
});

describe('the unique index the schema comment claims', () => {
  it('coalesces the indication, so the unscoped case is still constrained', async () => {
    // In Postgres nulls are distinct, so indexing the bare column would stop
    // constraining every drug but the split ones -- which is the case the index
    // was added for. Drizzle cannot express the expression, so the schema
    // states the columns and this checks the database.
    const [row] = await db.execute<{ indexdef: string }>(sql`
      select indexdef from pg_indexes where indexname = 'dosing_regimens_unique'`);

    const indexdef = row.indexdef.toLowerCase();
    expect(indexdef).toContain('coalesce');
    expect(indexdef).toContain('indication_id');
  });
});
