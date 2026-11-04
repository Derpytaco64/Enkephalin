'use client';

import { useState } from 'react';
import { submitTo } from '@/app/_components/submit';
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
 *
 * `onSubmit` rather than `action`, and controlled throughout, for the reason
 * spelled out in `app/settings/look-form.tsx`: a form action makes React reset
 * the form, and a reset select keeps showing the old answer however the value
 * is held. Same bug, same page, same fix.
 */
export function SiteThemeForm({
  theme,
  season,
  seasonTint,
  ambience,
  save,
}: {
  theme: ThemePref;
  season: SeasonPref;
  seasonTint: boolean;
  ambience: boolean;
  save: (formData: FormData) => Promise<Result>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const [themeValue, setThemeValue] = useState(theme);
  const [seasonValue, setSeasonValue] = useState(season);
  const [tintValue, setTintValue] = useState(seasonTint);
  const [ambienceValue, setAmbienceValue] = useState(ambience);

  /** Any edit retires the last "Saved." -- it no longer describes this form. */
  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      setSaved(false);
      set(value);
    };
  }

  return (
    <form
      onSubmit={submitTo(async (formData: FormData) => {
        setPending(true);
        setError(null);
        const result = await save(formData);
        setPending(false);
        if (result.ok) setSaved(true);
        else setError(result.message);
      })}
      className="mt-4 rounded border border-[var(--border)] p-4"
    >
      <label htmlFor="theme" className="block text-sm font-medium">Default theme</label>
      <select
        id="theme" name="theme"
        className="mt-1 h-9 w-full max-w-xs rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
        value={themeValue}
        onChange={(event) => edited(setThemeValue)(event.target.value as ThemePref)}
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
        id="season" name="season"
        className="mt-1 h-9 w-full max-w-xs rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm"
        value={seasonValue}
        onChange={(event) => edited(setSeasonValue)(event.target.value as SeasonPref)}
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

      <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox" name="seasonTint" className="mt-1"
            checked={tintValue}
            onChange={(event) => edited(setTintValue)(event.target.checked)}
          />
          <span>
            Tint the whole theme to match the season
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              Grounds, card surfaces and borders take the season&rsquo;s cast, not just the
              background wash.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox" name="ambience" className="mt-1"
            checked={ambienceValue}
            onChange={(event) => edited(setAmbienceValue)(event.target.checked)}
          />
          <span>
            Ambient decoration for light and dark
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              A starfield in dark, a sunbeam and paper grain in light, and warmth by the clock.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit" disabled={pending}
          className="btn btn-primary"
        >
          Save
        </button>
        {error !== null && <span className="text-sm text-[var(--danger)]">{error}</span>}
        {error === null && saved && <span className="text-sm text-[var(--ok)]">Saved.</span>}
      </div>
    </form>
  );
}
