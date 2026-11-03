import Link from 'next/link';
import { PaletteEditor } from '@/app/settings/palette-editor';
import { requireAdmin } from '@/lib/session';
import { getSiteSettings } from '@/lib/settings';
import { colorFor, isColorAxis, readableTextOn, type ColorAxis } from '@/lib/theme/palette';
import { getPreferences, isThemePref } from '@/lib/theme/preferences';
import { isSeasonPref } from '@/lib/theme/seasons';
import { listSwatches, sampleDrugs } from '@/lib/theme/swatches';
import {
  clearSitePaletteAction, randomizeSitePaletteAction, saveSiteThemeAction, setSiteColorAction,
} from './actions';
import { SiteThemeForm } from './site-theme-form';

export const metadata = { title: 'Look — Enkephalin' };
export const dynamic = 'force-dynamic';

const AXIS_LABELS: Record<Exclude<ColorAxis, 'none'>, string> = {
  class: 'Drug class',
  schedule: 'Controlled schedule',
  tag: 'Tag',
};

const EDITABLE = ['class', 'schedule', 'tag'] as const;

/**
 * The colours everyone starts with.
 *
 * The same editor as `/settings`, pointed at `site_settings.default_palette`
 * instead of one person's row. Every axis is editable here rather than only
 * the one the reader chose, because the site default is not a reader's choice
 * -- an admin setting the schedule ramp should not have to switch their own
 * view to the schedule axis first.
 *
 * Which axis is being edited lives in the URL, not in anybody's preferences.
 */
export default async function AdminLookPage({
  searchParams,
}: {
  searchParams: Promise<{ axis?: string }>;
}) {
  const session = await requireAdmin();
  const { axis: requested } = await searchParams;

  const axis: Exclude<ColorAxis, 'none'> =
    isColorAxis(requested) && requested !== 'none' ? requested : 'class';

  const settings = await getSiteSettings();
  const sitePalette = settings?.defaultPalette ?? {};
  const theme = isThemePref(settings?.defaultTheme) ? settings.defaultTheme : 'system';
  const season = isSeasonPref(settings?.defaultSeason) ? settings.defaultSeason : 'off';

  const [swatches, samples, mine] = await Promise.all([
    // The site palette alone, with no personal colours layered on: the point
    // of this page is what the default is, and an admin's own overrides would
    // otherwise be shown back as if they were the default.
    listSwatches(axis, sitePalette),
    sampleDrugs(6),
    getPreferences(session.user.id),
  ]);

  const ownOnThisAxis = Object.keys(mine.paletteOverrides).filter((key) => {
    const site = key in sitePalette;
    return key.startsWith(`${axis}:`) && (!site || mine.paletteOverrides[key] !== sitePalette[key]);
  }).length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Look</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        The theme and colours everyone gets before they change anything, and what a signed-out
        visitor gets full stop. Each person&rsquo;s own choices sit on top of these, colour by
        colour — so changing one here moves it for everyone who has not picked that one themselves.
      </p>

      <SiteThemeForm theme={theme} season={season} save={saveSiteThemeAction} />

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
          Default colours
        </h2>

        {/* The axis is a view here, not a setting, so it is links and not a
            select: an admin editing the schedule ramp has not changed their
            mind about how they want drugs coloured. */}
        <nav className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {EDITABLE.map((value) => (
            <Link
              key={value}
              href={`/admin/look?axis=${value}`}
              className={value === axis
                ? 'font-medium text-[var(--fg)] underline'
                : 'text-[var(--accent)] underline'}
            >
              {AXIS_LABELS[value]}
            </Link>
          ))}
        </nav>

        {ownOnThisAxis > 0 && (
          /* The trap this page sets: an admin with their own colours edits the
             default, looks at /drugs, and sees nothing move. Worth saying
             before it happens rather than leaving it to be rediscovered. */
          <p className="mt-4 rounded border border-[var(--unverified)] p-3 text-sm">
            You have {ownOnThisAxis} of your own {AXIS_LABELS[axis].toLowerCase()} colour
            {ownOnThisAxis === 1 ? '' : 's'}, which sit on top of these. Changes here will not
            show on your own pages until you{' '}
            <Link href="/settings" className="text-[var(--accent)] underline">clear yours</Link>.
          </p>
        )}

        {/* Rendered from the site palette rather than from this admin's
            preferences, for the same reason the swatches are. */}
        <ul className="mt-4 space-y-1">
          {samples.map((drug) => {
            const color = colorFor(axis, drug, sitePalette);
            return (
              <li key={drug.slug} className="flex flex-wrap items-center gap-2 text-sm">
                <span>{drug.generic}</span>
                {color !== null && (
                  <span
                    className="rounded px-1.5 py-0.5 text-xs"
                    style={{ backgroundColor: color, color: readableTextOn(color) }}
                  >
                    {axis === 'schedule'
                      ? drug.schedule ?? 'Not controlled'
                      : drug.drugClass ?? '—'}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <PaletteEditor
          swatches={swatches}
          axis={axis}
          axisLabel={AXIS_LABELS[axis]}
          setColor={setSiteColorAction}
          clearAll={clearSitePaletteAction}
          shuffle={randomizeSitePaletteAction}
        />
      </section>
    </main>
  );
}
