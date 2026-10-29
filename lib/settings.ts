import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { siteSettings } from '@/db/schema';

export type RegistrationMode = 'invite' | 'open' | 'closed';

export async function getSiteSettings() {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.id, 1)).limit(1);
  return row;
}

export async function getRegistrationMode(): Promise<RegistrationMode> {
  const settings = await getSiteSettings();
  const mode = settings?.registrationMode;
  return mode === 'open' || mode === 'closed' ? mode : 'invite';
}
