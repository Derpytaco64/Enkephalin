import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db';
import { accounts, auditLog, sessions, users } from '@/db/schema';
import {
  EMAIL_LIMIT, IMAGE_LIMIT, initialsFor, isStorableEmail, isStorableImage, NAME_LIMIT,
  normalizeEmail,
} from '@/lib/account/shape';
import { setDisplayName, setEmail, setProfileImage } from '@/lib/account/store';
import { createCredentialUser } from '@/lib/users';

const ME = 'user-account';

beforeEach(async () => {
  await db.delete(auditLog);
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

describe('normalizeEmail / isStorableEmail', () => {
  it('lowercases and trims, since the column is unique', () => {
    expect(normalizeEmail('  Dana.Ruiz@Example.TEST ')).toBe('dana.ruiz@example.test');
  });

  it('catches the mistakes a person makes typing into the box', () => {
    expect(isStorableEmail('dana@example.test')).toBe(true);
    expect(isStorableEmail('dana+school@example.co.uk')).toBe(true);
    expect(isStorableEmail('dana')).toBe(false);
    expect(isStorableEmail('dana@localhost')).toBe(false);
    expect(isStorableEmail('dana @example.test')).toBe(false);
    expect(isStorableEmail('@example.test')).toBe(false);
    expect(isStorableEmail('a@b.c'.padEnd(EMAIL_LIMIT + 1, 'x'))).toBe(false);
  });
});

describe('setEmail', () => {
  /* A real credential user, because the password check runs against the hash
     better-auth wrote -- which is the whole protection this has. */
  let id: string;
  const PASSWORD = 'the-old-password';

  beforeEach(async () => {
    ({ id } = await createCredentialUser({
      email: 'before@example.test', password: PASSWORD,
    }));
  });

  const stored = async () => {
    const [row] = await db
      .select({ email: users.email, verified: users.emailVerified })
      .from(users)
      .where(eq(users.id, id));
    return row;
  };

  it('moves the sign-in name, and marks it unverified', async () => {
    const result = await setEmail(id, '  After@Example.TEST ', PASSWORD);
    expect(result).toEqual({ ok: true, value: { email: 'after@example.test' } });

    // Unverified is the honest record: nothing was sent to the new address,
    // because there is nothing here that can send.
    expect(await stored()).toEqual({ email: 'after@example.test', verified: false });
  });

  it('records the change, since it moves who can get into the account', async () => {
    await setEmail(id, 'after@example.test', PASSWORD);
    const [entry] = await db.select().from(auditLog);
    expect(entry.action).toBe('account.email');
    expect(entry.diff).toEqual({ from: 'before@example.test', to: 'after@example.test' });
  });

  it('refuses a wrong password, and changes nothing', async () => {
    // Without this, a borrowed session could move the account to somebody
    // else's address -- the email *is* the sign-in name.
    const result = await setEmail(id, 'after@example.test', 'not-the-password');
    expect(result.ok).toBe(false);
    expect((await stored()).email).toBe('before@example.test');
    expect(await db.select().from(auditLog)).toEqual([]);
  });

  it('refuses an address another account already uses', async () => {
    await db.insert(users).values({ id: 'user-taken', email: 'taken@example.test' });
    const result = await setEmail(id, 'TAKEN@example.test', PASSWORD);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/already uses/);
    expect((await stored()).email).toBe('before@example.test');
  });

  it('says so rather than claiming a change, when it is the same address', async () => {
    const result = await setEmail(id, 'BEFORE@example.test', PASSWORD);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/already use/);
  });

  it('refuses something that is not an address, before asking for the password', async () => {
    expect((await setEmail(id, 'nonsense', PASSWORD)).ok).toBe(false);
    expect((await setEmail(id, '', PASSWORD)).ok).toBe(false);
    expect((await setEmail(id, 42, PASSWORD)).ok).toBe(false);
    expect((await setEmail(id, 'after@example.test', null)).ok).toBe(false);
    expect((await stored()).email).toBe('before@example.test');
  });

  it('refuses an account with no password to check against', async () => {
    await db.delete(accounts).where(eq(accounts.userId, id));
    const result = await setEmail(id, 'after@example.test', PASSWORD);
    expect(result.ok).toBe(false);
    expect((await stored()).email).toBe('before@example.test');
  });
});
