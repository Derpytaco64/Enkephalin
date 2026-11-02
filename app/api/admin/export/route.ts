import { backupFilename, exportBackup } from '@/lib/data/backup';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * The backup as a file download.
 *
 * A route rather than a server action because the answer is a file: a browser
 * can only save one from a real response with Content-Disposition, and
 * streaming a megabyte of JSON back through an action to re-encode it in the
 * client would be work in service of nothing.
 *
 * Gated here rather than by the admin layout, which does not cover /api.
 */
export async function GET() {
  const session = await getSession();
  if (!session) return new Response('Not signed in.', { status: 401 });
  if (session.user.role !== 'admin') return new Response('Admins only.', { status: 403 });

  const backup = await exportBackup();

  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="${backupFilename()}"`,
      // A backup is a snapshot of a moment; a cached one is a lie about now.
      'cache-control': 'no-store',
    },
  });
}
