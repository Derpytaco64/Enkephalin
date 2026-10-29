'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/session';
import { createInvite, revokeInvite } from '@/lib/invites';

export async function createInviteAction(formData: FormData) {
  // Re-checked here on purpose: the layout guard protects the page render,
  // not a direct call to this action.
  const session = await requireAdmin();

  const maxUses = Number(formData.get('maxUses') ?? 1);
  const days = Number(formData.get('expiresInDays') ?? 0);

  await createInvite({
    createdBy: session.user.id,
    maxUses: Number.isFinite(maxUses) ? maxUses : 1,
    expiresAt: Number.isFinite(days) && days > 0 ? new Date(Date.now() + days * 86_400_000) : null,
    note: String(formData.get('note') ?? ''),
  });

  revalidatePath('/admin/invites');
}

export async function revokeInviteAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id') ?? '');
  if (id) await revokeInvite(id);
  revalidatePath('/admin/invites');
}
