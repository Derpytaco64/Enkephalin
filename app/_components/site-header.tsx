import Link from 'next/link';
import { getSession } from '@/lib/session';
import { getSiteName } from '@/lib/settings';
import { Avatar } from './avatar';
import { NavLinks, type NavItem } from './nav-links';
import { SignOutButton } from './sign-out-button';

/**
 * Reading the session here makes every page dynamic, which is the accepted
 * trade for having navigation present everywhere. It also means any request
 * to any page drops a disabled account's sessions, not just a guarded one.
 */
export async function SiteHeader() {
  const [session, siteName] = await Promise.all([getSession(), getSiteName()]);

  const items: NavItem[] = [
    { href: '/drugs', label: 'Drugs' },
    { href: '/study/flashcards', label: 'Flashcards' },
    { href: '/study/quiz', label: 'Quiz' },
    { href: '/settings', label: 'Settings' },
    ...(session?.user.role === 'admin' ? [{ href: '/admin' as const, label: 'Admin' }] : []),
  ];

  return (
    <header className="border-b border-[var(--border)]">
      {/* Two layouts, because the bar has two jobs at two widths.

          Wide: a three-column grid with the outer columns at `1fr`, which puts
          the pills dead centre of the *page* -- not centred in whatever is
          left over beside the wordmark, which is what `mx-auto` on a flex
          child would have given, and which drifts as the account end changes
          width (Sign out is there, the Admin pill is not always).

          Narrow: back to a wrapping flex row, centred. Signed in as an admin
          this holds the wordmark, five pills, the avatar and Sign out, which
          does not fit on a phone -- and without a wrap it did not shrink, it
          overflowed the page sideways.

          Sized so the wide layout clears a window at **half a 1366-wide
          screen**, which is how this app is actually read: notes on one side,
          the drug on the other. At full `.pill` sizing the row measured about
          690px against the 683px it had, so it wrapped -- and a wrap here is
          not a graceful degradation, it doubles the height of the chrome on
          every page. The pills carry `.pill-nav`, the mark and the avatar are
          28px rather than 32, and the gaps are a step tighter; together that
          is about 75px, which is the difference between wrapping and not. */}
      <nav
        className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-3 gap-y-2
          px-4 py-2.5 sm:grid sm:grid-cols-[1fr_auto_1fr]"
      >
        <Link href="/" className="flex items-center gap-1.5 font-semibold tracking-tight">
          {/* Decorative, so alt is empty: the word beside it already says the
              name, and alt="Enkephalin" would have a screen reader read the
              wordmark twice. Width and height are set so the row does not
              shift as the image arrives.

              7 rather than 6: at 24px the box read as a bullet beside the
              word. It matches the avatar at the other end, and came down from
              32px with the rest of the bar so the wide layout fits a half
              screen. */}
          <img
            src="/enkephalin.webp" alt="" width={256} height={256}
            className="mark h-7 w-7 shrink-0"
          />
          {siteName}
        </Link>

        {session ? (
          <>
            <NavLinks items={items} />

            {/* The far end, and last in the source as well as on screen, so
                tabbing reaches the destinations before the account. */}
            <div className="flex items-center gap-2 sm:justify-self-end">
              {/* The email used to sit here as text, which spent a third of
                  the bar saying something the reader already knows. The
                  circle is the same information when you want it -- it is the
                  title -- and a way into the account when you do not.

                  The ring was `--accent`, which is the one chrome token the
                  seasons never move: in a tinted autumn, hovering the circle
                  drew a cold blue ring in a warm bar. It is `--btn-edge` now
                  -- the button's own boundary colour, and the only seasonal
                  token held at 3:1 or better against every ground, which is
                  what a ring has to be. The fill inside stays `--accent` on
                  purpose: it is an identity chip rather than a control, and
                  it is the one accent fill left in the app. */}
              <Link
                href="/account"
                title={session.user.email}
                aria-label="Account settings"
                className="rounded-full ring-offset-2 ring-offset-[var(--bg)]
                  hover:ring-2 hover:ring-[var(--btn-edge)]
                  focus-visible:ring-2 focus-visible:ring-[var(--btn-edge)]"
              >
                <Avatar user={session.user} size={28} />
              </Link>
              <SignOutButton />
            </div>
          </>
        ) : (
          <Link href="/login" className="pill pill-nav pill-edge sm:col-start-3 sm:justify-self-end">
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
