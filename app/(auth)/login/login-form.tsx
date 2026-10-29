'use client';

import { useState } from 'react';
import { signIn } from '@/lib/auth-client';

/**
 * Only same-site absolute paths are followed. '//evil.com' is a
 * protocol-relative URL, so checking for a leading slash is not enough.
 */
function safeNext(next: string | undefined) {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/';
  return next;
}

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await signIn.email({ email, password });
    if (result.error) {
      // Deliberately not distinguishing unknown email from wrong password.
      setError('That email and password do not match.');
      setBusy(false);
      return;
    }

    // Full navigation rather than a router push, so server components re-read
    // the session cookie that was just set.
    window.location.assign(safeNext(next));
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm">Email</label>
        <input
          id="email" type="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm">Password</label>
        <input
          id="password" type="password" required autoComplete="current-password" value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2"
        />
      </div>

      {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}

      <button
        type="submit" disabled={busy}
        className="rounded bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)] disabled:opacity-60"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
