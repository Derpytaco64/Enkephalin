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
      <nav className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-semibold tracking-tight">
          Enkephalin
        </Link>

        <div className="flex items-center gap-4 text-sm">
          {session ? (
            <>
              <Link href="/drugs" className="text-[var(--accent)] underline">
                Drugs
              </Link>
              <Link href="/study/flashcards" className="text-[var(--accent)] underline">
                Study
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
