'use server';

import { revalidatePath } from 'next/cache';
import {
  deleteUser, setUserPassword, setUserRole, setUserStatus, signOutUser,
} from '@/lib/admin/users';
import type { Result } from '@/lib/drugs/mutations';
import { requireAdmin } from '@/lib/session';

/**
 * Every action re-reads the session rather than taking an actor from the form.
 *
 * The actor decides what is refused -- you may not change your own role,
 * status or existence -- so an actor supplied by the page would be an actor the
 * browser could supply, and the one guard that prevents locking everybody out
 * would be a hidden input.
 *
 * `/admin/users` is revalidated, which is safe here in a way it is not on a
 * study page: this route is a list, not a randomised draw, so re-rendering it
 * shows the row that just changed instead of dealing a different hand.
 */
const refresh = () => revalidatePath('/admin/users');

export async function setRoleAction(formData: FormData): Promise<Result> {
  const session = await requireAdmin();
  const result = await setUserRole(
    session.user.id,
    String(formData.get('userId') ?? ''),
    formData.get('role'),
  );
  if (result.ok) refresh();
  return result;
}

export async function setStatusAction(formData: FormData): Promise<Result> {
  const session = await requireAdmin();
  const result = await setUserStatus(
    session.user.id,
    String(formData.get('userId') ?? ''),
    formData.get('status'),
  );
  if (result.ok) refresh();
  return result.ok ? { ok: true } : result;
}

export async function signOutUserAction(formData: FormData): Promise<Result<number>> {
  const session = await requireAdmin();
  const userId = String(formData.get('userId') ?? '');

  const result = await signOutUser(
    session.user.id,
    userId,
    // Signing *yourself* out of everywhere must not include the session doing
    // the asking, or the click would end with a redirect to the login page.
    userId === session.user.id ? session.session.id : undefined,
  );
  if (result.ok) refresh();
  return result.ok ? { ok: true, value: result.value?.sessionsDropped ?? 0 } : result;
}

export async function setPasswordAction(formData: FormData): Promise<Result<number>> {
  const session = await requireAdmin();
  const result = await setUserPassword(
    session.user.id,
    String(formData.get('userId') ?? ''),
    formData.get('password'),
  );
  if (result.ok) refresh();
  return result.ok ? { ok: true, value: result.value?.sessionsDropped ?? 0 } : result;
}

export async function deleteUserAction(formData: FormData): Promise<Result> {
  const session = await requireAdmin();
  const result = await deleteUser(session.user.id, String(formData.get('userId') ?? ''));
  if (result.ok) refresh();
  return result.ok ? { ok: true } : result;
}
