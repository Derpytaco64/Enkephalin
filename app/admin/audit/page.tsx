import Link from 'next/link';
import type { Route } from 'next';
import { auditCounts, listAudit, PAGE_SIZE } from '@/lib/admin/audit';

export const metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

/**
 * The audit log, which until now was write-only.
 *
 * Seven modules have been recording every content and account change since
 * phase 8 began, and no page opened the table. That is the worst state for a
 * record to be in -- the cost of keeping it was already being paid and none of
 * the benefit was available -- and it is the last gap in phase 8 with anything
 * actually in it.
 *
 * It is a reader, not a queue: nothing here is a to-do and nothing here can be
 * edited. Audit rows are never written by this screen, which is what keeps the
 * log a record rather than a document.
 *
 * **Grouped by day, newest first.** The question somebody brings to a change
 * history is almost always "what happened to this, and when" or "what did I
 * change yesterday", and both are answered by reading downwards. A flat list of
 * timestamps answers neither without arithmetic.
 *
 * **Every row shows its raw diff.** The summary beside an action is best-effort
 * -- see `summarise` -- so the JSON is one click away on every row rather than
 * only on the ones the summariser gave up on. A log whose rendering you cannot
 * check is a log you cannot trust, and the rows most worth reading are the ones
 * whose subject has since been deleted.
 */
export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; target?: string; actor?: string; cursor?: string }>;
}) {
  const params = await searchParams;
  const [counts, page] = await Promise.all([
    auditCounts(),
    listAudit({
      action: params.action,
      targetType: params.target,
      actor: params.actor,
      cursor: params.cursor,
    }),
  ]);

  // Filters survive paging, and paging does not survive a filter change -- a
  // cursor from one filter means nothing under another.
  const base: Record<string, string> = {};
  if (params.action) base.action = params.action;
  if (params.target) base.target = params.target;
  if (params.actor) base.actor = params.actor;

  const href = (patch: Record<string, string | undefined>) => {
    const query = { ...base, ...patch };
    for (const key of Object.keys(query)) if (!query[key]) delete query[key];
    return { pathname: '/admin/audit' as Route, query: query as Record<string, string> };
  };

  const filtered = Boolean(params.action || params.target || params.actor);
  const days = groupByDay(page.rows);

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <Link href="/admin" className="pill">← Admin</Link>

      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Audit log</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Every content and account change, with what it was before. Written by the editors
        themselves, so this is a record of what happened rather than a report somebody
        assembled — nothing on this page can be edited, and reading it writes nothing.
      </p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-3">
        <Figure
          figure={String(counts.total)}
          label="entries"
          note={`${counts.actions.length} kind${counts.actions.length === 1 ? '' : 's'} of change`}
        />
        <Figure
          figure={counts.latest ? counts.latest.toLocaleDateString() : '—'}
          label="newest"
          note={counts.latest ? counts.latest.toLocaleTimeString() : 'nothing recorded yet'}
        />
        <Figure
          figure={String(counts.actors.length)}
          label={counts.actors.length === 1 ? 'person' : 'people'}
          note="have changed something"
        />
      </dl>

      {counts.total > 0 && (
        <div className="mt-8 space-y-3">
          <FilterRow label="What it was about">
            <Pill href={href({ target: undefined, cursor: undefined })} on={!params.target}>
              Everything
            </Pill>
            {counts.targetTypes.map((row) => (
              <Pill
                key={row.targetType}
                href={href({ target: row.targetType, cursor: undefined })}
                on={params.target === row.targetType}
              >
                {row.targetType.replace('_', ' ')} <Count n={row.count} />
              </Pill>
            ))}
          </FilterRow>

          <FilterRow label="What happened">
            <Pill href={href({ action: undefined, cursor: undefined })} on={!params.action}>
              Anything
            </Pill>
            {counts.actions.map((row) => (
              <Pill
                key={row.action}
                href={href({ action: row.action, cursor: undefined })}
                on={params.action === row.action}
              >
                <code className="font-mono text-xs">{row.action}</code> <Count n={row.count} />
              </Pill>
            ))}
          </FilterRow>

          {/* Only worth a row when there is more than one person to choose
              between -- a single-actor filter is a no-op with a hover state. */}
          {counts.actors.length > 1 && (
            <FilterRow label="Who">
              <Pill href={href({ actor: undefined, cursor: undefined })} on={!params.actor}>
                Anyone
              </Pill>
              {counts.actors.map((row) => (
                <Pill
                  key={row.id}
                  href={href({ actor: row.id, cursor: undefined })}
                  on={params.actor === row.id}
                >
                  {row.email ?? 'deleted account'} <Count n={row.count} />
                </Pill>
              ))}
            </FilterRow>
          )}
        </div>
      )}

      {page.rows.length === 0 ? (
        <p className="mt-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6
          text-sm text-[var(--muted)]">
          {counts.total === 0
            ? 'Nothing recorded yet. Every edit in the admin UI and the drug editor writes here.'
            : 'No entries match those filters.'}
          {filtered && counts.total > 0 && (
            <>
              {' '}
              <Link href={href({ action: undefined, target: undefined, actor: undefined, cursor: undefined })}
                className="text-[var(--accent)] underline">
                Clear them
              </Link>.
            </>
          )}
        </p>
      ) : (
        <div className="mt-10 space-y-8">
          {days.map((day) => (
            <section key={day.key}>
              <h2 className="sticky top-0 bg-[var(--bg)] py-1 text-sm font-medium
                text-[var(--muted)]">
                {day.label}
              </h2>
              <ol className="mt-2 divide-y divide-[var(--border)] rounded-lg border
                border-[var(--border)] bg-[var(--surface)]">
                {day.rows.map((row) => (
                  <li key={row.id} className="p-4">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <time
                        dateTime={row.at.toISOString()}
                        className="font-mono text-xs text-[var(--muted)]"
                      >
                        {row.at.toLocaleTimeString()}
                      </time>
                      <code className="pill pill-xs pill-edge font-mono text-xs">{row.action}</code>
                      {row.targetLabel && (
                        row.targetHref ? (
                          <Link
                            href={row.targetHref as Route}
                            className="font-medium text-[var(--accent)] underline"
                          >
                            {row.targetLabel}
                          </Link>
                        ) : (
                          // No link, and said so: the row's subject is gone,
                          // which is usually why somebody is reading this row.
                          <span className="font-medium">
                            {row.targetLabel}
                            <span className="ml-1 text-xs font-normal text-[var(--muted)]">
                              (deleted)
                            </span>
                          </span>
                        )
                      )}
                      <span className="ml-auto text-xs text-[var(--muted)]">
                        {row.actor ?? 'deleted account'}
                      </span>
                    </div>

                    {row.summary && (
                      <p className="mt-2 text-sm break-words">{row.summary}</p>
                    )}

                    {row.diff !== null && row.diff !== undefined && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-[var(--muted)]
                          hover:text-[var(--fg)]">
                          {row.summary ? 'Raw' : 'No summary for this shape — raw'}
                        </summary>
                        <pre className="mt-2 overflow-x-auto rounded border border-[var(--border)]
                          bg-[var(--bg)] p-3 text-xs">
                          {JSON.stringify(row.diff, null, 2)}
                        </pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}

          {page.nextCursor && (
            <Link
              href={href({ cursor: page.nextCursor })}
              className="btn btn-quiet inline-block"
            >
              Older entries
            </Link>
          )}
          {!page.nextCursor && counts.total > PAGE_SIZE && (
            <p className="text-sm text-[var(--muted)]">That is the end of the log.</p>
          )}
        </div>
      )}
    </main>
  );
}

/* ---------------------------------------------------------------- parts --- */

function Figure({ figure, label, note }: { figure: string; label: string; note: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <dt className="text-sm text-[var(--muted)]">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{figure}</dd>
      <dd className="mt-1 text-xs text-[var(--muted)]">{note}</dd>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <div className="mt-1 flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function Pill({
  href, on, children,
}: {
  href: React.ComponentProps<typeof Link>['href'];
  on: boolean;
  children: React.ReactNode;
}) {
  // `pill-soft` on the ones you are not on: a filter row always has one pill
  // filled, and without it hovering a neighbour draws the same lozenge as the
  // current one and the row lies about where you are. See globals.css.
  return (
    <Link
      href={href}
      aria-current={on ? 'page' : undefined}
      className={`pill pill-xs ${on ? 'pill-on' : 'pill-edge pill-soft'}`}
    >
      {children}
    </Link>
  );
}

function Count({ n }: { n: number }) {
  return <span className="text-[var(--muted)] tabular-nums">{n}</span>;
}

/**
 * Day buckets in the order the rows arrive, which is already newest first --
 * so this never sorts and never needs to know the page's date range.
 */
function groupByDay<T extends { at: Date }>(rows: T[]) {
  const days: { key: string; label: string; rows: T[] }[] = [];
  for (const row of rows) {
    const key = row.at.toDateString();
    const last = days[days.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else days.push({ key, label: dayLabel(row.at), rows: [row] });
  }
  return days;
}

function dayLabel(at: Date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (at.toDateString() === today.toDateString()) return 'Today';
  if (at.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return at.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}
