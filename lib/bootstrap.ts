import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { accounts, siteSettings, users } from '@/db/schema';

async function ensureSiteSettings() {
  await db
    .insert(siteSettings)
    .values({ id: 1, siteName: process.env.SITE_NAME || 'Enkephalin' })
    .onConflictDoNothing();
}

/**
 * Seeds the first admin from env. Hashing goes through better-auth's own
 * hasher rather than the sign-up API, which expects a request context for its
 * cookie handling and has none during boot.
 */
async function ensureAdmin() {
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  if (admin) return;

  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn('[bootstrap] ADMIN_EMAIL/ADMIN_PASSWORD unset; no admin seeded');
    return;
  }

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    await db.update(users).set({ role: 'admin', status: 'active' }).where(eq(users.id, existing.id));
    console.log(`[bootstrap] promoted existing user ${email} to admin`);
    return;
  }

  const userId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(users).values({
      id: userId,
      email,
      name: 'Admin',
      role: 'admin',
      status: 'active',
      emailVerified: true,
    });
    await tx.insert(accounts).values({
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: 'credential',
      password: await hashPassword(password),
    });
  });
  console.log(`[bootstrap] seeded admin ${email}`);
}

export async function bootstrap() {
  try {
    await ensureSiteSettings();
    await ensureAdmin();
  } catch (err) {
    // A seeding failure must not stop the server from serving, but it must be
    // loud: a silently missing admin looks identical to a working boot.
    console.error('[bootstrap] failed:', err);
  }
}
