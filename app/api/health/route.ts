import { sql } from 'drizzle-orm';
import { db } from '@/db';

export const dynamic = 'force-dynamic';

/** Liveness plus a real database round-trip, so compose can gate on it. */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, db: 'up' });
  } catch (err) {
    return Response.json(
      { ok: false, db: 'down', error: (err as Error).message },
      { status: 503 },
    );
  }
}
