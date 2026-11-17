import Link from 'next/link';
import { listIndications } from '@/lib/drugs/indication-store';
import { requireAdmin } from '@/lib/session';
import {
  deleteIndicationAction, mergeIndicationsAction, renameIndicationAction,
} from './actions';
import { IndicationList } from './indication-list';

export const metadata = { title: 'Indications' };
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
      <p className="mt-2 text-sm text-[var(--muted)]">
        A wording that qualifies a condition says which condition it{'’'}s{' '}
        <em>under</em>. That grouping is what the pickers offer and what a study scope matches, so
        nine wordings of gonorrhea are one thing to tick and still nine different things to learn.
        Nothing is merged — a wording filed under the wrong condition is worth fixing here, and
        the wrong condition is the thing to look for.
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
