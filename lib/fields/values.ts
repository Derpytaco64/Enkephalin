import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { drugs, type FieldValue } from '@/db/schema';

/**
 * Marks one stored field value. Only the envelope changes -- the value itself
 * is the drug editor's business (phase 8) -- so verifying is a statement about
 * a value someone has already read, not an edit of it.
 *
 * Core fields are not here on purpose: their values live in their own columns,
 * so there is no envelope to stamp.
 */
export async function setFieldStatus(input: {
  slug: string;
  key: string;
  status: FieldValue['status'];
  userId: string;
}) {
  const [drug] = await db.select({ id: drugs.id, fields: drugs.fields }).from(drugs).where(eq(drugs.slug, input.slug));
  if (!drug) return { ok: false as const, message: 'That drug no longer exists.' };

  const current = drug.fields[input.key];
  if (!current) return { ok: false as const, message: 'That field has no value to mark.' };
  if (current.status === input.status) return { ok: true as const };

  await db
    .update(drugs)
    .set({
      fields: {
        ...drug.fields,
        [input.key]: {
          ...current,
          status: input.status,
          updatedAt: new Date().toISOString(),
          updatedBy: input.userId,
        },
      },
      updatedAt: new Date(),
    })
    .where(eq(drugs.id, drug.id));

  return { ok: true as const };
}
