import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { accounts, sessions, userPreferences, users } from '@/db/schema';
import { lastUsedSetups, rememberSetup } from '@/lib/study/last-used';

const ME = 'user-last-used';

beforeEach(async () => {
  await db.delete(userPreferences);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);
  await db.insert(users).values([{ id: ME, email: 'student@example.test' }]);
});

describe('rememberSetup', () => {
  it('records a surface and reads it back', async () => {
    await rememberSetup(ME, 'quiz', { fields: ['moa'], dir: 'random', max: '20' });
    expect(await lastUsedSetups(ME)).toEqual({
      quiz: { dir: 'random', max: '20', fields: ['moa'] },
    });
  });

  it('keeps the other surface rather than replacing the lot', async () => {
    // The whole reason this is a jsonb merge: a deck in one tab and a quiz in
    // another must both survive, where a read-modify-write would have the
    // second overwrite the first's surface with nothing.
    await rememberSetup(ME, 'quiz', { fields: ['moa'] });
    await rememberSetup(ME, 'flashcards', { fields: ['dosing'], mode: 'cram' });

    expect(await lastUsedSetups(ME)).toEqual({
      quiz: { fields: ['moa'] },
      flashcards: { mode: 'cram', fields: ['dosing'] },
    });
  });

  it('overwrites the same surface, since only the last one is wanted', async () => {
    await rememberSetup(ME, 'quiz', { fields: ['moa'], max: '20' });
    await rememberSetup(ME, 'quiz', { fields: ['dosing'] });
    expect(await lastUsedSetups(ME)).toEqual({ quiz: { fields: ['dosing'] } });
  });

  it('records nothing for a page that started nothing', async () => {
    // A page showing its form has no fields in the URL, and offering "pick up
    // where you left off" on a blank form would be worse than offering
    // nothing.
    await rememberSetup(ME, 'quiz', { dir: 'random', max: '20' });
    expect(await lastUsedSetups(ME)).toEqual({});
  });

  it('drops keys the page does not read, in both directions', async () => {
    await rememberSetup(ME, 'quiz', { fields: ['moa'], block: '10', rogue: 'anything' });
    // `block` is a flashcard setting; the quiz has no use for it.
    expect(await lastUsedSetups(ME)).toEqual({ quiz: { fields: ['moa'] } });
  });

  it('leaves the rest of the preferences row alone', async () => {
    await db.insert(userPreferences).values({ userId: ME, theme: 'dark', colorAxis: 'schedule' });
    await rememberSetup(ME, 'quiz', { fields: ['moa'] });

    const [row] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, ME));
    expect(row.theme).toBe('dark');
    expect(row.colorAxis).toBe('schedule');
    expect(await lastUsedSetups(ME)).toEqual({ quiz: { fields: ['moa'] } });
  });

  it('keeps anything else already in study_defaults', async () => {
    await db
      .insert(userPreferences)
      .values({ userId: ME, studyDefaults: { somethingElse: 1 } });
    await rememberSetup(ME, 'quiz', { fields: ['moa'] });

    const [row] = await db
      .select({ defaults: userPreferences.studyDefaults })
      .from(userPreferences)
      .where(eq(userPreferences.userId, ME));
    expect(row.defaults.somethingElse).toBe(1);
  });
});

describe('lastUsedSetups', () => {
  it('is empty for someone who has started nothing', async () => {
    expect(await lastUsedSetups(ME)).toEqual({});
  });

  it('ignores a surface that is not one, and junk where params should be', async () => {
    // What a restored backup from another version could hold. None of it is a
    // reason to put unknown keys into a URL.
    await db.insert(userPreferences).values({
      userId: ME,
      studyDefaults: {
        lastUsed: {
          quiz: { fields: ['moa'] },
          essay: { fields: ['moa'] },
          flashcards: 'not an object',
        },
      },
    });
    expect(await lastUsedSetups(ME)).toEqual({ quiz: { fields: ['moa'] } });
  });

  it('survives study_defaults holding something that is not an object', async () => {
    await db.insert(userPreferences).values({ userId: ME, studyDefaults: { lastUsed: 7 } });
    expect(await lastUsedSetups(ME)).toEqual({});
  });
});

/* The wiring, asserted against the source. Both of these are invariants about
   where a write happens rather than about a value, and both have a way of
   being quietly undone by an ordinary-looking edit -- the symptom in each case
   is not a failure but a study session silently redrawn. */
describe('where the recording happens', () => {
  const quiz = readFileSync('app/study/quiz/page.tsx', 'utf8');
  const flashcards = readFileSync('app/study/flashcards/page.tsx', 'utf8');
  const action = readFileSync('app/study/_components/remember-actions.ts', 'utf8');
  const component = readFileSync('app/study/_components/remember-setup.tsx', 'utf8');

  /** Declarations only: the prose in these files says "revalidate" too. */
  const code = (source: string) => source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '');

  it('never revalidates, because that re-rolls a live deck or paper', () => {
    // The "0 of 83" bug: a study page is force-dynamic and randomised, so
    // revalidating one swaps the session under whoever is sitting in front of
    // it. Remembering a setup must not be able to do that.
    expect(code(action)).not.toContain('revalidate');
    expect(code(action)).not.toContain('router.refresh');
    expect(code(component)).not.toContain('revalidate');
  });

  it('is mounted by both study pages, with the settings they saved', () => {
    // Same params the save link uses, so the setup offered on the home page
    // and the setup you could have named are the same thing.
    expect(quiz).toContain('<RememberSetup surface="quiz" params={saveParams} />');
    expect(flashcards).toContain('<RememberSetup surface="flashcards" params={saveParams} />');
  });

  it('writes from the browser, not from the page render', () => {
    // A page render is a GET, and a GET that writes is a GET a link prefetch
    // performs -- so neither page may call the store itself.
    expect(component).toContain("'use client'");
    expect(component).toContain('useEffect');
    expect(quiz).not.toContain('rememberSetup(');
    expect(flashcards).not.toContain('rememberSetup(');
  });
});
