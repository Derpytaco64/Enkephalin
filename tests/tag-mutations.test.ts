import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { accounts, auditLog, drugTags, drugs, sessions, tags, users } from '@/db/schema';
import { createTag, deleteTag, renameTag, setTagDrugs, tagSlug } from '@/lib/tags/mutations';

const ADMIN = 'user-admin';
let drugIds: Record<string, string>;

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(drugTags);
  await db.delete(drugs);
  await db.delete(tags);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);

  await db.insert(users).values({ id: ADMIN, email: 'admin@example.test', role: 'admin' });

  const rows = await db
    .insert(drugs)
    .values([
      { slug: 'alprazolam', genericName: 'Alprazolam' },
      { slug: 'lisinopril', genericName: 'Lisinopril' },
      { slug: 'metformin', genericName: 'Metformin' },
    ])
    .returning({ id: drugs.id, slug: drugs.slug });
  drugIds = Object.fromEntries(rows.map((row) => [row.slug, row.id]));

  await db.insert(tags).values([
    { slug: 'top-drugs-2026', label: 'Top Drugs 2026', kind: 'top_list' },
    { slug: 'statins', label: 'Statins', kind: 'system' },
  ]);
});

async function membersOf(slug: string) {
  const [tag] = await db.select().from(tags).where(eq(tags.slug, slug));
  const rows = await db
    .select({ generic: drugs.genericName })
    .from(drugTags)
    .innerJoin(drugs, eq(drugs.id, drugTags.drugId))
    .where(eq(drugTags.tagId, tag.id));
  return rows.map((row) => row.generic).sort();
}

describe('createTag', () => {
  it('makes a list and hands back its slug', async () => {
    expect(await createTag({ label: 'Top Drugs 2027', kind: 'top_list' }, ADMIN))
      .toEqual({ ok: true, value: 'top-drugs-2027' });

    const [tag] = await db.select().from(tags).where(eq(tags.slug, 'top-drugs-2027'));
    expect(tag.label).toBe('Top Drugs 2027');
    expect(tag.kind).toBe('top_list');
  });

  it('refuses a name already taken', async () => {
    expect(await createTag({ label: 'Top drugs 2026', kind: 'top_list' }, ADMIN))
      .toEqual({ ok: false, message: 'A tag already exists at “top-drugs-2026”.' });
  });

  it('falls back to custom for a kind it does not know', async () => {
    // Including `system`: a category made here would be rebuilt away.
    await createTag({ label: 'Mine', kind: 'system' }, ADMIN);
    const [tag] = await db.select().from(tags).where(eq(tags.slug, 'mine'));
    expect(tag.kind).toBe('custom');
  });

  it('needs a name with something in it', async () => {
    expect(await createTag({ label: '  ', kind: 'custom' }, ADMIN).then((r) => r.ok)).toBe(false);
    expect(await createTag({ label: '???', kind: 'custom' }, ADMIN).then((r) => r.ok)).toBe(false);
  });
});

describe('setTagDrugs', () => {
  it('replaces the membership with exactly what was ticked', async () => {
    await setTagDrugs('top-drugs-2026', [drugIds.alprazolam, drugIds.lisinopril], ADMIN);
    expect(await membersOf('top-drugs-2026')).toEqual(['Alprazolam', 'Lisinopril']);

    // Unticking lisinopril and ticking metformin, in one save.
    const result = await setTagDrugs('top-drugs-2026', [drugIds.alprazolam, drugIds.metformin], ADMIN);
    expect(result).toEqual({ ok: true, value: { added: 1, removed: 1 } });
    expect(await membersOf('top-drugs-2026')).toEqual(['Alprazolam', 'Metformin']);
  });

  it('empties a list when nothing is ticked', async () => {
    await setTagDrugs('top-drugs-2026', [drugIds.alprazolam], ADMIN);
    await setTagDrugs('top-drugs-2026', [], ADMIN);
    expect(await membersOf('top-drugs-2026')).toEqual([]);
  });

  it('writes nothing when the list has not changed', async () => {
    await setTagDrugs('top-drugs-2026', [drugIds.alprazolam], ADMIN);
    await db.delete(auditLog);

    expect(await setTagDrugs('top-drugs-2026', [drugIds.alprazolam], ADMIN))
      .toEqual({ ok: true, value: { added: 0, removed: 0 } });
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it('refuses a stale form rather than emptying the list', async () => {
    await setTagDrugs('top-drugs-2026', [drugIds.alprazolam], ADMIN);

    const result = await setTagDrugs(
      'top-drugs-2026',
      [drugIds.alprazolam, '00000000-0000-0000-0000-000000000000'],
      ADMIN,
    );

    expect(result.ok).toBe(false);
    // The list it already had is untouched.
    expect(await membersOf('top-drugs-2026')).toEqual(['Alprazolam']);
  });

  it('refuses a category, which the seeder owns', async () => {
    const result = await setTagDrugs('statins', [drugIds.alprazolam], ADMIN);
    expect(result.ok).toBe(false);
    expect(await membersOf('statins')).toEqual([]);
  });

  it('records what changed', async () => {
    await setTagDrugs('top-drugs-2026', [drugIds.alprazolam, drugIds.metformin], ADMIN);

    const [row] = await db.select().from(auditLog);
    expect(row.action).toBe('tag.members');
    expect(row.targetType).toBe('tag');
    expect(row.diff).toEqual({ added: 2, removed: 0, total: 2 });
  });
});

describe('renameTag and deleteTag', () => {
  it('renames without moving the address', async () => {
    expect(await renameTag('top-drugs-2026', 'Top 200 — 2026', ADMIN)).toEqual({ ok: true });

    const [tag] = await db.select().from(tags).where(eq(tags.slug, 'top-drugs-2026'));
    // The slug is in every saved session link and browse URL.
    expect(tag.label).toBe('Top 200 — 2026');
    expect(tag.slug).toBe('top-drugs-2026');
  });

  it('deletes the list and its links, leaving the drugs', async () => {
    await setTagDrugs('top-drugs-2026', [drugIds.alprazolam], ADMIN);

    expect(await deleteTag('top-drugs-2026', ADMIN)).toEqual({ ok: true });
    expect(await db.select().from(tags).where(eq(tags.slug, 'top-drugs-2026'))).toEqual([]);
    expect(await db.select().from(drugTags)).toEqual([]);
    expect(await db.select().from(drugs)).toHaveLength(3);
  });

  it('will not rename or delete a category', async () => {
    expect((await renameTag('statins', 'Lipid things', ADMIN)).ok).toBe(false);
    expect((await deleteTag('statins', ADMIN)).ok).toBe(false);
    expect(await db.select().from(tags).where(eq(tags.slug, 'statins'))).toHaveLength(1);
  });
});

describe('tagSlug', () => {
  it('collapses punctuation the way the seeder does', () => {
    expect(tagSlug('Top Drugs 2026')).toBe('top-drugs-2026');
    expect(tagSlug('Pharmacology I / II')).toBe('pharmacology-i-ii');
    expect(tagSlug('  Spaced  out  ')).toBe('spaced-out');
  });
});
