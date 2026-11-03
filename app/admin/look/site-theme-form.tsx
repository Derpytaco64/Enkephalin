'use client';

import { useState } from 'react';
import type { Result } from '@/lib/drugs/mutations';
import type { ThemePref } from '@/lib/theme/preferences';
import { SEASON_LABELS, SEASON_PREFS, type SeasonPref } from '@/lib/theme/seasons';

/**
 * The theme and season a new account starts on, and what the login page uses.
 *
 * No site default colour axis, though: `sitePreferences()` answers that with
 * `class` and nobody has ever needed it to be otherwise. Adding a column for a
 * setting with one plausible value would be a migration spent on a question
 * nobody asked -- which is the test the season column had to pass, and did,
 * since "the whole site goes autumn in October" is a thing somebody would
 * actually want.
 */
export function SiteThemeForm({
  theme,
  season,
  save,
}: {
  theme: ThemePref;
  season: SeasonPref;
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

      <label htmlFor="season" className="mt-4 block text-sm font-medium">Default season</label>
      <select
        id="season" name="season" defaultValue={season}
        className="mt-1 h-9 w-full max-w-xs rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
      >
        {SEASON_PREFS.map((value) => (
          <option key={value} value={value}>{SEASON_LABELS[value]}</option>
        ))}
      </select>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {/* Worth stating, because an admin setting this and then not seeing it
            would reasonably conclude it was broken. */}
        Reaches only people who have never opened their own Settings — once somebody saves there,
        their answer is theirs. Yours included, so set it here and check it signed out.
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
