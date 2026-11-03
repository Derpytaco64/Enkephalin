import Link from 'next/link';
import { getSession } from '@/lib/session';
import { SignOutButton } from './sign-out-button';

/**
 * Reading the session here makes every page dynamic, which is the accepted
 * trade for having navigation present everywhere. It also means any request
 * to any page drops a disabled account's sessions, not just a guarded one.
 */
export async function SiteHeader() {
  const session = await getSession();

  return (
    <header className="border-b border-[var(--border)]">
      {/* Wraps. Signed in as an admin this holds the wordmark, four links, the
          email and Sign out, which does not fit on a phone -- and without a
          wrap it did not shrink, it overflowed the page sideways. */}
      <nav className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-5 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          {/* Decorative, so alt is empty: the word beside it already says the
              name, and alt="Enkephalin" would have a screen reader read the
              wordmark twice. Width and height are set so the row does not
              shift as the image arrives. */}
          <img
            src="/enkephalin.webp" alt="" width={256} height={256}
            className="h-6 w-6 shrink-0"
          />
          Enkephalin
        </Link>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {session ? (
            <>
              <Link href="/drugs" className="text-[var(--accent)] underline">
                Drugs
              </Link>
              <Link href="/study/flashcards" className="text-[var(--accent)] underline">
                Flashcards
              </Link>
              <Link href="/study/quiz" className="text-[var(--accent)] underline">
                Quiz
              </Link>
              <Link href="/settings" className="text-[var(--accent)] underline">
                Settings
              </Link>
              {session.user.role === 'admin' && (
                <Link href="/admin" className="text-[var(--accent)] underline">
                  Admin
                </Link>
              )}
              <span className="hidden max-w-[14rem] truncate text-[var(--muted)] sm:inline">
                {session.user.email}
              </span>
              <SignOutButton />
            </>
          ) : (
            <Link href="/login" className="text-[var(--accent)] underline">
              Sign in
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
