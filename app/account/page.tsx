import Link from 'next/link';
import { count, eq } from 'drizzle-orm';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';
import { requireUser } from '@/lib/session';
import { MIN_PASSWORD_LENGTH } from '@/lib/users';
import { changeEmailAction, changePasswordAction, saveProfileAction } from './actions';
import { EmailForm } from './email-form';
import { PasswordForm } from './password-form';
import { ProfileForm } from './profile-form';

export const metadata = { title: 'Account' };
export const dynamic = 'force-dynamic';

/**
 * Your account, as distinct from `/settings`.
 *
 * The split is who the setting is about: this page is about *you* -- the name,
 * the picture, the address you sign in with and the password -- and `/settings`
 * is about how
 * the site looks to you. Keeping the password beside the theme toggle would
 * have put the one irreversible control on the page people open to try colour
 * schemes.
 */
export default async function AccountPage() {
  const session = await requireUser();

  // Read from the row rather than from the session: `name` and `image` are
  // what a save just wrote, and the session is handed to us from a cache the
  // write did not clear.
  const [row] = await db
    .select({ name: users.name, email: users.email, image: users.image, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  const [sessionRow] = await db
    .select({ open: count(sessions.id) })
    .from(sessions)
    .where(eq(sessions.userId, session.user.id));

  const user = row ?? {
    name: session.user.name ?? null,
    email: session.user.email,
    image: session.user.image ?? null,
    createdAt: new Date(),
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Who you are here.{' '}
        <Link href="/settings" className="text-[var(--accent)] underline">Settings</Link>{' '}
        is where the theme and the colours live.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
          Profile
        </h2>
        <ProfileForm user={user} save={saveProfileAction} />
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
          Email
        </h2>
        <EmailForm email={user.email} change={changeEmailAction} />
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
          Password
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {/* Stated plainly, because the alternative is someone locked out
              waiting for an email that is never coming. */}
          There is no mailer configured, so a forgotten password cannot be
          reset by email — an admin has to set a new one. Changing one you still
          know works here.
        </p>
        <PasswordForm change={changePasswordAction} minLength={MIN_PASSWORD_LENGTH} />
      </section>

      <section className="mt-10 border-t border-[var(--border)] pt-6 text-sm text-[var(--muted)]">
        <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[8rem_1fr]">
          {/* No Email row: the form above states it, and three copies of the
              same address on one page is two too many. */}
          <dt>Role</dt>
          <dd className="text-[var(--fg)]">
            {session.user.role === 'admin' ? 'Admin' : 'Student'}
          </dd>
          <dt>Joined</dt>
          <dd className="text-[var(--fg)]">{user.createdAt.toLocaleDateString()}</dd>
          <dt>Signed in</dt>
          <dd className="text-[var(--fg)]">
            {sessionRow.open} {sessionRow.open === 1 ? 'device' : 'devices'}
          </dd>
        </dl>
        <p className="mt-3 text-xs">
          Nothing on this page is verified by email, because there is no mailer. An address you
          mistype is an address you sign in with — and a forgotten password needs an admin.
        </p>
      </section>
    </main>
  );
}
