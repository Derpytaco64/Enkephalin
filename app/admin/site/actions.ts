'use server';

import { revalidatePath } from 'next/cache';
import type { Result } from '@/lib/drugs/mutations';
import { requireAdmin } from '@/lib/session';
import { saveSiteIdentity, type SiteIdentity } from '@/lib/settings';

/**
 * The site's name, its registration lock and its disclaimer, saved together.
 *
 * `requireAdmin` here rather than inside the writer, for the reason every
 * other action in this app gives: a function that checks its own caller is a
 * function you cannot test or reuse, and the writer is reached from a seeded
 * script as well as from this form.
 */
export async function saveSiteIdentityAction(
  formData: FormData,
): Promise<Result<SiteIdentity>> {
  const session = await requireAdmin();

  const result = await saveSiteIdentity({
    siteName: formData.get('siteName'),
    registrationMode: formData.get('registrationMode'),
    disclaimerText: formData.get('disclaimerText'),
  }, session.user.id);

  // The whole layout, like the site theme: the name is in the tab title and
  // the top bar of every page, and the disclaimer is on two of them. Without
  // this, a rename would show on this screen and nowhere else until each page
  // happened to be re-rendered.
  if (result.ok) revalidatePath('/', 'layout');

  return result;
}
