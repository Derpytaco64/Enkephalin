'use client';

import { useState } from 'react';
import { registerWithInvite } from './actions';

export function RegisterForm({ needsCode }: { needsCode: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const result = await registerWithInvite({ name, email, password, code });
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }

    window.location.assign('/');
  }

  const field = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2';

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      {needsCode && (
        <div>
          <label htmlFor="code" className="block text-sm">Invite code</label>
          <input
            id="code" required value={code} onChange={(e) => setCode(e.target.value)}
            autoCapitalize="characters" spellCheck={false}
            className={`${field} font-mono tracking-wider`}
          />
        </div>
      )}
      <div>
        <label htmlFor="name" className="block text-sm">Name</label>
        <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className={field} />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm">Email</label>
        <input
          id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="email" className={field}
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm">Password</label>
        <input
          id="password" type="password" required minLength={8} value={password}
          onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className={field}
        />
        <p className="mt-1 text-xs text-[var(--muted)]">At least 8 characters.</p>
      </div>

      {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}

      <button
        type="submit" disabled={busy}
        className="btn btn-primary"
      >
        {busy ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
