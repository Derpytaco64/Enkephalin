import { beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, drugs, tags, users } from '@/db/schema';
import { auditCounts, listAudit, PAGE_SIZE, summarise } from '@/lib/admin/audit';

/**
 * The read side of `audit_log`, which seven modules had been writing for a
 * phase with nothing reading it.
 *
 * The tests that matter here are not the summaries -- those are prose and a
 * wrong one is visibly wrong. They are **paging** and **naming a target that no
 * longer exists**, because both fail silently: a skipped page looks like a
 * shorter history, and an unresolved target looks like an action about nothing.
 */

const ADMIN = 'user-admin';

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(tags);
  await db.delete(drugs);
  await db.delete(users);
  await db.insert(users).values({ id: ADMIN, email: 'admin@example.test', role: 'admin' });
});

/** Walks every page the way the screen's "Older entries" link does. */
async function walk() {
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 50; guard += 1) {
    const page = await listAudit({ cursor });
    seen.push(...page.rows.map((row) => row.id));
    if (!page.nextCursor) return seen;
    cursor = page.nextCursor;
  }
  throw new Error('paging did not terminate');
}

describe('paging', () => {
  /**
   * The regression that cost two pages which did not add up.
   *
   * `timestamptz` keeps microseconds; a JavaScript `Date` keeps milliseconds.
   * A cursor built from a timestamp that had been through Drizzle was already
   * truncated, so `at < cursor` excluded every row stored in the same
   * millisecond and `at = cursor` matched none of them -- and the rows between
   * the two pages vanished. A bulk write is exactly where this bites, because
   * every row it inserts shares one `now()`.
   */
  it('covers every row exactly once when more than a page share one timestamp', async () => {
    const total = PAGE_SIZE * 2 + 7;
    await db.insert(auditLog).values(
      Array.from({ length: total }, () => ({
        actorId: ADMIN, action: 'tag.delete', targetType: 'tag',
      })),
    );

    // Prove the premise rather than assuming it: one instant, with a
    // sub-millisecond component, shared by all of them.
    const [stamp] = await db
      .select({
        instants: sql<number>`count(distinct ${auditLog.at})::int`,
        micros: sql<number>`count(*) filter (
          where date_part('microsecond', ${auditLog.at})::int % 1000 <> 0
        )::int`,
      })
      .from(auditLog);
    expect(stamp.instants).toBe(1);
    expect(stamp.micros).toBe(total);

    const seen = await walk();
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
  });

  it('pages a mixed history in newest-first order with no repeats', async () => {
    const base = Date.UTC(2026, 10, 1, 12, 0, 0);
    await db.insert(auditLog).values(
      Array.from({ length: PAGE_SIZE + 5 }, (_, i) => ({
        actorId: ADMIN,
        action: 'drug.field',
        targetType: 'drug',
        at: new Date(base + i * 1000),
      })),
    );

    const first = await listAudit();
    expect(first.rows).toHaveLength(PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();

    const second = await listAudit({ cursor: first.nextCursor ?? undefined });
    expect(second.rows).toHaveLength(5);
    expect(second.nextCursor).toBeNull();

    const times = [...first.rows, ...second.rows].map((row) => row.at.getTime());
    for (let i = 0; i < times.length - 1; i += 1) expect(times[i]).toBeGreaterThanOrEqual(times[i + 1]);
  });

  it('opens at the first page when the cursor is junk rather than erroring', async () => {
    await db.insert(auditLog).values({ actorId: ADMIN, action: 'tag.create', targetType: 'tag' });

    for (const cursor of ['garbage', '', '2026-11-04T17:47:47.329Z|abc', 'null']) {
      const page = await listAudit({ cursor });
      expect(page.rows, cursor).toHaveLength(1);
    }
  });

  it('gives a filter its own page boundaries', async () => {
    await db.insert(auditLog).values([
      ...Array.from({ length: 3 }, () => ({
        actorId: ADMIN, action: 'tag.delete', targetType: 'tag',
      })),
      ...Array.from({ length: 2 }, () => ({
        actorId: ADMIN, action: 'drug.field', targetType: 'drug',
      })),
    ]);

    const tagsOnly = await listAudit({ action: 'tag.delete' });
    expect(tagsOnly.rows).toHaveLength(3);
    expect(tagsOnly.rows.every((row) => row.action === 'tag.delete')).toBe(true);

    const nothing = await listAudit({ action: 'tag.delete', targetType: 'drug' });
    expect(nothing.rows).toHaveLength(0);
    expect(nothing.nextCursor).toBeNull();
  });
});

describe('naming the target', () => {
  it('links a target that still exists', async () => {
    const [drug] = await db.insert(drugs).values({
      slug: 'methimazole', genericName: 'Methimazole', fields: {},
    }).returning({ id: drugs.id });

    await db.insert(auditLog).values({
      actorId: ADMIN, action: 'drug.field', targetType: 'drug', targetId: drug.id,
      diff: { key: 'dosing', from: null, to: '5 mg by mouth once a day' },
    });

    const [row] = (await listAudit()).rows;
    expect(row.targetLabel).toBe('Methimazole');
    expect(row.targetHref).toBe('/drugs/methimazole');
  });

  /**
   * The row somebody is most likely to be looking for. `target_id` carries no
   * foreign key on purpose -- a log that cascaded away with its subject would
   * lose exactly these -- so the name has to come back out of the diff.
   */
  it('names a deleted target from its own diff, and offers no link', async () => {
    await db.insert(auditLog).values([
      {
        actorId: ADMIN, action: 'tag.delete', targetType: 'tag',
        targetId: '00000000-0000-4000-8000-000000000001',
        diff: { slug: 'contraceptives', label: 'Contraceptives', reason: 'owner pruned tags' },
      },
      {
        actorId: ADMIN, action: 'drug.delete', targetType: 'drug',
        targetId: '00000000-0000-4000-8000-000000000002',
        diff: { slug: 'gone', generic: 'Gone Entirely', brands: 2 },
      },
    ]);

    const rows = (await listAudit()).rows;
    const byAction = new Map(rows.map((row) => [row.action, row]));

    expect(byAction.get('tag.delete')?.targetLabel).toBe('Contraceptives');
    expect(byAction.get('tag.delete')?.targetHref).toBeNull();
    expect(byAction.get('drug.delete')?.targetLabel).toBe('Gone Entirely');
    expect(byAction.get('drug.delete')?.targetHref).toBeNull();
  });

  it('names the site, which has no row to join', async () => {
    await db.insert(auditLog).values({
      actorId: ADMIN, action: 'site_settings.update', targetType: 'site_settings', targetId: '1',
      diff: { registrationMode: { from: 'open', to: 'invite' } },
    });

    const [row] = (await listAudit()).rows;
    expect(row.targetLabel).toBe('Site settings');
    expect(row.targetHref).toBe('/admin/site');
  });

  it('survives an actor whose account is gone', async () => {
    await db.insert(auditLog).values({ actorId: ADMIN, action: 'tag.create', targetType: 'tag' });
    await db.delete(users);

    const [row] = (await listAudit()).rows;
    expect(row.actor).toBeNull();
  });
});

describe('summaries', () => {
  it('reads the shapes the writers actually produce', () => {
    expect(summarise('drug.field', {
      key: 'dosing', from: '500 mg by mouth twice daily', to: '500 mcg by mouth twice daily',
    })).toBe('dosing: 500 mg by mouth twice daily → 500 mcg by mouth twice daily');

    expect(summarise('site_settings.update', { registrationMode: { from: 'open', to: 'invite' } }))
      .toBe('registrationMode: open → invite');

    expect(summarise('tag.delete', { label: 'Contraceptives', reason: 'owner pruned tags' }))
      .toBe('deleted Contraceptives — owner pruned tags');

    expect(summarise('dosing.reparsed', { rows: 2, status: 'parsed', branches: ['a', 'b'] }))
      .toBe('2 rows, parsed, 2 branches');

    expect(summarise('user.signout', { sessionsDropped: 1 })).toBe('1 session dropped');
    expect(summarise('drug.merge', {
      from: { generic: 'A' }, into: { generic: 'B' },
    })).toBe('folded A into B');
  });

  it('says nothing rather than guessing at a shape it does not know', () => {
    // The eighteenth action, whenever it arrives: no summary, and the screen
    // still renders the row and its raw diff.
    expect(summarise('something.new', { whatever: true })).toBeNull();
    expect(summarise('drug.field', null)).toBeNull();
    expect(summarise('drug.field', 'not an object')).toBeNull();
  });

  it('prints an absent value as a word, so a first-time set still reads', () => {
    expect(summarise('user.role', { from: null, to: 'admin' })).toBe('nothing → admin');
    expect(summarise('indication.rename', { from: '', to: 'Seizures' })).toBe('empty → Seizures');
  });
});

describe('the filter counts', () => {
  it('reads the actions off the table rather than a hard-coded list', async () => {
    await db.insert(auditLog).values([
      { actorId: ADMIN, action: 'tag.delete', targetType: 'tag' },
      { actorId: ADMIN, action: 'tag.delete', targetType: 'tag' },
      { actorId: ADMIN, action: 'future.action', targetType: 'drug' },
    ]);

    const counts = await auditCounts();
    expect(counts.total).toBe(3);
    expect(counts.actions).toEqual([
      { action: 'tag.delete', count: 2 },
      { action: 'future.action', count: 1 },
    ]);
    expect(counts.targetTypes).toEqual([
      { targetType: 'tag', count: 2 },
      { targetType: 'drug', count: 1 },
    ]);
    expect(counts.actors).toHaveLength(1);
    expect(counts.latest).not.toBeNull();
  });

  it('reports an empty log as empty rather than failing', async () => {
    const counts = await auditCounts();
    expect(counts.total).toBe(0);
    expect(counts.actions).toEqual([]);
    expect(counts.latest).toBeNull();

    const page = await listAudit();
    expect(page.rows).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});
