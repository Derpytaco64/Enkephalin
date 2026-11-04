/**
 * Removes every tag but the drug lists the owner asked for.
 *
 * Context, so the next person does not quietly undo it: this app had 66 tags.
 * One was *Top Drugs 2026*, the class list. The other 65 were therapeutic
 * categories written by `scripts/seed-categories.ts` -- a curated FDA-class →
 * category map that nobody asked for, and which the owner's verdict was
 * diluting the thing it meant to help. So they are gone, on 2026-11-04, by
 * that call.
 *
 * Nothing about a drug is harmed by losing a tag: `drug_tags` cascades, and a
 * saved study setup scoped to a category simply stops matching, which is the
 * honest outcome rather than a silent reinterpretation. Categories also had
 * one quiet job in the quiz -- the near-miss distractor falls back to "same
 * category" when a drug's class has no other member -- and with none left that
 * fallback is simply never taken, which it already handles.
 *
 * **Reversible two ways.** Re-running `scripts/seed-categories.ts` rebuilds
 * all 65 and their links from the map, which is still in the repo; or a
 * backup taken before this restores exactly what was there. This script writes
 * what it removed to the file named on the command line before deleting
 * anything, which is a third.
 *
 *   npx tsx scripts/prune-tags.ts [--write] [--out backups/tags-<date>.json]
 *
 * Without --write it prints what it would do and touches nothing.
 */
import './env.ts';
import { writeFileSync } from 'node:fs';
import { asc, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { auditLog, drugTags, tags, users } from '../db/schema.ts';

/** The one the owner kept. Slugs, because a label can be renamed. */
const KEEP = ['top-drugs-2026'];

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

async function main() {
  const write = process.argv.includes('--write');
  const out = arg('--out') ?? `backups/tags-removed_${new Date().toISOString().slice(0, 10)}.json`;

  const all = await db.select().from(tags).orderBy(asc(tags.slug));
  const kept = all.filter((tag) => KEEP.includes(tag.slug));
  const doomed = all.filter((tag) => !KEEP.includes(tag.slug));

  // A keep-list that matches nothing means a renamed slug, and deleting every
  // tag in the database is not what anybody meant by "all but one".
  if (kept.length !== KEEP.length) {
    throw new Error(
      `expected to keep ${KEEP.join(', ')} but found ${kept.map((t) => t.slug).join(', ') || 'none'}`,
    );
  }

  const links = doomed.length === 0 ? [] : await db
    .select({ tagId: drugTags.tagId, drugId: drugTags.drugId })
    .from(drugTags)
    .where(inArray(drugTags.tagId, doomed.map((tag) => tag.id)));

  console.log(`keeping ${kept.length}: ${kept.map((tag) => tag.slug).join(', ')}`);
  console.log(`removing ${doomed.length} tags and ${links.length} drug links`);
  for (const tag of doomed.slice(0, 5)) console.log(`  - ${tag.slug} (${tag.kind})`);
  if (doomed.length > 5) console.log(`  ... and ${doomed.length - 5} more`);

  if (!write) {
    console.log('\ndry run. Pass --write to apply.');
    return;
  }

  writeFileSync(out, `${JSON.stringify({
    removedAt: new Date().toISOString(),
    tags: doomed.map((tag) => ({
      slug: tag.slug, label: tag.label, kind: tag.kind, sortOrder: tag.sortOrder,
      defaultColorToken: tag.defaultColorToken,
    })),
    links: links.map((link) => ({
      tag: doomed.find((tag) => tag.id === link.tagId)?.slug ?? link.tagId,
      drugId: link.drugId,
    })),
  }, null, 2)}\n`, 'utf8');
  console.log(`wrote ${out}`);

  // audit_log.actor_id is a foreign key to users, so the row needs a real
  // person: the owner, resolved by the address in the environment.
  const email = process.env.ADMIN_EMAIL;
  if (!email) throw new Error('ADMIN_EMAIL is not set, and the audit row needs an actor.');
  const [actor] = await db.select().from(users).where(eq(users.email, email));
  if (!actor) throw new Error(`no user with the address ${email}`);

  // drug_tags cascades off the tag.
  await db.delete(tags).where(notInArray(tags.slug, KEEP));
  await db.insert(auditLog).values(doomed.map((tag) => ({
    actorId: actor.id,
    action: 'tag.delete',
    targetType: 'tag',
    targetId: tag.id,
    diff: { slug: tag.slug, label: tag.label, kind: tag.kind, reason: 'owner pruned tags' },
  })));

  const left = await db.select({ slug: tags.slug }).from(tags);
  console.log(`done. ${left.length} tag(s) left: ${left.map((tag) => tag.slug).join(', ')}`);
}

void main().then(() => process.exit(0));
