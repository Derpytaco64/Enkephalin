import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, drugs, tags, users } from '@/db/schema';
import { BACKUP_VERSION, exportBackup, restoreBackup } from '@/lib/data/backup';

/**
 * The audit log joining the backup, 2026-11-08.
 *
 * It was the one thing in the database that a move to a new server would
 * silently drop, and the two ways this can go quietly wrong are both about
 * fidelity rather than plumbing. **Microseconds**: `timestamptz` keeps them and
 * `Date` does not, so a round trip through the wrong type reorders a history --
 * the same truncation that cost the audit UI 23 rows, one layer down.
 * **Natural keys**: the file carries no UUIDs, so an entry has to name its
 * actor and subject by something a different database can resolve, and has to
 * survive the subject no longer existing.
 */

const OWNER = 'owner-id';

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(drugs);
  await db.delete(tags);
  await db.delete(users);
  await db.insert(users).values({ id: OWNER, email: 'owner@example.test', role: 'admin' });
});

async function seedDrug(slug: string) {
  const [row] = await db.insert(drugs)
    .values({ slug, genericName: slug, fields: {} })
    .returning({ id: drugs.id });
  return row.id;
}

/** Writes one entry at an exact instant, microseconds included. */
async function entryAt(stamp: string, values: Record<string, unknown>) {
  await db.insert(auditLog).values({ action: 'drug.field', ...values } as never);
  await db.execute(sql`
    update ${auditLog} set at = ${stamp}::timestamptz
    where id = (select id from ${auditLog} order by at desc limit 1)`);
}

describe('what the file carries', () => {
  it('names the actor by email and the subject by slug, with no uuids', async () => {
    const drugId = await seedDrug('dofetilide');
    await db.insert(auditLog).values({
      actorId: OWNER, action: 'drug.field', targetType: 'drug', targetId: drugId,
      diff: { dosing: { from: '500 mg', to: '500 mcg' } },
    });

    const backup = await exportBackup();
    expect(backup.audit).toHaveLength(1);

    const [entry] = backup.audit;
    expect(entry.actorEmail).toBe('owner@example.test');
    expect(entry.target).toBe('dofetilide');
    expect(entry.targetType).toBe('drug');
    expect(entry.diff).toEqual({ dosing: { from: '500 mg', to: '500 mcg' } });

    // The whole-file promise: nothing internal leaks into something you might
    // email yourself.
    expect(JSON.stringify(backup.audit)).not.toContain(drugId);
    expect(JSON.stringify(backup.audit)).not.toContain(OWNER);
  });

  it('counts the entries alongside everything else', async () => {
    await db.insert(auditLog).values([
      { actorId: OWNER, action: 'tag.create' },
      { actorId: OWNER, action: 'tag.delete' },
    ]);
    expect((await exportBackup()).counts.auditEntries).toBe(2);
  });

  it('keeps an entry whose subject has since been deleted', async () => {
    // Exactly the shape a deletion leaves behind: a target_id pointing at
    // nothing, and the name only in the diff.
    await db.insert(auditLog).values({
      actorId: OWNER, action: 'drug.delete', targetType: 'drug',
      targetId: '00000000-0000-0000-0000-000000000001',
      diff: { slug: 'gone', generic: 'Gone' },
    });

    const [entry] = (await exportBackup()).audit;
    expect(entry.target).toBeNull();
    expect(entry.action).toBe('drug.delete');
    expect(entry.diff).toEqual({ slug: 'gone', generic: 'Gone' });
  });

  it('keeps an entry with no actor at all', async () => {
    await db.insert(auditLog).values({ actorId: null, action: 'drug.create' });
    const [entry] = (await exportBackup()).audit;
    expect(entry.actorEmail).toBeNull();
  });

  it('is oldest first, so a restore writes the history in order', async () => {
    await entryAt('2026-01-01T00:00:00.000000Z', { actorId: OWNER, action: 'tag.create' });
    await entryAt('2026-06-01T00:00:00.000000Z', { actorId: OWNER, action: 'tag.rename' });
    await entryAt('2026-03-01T00:00:00.000000Z', { actorId: OWNER, action: 'tag.delete' });

    const actions = (await exportBackup()).audit.map((entry) => entry.action);
    expect(actions).toEqual(['tag.create', 'tag.delete', 'tag.rename']);
  });
});

describe('precision', () => {
  /**
   * The one that matters. A `Date` holds milliseconds, the column holds
   * microseconds, and a history that loses them is a history whose rows can
   * swap places.
   */
  it('carries microseconds out and back without losing them', async () => {
    await entryAt('2026-11-04T17:47:47.329008Z', { actorId: OWNER, action: 'dosing.reparsed' });

    const backup = await exportBackup();
    expect(backup.audit[0].at).toBe('2026-11-04T17:47:47.329008Z');

    await db.delete(auditLog);
    const result = await restoreBackup(backup, 'replace');
    expect(result.ok).toBe(true);

    const [row] = await db.execute<{ exact: string }>(sql`
      select to_char(at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as exact
      from ${auditLog}`);
    expect(row.exact).toBe('2026-11-04T17:47:47.329008Z');
  });

  it('keeps the order of two entries inside one millisecond', async () => {
    await entryAt('2026-11-04T17:47:47.329001Z', { actorId: OWNER, action: 'first' });
    await entryAt('2026-11-04T17:47:47.329002Z', { actorId: OWNER, action: 'second' });

    const backup = await exportBackup();
    await restoreBackup(backup, 'replace');

    const rows = await db.execute<{ action: string }>(sql`
      select action from ${auditLog} order by at asc`);
    expect([...rows].map((row) => row.action)).toEqual(['first', 'second']);
  });
});

describe('restoring it', () => {
  it('resolves the subject against the database it lands in', async () => {
    const drugId = await seedDrug('dofetilide');
    await db.insert(auditLog).values({
      actorId: OWNER, action: 'drug.field', targetType: 'drug', targetId: drugId,
    });
    const backup = await exportBackup();

    // A different database: same drug slug, a new uuid behind it.
    await db.delete(auditLog);
    await db.delete(drugs);
    const freshId = await seedDrug('dofetilide');
    expect(freshId).not.toBe(drugId);

    await restoreBackup(backup, 'replace');
    const [row] = await db.select().from(auditLog);
    expect(row.targetId).toBe(freshId);
  });

  it('replace clears what was there first', async () => {
    await db.insert(auditLog).values({ actorId: OWNER, action: 'tag.create' });
    const backup = await exportBackup();

    await db.insert(auditLog).values({ actorId: OWNER, action: 'tag.delete' });
    const result = await restoreBackup(backup, 'replace');

    expect(result.ok && result.report.auditRestored).toBe(1);
    const rows = await db.select().from(auditLog);
    expect(rows.map((row) => row.action)).toEqual(['tag.create']);
  });

  /**
   * The log is append-only history, so a merge that re-inserted everything
   * would duplicate a record whose value is being a faithful count.
   */
  it('merge adds only what is not already there', async () => {
    await entryAt('2026-05-05T05:05:05.050505Z', { actorId: OWNER, action: 'tag.create' });
    const backup = await exportBackup();

    const result = await restoreBackup(backup, 'merge');
    expect(result.ok && result.report.auditRestored).toBe(0);
    expect(result.ok && result.report.auditSkipped).toBe(1);
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });

  it('merge still adds an entry the database has not seen', async () => {
    await entryAt('2026-05-05T05:05:05.050505Z', { actorId: OWNER, action: 'tag.create' });
    const backup = await exportBackup();

    await db.delete(auditLog);
    await entryAt('2026-07-07T07:07:07.070707Z', { actorId: OWNER, action: 'tag.delete' });

    const result = await restoreBackup(backup, 'merge');
    expect(result.ok && result.report.auditRestored).toBe(1);
    const rows = await db.select().from(auditLog);
    expect(rows.map((row) => row.action).sort()).toEqual(['tag.create', 'tag.delete']);
  });

  it('keeps an entry whose actor has no account here, and says whose', async () => {
    await db.insert(auditLog).values({ actorId: OWNER, action: 'drug.field' });
    const backup = await exportBackup();

    // Restore into a database where that person does not exist.
    await db.delete(auditLog);
    await db.delete(users);
    const result = await restoreBackup(backup, 'replace');

    expect(result.ok && result.report.auditRestored).toBe(1);
    expect(result.ok && result.report.auditActorsUnmatched).toEqual(['owner@example.test']);

    const [row] = await db.select().from(auditLog);
    expect(row.actorId).toBeNull();
    expect(row.action).toBe('drug.field');
  });

  it('handles a file with no audit log at all', async () => {
    const backup = await exportBackup();
    const result = await restoreBackup({ ...backup, audit: undefined }, 'replace');
    expect(result.ok).toBe(true);
  });
});

describe('the version', () => {
  // The number itself is pinned once, in tests/backup-quiz-history.test.ts --
  // two files asserting it means every bump fails twice and says nothing extra.
  it('is past the version that had no audit log', () => {
    expect(BACKUP_VERSION).toBeGreaterThan(1);
  });

  it('refuses the older shape rather than half-reading it', async () => {
    const backup = await exportBackup();
    const result = await restoreBackup({ ...backup, version: 1 }, 'replace');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('version 1');
  });
});
