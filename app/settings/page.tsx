import Link from 'next/link';
import { requireUser } from '@/lib/session';
import { colorFor, readableTextOn, scheduleBadge } from '@/lib/theme/palette';
import { getPreferences } from '@/lib/theme/preferences';
import { listSwatches, sampleDrugs } from '@/lib/theme/swatches';
import {
  clearPaletteAction, randomizePaletteAction, saveLookAction, setColorAction,
} from './actions';
import { LookForm } from './look-form';
import { PaletteEditor } from './palette-editor';

export const metadata = { title: 'Settings — Enkephalin' };
export const dynamic = 'force-dynamic';

const AXIS_NOUN = {
  class: 'Drug classes',
  schedule: 'Schedules',
  tag: 'Tags',
  none: 'Nothing',
} as const;

export default async function SettingsPage() {
  const session = await requireUser();
  const preferences = await getPreferences(session.user.id);

  const [swatches, samples] = await Promise.all([
    listSwatches(preferences.colorAxis, preferences.paletteOverrides),
    sampleDrugs(),
  ]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Yours alone. The site has its own defaults and these layer over them, one colour at a
        time, so changing one leaves the rest where they were.
      </p>

      <LookForm
        theme={preferences.theme}
        axis={preferences.colorAxis}
        season={preferences.season}
        seasonTint={preferences.seasonTint}
        ambience={preferences.ambience}
        save={saveLookAction}
      />

      {/* Shown on real drugs rather than as squares: a colour is only right or
          wrong next to the name it sits beside. */}
      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
          How it looks
        </h2>
        <ul className="mt-3 space-y-1">
          {samples.map((drug) => {
            const color = colorFor(preferences.colorAxis, drug, preferences.paletteOverrides);
            return (
              <li key={drug.slug} className="flex flex-wrap items-center gap-2 text-sm">
                <Link href={`/drugs/${drug.slug}`} className="text-[var(--accent)] underline">
                  {drug.generic}
                </Link>
                {color !== null && (
                  <span
                    className="rounded px-1.5 py-0.5 text-xs"
                    style={{ backgroundColor: color, color: readableTextOn(color) }}
                  >
                    {preferences.colorAxis === 'schedule'
                      ? drug.schedule ?? 'Not controlled'
                      : drug.drugClass ?? '—'}
                  </span>
                )}
                {color === null && (
                  <span className="text-xs text-[var(--muted)]">
                    {preferences.colorAxis === 'none' ? 'colour off' : 'nothing on this axis'}
                  </span>
                )}
                {/* The control badge is coloured on every axis, so the preview
                    shows it on every axis too -- except the schedule axis,
                    where the badge above already is it. */}
                {preferences.colorAxis !== 'schedule' && drug.schedule && (
                  <span className="rounded px-1.5 py-0.5 text-xs"
                    style={scheduleBadge(drug.schedule, preferences.paletteOverrides) ?? undefined}>
                    {drug.schedule}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
          {AXIS_NOUN[preferences.colorAxis]}
        </h2>

        {preferences.colorAxis === 'none' ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            Colour is off, so there is nothing to pick. Choose an axis above to edit its colours.
          </p>
        ) : (
          <PaletteEditor
            swatches={swatches}
            axis={preferences.colorAxis}
            axisLabel={AXIS_NOUN[preferences.colorAxis]}
            setColor={setColorAction}
            clearAll={clearPaletteAction}
            shuffle={randomizePaletteAction}
          />
        )}
      </section>
    </main>
  );
}
