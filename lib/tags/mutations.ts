/**
 * Writing tags: create, rename, delete, and set which drugs are on one.
 *
 * `system` tags are the exception throughout this file -- they are the
 * therapeutic categories, and `scripts/seed-categories.ts` rebuilds every one
 * of their links on each run, so editing them here would last until the next
 * run and then vanish. They are listed, and refused.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, drugTags, drugs, tags } from '@/db/schema';
import { isUniqueViolation } from '@/lib/db-errors';
import { VARIANT_KINDS } from '@/lib/drugs/variant-kinds';
import type { Result } from '@/lib/drugs/mutations';
import { TAG_KINDS, type TagKind } from './constants';

export * from './constants';

export function tagSlug(label: string) {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function audit(input: {
  actorId: string;
  action: string;
  tagId: string;
  diff?: Record<string, unknown>;
}) {
  await db.insert(auditLog).values({
    actorId: input.actorId,
    action: input.action,
    targetType: 'tag',
    targetId: input.tagId,
    diff: input.diff ?? null,
  });
}

export async function createTag(
  input: { label: string; kind: string },
  actorId: string,
): Promise<Result<string>> {
  const label = input.label.trim();
  if (!label) return { ok: false, message: 'Give the tag a name.' };

  const kind = (TAG_KINDS as readonly string[]).includes(input.kind) ? (input.kind as TagKind) : 'custom';
  const slug = tagSlug(label);
  if (!slug) return { ok: false, message: 'That name has no letters or digits to make a slug from.' };

  try {
    const [created] = await db.insert(tags).values({ slug, label, kind }).returning({ id: tags.id });
    await audit({ actorId, action: 'tag.create', tagId: created.id, diff: { slug, label, kind } });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, message: `A tag already exists at “${slug}”.` };
    throw err;
  }

  return { ok: true, value: slug };
}

export async function renameTag(slug: string, label: string, actorId: string): Promise<Result> {
  const trimmed = label.trim();
  if (!trimmed) return { ok: false, message: 'Give the tag a name.' };

  const [tag] = await db.select().from(tags).where(eq(tags.slug, slug));
  if (!tag) return { ok: false, message: 'That tag no longer exists.' };
  if (tag.kind === 'system') {
    return { ok: false, message: 'Categories are named by the category map, not here.' };
  }

  // The slug stays: it is in saved session links and in every browse URL that
  // filters on this tag, and the name on screen comes from the label.
  await db.update(tags).set({ label: trimmed }).where(eq(tags.id, tag.id));
  await audit({ actorId, action: 'tag.rename', tagId: tag.id, diff: { from: tag.label, to: trimmed } });
  return { ok: true };
}

export async function deleteTag(slug: string, actorId: string): Promise<Result> {
  const [tag] = await db.select().from(tags).where(eq(tags.slug, slug));
  if (!tag) return { ok: false, message: 'That tag no longer exists.' };
  if (tag.kind === 'system') {
    return { ok: false, message: 'Categories come from the category map; remove it there.' };
  }

  // drug_tags cascades. No drug is harmed by losing a tag, and a session scoped
  // to the tag simply stops matching -- which is the honest outcome.
  await db.delete(tags).where(eq(tags.id, tag.id));
  await audit({ actorId, action: 'tag.delete', tagId: tag.id, diff: { slug, label: tag.label } });
  return { ok: true };
}

/**
 * Replaces a tag's membership with exactly the drugs given.
 *
 * The checklist submits every box that is ticked and nothing for the rest, so
 * "not in the list" is the absence of a value -- which is why this replaces
 * rather than adds. Unknown ids are refused rather than ignored: a stale form
 * should not quietly empty a list.
 */
/**
 * One member of a list: the drug, and optionally which version of it the list
 * means -- a class or exam slug, or null for the drug's own profile.
 */
export type TagMember = { drugId: string; variant: string | null };

export async function setTagDrugs(
  slug: string,
  members: (string | TagMember)[],
  actorId: string,
): Promise<Result<{ added: number; removed: number }>> {
  const [tag] = await db.select().from(tags).where(eq(tags.slug, slug));
  if (!tag) return { ok: false, message: 'That tag no longer exists.' };
  if (tag.kind === 'system') {
    return {
      ok: false,
      message: 'Category membership comes from the map in scripts/seed-categories.ts, which rebuilds it on every run.',
    };
  }

  // Plain ids still work -- most callers only decide membership -- and a
  // caller that cares about wording passes objects instead.
  const asked = members.map((member) => (
    typeof member === 'string' ? { drugId: member, variant: null } : member
  ));
  const chosen = new Map<string, string | null>();
  for (const member of asked) chosen.set(member.drugId, member.variant);
  const wanted = [...chosen.keys()];

  if (wanted.length > 0) {
    const known = await db.select({ id: drugs.id }).from(drugs).where(inArray(drugs.id, wanted));
    if (known.length !== wanted.length) {
      return { ok: false, message: 'That list refers to a drug that no longer exists. Reload and try again.' };
    }
  }

  // The versions named, resolved once. A slug that is not a class or an exam
  // is refused rather than ignored: silently reading the drug's own profile
  // when the list says otherwise is the kind of wrong nobody notices.
  const variantSlugs = [...new Set([...chosen.values()].filter((v): v is string => v !== null))];
  const variantIds = new Map<string, string>();
  if (variantSlugs.length > 0) {
    const rows = await db
      .select({ id: tags.id, slug: tags.slug })
      .from(tags)
      .where(and(inArray(tags.slug, variantSlugs), inArray(tags.kind, [...VARIANT_KINDS])));
    for (const row of rows) variantIds.set(row.slug, row.id);

    const unknown = variantSlugs.filter((wantedSlug) => !variantIds.has(wantedSlug));
    if (unknown.length > 0) {
      return {
        ok: false,
        message: `Not a class or exam whose version a list can name: ${unknown.join(', ')}.`,
      };
    }
  }

  const current = await db
    .select({ drugId: drugTags.drugId, variantTagId: drugTags.variantTagId })
    .from(drugTags)
    .where(eq(drugTags.tagId, tag.id));
  const have = new Set(current.map((row) => row.drugId));
  const want = new Set(wanted);

  const toAdd = wanted.filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !want.has(id));

  if (toAdd.length > 0) {
    await db
      .insert(drugTags)
      .values(toAdd.map((drugId) => ({
        drugId,
        tagId: tag.id,
        variantTagId: variantIds.get(chosen.get(drugId) ?? '') ?? null,
      })))
      .onConflictDoNothing();
  }

  // The version a kept member is read as, where it changed. Done row by row
  // because only the rows that moved should carry a new value, and because a
  // bulk update would have to name every drug anyway.
  for (const row of current) {
    if (!want.has(row.drugId)) continue;
    const next = variantIds.get(chosen.get(row.drugId) ?? '') ?? null;
    if (next === row.variantTagId) continue;
    await db
      .update(drugTags)
      .set({ variantTagId: next })
      .where(and(eq(drugTags.tagId, tag.id), eq(drugTags.drugId, row.drugId)));
  }
  if (toRemove.length > 0) {
    await db.delete(drugTags).where(and(eq(drugTags.tagId, tag.id), inArray(drugTags.drugId, toRemove)));
  }

  if (toAdd.length > 0 || toRemove.length > 0) {
    await audit({
      actorId, action: 'tag.members', tagId: tag.id,
      diff: { added: toAdd.length, removed: toRemove.length, total: wanted.length },
    });
  }

  return { ok: true, value: { added: toAdd.length, removed: toRemove.length } };
}
