import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { accounts, sessions, siteSettings, userPreferences, users } from '@/db/schema';
import {
  clearPalette, getPreferences, setColorAxis, setPaletteColor, setPaletteColors, setTheme,
  themeAttribute,
} from '@/lib/theme/preferences';

const ME = 'user-student';

beforeEach(async () => {
  await db.delete(userPreferences);
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);
  await db.delete(siteSettings);
  await db.insert(users).values({ id: ME, email: 'student@example.test' });
});

async function siteDefaults(patch: Record<string, unknown>) {
  await db.insert(siteSettings).values({ id: 1, ...patch } as never);
}

describe('getPreferences', () => {
  it('falls back to the site defaults for somebody who has chosen nothing', async () => {
    await siteDefaults({ defaultTheme: 'dark', defaultPalette: { 'class:Biguanide': '#123456' } });

    // The row is written on first change, not at registration, so absence
    // means "has not chosen" rather than "chose nothing".
    const prefs = await getPreferences(ME);
    expect(prefs.theme).toBe('dark');
    expect(prefs.paletteOverrides).toEqual({ 'class:Biguanide': '#123456' });
  });

  it('gives a signed-out visitor the site defaults too', async () => {
    await siteDefaults({ defaultTheme: 'dark' });
    // Signed out is the login page, but it still has a background, and having
    // the one page everybody sees first ignore the setting would be odd.
    expect((await getPreferences(null)).theme).toBe('dark');
  });

  it('layers a user colour over the site palette key by key', async () => {
    await siteDefaults({
      defaultPalette: { 'class:Biguanide': '#111111', 'class:Statin': '#222222' },
    });
    await setPaletteColor(ME, 'class:Statin', '#333333');

    // Overriding one colour must not discard the site's answer for the rest.
    expect((await getPreferences(ME)).paletteOverrides).toEqual({
      'class:Biguanide': '#111111',
      'class:Statin': '#333333',
    });
  });

  it('survives a site with no settings row at all', async () => {
    const prefs = await getPreferences(ME);
    expect(prefs).toEqual({ theme: 'system', colorAxis: 'class', paletteOverrides: {} });
  });
});

describe('setTheme and setColorAxis', () => {
  it('keeps the two independent', async () => {
    await setTheme(ME, 'dark');
    await setColorAxis(ME, 'schedule');

    const prefs = await getPreferences(ME);
    expect(prefs.theme).toBe('dark');
    expect(prefs.colorAxis).toBe('schedule');

    // Changing one leaves the other alone -- they go through one upsert, and a
    // patch that sent both would quietly reset whichever was not being set.
    await setTheme(ME, 'light');
    expect((await getPreferences(ME)).colorAxis).toBe('schedule');
  });

  it('refuses anything not on the list', async () => {
    expect(await setTheme(ME, 'sepia')).toEqual({ ok: false, message: 'That is not a theme.' });
    expect(await setColorAxis(ME, 'vibes'))
      .toEqual({ ok: false, message: 'That is not a colour axis.' });
    expect(await db.select().from(userPreferences)).toEqual([]);
  });
});

describe('themeAttribute', () => {
  it('says nothing for system, so the stylesheet answers it', () => {
    // The server has no business deciding what the operating system thinks.
    expect(themeAttribute('system')).toBeNull();
    expect(themeAttribute('dark')).toBe('dark');
    expect(themeAttribute('light')).toBe('light');
  });
});

describe('setPaletteColor', () => {
  it('stores a colour in canonical form', async () => {
    expect(await setPaletteColor(ME, 'class:Biguanide', '#ABC'))
      .toEqual({ ok: true, value: { color: '#aabbcc' } });
    expect((await getPreferences(ME)).paletteOverrides)
      .toEqual({ 'class:Biguanide': '#aabbcc' });
  });

  it('clears one entry back to the default on a blank', async () => {
    await setPaletteColor(ME, 'class:Biguanide', '#123456');
    await setPaletteColor(ME, 'class:Statin', '#654321');

    expect(await setPaletteColor(ME, 'class:Biguanide', '  '))
      .toEqual({ ok: true, value: { color: null } });
    // Resetting one keeps the rest, which is the difference between this and
    // the reset-everything button.
    expect((await getPreferences(ME)).paletteOverrides).toEqual({ 'class:Statin': '#654321' });
  });

  it('refuses something that is not a colour, and keeps what was there', async () => {
    await setPaletteColor(ME, 'class:Biguanide', '#123456');

    expect(await setPaletteColor(ME, 'class:Biguanide', 'octarine'))
      .toEqual({ ok: false, message: 'Give a colour as a hex code, like #2563eb.' });
    expect((await getPreferences(ME)).paletteOverrides)
      .toEqual({ 'class:Biguanide': '#123456' });
  });

  it('refuses a key that is not axis-shaped', async () => {
    const result = await setPaletteColor(ME, 'nonsense', '#123456');
    expect(result).toEqual({ ok: false, message: 'That is not something with a colour.' });
    expect(await db.select().from(userPreferences)).toEqual([]);
  });

  it('allows a colour that fails its contrast check', async () => {
    // The editor warns; it does not forbid. Someone who wants a colour that
    // is hard to see on one theme is allowed to have it -- the badge's own
    // text stays readable either way, so nothing becomes unreadable.
    expect((await setPaletteColor(ME, 'class:Biguanide', '#7e22ce')).ok).toBe(true);
  });
});

describe('clearPalette', () => {
  it('drops every override at once but leaves theme and axis', async () => {
    await setTheme(ME, 'dark');
    await setColorAxis(ME, 'tag');
    await setPaletteColor(ME, 'class:Biguanide', '#123456');

    expect(await clearPalette(ME)).toEqual({ ok: true });

    const prefs = await getPreferences(ME);
    expect(prefs.paletteOverrides).toEqual({});
    expect(prefs.theme).toBe('dark');
    expect(prefs.colorAxis).toBe('tag');
  });
});

describe('the preferences row', () => {
  it('is created on the first change and never before', async () => {
    await getPreferences(ME);
    expect(await db.select().from(userPreferences)).toEqual([]);

    await setTheme(ME, 'dark');
    expect(await db.select().from(userPreferences).where(eq(userPreferences.userId, ME)))
      .toHaveLength(1);
  });
});

describe('setPaletteColors', () => {
  it('replaces one axis and leaves the others alone', async () => {
    await setPaletteColor(ME, 'schedule:CII', '#111111');
    await setPaletteColor(ME, 'class:Old', '#222222');

    const result = await setPaletteColors(ME, 'class', {
      'class:New one': '#333333',
      'class:New two': '#444444',
    });
    expect(result).toEqual({ ok: true, value: { changed: 2 } });

    // Shuffling the classes must not throw away a schedule colour someone
    // chose deliberately -- and the class colours it replaced are gone, not
    // merged, or a shuffle would accumulate dead keys forever.
    expect((await getPreferences(ME)).paletteOverrides).toEqual({
      'schedule:CII': '#111111',
      'class:New one': '#333333',
      'class:New two': '#444444',
    });
  });

  it('refuses an entry that is not on the axis it claims', async () => {
    const result = await setPaletteColors(ME, 'class', { 'schedule:CII': '#111111' });
    expect(result).toEqual({ ok: false, message: 'Those colours are not all on that axis.' });
    expect(await db.select().from(userPreferences)).toEqual([]);
  });

  it('refuses the whole batch if any colour is not one', async () => {
    const result = await setPaletteColors(ME, 'class', {
      'class:Fine': '#123456',
      'class:Not': 'octarine',
    });
    expect(result.ok).toBe(false);
    // All or nothing: half a shuffle is worse than none, because you cannot
    // tell by looking which half took.
    expect(await db.select().from(userPreferences)).toEqual([]);
  });

  it('clears an axis when given nothing', async () => {
    await setPaletteColor(ME, 'class:Old', '#222222');
    expect(await setPaletteColors(ME, 'class', {})).toEqual({ ok: true, value: { changed: 0 } });
    expect((await getPreferences(ME)).paletteOverrides).toEqual({});
  });
});
