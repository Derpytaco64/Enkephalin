import Link from 'next/link';
import { requireAdmin } from '@/lib/session';
import {
  FALLBACK_SITE_NAME, getSiteSettings, isRegistrationMode, REGISTRATION_LABELS,
} from '@/lib/settings';
import { saveSiteIdentityAction } from './actions';
import { SiteIdentityForm } from './site-identity-form';

export const metadata = { title: 'Site' };
export const dynamic = 'force-dynamic';

/**
 * What the site is, as opposed to how it looks.
 *
 * Three values that have been stored since phase 0 and editable nowhere: the
 * name, the registration lock, and the disclaimer. The lock is the one that
 * mattered -- the register page refuses a stranger because of it, and turning
 * it meant SQL or a backup restore.
 *
 * Separate from `/admin/look` on purpose. That page is the theme and the
 * palette everyone starts on, which is a matter of taste and can be overridden
 * per person; nothing here can be overridden by anyone, because it is not a
 * preference. Same row in the database, two different questions.
 */
export default async function SiteSettingsPage() {
  await requireAdmin();

  const settings = await getSiteSettings();
  const mode = isRegistrationMode(settings?.registrationMode)
    ? settings.registrationMode
    : 'invite';

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <Link href="/admin" className="pill">← Admin</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Site</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        What this site is called, who is allowed to join it, and what it says about itself.
        Everyone sees these; there is no per-person version of any of them.
      </p>

      <SiteIdentityForm
        settings={{
          siteName: settings?.siteName ?? FALLBACK_SITE_NAME,
          registrationMode: mode,
          disclaimerText: settings?.disclaimerText ?? '',
        }}
        save={saveSiteIdentityAction}
      />

      <p className="mt-6 text-xs text-[var(--muted)]">
        Registration is <span className="font-medium">{REGISTRATION_LABELS[mode].toLowerCase()}</span>{' '}
        as of this page load. Every change here is written to the audit log with what it was
        before.
      </p>
    </main>
  );
}
