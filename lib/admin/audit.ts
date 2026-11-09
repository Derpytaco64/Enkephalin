/**
 * The read side of `audit_log`.
 *
 * Seven modules have been writing this table since phase 8 began and nothing
 * read it, which made it the last real gap in the phase: a change history that
 * cannot be opened is a change history nobody has.
 *
 * Two decisions shape the whole module.
 *
 * **It summarises the shapes it knows and shows the rest raw.** There are
 * seventeen actions and their diffs have five different shapes -- `{from,to}`
 * pairs, nested per-field pairs, identity snapshots left behind by deletes,
 * lists, and merge reports with a moved/dropped count per child table. Writing
 * seventeen renderers would mean the eighteenth action silently renders as
 * nothing, which is the one failure a log may not have. So `summarise` handles
 * the shapes it recognises and every row keeps its raw diff; an unrecognised
 * diff reads as "no summary" and still shows its JSON. The same rule the
 * dosing parser follows one table over: a value that cannot be read keeps its
 * place.
 *
 * **A deleted target keeps its name.** `target_id` is a bare id with no
 * foreign key -- deliberately, since a log that cascaded away with its subject
 * would lose exactly the rows somebody is looking for. So names are resolved by
 * joining where the row still exists and read out of the diff where it does
 * not: `drug.delete` recorded the slug and generic, `tag.delete` the label,
 * `user.delete` the email. A row whose subject is gone is the most interesting
 * row in the table and it still reads as a sentence.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, drugs, indications, tags, users } from '@/db/schema';

export const PAGE_SIZE = 50;

/** The five things an action can be about, as written by the modules today. */
export type TargetType = 'drug' | 'user' | 'indication' | 'tag' | 'site_settings';

export type AuditRow = {
  id: string;
  at: Date;
  action: string;
  /** Null where the actor's account has since been deleted -- the FK sets it null. */
  actor: string | null;
  targetType: string | null;
  targetId: string | null;
  /** The target's name, from the live row or from the diff of its deletion. */
  targetLabel: string | null;
  /** Null when the target is gone, or has no page of its own. */
  targetHref: string | null;
  /** A sentence, where the diff's shape is one this module knows. */
  summary: string | null;
  diff: unknown;
};

export type AuditPage = {
  rows: AuditRow[];
  /** Pass back as `cursor` for the next page; null at the end. */
  nextCursor: string | null;
};

export type AuditFilter = {
  action?: string;
  targetType?: string;
  /** A user id, as `actor_id` stores it. */
  actor?: string;
  cursor?: string;
};

/* ------------------------------------------------------------ summaries --- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `null` prints as the word, so "from nothing to X" is legible rather than blank. */
function show(value: unknown): string {
  if (value === null || value === undefined) return 'nothing';
  if (value === '') return 'empty';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (Array.isArray(value)) return value.length === 0 ? 'nothing' : value.join(', ');
  if (isRecord(value)) return JSON.stringify(value);
  return String(value);
}

/** Trims a long value to a clause, since a summary is one line. */
function clip(text: string, max = 70): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function pair(diff: Record<string, unknown>): string | null {
  if (!('from' in diff) && !('to' in diff)) return null;
  return `${clip(show(diff.from))} → ${clip(show(diff.to))}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * One line saying what moved, or null where this module does not recognise the
 * shape. Never throws on an unexpected diff: the row still has to render.
 */
export function summarise(action: string, diff: unknown): string | null {
  if (!isRecord(diff)) return null;

  switch (action) {
    case 'drug.field': {
      const moved = pair(diff);
      const key = typeof diff.key === 'string' ? diff.key : 'a field';
      return moved ? `${key}: ${moved}` : `${key} set`;
    }

    case 'account.email':
    case 'indication.rename':
    case 'user.role':
    case 'user.status':
      return pair(diff);

    case 'site_settings.update': {
      // One nested {from,to} per field that actually moved; fields that did not
      // are absent, which is what the writer guarantees.
      const parts = Object.entries(diff)
        .filter(([, value]) => isRecord(value) && ('from' in value || 'to' in value))
        .map(([field, value]) => `${field}: ${pair(value as Record<string, unknown>)}`);
      return parts.length > 0 ? parts.join(' · ') : null;
    }

    case 'drug.create':
      return typeof diff.genericName === 'string' ? `created ${diff.genericName}` : 'created';

    case 'drug.delete': {
      const counts = ['brands', 'indications', 'regimens', 'tags', 'cards', 'answers']
        .filter((key) => typeof diff[key] === 'number' && (diff[key] as number) > 0)
        .map((key) => `${diff[key]} ${key}`);
      const what = typeof diff.generic === 'string' ? diff.generic : 'a drug';
      return counts.length > 0 ? `deleted ${what}, with ${counts.join(', ')}` : `deleted ${what}`;
    }

    case 'drug.merge': {
      const from = isRecord(diff.from) ? show(diff.from.generic) : 'one drug';
      const into = isRecord(diff.into) ? show(diff.into.generic) : 'another';
      return `folded ${from} into ${into}`;
    }

    case 'indication.merge':
      return `${show(diff.from)} → ${show(diff.into)}, ${plural(
        typeof diff.moved === 'number' ? diff.moved : 0, 'drug moved', 'drugs moved',
      )}`;

    case 'drug.indications':
    case 'drug.brands':
    case 'drug.tags': {
      const key = action.split('.')[1];
      const list = diff[key];
      if (!Array.isArray(list)) return null;
      return list.length === 0 ? `${key} cleared` : `${key}: ${clip(list.join(', '))}`;
    }

    case 'drug.dosing_unique':
      return diff.unique === true
        ? 'marked as a unique or complicated sig'
        : 'no longer marked unique';

    case 'dosing.reparsed': {
      const rows = typeof diff.rows === 'number' ? diff.rows : 0;
      const status = show(diff.status);
      const branches = Array.isArray(diff.branches) ? diff.branches.length : 0;
      const tail = branches > 0 ? `, ${plural(branches, 'branch', 'branches')}` : '';
      return `${plural(rows, 'row')}, ${status}${tail}`;
    }

    case 'dosing.cleared':
      return 'dosing cleared';

    case 'tag.create':
      return `created ${show(diff.label)}`;

    case 'tag.rename':
      return pair(diff);

    case 'tag.delete': {
      const reason = typeof diff.reason === 'string' ? ` — ${diff.reason}` : '';
      return `deleted ${show(diff.label)}${reason}`;
    }

    case 'tag.members': {
      const added = typeof diff.added === 'number' ? diff.added : null;
      const removed = typeof diff.removed === 'number' ? diff.removed : null;
      if (added === null && removed === null) return null;
      return [
        added ? `+${added}` : null,
        removed ? `−${removed}` : null,
      ].filter(Boolean).join(' ') || 'membership unchanged';
    }

    case 'user.password':
      return `password set${diff.self === true ? ' (their own)' : ''}${
        typeof diff.sessionsDropped === 'number' && diff.sessionsDropped > 0
          ? `, ${plural(diff.sessionsDropped, 'session')} dropped`
          : ''}`;

    case 'user.signout':
      return typeof diff.sessionsDropped === 'number'
        ? `${plural(diff.sessionsDropped, 'session')} dropped`
        : null;

    case 'user.delete':
      return `deleted ${show(diff.email)}`;

    case 'indication.delete':
      return `deleted ${show(diff.label ?? diff.text)}`;

    default:
      return null;
  }
}

/* ------------------------------------------------------- target naming --- */

/** Where a target's own page is, when it has one and still exists. */
function hrefFor(targetType: string | null, targetId: string | null, slug: string | null) {
  if (targetType === 'drug' && slug) return `/drugs/${slug}`;
  if (targetType === 'tag' && slug) return `/admin/tags/${slug}`;
  if (targetType === 'user' && targetId) return '/admin/users';
  if (targetType === 'indication') return '/admin/indications';
  // `site_settings` is not here: it has no row to resolve, so it is named
  // where the rows are built rather than reached through this.
  return null;
}

/** The name a deletion left behind in its own diff. */
function labelFromDiff(targetType: string | null, diff: unknown): string | null {
  if (!isRecord(diff)) return null;
  const first = (...keys: string[]) => {
    for (const key of keys) {
      const value = diff[key];
      if (typeof value === 'string' && value.trim() !== '') return value;
    }
    return null;
  };
  if (targetType === 'drug') return first('generic', 'genericName', 'slug');
  if (targetType === 'tag') return first('label', 'slug');
  if (targetType === 'user') return first('email');
  if (targetType === 'indication') return first('label', 'text', 'from');
  // A set is never resolved live -- `nameTargets` has no query for one -- so
  // every set row, import and delete alike, is named from here.
  if (targetType === 'set') return first('name', 'slug');
  return null;
}

/**
 * Resolves names for a page of rows in one query per target type, rather than
 * one per row. Deleted targets simply do not come back, which is what sends
 * them to the diff for their name.
 */
async function nameTargets(rows: { targetType: string | null; targetId: string | null }[]) {
  const idsOf = (type: string) => [...new Set(
    rows.filter((row) => row.targetType === type && row.targetId)
      .map((row) => row.targetId as string),
  )];

  const drugIds = idsOf('drug');
  const userIds = idsOf('user');
  const tagIds = idsOf('tag');
  const indicationIds = idsOf('indication');

  const [drugRows, userRows, tagRows, indicationRows] = await Promise.all([
    drugIds.length
      ? db.select({ id: drugs.id, label: drugs.genericName, slug: drugs.slug })
        .from(drugs).where(inArray(drugs.id, drugIds))
      : [],
    userIds.length
      ? db.select({ id: users.id, label: users.email }).from(users).where(inArray(users.id, userIds))
      : [],
    tagIds.length
      ? db.select({ id: tags.id, label: tags.label, slug: tags.slug })
        .from(tags).where(inArray(tags.id, tagIds))
      : [],
    indicationIds.length
      ? db.select({ id: indications.id, label: indications.label })
        .from(indications).where(inArray(indications.id, indicationIds))
      : [],
  ]);

  const found = new Map<string, { label: string; slug: string | null }>();
  for (const row of drugRows) found.set(`drug:${row.id}`, { label: row.label, slug: row.slug });
  for (const row of userRows) found.set(`user:${row.id}`, { label: row.label, slug: null });
  for (const row of tagRows) found.set(`tag:${row.id}`, { label: row.label, slug: row.slug });
  for (const row of indicationRows) {
    found.set(`indication:${row.id}`, { label: row.label, slug: null });
  }
  return found;
}

/* ------------------------------------------------------------- queries --- */

/**
 * Keyset pagination on `(at, id)`, not an offset.
 *
 * An offset page two would shift under the reader the moment anything wrote a
 * row -- and this table is written by every edit in the admin UI, including the
 * ones somebody makes while reading it. `at` alone is not unique: a single
 * mutation writes `drug.field` and `dosing.reparsed` in the same transaction,
 * which is exactly the pair most worth reading in order.
 *
 * **The cursor is the row's id alone, and the comparison reads that row's own
 * stored values back in SQL.** The obvious version -- put the timestamp in the
 * cursor -- silently skipped rows, and it took two pages that did not add up to
 * find out why: `timestamptz` keeps microseconds and a JavaScript `Date` keeps
 * milliseconds, so a timestamp that has been through Drizzle is already
 * truncated. `17:47:47.329008` came back as `.329`, and `at < '...329Z'` then
 * excluded all 65 rows stored at `.329008` while `at = '...329Z'` matched none
 * of them. Twenty-three rows fell down the gap between the two pages. Comparing
 * row-wise against a subquery never converts the value at all.
 *
 * Safe because `audit_log` is append-only: nothing in the codebase deletes from
 * it, so the row a cursor names is still there. If that ever changes this needs
 * a monotonic sequence column instead, because the subquery would return no row
 * and a missing cursor would read as the end of the log.
 */
function cursorOf(row: { id: string }) {
  return row.id;
}

function parseCursor(cursor: string | undefined) {
  if (!cursor) return null;
  // A uuid, because that is all a cursor is now. Anything else is somebody
  // editing the URL, and the page should open rather than error.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)
    ? cursor
    : null;
}

export async function listAudit(filter: AuditFilter = {}): Promise<AuditPage> {
  const after = parseCursor(filter.cursor);

  const where = [
    filter.action ? eq(auditLog.action, filter.action) : undefined,
    filter.targetType ? eq(auditLog.targetType, filter.targetType) : undefined,
    filter.actor ? eq(auditLog.actorId, filter.actor) : undefined,
    // Row-wise `<` matches `order by at desc, id desc` exactly, and reads the
    // cursor row's values straight out of the table -- see `parseCursor`.
    after
      ? sql`(${auditLog.at}, ${auditLog.id}) < (
          select ${auditLog.at}, ${auditLog.id} from ${auditLog}
          where ${auditLog.id} = ${after}::uuid
        )`
      : undefined,
  ].filter(Boolean);

  // One extra row is the only honest way to know whether there is a next page
  // without counting the table on every request.
  const found = await db
    .select({
      id: auditLog.id,
      at: auditLog.at,
      action: auditLog.action,
      actorId: auditLog.actorId,
      actor: users.email,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      diff: auditLog.diff,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(PAGE_SIZE + 1);

  const page = found.slice(0, PAGE_SIZE);
  const names = await nameTargets(page);

  const rows: AuditRow[] = page.map((row) => {
    // The site is the one target with no table to join: `site_settings` is a
    // single row addressed by the literal 1, so it is named here rather than
    // rendering as an action with no subject.
    if (row.targetType === 'site_settings') {
      return {
        id: row.id,
        at: row.at,
        action: row.action,
        actor: row.actor ?? null,
        targetType: row.targetType,
        targetId: row.targetId,
        targetLabel: 'Site settings',
        targetHref: '/admin/site',
        summary: summarise(row.action, row.diff),
        diff: row.diff,
      };
    }

    const live = row.targetId ? names.get(`${row.targetType}:${row.targetId}`) : undefined;
    const label = live?.label ?? labelFromDiff(row.targetType, row.diff);
    return {
      id: row.id,
      at: row.at,
      action: row.action,
      actor: row.actor ?? null,
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel: label,
      targetHref: live ? hrefFor(row.targetType, row.targetId, live.slug) : null,
      summary: summarise(row.action, row.diff),
      diff: row.diff,
    };
  });

  return {
    rows,
    nextCursor: found.length > PAGE_SIZE && page.length > 0
      ? cursorOf(page[page.length - 1])
      : null,
  };
}

export type AuditCounts = {
  total: number;
  actions: { action: string; count: number }[];
  targetTypes: { targetType: string; count: number }[];
  actors: { id: string; email: string | null; count: number }[];
  /** Newest entry, so the screen can say how current it is. */
  latest: Date | null;
};

/**
 * The filter pills, read off the table rather than hard-coded.
 *
 * Hard-coding the seventeen actions would mean a new one is invisible here
 * until somebody remembers this file -- and the whole point of the screen is
 * that nothing written goes unseen.
 */
export async function auditCounts(): Promise<AuditCounts> {
  const [byAction, byTarget, byActor] = await Promise.all([
    db.select({ action: auditLog.action, count: sql<number>`count(*)::int` })
      .from(auditLog).groupBy(auditLog.action).orderBy(desc(sql`count(*)`), auditLog.action),
    db.select({ targetType: auditLog.targetType, count: sql<number>`count(*)::int` })
      .from(auditLog).groupBy(auditLog.targetType).orderBy(desc(sql`count(*)`)),
    db.select({ id: auditLog.actorId, email: users.email, count: sql<number>`count(*)::int` })
      .from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId))
      .groupBy(auditLog.actorId, users.email).orderBy(desc(sql`count(*)`)),
  ]);

  const [newest] = await db
    .select({ at: auditLog.at }).from(auditLog).orderBy(desc(auditLog.at)).limit(1);

  return {
    total: byAction.reduce((sum, row) => sum + row.count, 0),
    actions: byAction,
    targetTypes: byTarget
      .filter((row): row is { targetType: string; count: number } => row.targetType !== null),
    actors: byActor.filter((row) => row.id !== null) as AuditCounts['actors'],
    latest: newest?.at ?? null,
  };
}
