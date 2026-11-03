'use client';

import { useState } from 'react';
import type { Result } from '@/lib/drugs/mutations';
import type { ColorAxis } from '@/lib/theme/palette';
import type { ThemePref } from '@/lib/theme/preferences';
import { SEASON_LABELS, SEASON_PREFS, type SeasonPref } from '@/lib/theme/seasons';

const AXIS_LABELS: Record<ColorAxis, string> = {
  class: 'Drug class',
  schedule: 'Controlled schedule',
  tag: 'Tag',
  none: 'No colour',
};

/**
 * Theme and colour axis, saved together.
 *
 * A client component only so a refusal has somewhere to land, which is how
 * every other write in this app behaves. The values come from fixed lists, so
 * a refusal means a hand-made request -- but silently ignoring one of those is
 * how a form starts lying about what it saved.
 */
export function LookForm({
  theme,
  axis,
  season,
  seasonTint,
  ambience,
  save,
}: {
  theme: ThemePref;
  axis: ColorAxis;
  season: SeasonPref;
  seasonTint: boolean;
  ambience: boolean;
  save: (formData: FormData) => Promise<Result>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const control = 'mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-2 text-sm';

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
      className="mt-6 rounded border border-[var(--border)] p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="theme" className="block text-sm font-medium">Theme</label>
          <select id="theme" name="theme" defaultValue={theme} className={control}>
            <option value="system">Follow the system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Applied while the page is built, so there is no flash of the wrong one on the way in.
          </p>
        </div>

        <div>
          <label htmlFor="season" className="block text-sm font-medium">Season</label>
          <select id="season" name="season" defaultValue={season} className={control}>
            {SEASON_PREFS.map((value) => (
              <option key={value} value={value}>{SEASON_LABELS[value]}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {/* Said plainly, because "season" beside "theme" reads like a
                second answer to the same question, and it is not. */}
            A tint and a few drifting motes over whichever theme you picked — it does not choose
            light or dark for you. Nothing in a deck or a quiz depends on it, and it stops moving
            if your system asks for reduced motion.
          </p>
        </div>

        <div>
          <label htmlFor="axis" className="block text-sm font-medium">Colour by</label>
          <select id="axis" name="axis" defaultValue={axis} className={control}>
            {(['class', 'schedule', 'tag', 'none'] as ColorAxis[]).map((value) => (
              <option key={value} value={value}>{AXIS_LABELS[value]}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--muted)]">
            What the badge beside a drug stands for. Colour is never the only signal — every badge
            carries its own text — so turning it off loses nothing but the colour.
          </p>
        </div>
      </div>

      {/* The two switches, under the selects they qualify. Checkboxes rather
          than selects because each is one yes-or-no, and a two-option select
          is a checkbox that takes an extra click. */}
      <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox" name="seasonTint" defaultChecked={seasonTint} className="mt-1"
          />
          <span>
            Tint the whole theme to match the season
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              Without this, a season is the background wash and the motes. With it, the page,
              the cards and the borders take the season&rsquo;s cast too — still light or dark as
              you chose, just warmer or cooler. Nothing to set if the season is off.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="ambience" defaultChecked={ambience} className="mt-1" />
          <span>
            Ambient decoration for light and dark
            <span className="mt-0.5 block text-xs text-[var(--muted)]">
              A drifting starfield in dark; a slow sunbeam, its dust and a faint paper grain in
              light; and a warmth that follows the clock. Independent of the season — you can
              have both, either, or neither.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
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
