'use client';

import { useState } from 'react';
import type { Result } from '@/lib/drugs/mutations';
import type { ThemePref } from '@/lib/theme/preferences';

/**
 * The theme a new account starts on, and the one the login page uses.
 *
 * Theme only: there is no site default colour axis to set, because
 * `sitePreferences()` answers that with `class` and nobody has ever needed it
 * to be otherwise. Adding a column for a setting with one plausible value
 * would be a migration spent on a question nobody asked.
 */
export function SiteThemeForm({
  theme,
  save,
}: {
  theme: ThemePref;
  save: (formData: FormData) => Promise<Result>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <form
      action={async (formData: FormData) => {
        setPending(true);
        setError(null);
        const result = await save(formData);
        setPending(false);
        if (result.ok) setSaved(true);
        else setError(result.message);
      }}
      className="mt-4 rounded border border-[var(--border)] p-4"
    >
      <label htmlFor="theme" className="block text-sm font-medium">Default theme</label>
      <select
        id="theme" name="theme" defaultValue={theme}
        className="mt-1 h-9 w-full max-w-xs rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
      >
        <option value="system">Follow the system</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
      <p className="mt-1 text-xs text-[var(--muted)]">
        What someone sees before they choose for themselves, and what the login page uses — which
        is the one page nobody has a saved choice on yet.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit" disabled={pending}
          className="rounded bg-[var(--accent)] px-4 py-2 text-[var(--accent-fg)] disabled:opacity-60"
        >
          Save
        </button>
        {error !== null && <span className="text-sm text-[var(--danger)]">{error}</span>}
        {error === null && saved && <span className="text-sm text-[var(--ok)]">Saved.</span>}
      </div>
    </form>
  );
}
