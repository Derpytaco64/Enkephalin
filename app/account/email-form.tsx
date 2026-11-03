'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Result } from '@/lib/drugs/mutations';

/**
 * Changing the address you sign in with.
 *
 * The password box is not optional and not a courtesy: the email *is* the
 * sign-in name, so without it a borrowed session could move the account to
 * somebody else's address. And with no mailer there is no second signal --
 * nothing can be sent to the old address to say this happened, which is
 * exactly why the page says so rather than implying a confirmation step that
 * does not exist.
 */
export function EmailForm({
  email,
  change,
}: {
  email: string;
  change: (input: { email: string; currentPassword: string }) => Promise<Result<{ email: string }>>;
}) {
  const router = useRouter();
  const [next, setNext] = useState('');
  const [currentPassword, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    setChanged(null);

    const result = await change({ email: next, currentPassword });
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }
    setChanged(result.value?.email ?? next);
    setNext('');
    // Cleared whatever happens next: the password should not sit in a box
    // after it has been used.
    setPassword('');
    // Re-renders the layout too, so the header's title and the row below show
    // the new address rather than the one that is no longer the sign-in name.
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="mt-4 max-w-xs rounded border border-[var(--border)] p-4">
      <p className="text-sm text-[var(--muted)]">
        You sign in with <span className="font-medium text-[var(--fg)]">{email}</span>. Changing it
        changes how you sign in, from the next time you do.
      </p>

      <div className="mt-3">
        <label htmlFor="newEmail" className="text-sm font-medium">New email</label>
        <input
          id="newEmail" type="email" required autoComplete="email"
          value={next} className={control}
          onChange={(event) => { setNext(event.target.value); setChanged(null); }}
        />
      </div>

      <div className="mt-3">
        <label htmlFor="emailPassword" className="text-sm font-medium">Your password</label>
        <input
          id="emailPassword" type="password" required autoComplete="current-password"
          value={currentPassword} className={control}
          onChange={(event) => { setPassword(event.target.value); setChanged(null); }}
        />
        <p className="mt-1 text-xs text-[var(--muted)]">
          {/* Stated, because the absence of a confirmation email is the thing
              a person would otherwise sit and wait for. */}
          Asked for because the email is your sign-in name. Nothing is sent to either address —
          there is no mailer — so type it carefully.
        </p>
      </div>

      <button
        type="submit" disabled={pending}
        className="mt-4 rounded-full border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-60"
      >
        {pending ? 'Changing…' : 'Change email'}
      </button>

      {error !== null && <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>}
      {changed !== null && error === null && (
        <p className="mt-3 text-sm text-[var(--ok)]">
          You now sign in with {changed}.
        </p>
      )}
    </form>
  );
}
