'use server';

import { revalidatePath } from 'next/cache';
import { setBaseVariant } from '@/lib/drugs/variants';
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

/**
 * Records which class's words the drug's own profile is -- or clears it.
 *
 * The reason there is a control at all: a lecture imported into a drug the app
 * had never held writes the drug itself, so the base is that class's wording,
 * and until it was recorded the picker called it *the drug's own* beside two
 * versions it had named. An import now sets it as it goes; this is for the
 * drugs that came in before it did.
 *
 * An empty select is *nobody in particular*, which is what the 236 off the
 * class sheet are -- so clearing has to be possible and is the blank option.
 */
export async function setBaseVariantAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const slug = String(formData.get('slug') ?? '');
  const variant = String(formData.get('variant') ?? '');

  const result = await setBaseVariant({ drugSlug: slug, variantSlug: variant || null });
  if (!result.ok) console.error('[profile] base attribution refused:', result.message);

  revalidatePath(`/drugs/${slug}`);
}
