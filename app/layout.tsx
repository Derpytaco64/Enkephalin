import type { Metadata } from 'next';
import { SiteHeader } from '@/app/_components/site-header';
import { getSession } from '@/lib/session';
import { getPreferences, themeAttribute } from '@/lib/theme/preferences';
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
  const { theme } = await getPreferences(session?.user.id ?? null);

  return (
    <html
      lang="en"
      // Absent for `system`, which `globals.css` answers with
      // `prefers-color-scheme`: the server does not get to decide what the
      // operating system thinks.
      data-theme={themeAttribute(theme) ?? undefined}
      suppressHydrationWarning
    >
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
