'use client';

import { useState } from 'react';
import { Avatar } from '@/app/_components/avatar';
import type { UserRow as Row } from '@/lib/admin/users';
import type { Result } from '@/lib/drugs/mutations';

/**
 * One account, with everything that can be done to it.
 *
 * Two rows rather than one: the destructive pair -- setting a password and
 * deleting -- open a panel underneath instead of sitting in the table, because
 * a password box and a delete button inline would be two clicks away from each
 * other in a row people scan quickly. Role and status stay in the row, since
 * those are the ones you come here to read.
 *
 * `self` is passed in rather than worked out here. It decides what is even
 * offered: role, status and delete are refused on your own account by
 * `lib/admin/users.ts`, and offering a control that will always refuse is worse
 * than not offering it.
 */
export function UserRow({
  user,
  self,
  minPasswordLength,
  setRole,
  setStatus,
  signOut,
  setPassword,
  remove,
}: {
  user: Row;
  self: boolean;
  minPasswordLength: number;
  setRole: (formData: FormData) => Promise<Result>;
  setStatus: (formData: FormData) => Promise<Result>;
  signOut: (formData: FormData) => Promise<Result<number>>;
  setPassword: (formData: FormData) => Promise<Result<number>>;
  remove: (formData: FormData) => Promise<Result>;
}) {
  const [open, setOpen] = useState<'none' | 'password' | 'delete'>('none');
  const [password, setPasswordText] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const button = 'rounded-full border border-[var(--border)] px-2.5 py-1 text-xs disabled:opacity-60';
  const control = 'h-8 rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

  const run = async <T,>(
    action: (formData: FormData) => Promise<Result<T>>,
    fields: Record<string, string>,
    say?: (value: T | undefined) => string,
  ) => {
    setPending(true);
    setError(null);
    setNote(null);

    const data = new FormData();
    data.set('userId', user.id);
    for (const [key, value] of Object.entries(fields)) data.set(key, value);

    const result = await action(data);
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (say) setNote(say(result.value));
  };

  const devices = `${user.sessions} ${user.sessions === 1 ? 'device' : 'devices'}`;

  return (
    <>
      <tr className="border-b border-[var(--border)] align-middle">
        <td className="py-2 pr-4">
          <div className="flex items-center gap-2">
            <Avatar user={user} size={28} />
            <div className="min-w-0">
              <p className="truncate">
                {user.name ?? user.email}
                {self && <span className="ml-2 text-xs text-[var(--muted)]">you</span>}
              </p>
              {user.name !== null && (
                <p className="truncate text-xs text-[var(--muted)]">{user.email}</p>
              )}
            </div>
          </div>
        </td>

        <td className="py-2 pr-4">
          {self ? (
            // Not a disabled select: a control you cannot use reads as broken
            // rather than as deliberate.
            <span className="text-sm">{user.role === 'admin' ? 'Admin' : 'Student'}</span>
          ) : (
            <select
              aria-label={`Role for ${user.email}`}
              value={user.role}
              disabled={pending}
              className={control}
              onChange={(event) => void run(setRole, { role: event.target.value })}
            >
              <option value="student">Student</option>
              <option value="admin">Admin</option>
            </select>
          )}
        </td>

        <td className="py-2 pr-4">
          {self ? (
            <span className="text-sm">Active</span>
          ) : (
            <button
              type="button" disabled={pending} className={button}
              onClick={() => void run(
                setStatus,
                { status: user.status === 'active' ? 'disabled' : 'active' },
              )}
            >
              {user.status === 'active' ? 'Disable' : 'Enable'}
            </button>
          )}
          {user.status === 'disabled' && (
            <span className="ml-2 text-xs text-[var(--danger)]">disabled</span>
          )}
        </td>

        <td className="py-2 pr-4 text-xs text-[var(--muted)]">
          <div>{devices}</div>
          <div>
            {user.lastSignIn === null
              ? 'never signed in'
              : `last ${user.lastSignIn.toLocaleDateString()}`}
          </div>
        </td>

        <td className="py-2">
          <div className="flex flex-wrap justify-end gap-1">
            {user.sessions > 0 && (
              <button
                type="button" disabled={pending} className={button}
                onClick={() => void run(
                  signOut, {},
                  (dropped) => `Signed out of ${dropped ?? 0} ${dropped === 1 ? 'device' : 'devices'}.`,
                )}
              >
                {/* Yours keeps the session you are using, which is why it says
                    "elsewhere" on your own row and not on anyone else's. */}
                {self ? 'Sign out elsewhere' : 'Sign out'}
              </button>
            )}
            <button
              type="button" className={button}
              onClick={() => {
                setOpen(open === 'password' ? 'none' : 'password');
                setError(null);
                setNote(null);
              }}
            >
              Set password
            </button>
            {!self && (
              <button
                type="button" className={button}
                onClick={() => {
                  setOpen(open === 'delete' ? 'none' : 'delete');
                  setConfirmDelete(false);
                  setError(null);
                  setNote(null);
                }}
              >
                Delete
              </button>
            )}
          </div>
        </td>
      </tr>

      {(open !== 'none' || error !== null || note !== null) && (
        <tr className="border-b border-[var(--border)]">
          <td colSpan={5} className="pb-4">
            {open === 'password' && (
              <div className="rounded border border-[var(--border)] p-3">
                <p className="text-sm">
                  Set a new password for <span className="font-medium">{user.email}</span>.
                </p>
                {/* Said up front, because it is the part that surprises: this
                    is the recovery path, and whoever lost the password should
                    not keep whatever sessions are still open on it. */}
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Signs the account out everywhere, and you will have to tell them the password
                  yourself — there is no mailer to send it.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="text" value={password} minLength={minPasswordLength}
                    placeholder={`at least ${minPasswordLength} characters`}
                    autoComplete="off" className={`${control} w-64`}
                    onChange={(event) => setPasswordText(event.target.value)}
                  />
                  <button
                    type="button" disabled={pending || password.length < minPasswordLength}
                    className={button}
                    onClick={() => void run(setPassword, { password }, (dropped) => {
                      setPasswordText('');
                      setOpen('none');
                      return `Password set, and ${dropped ?? 0} ${dropped === 1 ? 'session' : 'sessions'} dropped.`;
                    })}
                  >
                    Set it
                  </button>
                </div>
                {/* Shown rather than masked: an admin typing a password for
                    somebody else has to be able to read it back to them. */}
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Shown as you type, so you can pass it on.
                </p>
              </div>
            )}

            {open === 'delete' && (
              <div className="rounded border border-[var(--border)] p-3">
                <p className="text-sm">
                  Delete <span className="font-medium">{user.email}</span> and everything they have
                  studied — schedules, quiz history and saved setups. It cannot be undone, and
                  disabling keeps all of it.
                </p>
                <label className="mt-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox" checked={confirmDelete}
                    onChange={(event) => setConfirmDelete(event.target.checked)}
                  />
                  Yes, delete the account and its history
                </label>
                <button
                  type="button" disabled={pending || !confirmDelete}
                  className={`${button} mt-2 disabled:cursor-not-allowed`}
                  onClick={() => void run(remove, {})}
                >
                  Delete {user.email}
                </button>
              </div>
            )}

            {error !== null && <p className="mt-2 text-sm text-[var(--danger)]">{error}</p>}
            {note !== null && <p className="mt-2 text-sm text-[var(--ok)]">{note}</p>}
          </td>
        </tr>
      )}
    </>
  );
}
