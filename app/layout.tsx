import type { Metadata } from 'next';
import { SeasonLayer } from '@/app/_components/season-layer';
import { SiteHeader } from '@/app/_components/site-header';
import { getSession } from '@/lib/session';
import { getPreferences, seasonAttribute, themeAttribute } from '@/lib/theme/preferences';
import './globals.css';

export const metadata: Metadata = {
  title: 'Enkephalin',
  description: 'Drug study reference and quiz tool for pharmacy school.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Stamped during the render rather than corrected in the browser. A theme
  // applied after load is a white flash on every navigation for anyone who
  // chose dark, and the cost -- a dynamic layout -- was already being paid by
  // every page reading a session.
  const session = await getSession();
  const { theme, season } = await getPreferences(session?.user.id ?? null);

  // Resolved here, once, so the wash the stylesheet paints and the motes the
  // layer draws cannot disagree about which season it is. Null for `off`, and
  // for nobody who has not asked.
  const drawn = seasonAttribute(season);

  return (
    <html
      lang="en"
      // Absent for `system`, which `globals.css` answers with
      // `prefers-color-scheme`: the server does not get to decide what the
      // operating system thinks.
      data-theme={themeAttribute(theme) ?? undefined}
      data-season={drawn ?? undefined}
      suppressHydrationWarning
    >
      <body>
        {/* Behind everything. The layer is z-index 0 and inert; the wrapper
            below is z-index 1, which is what keeps a decoration from sitting
            on top of the page it decorates. */}
        <SeasonLayer season={drawn} />

        <div className="relative z-10">
          <SiteHeader />
          {children}
        </div>
      </body>
    </html>
  );
}
