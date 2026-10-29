import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { siteSettings, users } from '@/db/schema';
import { createCredentialUser } from '@/lib/users';

async function ensureSiteSettings() {
  await db
    .insert(siteSettings)
    .values({ id: 1, siteName: process.env.SITE_NAME || 'Enkephalin' })
    .onConflictDoNothing();
}

/** Seeds the first admin from env, via the same path invited users take. */
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

  await createCredentialUser({
    email,
    password,
    name: 'Admin',
    role: 'admin',
    emailVerified: true,
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
