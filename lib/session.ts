import { headers } from 'next/headers';
import { forbidden, redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { sessions } from '@/db/schema';
import { auth } from '@/lib/auth';

/**
 * The authoritative session read. Middleware only checks that a cookie
 * exists; anything that gates on identity must come through here.
 */
export async function getSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;

  // A disabled account has to lose access on its next request rather than at
  // its next login, so drop every session it holds the moment we see one.
  if (session.user.status === 'disabled') {
    await db.delete(sessions).where(eq(sessions.userId, session.user.id));
    return null;
  }

  return session;
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

export async function requireAdmin() {
  const session = await requireUser();
  if (session.user.role !== 'admin') forbidden();
  return session;
}
