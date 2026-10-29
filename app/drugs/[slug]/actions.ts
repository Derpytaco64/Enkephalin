'use server';

import { revalidatePath } from 'next/cache';
import { setFieldStatus } from '@/lib/fields/values';
import { requireAdmin } from '@/lib/session';

/**
 * Verifying is an admin judgement: it is the claim that someone checked this
 * value against Micromedex or lecture, which is what makes "verified only"
 * worth filtering a study session by.
 */
export async function markFieldAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const slug = String(formData.get('slug') ?? '');
  const key = String(formData.get('key') ?? '');
  const status = String(formData.get('status') ?? '');
  if (status !== 'verified' && status !== 'flagged' && status !== 'unverified') return;

  const result = await setFieldStatus({ slug, key, status, userId: session.user.id });
  if (!result.ok) console.error('[profile] mark refused:', result.message);

  revalidatePath(`/drugs/${slug}`);
}
