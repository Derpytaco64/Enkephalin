import Link from 'next/link';
import type { Route } from 'next';
import { listFieldDefs } from '@/lib/fields/registry';
import { overviewFor, type Overview } from '@/lib/home/overview';
import { getSession } from '@/lib/session';
import { getSiteSettings } from '@/lib/settings';
import { lastUsedSetups } from '@/lib/study/last-used';
import { describeSetup, listSetups, SURFACES, type SetupParams, type Surface } from '@/lib/study/presets';

export const dynamic = 'force-dynamic';

/**
 * The front door.
 *
 * It used to say "Scaffold is up", which it has not been since phase 0. What
 * replaces it answers the two questions somebody opening the site actually
 * has: is there anything to do, and can I start the thing I did last time
 * without setting it up again. Everything else on the page is a way in.
 *
 * Nothing here is a new source of truth. The figures are counted in
 * `lib/home/overview.ts`, the setups come from the same whitelist the study
 * pages save through, and the disclaimer is the one an admin edits in site
 * settings rather than a sentence hard-coded twice.
 */
export default async function Home() {
  const session = await getSession();
  const disclaimer = (await getSiteSettings())?.disclaimerText;

  if (session === null) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Enkephalin</h1>
        <p className="mt-3 text-[var(--muted)]">
          Drug profiles, flashcards and quizzes for the top-drugs list — self-hosted, one class,
          no accounts you did not invite.
        </p>
        <Link
          href="/login"
          className="mt-8 inline-block rounded-full bg-[var(--accent)] px-4 py-2 text-sm
            font-medium text-[var(--accent-fg)]"
        >
          Sign in
        </Link>
        {disclaimer !== undefined && (
          <p className="mt-10 text-sm text-[var(--muted)]">{disclaimer}</p>
        )}
      </main>
    );
  }

  const [overview, defs, lastUsed, quizSetups, deckSetups] = await Promise.all([
    overviewFor(session.user.id),
    listFieldDefs(),
    lastUsedSetups(session.user.id),
    listSetups(session.user.id, 'quiz'),
    listSetups(session.user.id, 'flashcards'),
  ]);

  const labelFor = (key: string) => key
    .split('+')
    .map((part) => defs.find((def) => def.key === part)?.label ?? part)
    .join(', ');

  const greeting = (session.user.name ?? '').trim() !== ''
    ? `Welcome back, ${(session.user.name as string).trim().split(' ')[0]}`
    : 'Welcome back';

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
        {overview.streak > 0 && (
          <p className="text-sm text-[var(--muted)]">
            {overview.streak} day{overview.streak === 1 ? '' : 's'} running
          </p>
        )}
      </div>

      <Stats overview={overview} labelFor={labelFor} />

      <Resume lastUsed={lastUsed} labelFor={labelFor} />

      <Saved
        surfaces={[['quiz', quizSetups], ['flashcards', deckSetups]]}
        labelFor={labelFor}
      />

      <Areas isAdmin={session.user.role === 'admin'} drugs={overview.catalogue.drugs} />

      {/* The admin's own wording out of site settings, not a sentence
          hard-coded on two pages. Absent only before bootstrap has written
          the singleton, which is a state nobody signed in can be in. */}
      {disclaimer !== undefined && (
        <p className="mt-12 border-t border-[var(--border)] pt-6 text-sm text-[var(--muted)]">
          {disclaimer}
        </p>
      )}
    </main>
  );
}

/* ------------------------------------------------------------- stats ------ */

/**
 * Four figures, each of which is also a link to the thing it is about.
 *
 * Due-now leads, because it is the only one that is a request rather than a
 * record. Accuracy is withheld rather than shown as 0% before a single
 * question has been answered: a new account has no record, and printing one
 * reads as a verdict on it.
 */
function Stats({ overview, labelFor }: { overview: Overview; labelFor: (key: string) => string }) {
  const percent = (value: number) => `${Math.round(value * 100)}%`;

  const tiles: { href: Route | { pathname: Route; query: Record<string, string> }; figure: string; label: string; note: string }[] = [
    {
      href: '/study/flashcards',
      figure: overview.deck.dueNow === 0 ? '—' : String(overview.deck.dueNow),
      label: 'Cards due',
      note: overview.deck.tracked === 0
        ? 'no deck yet'
        : `${overview.deck.tracked} scheduled · ${overview.deck.reviews} reviews`,
    },
    {
      href: '/study/quiz',
      figure: overview.quiz.accuracy === null ? '—' : percent(overview.quiz.accuracy),
      label: 'Quiz accuracy',
      note: overview.quiz.answered === 0
        ? 'no questions yet'
        : `${overview.quiz.answered} answered · ${overview.quiz.attempts} quizzes`,
    },
    {
      href: overview.weakest === null
        ? '/study/quiz'
        // The one tile that is an instruction: it links to a quiz on exactly
        // the field it names, which is the whole reason the key is carried.
        : { pathname: '/study/quiz', query: { fields: overview.weakest.fieldKey } },
      figure: overview.weakest === null
        ? '—'
        : percent(overview.weakest.right / overview.weakest.asked),
      label: overview.weakest === null ? 'Weakest field' : labelFor(overview.weakest.fieldKey),
      note: overview.weakest === null
        ? 'not enough answers yet'
        : `weakest · ${overview.weakest.right} of ${overview.weakest.asked} · quiz it`,
    },
    {
      href: '/drugs',
      figure: String(overview.catalogue.drugs),
      label: 'Drugs',
      note: `${overview.catalogue.classes} classes · ${overview.catalogue.brands} brands`,
    },
  ];

  return (
    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((tile) => (
        <Link
          key={tile.label}
          href={tile.href}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4
            hover:border-[var(--accent)]"
        >
          <p className="text-2xl font-semibold tabular-nums">{tile.figure}</p>
          <p className="mt-0.5 text-sm font-medium">{tile.label}</p>
          <p className="mt-1 text-xs text-[var(--muted)]">{tile.note}</p>
        </Link>
      ))}
    </section>
  );
}

/* ------------------------------------------------------------ resume ------ */

/**
 * The last deck and the last quiz, each one click from starting again.
 *
 * Recorded by the study pages themselves once a session is on screen, not by
 * this page guessing from history -- see `lib/study/last-used.ts`. Absent
 * until there is something to resume, rather than shown empty.
 */
function Resume({
  lastUsed,
  labelFor,
}: {
  lastUsed: Partial<Record<Surface, SetupParams>>;
  labelFor: (key: string) => string;
}) {
  const entries = (['flashcards', 'quiz'] as const)
    .flatMap((surface) => {
      const params = lastUsed[surface];
      return params === undefined ? [] : [{ surface, params }];
    });

  if (entries.length === 0) {
    return (
      <p className="mt-8 text-sm text-[var(--muted)]">
        Start a deck or a quiz and its settings will be waiting here next time.
      </p>
    );
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
        Pick up where you left off
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {entries.map(({ surface, params }) => (
          <Link
            key={surface}
            href={{ pathname: SURFACES[surface].path as Route, query: params }}
            className="rounded-lg border border-[var(--border)] p-4 hover:border-[var(--accent)]"
          >
            <p className="text-sm font-medium">
              {surface === 'quiz' ? 'Sit that quiz again' : 'Carry on with that deck'}
            </p>
            {/* The settings in words, so the link is not a leap of faith --
                the same summary the saved-setup list uses. */}
            <p className="mt-1 text-xs text-[var(--muted)]">
              {describeSetup(surface, params, labelFor)}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- saved ------ */

/** The named setups, as chips. Nothing when there are none. */
function Saved({
  surfaces,
  labelFor,
}: {
  surfaces: [Surface, { id: string; name: string; params: SetupParams }[]][];
  labelFor: (key: string) => string;
}) {
  const all = surfaces.flatMap(([surface, setups]) => setups.map((setup) => ({ surface, setup })));
  if (all.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
        Saved setups
      </h2>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {all.map(({ surface, setup }) => (
          <Link
            key={setup.id}
            href={{ pathname: SURFACES[surface].path as Route, query: setup.params }}
            title={describeSetup(surface, setup.params, labelFor)}
            className="rounded-full border border-[var(--border)] px-3 py-1.5 text-sm
              hover:border-[var(--accent)]"
          >
            {setup.name}
            <span className="ml-2 text-xs text-[var(--muted)]">{SURFACES[surface].label}</span>
          </Link>
        ))}
        <Link href="/study/setups" className="text-xs text-[var(--muted)] underline">
          Manage
        </Link>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- areas ------ */

/** The four places there are, plus admin for those who have it. */
function Areas({ isAdmin, drugs }: { isAdmin: boolean; drugs: number }) {
  const areas: { href: Route; title: string; blurb: string }[] = [
    { href: '/drugs', title: 'Drugs', blurb: `Browse and search all ${drugs}, filter by class, schedule or list.` },
    { href: '/study/flashcards', title: 'Flashcards', blurb: 'Prompt, reveal, grade yourself. Spaced so what you miss comes back.' },
    { href: '/study/quiz', title: 'Quiz', blurb: 'Multiple choice, scored, both directions, weighted to what you got wrong.' },
    { href: '/settings', title: 'Settings', blurb: 'Theme, the colour axis, and a colour per class or schedule.' },
    ...(isAdmin
      ? [{ href: '/admin' as Route, title: 'Admin', blurb: 'Fields, tags, indications, invites, the site palette and the backup.' }]
      : []),
  ];

  return (
    <section className="mt-10 border-t border-[var(--border)] pt-8">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {areas.map((area) => (
          <Link
            key={area.href}
            href={area.href}
            className="rounded-lg border border-[var(--border)] p-4 hover:border-[var(--accent)]"
          >
            <p className="font-medium">{area.title}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">{area.blurb}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
