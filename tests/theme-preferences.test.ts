import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { accounts, sessions, siteSettings, userPreferences, users } from '@/db/schema';
import {
  clearPalette, clearSitePalette, decorAttributes, getPreferences, seasonAttribute, setAmbience,
  setColorAxis, setPaletteColor, setPaletteColors, setSeason, setSeasonTint, setSiteAmbience,
  setSitePaletteColor, setSitePaletteColors, setSiteSeason, setSiteSeasonTint, setSiteTheme,
  setTheme, themeAttribute,
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
    // Every decoration off, which is the point: an upgrade must not start
    // animating under somebody who has never opened Settings.
    expect(prefs).toEqual({
      theme: 'system',
      colorAxis: 'class',
      season: 'off',
      seasonTint: false,
      ambience: false,
      paletteOverrides: {},
    });
  });
});

describe('setSeason', () => {
  it('is a third independent setting, not a theme', async () => {
    // The whole reason it is its own column: picking autumn must not pick a
    // brightness, and "autumn, dark" has to be sayable.
    await setTheme(ME, 'dark');
    await setSeason(ME, 'autumn');

    const prefs = await getPreferences(ME);
    expect(prefs.theme).toBe('dark');
    expect(prefs.season).toBe('autumn');
  });

  it('keeps the choice rather than the season it resolves to', async () => {
    // `auto` has to survive a round trip, or the settings form would show
    // whichever season it is today and saving it would pin that one forever.
    await setSeason(ME, 'auto');
    expect((await getPreferences(ME)).season).toBe('auto');
  });

  it('refuses something that is not a season', async () => {
    await setSeason(ME, 'winter');
    expect((await setSeason(ME, 'autumnal')).ok).toBe(false);
    expect((await getPreferences(ME)).season).toBe('winter');
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

/* The site palette is the same rules over a different row, which is exactly
   the kind of pair that drifts. These assert the behaviour the per-user tests
   above assert, plus the one thing only the site half can get wrong: writing
   to `user_preferences` by accident. */
describe('the site palette', () => {
  it('creates the settings row on the first change', async () => {
    expect(await db.select().from(siteSettings)).toHaveLength(0);

    expect(await setSitePaletteColor('class:Biguanide', '#123456')).toEqual({
      ok: true,
      value: { color: '#123456' },
    });

    const [row] = await db.select().from(siteSettings);
    expect(row.defaultPalette).toEqual({ 'class:Biguanide': '#123456' });
  });

  it('reaches somebody who has chosen nothing, and only them', async () => {
    await setSitePaletteColor('class:Biguanide', '#123456');
    expect((await getPreferences(ME)).paletteOverrides).toEqual({ 'class:Biguanide': '#123456' });

    // Their own answer wins once they have one, and the site moving does not
    // take it back.
    await setPaletteColor(ME, 'class:Biguanide', '#abcdef');
    await setSitePaletteColor('class:Biguanide', '#654321');
    expect((await getPreferences(ME)).paletteOverrides).toEqual({ 'class:Biguanide': '#abcdef' });
  });

  it('never writes to anybody’s own row', async () => {
    await setSitePaletteColor('class:Biguanide', '#123456');
    await setSitePaletteColors('class', { 'class:Statin': '#0ea5e9' });
    await setSiteTheme('dark');
    await clearSitePalette();

    expect(await db.select().from(userPreferences)).toHaveLength(0);
  });

  it('holds the same line on keys and colours as the per-user writer', async () => {
    await setSitePaletteColor('class:Biguanide', '#123456');

    expect(await setSitePaletteColor('not-a-key', '#123456')).toMatchObject({ ok: false });
    expect(await setSitePaletteColor('class:Biguanide', 'cornflower')).toMatchObject({ ok: false });
    expect(await setSitePaletteColors('class', { 'tag:statins': '#123456' }))
      .toMatchObject({ ok: false });

    // A refused edit leaves what was stored alone.
    const [row] = await db.select().from(siteSettings);
    expect(row.defaultPalette).toEqual({ 'class:Biguanide': '#123456' });
  });

  it('shuffles one axis without touching the schedule ramp', async () => {
    await setSitePaletteColor('schedule:CII', '#dc2626');
    await setSitePaletteColors('class', { 'class:Statin': '#0ea5e9', 'class:Biguanide': '#f59e0b' });

    const [row] = await db.select().from(siteSettings);
    expect(row.defaultPalette).toEqual({
      'schedule:CII': '#dc2626',
      'class:Statin': '#0ea5e9',
      'class:Biguanide': '#f59e0b',
    });
  });

  it('sets the default theme without disturbing the palette', async () => {
    await setSitePaletteColor('class:Biguanide', '#123456');
    expect(await setSiteTheme('dark')).toEqual({ ok: true });
    expect(await setSiteTheme('puce')).toMatchObject({ ok: false });

    const [row] = await db.select().from(siteSettings);
    expect(row.defaultTheme).toBe('dark');
    expect(row.defaultPalette).toEqual({ 'class:Biguanide': '#123456' });
  });

  it('clears the default palette and leaves the theme standing', async () => {
    await setSiteTheme('dark');
    await setSitePaletteColor('class:Biguanide', '#123456');

    expect(await clearSitePalette()).toEqual({ ok: true });
    const [row] = await db.select().from(siteSettings);
    expect(row.defaultPalette).toEqual({});
    expect(row.defaultTheme).toBe('dark');
  });

  it('leaves a registration mode alone, which shares the row', async () => {
    await db.insert(siteSettings).values({ id: 1, registrationMode: 'open' });
    await setSitePaletteColor('class:Biguanide', '#123456');

    const [row] = await db.select().from(siteSettings);
    expect(row.registrationMode).toBe('open');
  });
});

describe('the site default season', () => {
  it('reaches somebody with no preferences row of their own', async () => {
    await setSiteSeason('winter');
    expect((await getPreferences(ME)).season).toBe('winter');
  });

  it('stops reaching them the moment they answer for themselves', async () => {
    // Which is what the admin screen warns about: a site default is a floor,
    // not an override, and an admin who has visited Settings will not see it.
    await setSiteSeason('winter');
    await setSeason(ME, 'off');
    expect((await getPreferences(ME)).season).toBe('off');
  });

  it('is what a signed-out visitor on the login page gets', async () => {
    await setSiteSeason('autumn');
    expect((await getPreferences(null)).season).toBe('autumn');
  });

  it('refuses something that is not a season', async () => {
    expect((await setSiteSeason('decembery')).ok).toBe(false);
  });
});

describe('seasonAttribute', () => {
  it('is absent for off, so <html> carries no data-season at all', () => {
    expect(seasonAttribute('off')).toBeNull();
  });

  it('resolves auto against the date it is given', () => {
    expect(seasonAttribute('auto', new Date(2026, 11, 25))).toBe('winter');
  });
});

describe('setSeasonTint and setAmbience', () => {
  it('turns on from a checked box and off from an absent one', async () => {
    await setSeasonTint(ME, 'on');
    await setAmbience(ME, 'on');
    let prefs = await getPreferences(ME);
    expect([prefs.seasonTint, prefs.ambience]).toEqual([true, true]);

    // What the form actually sends when both boxes are cleared: nothing.
    await setSeasonTint(ME, null);
    await setAmbience(ME, undefined);
    prefs = await getPreferences(ME);
    expect([prefs.seasonTint, prefs.ambience]).toEqual([false, false]);
  });

  it('is independent of the season itself', async () => {
    // A tint with no season draws nothing, and that is the layout's business
    // rather than a reason to refuse the setting -- somebody turning the
    // season back on should find their tint where they left it.
    await setSeasonTint(ME, 'on');
    await setSeason(ME, 'off');
    expect((await getPreferences(ME)).seasonTint).toBe(true);
  });

  it('has a site default that reaches somebody with no row of their own', async () => {
    await setSiteSeasonTint('on');
    await setSiteAmbience('on');
    const prefs = await getPreferences(ME);
    expect([prefs.seasonTint, prefs.ambience]).toEqual([true, true]);
  });
});

describe('decorAttributes', () => {
  const base = { season: 'off', seasonTint: false, ambience: false } as const;

  it('stamps nothing at all when everything is off', () => {
    expect(decorAttributes(base)).toEqual({
      season: null, tint: null, ambience: false, daypart: null,
    });
  });

  it('withholds a tint there is no season to tint', () => {
    // The stylesheet has no rule for [data-tint] without [data-season], so
    // stamping one would be stamping a state that means nothing.
    expect(decorAttributes({ ...base, seasonTint: true }).tint).toBeNull();
  });

  it('pairs a tint with its season', () => {
    const decor = decorAttributes({ ...base, season: 'winter', seasonTint: true });
    expect(decor).toMatchObject({ season: 'winter', tint: 'season' });
  });

  it('withholds a daypart nothing would read', () => {
    expect(decorAttributes(base).daypart).toBeNull();
    expect(decorAttributes({ ...base, ambience: true }, new Date(2026, 10, 3, 19)).daypart)
      .toBe('evening');
  });

  it('resolves auto against the date, as the season attribute does', () => {
    expect(decorAttributes({ ...base, season: 'auto' }, new Date(2026, 6, 4)).season)
      .toBe('summer');
  });
});

/**
 * The bug this guards, and the half of it I got wrong the first time.
 *
 * React calls `requestFormReset` on any `<form action={...}>` before running
 * the action, and the commit that follows calls the DOM's own `form.reset()`.
 * On update a `<select>` only has its `defaultValue` reapplied if `multiple`
 * changed, so an uncontrolled one snaps back to whatever it first rendered
 * with -- the save works, the revalidated layout comes back wearing the new
 * theme, and the form sits there claiming the old one.
 *
 * Making the controls *controlled* does not fix that, which is what the first
 * attempt assumed and the owner reported back as still broken: `reset()`
 * dispatches no change event, so React never restores the controlled value,
 * and nothing in state changed to re-render from. **The fix is not using
 * `action` at all** -- `onSubmit` with `preventDefault` never schedules the
 * reset. The controls stay controlled on top of that, because a displayed
 * value held in state cannot disagree with what was posted.
 *
 * Source-scanned rather than rendered, because what went wrong is the wiring
 * both times.
 */
describe('the cosmetic forms hold their own answers', () => {
  const FORMS = [
    'app/settings/look-form.tsx',
    'app/admin/look/site-theme-form.tsx',
  ];

  /** Comments stripped, because both files *discuss* `<form action>` at length. */
  const code = (path: string) => readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  it('never hands the form to a form action', () => {
    // The whole bug in one assertion: `<form action={...}>` is what makes
    // React reset the form, and nothing else here does.
    for (const path of FORMS) {
      expect(code(path), `${path} action=`).not.toMatch(/action=\{/);
      expect(code(path), `${path} onSubmit`).toContain('onSubmit={async (event) => {');
      expect(code(path), `${path} preventDefault`).toContain('event.preventDefault();');
    }
  });

  it('leaves no control uncontrolled', () => {
    for (const path of FORMS) {
      const source = readFileSync(path, 'utf8');
      expect(source, `${path} defaultValue`).not.toMatch(/defaultValue=/);
      expect(source, `${path} defaultChecked`).not.toMatch(/defaultChecked=/);
    }
  });

  it('gives every named control a value and an onChange', () => {
    for (const path of FORMS) {
      const source = readFileSync(path, 'utf8');
      // One `value=`/`checked=` and one `onChange` per control the form posts,
      // so adding a sixth switch without wiring it fails here rather than in
      // somebody's settings.
      const posted = [...source.matchAll(/\sname="([A-Za-z]+)"/g)].map((match) => match[1]);
      expect(posted.length, `${path} controls`).toBeGreaterThan(2);

      const bound = (source.match(/\n\s+(?:value|checked)=\{/g) ?? []).length;
      const changed = (source.match(/onChange=\{/g) ?? []).length;
      expect(bound, `${path} bound`).toBe(posted.length);
      expect(changed, `${path} onChange`).toBe(posted.length);
    }
  });

  it('retires "Saved." the moment the form is edited again', () => {
    // Otherwise the form says it saved while showing something it has not.
    for (const path of FORMS) {
      expect(readFileSync(path, 'utf8'), path).toContain('setSaved(false)');
    }
  });
});
