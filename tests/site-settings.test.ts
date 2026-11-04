import { readdirSync, readFileSync, statSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { auditLog, sessions, siteSettings, users } from '@/db/schema';
import {
  DISCLAIMER_MAX, FALLBACK_SITE_NAME, getRegistrationMode, getSiteName, getSiteSettings,
  isRegistrationMode, REGISTRATION_LABELS, REGISTRATION_MODES, saveSiteIdentity, SITE_NAME_MAX,
} from '@/lib/settings';
import { setSiteSeason } from '@/lib/theme/preferences';

/**
 * The three settings that were stored from phase 0 and editable nowhere.
 *
 * `registration_mode` is the one with teeth -- it is what the register page
 * refuses a stranger with -- and until `/admin/site` existed the only way to
 * turn it was SQL or a backup restore. So the tests that matter here are the
 * refusals: what the writer declines to store, and that declining leaves the
 * row exactly as it was.
 */

const ADMIN = 'user-admin';

beforeEach(async () => {
  await db.delete(auditLog);
  await db.delete(sessions);
  await db.delete(users);
  await db.delete(siteSettings);
  await db.insert(users).values({ id: ADMIN, email: 'admin@example.test', role: 'admin' });
});

const GOOD = {
  siteName: 'Pharm Deck',
  registrationMode: 'closed',
  disclaimerText: 'A study aid. Not a clinical reference.',
};

describe('the registration mode', () => {
  it('accepts exactly the three and nothing else', () => {
    for (const mode of REGISTRATION_MODES) expect(isRegistrationMode(mode), mode).toBe(true);
    for (const junk of ['INVITE', 'inv', '', null, 3, undefined]) {
      expect(isRegistrationMode(junk), String(junk)).toBe(false);
    }
  });

  it('has a label for every mode, so no select renders a raw value', () => {
    for (const mode of REGISTRATION_MODES) expect(REGISTRATION_LABELS[mode]).toBeTruthy();
  });

  it('falls back to invite for a row that says something else', async () => {
    // The column is `text`, so a hand-edited database can put anything in it.
    // Falling back to the *strictest* usable mode rather than to open is the
    // whole point: a junk value must not be a way in.
    await db.insert(siteSettings).values({ id: 1, registrationMode: 'sure-why-not' });
    expect(await getRegistrationMode()).toBe('invite');
  });

  it('falls back to invite with no settings row at all', async () => {
    expect(await getRegistrationMode()).toBe('invite');
  });

  it('is what the writer stored', async () => {
    await saveSiteIdentity({ ...GOOD, registrationMode: 'open' }, ADMIN);
    expect(await getRegistrationMode()).toBe('open');
  });
});

describe('saving the site identity', () => {
  it('stores all three, trimmed', async () => {
    const result = await saveSiteIdentity({
      siteName: '  Pharm Deck  ',
      registrationMode: 'invite',
      disclaimerText: '  Mind the gap.  ',
    }, ADMIN);

    expect(result.ok).toBe(true);
    // Returned as stored, so the form can re-seed itself rather than keep
    // showing the untrimmed thing that was typed.
    expect(result.ok && result.value).toEqual({
      siteName: 'Pharm Deck',
      registrationMode: 'invite',
      disclaimerText: 'Mind the gap.',
    });

    const row = await getSiteSettings();
    expect(row?.siteName).toBe('Pharm Deck');
    expect(row?.disclaimerText).toBe('Mind the gap.');
  });

  it('creates the singleton if it is not there yet', async () => {
    // Bootstrap writes it on boot, but the writer must not depend on that --
    // and it must not be able to make a second row.
    await saveSiteIdentity(GOOD, ADMIN);
    expect(await db.select().from(siteSettings)).toHaveLength(1);
  });

  it('shares one upsert with the theme writers, so neither makes a second row', async () => {
    // Two files write this row -- the look half and the identity half. They
    // both go through `upsertSiteSettings` for exactly this reason.
    await setSiteSeason('winter');
    await saveSiteIdentity(GOOD, ADMIN);

    const rows = await db.select().from(siteSettings);
    expect(rows).toHaveLength(1);
    // And neither half wipes the other's columns.
    expect(rows[0].defaultSeason).toBe('winter');
    expect(rows[0].siteName).toBe('Pharm Deck');
  });

  for (const [what, patch, says] of [
    ['an empty name', { siteName: '   ' }, /needs a name/i],
    ['a name too long for the bar', { siteName: 'x'.repeat(SITE_NAME_MAX + 1) }, /top bar/i],
    ['a mode that is not one', { registrationMode: 'everyone' }, /not a registration mode/i],
    ['an empty disclaimer', { disclaimerText: '  ' }, /cannot be empty/i],
    ['a disclaimer too long for a footer',
      { disclaimerText: 'x'.repeat(DISCLAIMER_MAX + 1) }, /footer/i],
  ] as [string, Record<string, unknown>, RegExp][]) {
    it(`refuses ${what}, and writes nothing`, async () => {
      await saveSiteIdentity(GOOD, ADMIN);
      const before = await getSiteSettings();

      const result = await saveSiteIdentity({ ...GOOD, ...patch }, ADMIN);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toMatch(says);

      // The reason all three are validated before anything is written: an
      // admin changing the name and the disclaimer together must not land one
      // and be refused the other.
      expect(await getSiteSettings()).toEqual(before);
    });
  }

  it('will not let the disclaimer be emptied', async () => {
    // Deliberate, and the one refusal here that is a judgement rather than a
    // layout constraint: this is a study aid built off a class sheet, and the
    // sentence saying it is not a clinical reference is the one it should not
    // be able to lose by clearing a field. Rewording is the control.
    await saveSiteIdentity(GOOD, ADMIN);
    const reworded = await saveSiteIdentity({ ...GOOD, disclaimerText: 'Ask a pharmacist.' }, ADMIN);
    expect(reworded.ok).toBe(true);

    const emptied = await saveSiteIdentity({ ...GOOD, disclaimerText: '' }, ADMIN);
    expect(emptied.ok).toBe(false);
    expect((await getSiteSettings())?.disclaimerText).toBe('Ask a pharmacist.');
  });
});

describe('the audit row a change leaves', () => {
  it('names only the fields that moved, with what they were', async () => {
    await saveSiteIdentity(GOOD, ADMIN);
    await db.delete(auditLog);

    await saveSiteIdentity({ ...GOOD, registrationMode: 'open' }, ADMIN);

    const rows = await db.select().from(auditLog);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('site_settings.update');
    expect(rows[0].actorId).toBe(ADMIN);
    expect(rows[0].targetType).toBe('site_settings');
    // Only the one that changed. "The name changed from X to X" is noise in
    // the one log that has to stay readable.
    expect(rows[0].diff).toEqual({ registrationMode: { from: 'closed', to: 'open' } });
  });

  it('records the first write against what the column defaulted to', async () => {
    await saveSiteIdentity(GOOD, ADMIN);

    const [row] = await db.select().from(auditLog);
    // Nothing existed, so `from` is null rather than a guess at the default.
    expect(row.diff).toMatchObject({ siteName: { from: null, to: 'Pharm Deck' } });
  });

  it('writes nothing when a save changes nothing', async () => {
    await saveSiteIdentity(GOOD, ADMIN);
    await db.delete(auditLog);

    const again = await saveSiteIdentity(GOOD, ADMIN);
    expect(again.ok).toBe(true);
    expect(await db.select().from(auditLog)).toHaveLength(0);
  });
});

describe('the name, where it is printed', () => {
  it('falls back rather than leaving a hole', async () => {
    // Every caller -- the tab title, the wordmark, the front page -- would
    // otherwise have to invent the same fallback, and a bar with a gap in it
    // is a worse failure than one showing the default name.
    expect(await getSiteName()).toBe(FALLBACK_SITE_NAME);

    await db.insert(siteSettings).values({ id: 1, siteName: '   ' });
    expect(await getSiteName()).toBe(FALLBACK_SITE_NAME);
  });

  it('is the stored name once there is one', async () => {
    await saveSiteIdentity(GOOD, ADMIN);
    expect(await getSiteName()).toBe('Pharm Deck');
  });

  it('is not hard-coded in a single page title any more', () => {
    // The bug this setting had for its whole life: the name was stored and
    // nothing read it, because all eighteen titles said "— Enkephalin"
    // themselves. They carry their own half now and the root layout's
    // template adds the rest.
    const walk = (path: string): string[] => readdirSync(path).flatMap((entry) => {
      const full = `${path}/${entry}`;
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry) ? [full] : [];
    });

    const offenders = walk('app')
      .filter((file) => /— Enkephalin|Back to Enkephalin/.test(readFileSync(file, 'utf8')))
      .map((file) => file.replaceAll('\\', '/'));
    expect(offenders).toEqual([]);

    const layout = readFileSync('app/layout.tsx', 'utf8');
    expect(layout).toContain('template: `%s — ${name}`');
    expect(layout).toContain('await getSiteName()');
  });

  it('is read by the bar, the front page and the 403', () => {
    expect(readFileSync('app/_components/site-header.tsx', 'utf8')).toContain('{siteName}');
    expect(readFileSync('app/page.tsx', 'utf8')).toContain('settings?.siteName');
    expect(readFileSync('app/forbidden.tsx', 'utf8')).toContain('Back to {siteName}');
  });

  it('leaves the disclaimer to the admin on both pages that print it', () => {
    // /drugs restated the first half of it as a hard-coded sentence, so
    // rewording it on the front page left the page people actually read drug
    // facts on still saying the old thing.
    const drugs = readFileSync('app/drugs/page.tsx', 'utf8');
    expect(drugs).toContain('{disclaimer}');
    expect(drugs).not.toContain('study aid, not a clinical reference');
  });
});
