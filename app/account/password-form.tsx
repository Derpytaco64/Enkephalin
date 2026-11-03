'use client';

import { useState } from 'react';
import type { Result } from '@/lib/drugs/mutations';

/**
 * Changing your own password.
 *
 * Three boxes and a checkbox. The checkbox defaults to **on**: the usual
 * reason to change a password is that you think someone else has it, and
 * leaving their session alive would make the change ceremonial. Turning it off
 * is there for the ordinary case -- a password you simply wanted to improve,
 * with a phone signed in on the sofa.
 *
 * `autoComplete` is set deliberately rather than left off, so a password
 * manager offers the stored one in the first box and files the new one once.
 */
export function PasswordForm({
  change,
  minLength,
}: {
  change: (input: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
    revokeOthers: boolean;
  }) => Promise<Result>;
  minLength: number;
}) {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [revokeOthers, setRevoke] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await change({ currentPassword, newPassword, confirmPassword, revokeOthers });
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Cleared on success so the new password is not left sitting in three
    // boxes on a screen somebody walks past.
    setCurrent('');
    setNew('');
    setConfirm('');
    setDone(true);
  };

  return (
    <form onSubmit={submit} className="mt-4 max-w-xs rounded border border-[var(--border)] p-4">
      <div>
        <label htmlFor="current" className="text-sm font-medium">Current password</label>
        <input
          id="current" type="password" autoComplete="current-password" required
          value={currentPassword} className={control}
          onChange={(event) => { setCurrent(event.target.value); setDone(false); }}
        />
      </div>

      <div className="mt-3">
        <label htmlFor="next" className="text-sm font-medium">New password</label>
        <input
          id="next" type="password" autoComplete="new-password" required minLength={minLength}
          value={newPassword} className={control}
          onChange={(event) => { setNew(event.target.value); setDone(false); }}
        />
        <p className="mt-1 text-xs text-[var(--muted)]">At least {minLength} characters.</p>
      </div>

      <div className="mt-3">
        <label htmlFor="again" className="text-sm font-medium">New password again</label>
        <input
          id="again" type="password" autoComplete="new-password" required
          value={confirmPassword} className={control}
          onChange={(event) => { setConfirm(event.target.value); setDone(false); }}
        />
      </div>

      <label className="mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox" checked={revokeOthers} className="mt-0.5"
          onChange={(event) => setRevoke(event.target.checked)}
        />
        Sign out everywhere else
      </label>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit" disabled={pending}
          className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
        >
          {pending ? 'Changing…' : 'Change password'}
        </button>
      </div>

      {error !== null && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
      {done && error === null && (
        <p className="mt-3 text-sm text-[var(--ok)]">
          Changed{revokeOthers ? ', and every other session is signed out' : ''}.
        </p>
      )}
    </form>
  );
}
