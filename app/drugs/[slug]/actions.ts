'use server';

import { revalidatePath } from 'next/cache';
import { setFieldStatus } from '@/lib/fields/values';
import { requireAdmin } from '@/lib/session';

/**
 * Flagging is the one judgement left on a profile: everything in the database
 * is studied, and a flag says "this looks wrong" without taking it out of a
 * deck. Changing the value itself is the editor's job.
 */
export async function markFieldAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const slug = String(formData.get('slug') ?? '');
  const key = String(formData.get('key') ?? '');
  const status = String(formData.get('status') ?? '');
  if (status !== 'ok' && status !== 'flagged' && status !== 'none') return;

  const result = await setFieldStatus({ slug, key, status, userId: session.user.id });
  if (!result.ok) console.error('[profile] mark refused:', result.message);

  revalidatePath(`/drugs/${slug}`);
}
