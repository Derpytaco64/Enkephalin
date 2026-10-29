import Link from 'next/link';
import { getRegistrationMode } from '@/lib/settings';
import { RegisterForm } from './register-form';

export const metadata = { title: 'Register — Enkephalin' };

// registration_mode is site settings an admin can change, so this page must
// be rendered per request rather than baked at build time -- where the
// database is not even reachable.
export const dynamic = 'force-dynamic';

export default async function RegisterPage() {
  const mode = await getRegistrationMode();

  return (
    <main className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>

      {mode === 'closed' ? (
        <p className="mt-2 text-[var(--muted)]">Registration is closed right now.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-[var(--muted)]">
            {mode === 'invite'
              ? 'You need an invite code from the site owner.'
              : 'Registration is open.'}
          </p>
          <RegisterForm needsCode={mode === 'invite'} />
        </>
      )}

      <Link href="/login" className="mt-8 inline-block text-sm text-[var(--accent)] underline">
        Already have an account? Sign in
      </Link>
    </main>
  );
}
