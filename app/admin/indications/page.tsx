import Link from 'next/link';
import { listIndications } from '@/lib/drugs/indication-store';
import { requireAdmin } from '@/lib/session';
import {
  deleteIndicationAction, mergeIndicationsAction, renameIndicationAction,
} from './actions';
import { IndicationList } from './indication-list';

export const metadata = { title: 'Indications — Enkephalin' };
export const dynamic = 'force-dynamic';

export default async function IndicationsPage() {
  await requireAdmin();
  const items = await listIndications();

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/admin" className="pill">← Admin</Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Indications</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        What the drugs are for, as one shared list. A drug editor picks from these words, so this
        is where a wording gets fixed — once, for every drug carrying it — and where a near-
        duplicate gets folded into the one you meant.
      </p>
      <p className="mt-2 text-sm text-[var(--muted)]">
        New entries are made by writing one into a drug, not here: an indication nothing is for is
        a word with nothing to say. Any that end up that way are counted below and can be cleared.
      </p>

      <IndicationList
        items={items}
        rename={renameIndicationAction}
        merge={mergeIndicationsAction}
        remove={deleteIndicationAction}
      />
    </main>
  );
}
