import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { accounts, sessions, studyPresets, users } from '@/db/schema';
import {
  deleteSetup, describeSetup, listSetups, saveSetup, saveSetupHref, setupParams,
  startsSomething,
} from '@/lib/study/presets';

const ME = 'user-student';
const SOMEONE_ELSE = 'user-other';

beforeEach(async () => {
  await db.delete(studyPresets);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);
  await db.insert(users).values([
    { id: ME, email: 'student@example.test' },
    { id: SOMEONE_ELSE, email: 'other@example.test' },
  ]);
});

const label = (key: string) => ({ moa: 'Mechanism of action', dosing: 'Dosing' }[key] ?? key);

describe('setupParams', () => {
  it('keeps what the page reads and drops what it does not', () => {
    const params = setupParams('quiz', {
      fields: ['moa', 'dosing'], dir: 'random', pri: 'off',
      // `block` and `mode` are flashcard settings; the quiz has no use for
      // them, and a stored key no page reads is dead weight at best.
      block: '10', mode: 'cram', rogue: 'anything',
    });

    expect(params).toEqual({ dir: 'random', pri: 'off', fields: ['moa', 'dosing'] });
  });

  it('drops the blank values an untouched select submits', () => {
    // A select left alone posts its name with an empty value. Stored, `tag=`
    // would make a setup that claims to narrow by drug list and does not.
    expect(setupParams('quiz', { year: 'P2', tag: '', cat: ['', ' '] })).toEqual({ year: 'P2' });
  });

  it('trims, dedupes, and takes the first of a repeated single', () => {
    expect(setupParams('quiz', { fields: [' moa ', 'moa'], max: [' 20 ', '40'] }))
      .toEqual({ max: '20', fields: ['moa'] });
  });

  it('writes its keys in a fixed order, so the same setup saves the same twice', () => {
    const one = setupParams('quiz', { dir: 'random', year: 'P2', fields: ['moa'] });
    const two = setupParams('quiz', { fields: ['moa'], year: 'P2', dir: 'random' });
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it('knows each page has its own settings', () => {
    const params = setupParams('flashcards', { mode: 'cram', block: '10', pri: 'off' });
    // Priority is a quiz setting: a deck is not drawn from a weighted pool.
    expect(params).toEqual({ block: '10', mode: 'cram' });
  });
});

describe('startsSomething', () => {
  it('is false for settings that would show an empty form', () => {
    // Both pages key off the field list, so a setup without one is a setup
    // that does nothing -- a blank form under a name.
    expect(startsSomething({ max: '20', dir: 'random' })).toBe(false);
    expect(startsSomething({ fields: ['moa'] })).toBe(true);
    expect(startsSomething({ year: 'P2' })).toBe(true);
  });
});

describe('saveSetup', () => {
  const params = { fields: ['moa'], max: '20' };

  it('keeps a named setup and hands it back', async () => {
    const result = await saveSetup({ userId: ME, surface: 'quiz', name: '  P2 drill  ', params });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toMatchObject({ name: 'P2 drill', surface: 'quiz' });
    expect(await listSetups(ME)).toHaveLength(1);
  });

  it('saves over the setup of that name rather than making a second', async () => {
    await saveSetup({ userId: ME, surface: 'quiz', name: 'P2 drill', params });
    await saveSetup({
      userId: ME, surface: 'quiz', name: 'P2 drill', params: { fields: ['dosing'] },
    });

    // Editing a setup is loading it, changing a control and saving it again,
    // which is also how it gets renamed. Two rows of the same name would mean
    // a list offering both with no way to tell them apart.
    const [only] = await listSetups(ME);
    expect(await listSetups(ME)).toHaveLength(1);
    expect(only.params).toEqual({ fields: ['dosing'] });
  });

  it('refuses a setup with nothing in it', async () => {
    const result = await saveSetup({
      userId: ME, surface: 'quiz', name: 'Empty', params: { max: '20' },
    });

    expect(result).toEqual({
      ok: false,
      message: 'Pick a year or some fields first — there is nothing to save yet.',
    });
    expect(await listSetups(ME)).toEqual([]);
  });

  it('refuses a blank name and an overlong one', async () => {
    expect(await saveSetup({ userId: ME, surface: 'quiz', name: '   ', params }))
      .toEqual({ ok: false, message: 'Give the setup a name.' });
    expect(await saveSetup({ userId: ME, surface: 'quiz', name: 'x'.repeat(61), params }))
      .toEqual({ ok: false, message: 'Keep the name under 60 characters.' });
  });

  it('stores only the parameters the surface reads', async () => {
    await saveSetup({
      userId: ME,
      surface: 'quiz',
      name: 'Filtered',
      params: { fields: ['moa'], rogue: 'anything' },
    });

    const [row] = await db.select().from(studyPresets).where(eq(studyPresets.userId, ME));
    expect(row.config).toEqual({ surface: 'quiz', params: { fields: ['moa'] } });
  });

  it('lets two people use the same name', async () => {
    await saveSetup({ userId: ME, surface: 'quiz', name: 'Exam 2', params });
    await saveSetup({ userId: SOMEONE_ELSE, surface: 'quiz', name: 'Exam 2', params });

    expect(await listSetups(ME)).toHaveLength(1);
    expect(await listSetups(SOMEONE_ELSE)).toHaveLength(1);
  });
});

describe('listSetups', () => {
  it('filters to one page when asked, and sorts by name', async () => {
    await saveSetup({ userId: ME, surface: 'quiz', name: 'Zebra', params: { fields: ['moa'] } });
    await saveSetup({ userId: ME, surface: 'quiz', name: 'Apple', params: { fields: ['moa'] } });
    await saveSetup({
      userId: ME, surface: 'flashcards', name: 'Deck', params: { fields: ['moa'] },
    });

    expect((await listSetups(ME)).map((setup) => setup.name)).toEqual(['Apple', 'Deck', 'Zebra']);
    expect((await listSetups(ME, 'quiz')).map((setup) => setup.name)).toEqual(['Apple', 'Zebra']);
    expect((await listSetups(ME, 'flashcards')).map((setup) => setup.name)).toEqual(['Deck']);
  });

  it('ignores a row whose stored shape it does not recognise', async () => {
    // A backup restored from an older version, or hand-edited: a setup that
    // does not say which page it belongs to cannot be loaded, so it is not
    // offered. Better a missing row than a link to nowhere.
    await db.insert(studyPresets).values([
      { userId: ME, name: 'Nonsense', config: { nothing: true } },
      { userId: ME, name: 'Wrong page', config: { surface: 'elsewhere', params: {} } },
    ]);

    expect(await listSetups(ME)).toEqual([]);
  });

  it('re-filters the parameters on the way out', async () => {
    await db.insert(studyPresets).values({
      userId: ME,
      name: 'Smuggled',
      config: { surface: 'quiz', params: { fields: ['moa'], rogue: 'anything' } },
    });

    // The whitelist runs in both directions: a restored backup is not a reason
    // to put an unknown key into a URL.
    expect((await listSetups(ME))[0].params).toEqual({ fields: ['moa'] });
  });

  it('shows you only your own', async () => {
    await saveSetup({ userId: SOMEONE_ELSE, surface: 'quiz', name: 'Theirs', params: { year: 'P2' } });
    expect(await listSetups(ME)).toEqual([]);
  });
});

describe('deleteSetup', () => {
  it('removes your own and refuses anyone else’s', async () => {
    const mine = await saveSetup({ userId: ME, surface: 'quiz', name: 'Mine', params: { year: 'P2' } });
    const id = mine.ok ? mine.value!.id : '';

    expect(await deleteSetup(SOMEONE_ELSE, id))
      .toEqual({ ok: false, message: 'That setup no longer exists.' });
    expect(await listSetups(ME)).toHaveLength(1);

    expect(await deleteSetup(ME, id)).toEqual({ ok: true });
    expect(await listSetups(ME)).toEqual([]);
  });
});

describe('describeSetup', () => {
  it('says what a quiz setup selects, in field labels', () => {
    expect(describeSetup('quiz', { fields: ['moa', 'dosing'], max: '20' }, label))
      .toBe('Mechanism of action, Dosing · per fact · mixed directions · 20 questions');
  });

  it('mentions priority only when it is off, since on is the default', () => {
    expect(describeSetup('quiz', { fields: ['moa'], pri: 'off' }, label)).toContain('no priority');
    expect(describeSetup('quiz', { fields: ['moa'], pri: 'on' }, label))
      .not.toContain('priority');
  });

  it('describes a year-only setup as the year’s own fields', () => {
    expect(describeSetup('flashcards', { year: 'P2', mode: 'cram' }, label))
      .toBe('every P2 field · cram · per drug');
  });
});

describe('saveSetupHref', () => {
  it('carries the settings and the page they belong to', () => {
    const href = saveSetupHref('quiz', { fields: ['moa', 'dosing'], year: 'P2' });
    const query = new URL(href, 'http://x').searchParams;

    expect(query.get('surface')).toBe('quiz');
    expect(query.getAll('fields')).toEqual(['moa', 'dosing']);
    expect(query.get('year')).toBe('P2');
  });
});
