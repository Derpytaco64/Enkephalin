import type { Metadata } from 'next';
import { AmbienceLayer } from '@/app/_components/ambience-layer';
import { SeasonLayer } from '@/app/_components/season-layer';
import { SiteHeader } from '@/app/_components/site-header';
import { getSession } from '@/lib/session';
import { getSiteName } from '@/lib/settings';
import { decorAttributes, getPreferences, themeAttribute } from '@/lib/theme/preferences';
import './globals.css';

/**
 * The tab title, from the name an admin set.
 *
 * A template rather than a string, so the eighteen pages that carry a title
 * say only their own half of it -- `title: 'Drugs'` becomes "Drugs — <name>".
 * Each of them used to append the default name itself, which is why renaming
 * the site in the database changed nothing anybody could see.
 */
export async function generateMetadata(): Promise<Metadata> {
  const name = await getSiteName();
  return {
    title: { default: name, template: `%s — ${name}` },
    description: 'Drug study reference and quiz tool for pharmacy school.',
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Stamped during the render rather than corrected in the browser. A theme
  // applied after load is a white flash on every navigation for anyone who
  // chose dark, and the cost -- a dynamic layout -- was already being paid by
  // every page reading a session.
  const session = await getSession();
  const preferences = await getPreferences(session?.user.id ?? null);

  // Resolved once, together, so the stylesheet and the two layers cannot
  // disagree -- and so no combination the stylesheet has no rule for can be
  // stamped: a tint needs a season, a daypart needs ambience.
  const decor = decorAttributes(preferences);

  return (
    <html
      lang="en"
      // Absent for `system`, which `globals.css` answers with
      // `prefers-color-scheme`: the server does not get to decide what the
      // operating system thinks.
      data-theme={themeAttribute(preferences.theme) ?? undefined}
      data-season={decor.season ?? undefined}
      data-tint={decor.tint ?? undefined}
      data-ambience={decor.ambience ? '' : undefined}
      data-daypart={decor.daypart ?? undefined}
      suppressHydrationWarning
    >
      <body>
        {/* Behind everything. Both layers are z-index 0 and inert; the wrapper
            below is z-index 1, and `<header>` and `<main>` paint their own
            opaque grounds -- which is what keeps a leaf from drifting through
            a paragraph. See "nothing drifts behind text" in globals.css. */}
        <AmbienceLayer on={decor.ambience} />
        <SeasonLayer season={decor.season} />

        <div className="relative z-10">
          <SiteHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
