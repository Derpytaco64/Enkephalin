import { listInvites } from '@/lib/invites';
import { createInviteAction, revokeInviteAction } from './actions';

export const metadata = { title: 'Invites — Enkephalin' };

function status(invite: Awaited<ReturnType<typeof listInvites>>[number]) {
  if (invite.revokedAt) return 'revoked';
  if (invite.expiresAt && invite.expiresAt <= new Date()) return 'expired';
  if (invite.uses >= invite.maxUses) return 'spent';
  return 'active';
}

export default async function InvitesPage() {
  const invites = await listInvites();
  const field = 'mt-1 w-full rounded border border-[var(--border)] bg-[var(--surface)] px-3 py-2';

  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Invites</h1>

      {/* A form action, deliberately: the reset React performs afterwards is
          what clears the note and puts the counts back to 1 and 14 for the
          next invite. See app/_components/submit.ts for the forms where that
          same reset is a bug. */}
      <form action={createInviteAction} className="mt-8 grid gap-4 sm:grid-cols-[6rem_8rem_1fr_auto] sm:items-end">
        <div>
          <label htmlFor="maxUses" className="block text-sm">Max uses</label>
          <input id="maxUses" name="maxUses" type="number" min={1} defaultValue={1} className={field} />
        </div>
        <div>
          <label htmlFor="expiresInDays" className="block text-sm">Expires (days)</label>
          <input id="expiresInDays" name="expiresInDays" type="number" min={0} defaultValue={14} className={field} />
        </div>
        <div>
          <label htmlFor="note" className="block text-sm">Note</label>
          <input id="note" name="note" placeholder="who it is for" className={field} />
        </div>
        <button type="submit" className="btn btn-primary">
          Generate
        </button>
      </form>

      <p className="mt-2 text-xs text-[var(--muted)]">0 days means it never expires.</p>

      {invites.length === 0 ? (
        <p className="mt-10 text-[var(--muted)]">No invites yet.</p>
      ) : (
        <div className="mt-10 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[var(--muted)]">
                <th className="py-2 pr-4 font-medium">Code</th>
                <th className="py-2 pr-4 font-medium">Uses</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Note</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => {
                const state = status(invite);
                return (
                  <tr key={invite.id} className="border-b border-[var(--border)]">
                    <td className="py-2 pr-4 font-mono tracking-wider">{invite.code}</td>
                    <td className="py-2 pr-4">{invite.uses} / {invite.maxUses}</td>
                    <td className="py-2 pr-4">
                      <span className={state === 'active' ? 'text-[var(--ok)]' : 'text-[var(--muted)]'}>{state}</span>
                    </td>
                    <td className="py-2 pr-4 text-[var(--muted)]">{invite.note ?? ''}</td>
                    <td className="py-2 text-right">
                      {state === 'active' && (
                        <form action={revokeInviteAction}>
                          <input type="hidden" name="id" value={invite.id} />
                          <button type="submit" className="text-[var(--danger)] underline">Revoke</button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
