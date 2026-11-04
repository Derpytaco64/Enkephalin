import Link from 'next/link';
import { listFieldDefs } from '@/lib/fields/registry';
import { requireUser } from '@/lib/session';
import {
  describeSetup, isSurface, listSetups, setupParams, startsSomething, SURFACES,
} from '@/lib/study/presets';
import { deleteSetupAction, saveSetupAction } from './actions';
import { SetupManager, type SetupRow } from './setup-manager';

export const metadata = { title: 'Saved setups — Enkephalin' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

export default async function SetupsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const session = await requireUser();
  const [search, defs] = await Promise.all([searchParams, listFieldDefs()]);

  const labelFor = (key: string) => key
    .split('+')
    .map((part) => defs.find((def) => def.key === part)?.label ?? part)
    .join(', ');

  const setups = await listSetups(session.user.id);
  const rows: SetupRow[] = setups.map((setup) => ({
    id: setup.id,
    name: setup.name,
    surface: setup.surface,
    path: SURFACES[setup.surface].path,
    query: setup.params,
    surfaceLabel: SURFACES[setup.surface].label,
    summary: describeSetup(setup.surface, setup.params, labelFor),
  }));

  // Arriving from a study page: the settings to keep are in the query, and the
  // surface says which page they belong to. Anything else is a plain visit.
  const surface = search.surface;
  const incomingSurface = isSurface(surface) ? surface : null;
  const incomingParams = incomingSurface === null ? {} : setupParams(incomingSurface, search);
  const incoming = incomingSurface !== null && startsSomething(incomingParams)
    ? {
      surface: incomingSurface,
      surfaceLabel: SURFACES[incomingSurface].label,
      summary: describeSetup(incomingSurface, incomingParams, labelFor),
      params: incomingParams,
    }
    : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Saved setups</h1>
        <nav className="flex gap-1">
          <Link href="/study/quiz" className="pill">Quiz</Link>
          <Link href="/study/flashcards" className="pill">Flashcards</Link>
        </nav>
      </div>

      <p className="mt-3 text-sm text-[var(--muted)]">
        A setup is the settings of a quiz or a deck under a name. Loading one puts those settings
        back and starts straight away, so a session you sit often is one click rather than eight
        controls.
      </p>

      <SetupManager
        rows={rows}
        incoming={incoming}
        save={saveSetupAction}
        remove={deleteSetupAction}
      />
    </main>
  );
}
