import Link from 'next/link';
import { getRegistrationMode } from '@/lib/settings';
import { LoginForm } from './login-form';

export const metadata = { title: 'Sign in — Enkephalin' };

// Same reason as the register page: registration_mode is site settings an
// admin can change, so this is rendered per request rather than baked at
// build time, where the database is not even reachable.
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ next }, mode] = await Promise.all([searchParams, getRegistrationMode()]);

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>

      {/* Read from settings rather than stated as a fact. This line used to
          say "invite-only" whatever the mode actually was, which is a thing
          the page cannot know without asking. */}
      <p className="mt-2 text-sm text-[var(--muted)]">
        {mode === 'closed'
          ? 'Registration is closed right now.'
          : mode === 'open'
            ? 'Registration is open.'
            : 'Registration is invite-only.'}
      </p>

      <LoginForm next={next} />

      {/* No link when registration is closed: the page would only refuse, and
          sending someone to be refused is worse than not offering. */}
      {mode !== 'closed' && (
        <Link href="/register" className="mt-8 inline-block text-sm text-[var(--accent)] underline">
          {mode === 'invite'
            ? 'Have an invite code? Create an account'
            : 'New here? Create an account'}
        </Link>
      )}
    </main>
  );
}
