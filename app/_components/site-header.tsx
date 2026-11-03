import Link from 'next/link';
import { getSession } from '@/lib/session';
import { Avatar } from './avatar';
import { NavLinks, type NavItem } from './nav-links';
import { SignOutButton } from './sign-out-button';

/**
 * Reading the session here makes every page dynamic, which is the accepted
 * trade for having navigation present everywhere. It also means any request
 * to any page drops a disabled account's sessions, not just a guarded one.
 */
export async function SiteHeader() {
  const session = await getSession();

  const items: NavItem[] = [
    { href: '/drugs', label: 'Drugs' },
    { href: '/study/flashcards', label: 'Flashcards' },
    { href: '/study/quiz', label: 'Quiz' },
    { href: '/settings', label: 'Settings' },
    ...(session?.user.role === 'admin' ? [{ href: '/admin' as const, label: 'Admin' }] : []),
  ];

  return (
    <header className="border-b border-[var(--border)]">
      {/* Wraps. Signed in as an admin this holds the wordmark, five pills, the
          avatar and Sign out, which does not fit on a phone -- and without a
          wrap it did not shrink, it overflowed the page sideways. */}
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          {/* Decorative, so alt is empty: the word beside it already says the
              name, and alt="Enkephalin" would have a screen reader read the
              wordmark twice. Width and height are set so the row does not
              shift as the image arrives.

              8 rather than 6: at 24px the box read as a bullet beside the
              word. 32px is as far as it goes without setting the bar's
              height -- it matches the avatar at the other end, and the pills
              between them are 30px tall. */}
          <img
            src="/enkephalin.webp" alt="" width={256} height={256}
            className="h-8 w-8 shrink-0"
          />
          Enkephalin
        </Link>

        {session ? (
          <>
            <NavLinks items={items} />

            {/* Pushed to the far end, and last in the source as well as on
                screen, so tabbing reaches the destinations before the account. */}
            <div className="ml-auto flex items-center gap-3">
              {/* The email used to sit here as text, which spent a third of
                  the bar saying something the reader already knows. The
                  circle is the same information when you want it -- it is the
                  title -- and a way into the account when you do not. */}
              <Link
                href="/account"
                title={session.user.email}
                aria-label="Account settings"
                className="rounded-full ring-offset-2 ring-offset-[var(--bg)]
                  hover:ring-2 hover:ring-[var(--accent)]
                  focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              >
                <Avatar user={session.user} size={32} />
              </Link>
              <SignOutButton />
            </div>
          </>
        ) : (
          <Link
            href="/login"
            className="ml-auto rounded-full border border-[var(--border)] px-3 py-1.5 text-sm
              hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            Sign in
          </Link>
        )}
      </nav>
    </header>
  );
}
