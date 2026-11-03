import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { accounts, sessions, users } from '@/db/schema';
import { IMAGE_LIMIT, initialsFor, isStorableImage, NAME_LIMIT } from '@/lib/account/shape';
import { setDisplayName, setProfileImage } from '@/lib/account/store';

const ME = 'user-account';

beforeEach(async () => {
  await db.delete(sessions);
  await db.delete(accounts);
  await db.delete(users);
  await db.insert(users).values([{ id: ME, email: 'dana.ruiz@example.test' }]);
});

const row = async () => {
  const [found] = await db
    .select({ name: users.name, image: users.image })
    .from(users)
    .where(eq(users.id, ME));
  return found;
};

describe('initialsFor', () => {
  it('reads a display name when there is one', () => {
    expect(initialsFor({ name: 'Dana Ruiz', email: 'x@y.test' })).toBe('DR');
    expect(initialsFor({ name: 'Dana', email: 'x@y.test' })).toBe('DA');
  });

  it('reads the email local part, not the domain', () => {
    // A classful of @gmail.com accounts would otherwise all read "G".
    expect(initialsFor({ email: 'dana.ruiz@gmail.com' })).toBe('DR');
    expect(initialsFor({ name: '   ', email: 'dana_ruiz@gmail.com' })).toBe('DR');
    expect(initialsFor({ email: 'dana@gmail.com' })).toBe('DA');
  });

  it('takes the first and last word, not the first two', () => {
    expect(initialsFor({ name: 'Dana Marie Ruiz', email: 'x@y.test' })).toBe('DR');
  });

  it('has an answer for a name with no letters in it', () => {
    expect(initialsFor({ name: '!!!', email: '@@@' })).toBe('?');
  });
});

describe('isStorableImage', () => {
  const body = 'AAAA'.repeat(8);

  it('takes the three raster types the picker offers', () => {
    for (const type of ['webp', 'png', 'jpeg']) {
      expect(isStorableImage(`data:image/${type};base64,${body}`), type).toBe(true);
    }
  });

  it('refuses SVG', () => {
    // An image to a browser and a script host to an attacker, and this string
    // goes straight into an <img src> other people's pages will render.
    expect(isStorableImage(`data:image/svg+xml;base64,${body}`)).toBe(false);
  });

  it('refuses anything that is not a base64 data URL', () => {
    expect(isStorableImage('https://example.test/me.png')).toBe(false);
    expect(isStorableImage('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isStorableImage('data:image/png,notbase64')).toBe(false);
    expect(isStorableImage('data:image/png;base64,has spaces')).toBe(false);
  });

  it('refuses one past the cap', () => {
    const prefix = 'data:image/webp;base64,';
    expect(isStorableImage(prefix + 'A'.repeat(IMAGE_LIMIT - prefix.length))).toBe(true);
    expect(isStorableImage(prefix + 'A'.repeat(IMAGE_LIMIT - prefix.length + 1))).toBe(false);
  });
});

describe('setDisplayName', () => {
  it('stores a trimmed, collapsed name', async () => {
    expect(await setDisplayName(ME, '  Dana   Ruiz ')).toEqual({ ok: true });
    expect((await row()).name).toBe('Dana Ruiz');
  });

  it('treats blank as a clear rather than a refusal', async () => {
    await setDisplayName(ME, 'Dana');
    expect(await setDisplayName(ME, '   ')).toEqual({ ok: true });
    // Null, not an empty string: the column means "no name", and the avatar
    // and the header both read it as absent.
    expect((await row()).name).toBeNull();
  });

  it('refuses a name longer than the cap, and stores nothing', async () => {
    await setDisplayName(ME, 'Dana');
    const result = await setDisplayName(ME, 'x'.repeat(NAME_LIMIT + 1));
    expect(result.ok).toBe(false);
    expect((await row()).name).toBe('Dana');
  });

  it('refuses something that is not a string', async () => {
    expect((await setDisplayName(ME, { name: 'Dana' })).ok).toBe(false);
  });
});

describe('setProfileImage', () => {
  const picture = `data:image/webp;base64,${'AAAA'.repeat(8)}`;

  it('stores a picture and removes it again', async () => {
    expect(await setProfileImage(ME, picture)).toEqual({ ok: true });
    expect((await row()).image).toBe(picture);

    expect(await setProfileImage(ME, null)).toEqual({ ok: true });
    expect((await row()).image).toBeNull();
  });

  it('reads an empty string as a removal, as a cleared form sends one', async () => {
    await setProfileImage(ME, picture);
    expect(await setProfileImage(ME, '')).toEqual({ ok: true });
    expect((await row()).image).toBeNull();
  });

  it('refuses an SVG without touching what is stored', async () => {
    await setProfileImage(ME, picture);
    const result = await setProfileImage(ME, 'data:image/svg+xml;base64,PHN2Zy8+');
    expect(result.ok).toBe(false);
    expect((await row()).image).toBe(picture);
  });

  it('says *which* way an oversized picture is wrong', async () => {
    const huge = `data:image/webp;base64,${'A'.repeat(IMAGE_LIMIT)}`;
    const result = await setProfileImage(ME, huge);
    expect(result.ok).toBe(false);
    // Two refusals rather than one, because they call for different actions.
    expect(result.ok === false && result.message).toMatch(/too large/);
  });
});
