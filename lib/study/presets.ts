/**
 * Named study setups: the settings of a quiz or a deck, kept so a session you
 * sit often is one click instead of eight controls.
 *
 * What is stored is the page's own **query parameters**, not a `StudyConfig`.
 * Both forms are GET forms whose state is the query, and a config cannot hold
 * all of it: `direction` has no value for "mixed, decided per question", and
 * priority is not a config field. Keeping the query reproduces the page
 * exactly, and a setting added later needs no migration.
 *
 * Nothing is trusted on the way in or the way out. A stored setup is turned
 * back into a URL, so a key the page does not understand is at best dead
 * weight and at worst something a restored backup smuggled in; both directions
 * go through the same whitelist.
 */
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { studyPresets } from '@/db/schema';
// The shared shape for a write that can refuse, as `lib/tags` takes it too.
import type { Result } from '@/lib/drugs/mutations';

/** The two pages that have settings worth keeping. */
export type Surface = 'quiz' | 'flashcards';

export const SURFACES: Record<Surface, { path: string; label: string }> = {
  quiz: { path: '/study/quiz', label: 'Quiz' },
  flashcards: { path: '/study/flashcards', label: 'Flashcards' },
};

export function isSurface(value: unknown): value is Surface {
  return value === 'quiz' || value === 'flashcards';
}

/**
 * Every parameter each page reads, split by whether it repeats.
 *
 * Kept here rather than inferred, because this list is a promise: a setup
 * saved today has to still mean what it said, so a renamed parameter is a
 * decision about saved setups and not just about a form.
 */
const ALLOWED: Record<Surface, { one: string[]; many: string[] }> = {
  quiz: {
    one: ['year', 'max', 'dir', 'set', 'tag', 'pri'],
    many: ['fields', 'cat', 'ind'],
  },
  flashcards: {
    one: ['mode', 'year', 'block', 'max', 'dir', 'set', 'tag'],
    many: ['fields', 'cat', 'ind'],
  },
};

export type SetupParams = Record<string, string | string[]>;

export type Setup = {
  id: string;
  name: string;
  surface: Surface;
  params: SetupParams;
};

const NAME_LIMIT = 60;

/**
 * Keeps the parameters this surface understands and drops everything else.
 *
 * Blank values go too: an untouched select submits its name with an empty
 * value, and storing `tag=` would make a setup that claims to narrow by list
 * and does not. Keys come out sorted so the same setup saved twice is the same
 * row either time.
 */
export function setupParams(
  surface: Surface,
  raw: Record<string, string | string[] | undefined>,
): SetupParams {
  const allowed = ALLOWED[surface];
  const params: SetupParams = {};

  for (const key of [...allowed.one].sort()) {
    const value = raw[key];
    const text = Array.isArray(value) ? value[0] : value;
    if (typeof text === 'string' && text.trim() !== '') params[key] = text.trim();
  }

  for (const key of [...allowed.many].sort()) {
    const value = raw[key];
    const list = (Array.isArray(value) ? value : [value])
      .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      .map((item) => item.trim());
    if (list.length > 0) params[key] = [...new Set(list)];
  }

  return params;
}

/**
 * Whether these parameters would actually start something.
 *
 * Both pages key off the field list -- a page with no fields shows the form
 * and nothing else -- so a setup without one is a setup that does nothing, and
 * saving it would be saving a blank form under a name.
 */
export function startsSomething(params: SetupParams): boolean {
  return 'fields' in params || 'year' in params;
}

export async function listSetups(userId: string, surface?: Surface): Promise<Setup[]> {
  const rows = await db
    .select()
    .from(studyPresets)
    .where(eq(studyPresets.userId, userId))
    .orderBy(asc(studyPresets.name));

  return rows.flatMap((row) => {
    const stored = row.config as { surface?: unknown; params?: unknown };
    if (!isSurface(stored.surface)) return [];
    if (surface !== undefined && stored.surface !== surface) return [];

    // Re-filtered on the way out: a backup restored from an older version, or
    // from someone else's export, is not a reason to put unknown keys in a URL.
    const params = setupParams(
      stored.surface,
      (stored.params ?? {}) as Record<string, string | string[] | undefined>,
    );
    return [{ id: row.id, name: row.name, surface: stored.surface, params }];
  });
}

/**
 * Saves a setup, overwriting the one with that name if it exists.
 *
 * Overwriting rather than refusing is the useful behaviour: a setup is edited
 * by loading it, changing a control and saving it again under the same name,
 * which is also how it gets renamed. One statement, so two tabs cannot both
 * win and leave two rows with the same name and different filters.
 */
export async function saveSetup(input: {
  userId: string;
  surface: Surface;
  name: string;
  params: SetupParams;
}): Promise<Result<Setup>> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (name === '') return { ok: false, message: 'Give the setup a name.' };
  if (name.length > NAME_LIMIT) {
    return { ok: false, message: `Keep the name under ${NAME_LIMIT} characters.` };
  }

  const params = setupParams(input.surface, input.params);
  if (!startsSomething(params)) {
    return {
      ok: false,
      message: 'Pick a year or some fields first — there is nothing to save yet.',
    };
  }

  const config = { surface: input.surface, params };
  const [row] = await db
    .insert(studyPresets)
    .values({ userId: input.userId, name, config })
    .onConflictDoUpdate({
      target: [studyPresets.userId, studyPresets.name],
      set: { config },
    })
    .returning({ id: studyPresets.id, name: studyPresets.name });

  return { ok: true, value: { id: row.id, name: row.name, surface: input.surface, params } };
}

/**
 * Where *Save this setup* goes: the manager, carrying the settings to keep.
 *
 * Built as a string rather than passed through state because the study pages
 * open it in a new tab -- they have a session in memory and must not navigate
 * -- and a new tab only has a URL.
 */
export function saveSetupHref(surface: Surface, params: SetupParams): string {
  const query = new URLSearchParams([['surface', surface]]);
  for (const [key, value] of Object.entries(params)) {
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  return `/study/setups?${query.toString()}`;
}

/** Scoped to the owner, so an id from somewhere else deletes nothing. */
export async function deleteSetup(userId: string, id: string): Promise<Result> {
  const gone = await db
    .delete(studyPresets)
    .where(and(eq(studyPresets.id, id), eq(studyPresets.userId, userId)))
    .returning({ id: studyPresets.id });

  if (gone.length === 0) return { ok: false, message: 'That setup no longer exists.' };
  return { ok: true };
}

/**
 * What a setup selects, in words.
 *
 * A name is what you pick a setup by and a summary is how you remember which
 * one it was, three weeks after naming two of them "dosing". Read off the
 * stored parameters rather than from a config, because the parameters are what
 * is stored.
 */
export function describeSetup(
  surface: Surface,
  params: SetupParams,
  labelFor: (key: string) => string,
): string {
  const list = (value: string | string[] | undefined) =>
    value === undefined ? [] : Array.isArray(value) ? value : [value];
  const one = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const bits: string[] = [];

  const fields = list(params.fields);
  if (fields.length > 0) bits.push(fields.map(labelFor).join(', '));
  else if (one(params.year)) bits.push(`every ${one(params.year)} field`);

  if (one(params.year) && fields.length > 0) bits.push(String(one(params.year)));

  if (surface === 'quiz') {
    bits.push(one(params.set) === 'inclusive' ? 'per drug' : 'per fact');
    const dir = one(params.dir);
    if (dir === 'drug_to_fields') bits.push('drug → fact');
    else if (dir === 'fields_to_drug') bits.push('fact → drug');
    else bits.push('mixed directions');
    // Only worth saying when it is off, since on is the default.
    if (one(params.pri) === 'off') bits.push('no priority');
  } else {
    bits.push(one(params.mode) === 'cram' ? 'cram' : 'review');
    bits.push(one(params.set) === 'exclusive' ? 'per fact' : 'per drug');
    const block = one(params.block);
    if (block !== undefined) bits.push(block === '0' ? 'no blocks' : `blocks of ${block}`);
  }

  const max = one(params.max);
  if (max !== undefined) bits.push(surface === 'quiz' ? `${max} questions` : `${max} cards`);

  const tag = one(params.tag);
  if (tag !== undefined) bits.push(tag);
  const categories = list(params.cat);
  if (categories.length > 0) {
    bits.push(`${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}`);
  }
  const indications = list(params.ind);
  if (indications.length > 0) {
    bits.push(`${indications.length} indication${indications.length === 1 ? '' : 's'}`);
  }

  return bits.join(' · ');
}
