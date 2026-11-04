import Link from 'next/link';
import { listUsers } from '@/lib/admin/users';
import { requireAdmin } from '@/lib/session';
import { MIN_PASSWORD_LENGTH } from '@/lib/users';
import {
  deleteUserAction, setPasswordAction, setRoleAction, setStatusAction, signOutUserAction,
} from './actions';
import { UserRow } from './user-row';

export const metadata = { title: 'Users — Enkephalin' };
export const dynamic = 'force-dynamic';

/**
 * Who has an account.
 *
 * The reason this screen matters more than a roster of one suggests: there is
 * no mailer, so *setting someone's password here is the only way back into a
 * locked-out account*. `/account` can change a password you still know; nothing
 * else can change one you have forgotten.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireAdmin();
  const { q } = await searchParams;
  const users = await listUsers(q);

  const admins = users.filter((user) => user.role === 'admin').length;
  const disabled = users.filter((user) => user.status === 'disabled').length;

  return (
    <main className="mx-auto max-w-4xl px-4 py-16">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <Link href="/admin/invites" className="pill">
          Invites
        </Link>
      </div>

      <p className="mt-2 text-sm text-[var(--muted)]">
        There is no mailer, so a forgotten password is reset here and nowhere else — and whoever
        resets it has to pass it on themselves. Your own row offers less on purpose: an admin who
        could demote, disable or delete themselves is one click from an installation nobody can
        administer.
      </p>

      {/* A GET form, so a search is a URL -- the same rule the drug browser
          and the study pages follow. */}
      <form method="get" className="mt-6 flex flex-wrap items-center gap-2">
        <label htmlFor="q" className="text-sm">Search</label>
        <input
          id="q" name="q" defaultValue={q ?? ''} placeholder="email or name"
          className="h-9 w-64 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm"
        >
          Search
        </button>
        {(q ?? '') !== '' && (
          <Link href="/admin/users" className="pill pill-xs">
            Clear
          </Link>
        )}
      </form>

      {users.length === 0 ? (
        <p className="mt-10 text-[var(--muted)]">
          {(q ?? '') === '' ? 'No accounts yet.' : `Nothing matches “${q}”.`}
        </p>
      ) : (
        <>
          <div className="mt-8 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                  <th className="py-2 pr-4 font-medium">Account</th>
                  <th className="py-2 pr-4 font-medium">Role</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium">Sessions</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    self={user.id === session.user.id}
                    minPasswordLength={MIN_PASSWORD_LENGTH}
                    setRole={setRoleAction}
                    setStatus={setStatusAction}
                    signOut={signOutUserAction}
                    setPassword={setPasswordAction}
                    remove={deleteUserAction}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-xs text-[var(--muted)]">
            {users.length} {users.length === 1 ? 'account' : 'accounts'}
            {(q ?? '') !== '' && ' matching'} · {admins} {admins === 1 ? 'admin' : 'admins'}
            {disabled > 0 && ` · ${disabled} disabled`}
          </p>
        </>
      )}
    </main>
  );
}
