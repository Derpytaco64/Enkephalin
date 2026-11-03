import Link from 'next/link';
import type { SetupParams } from '@/lib/study/presets';

/**
 * The saved setups for this page, at the top of its settings.
 *
 * Read-only on purpose. Saving and removing happen on `/study/setups`, because
 * a write here would have to re-render this page to show its result -- and
 * re-rendering a study page redraws the deck or the paper underneath a session
 * in progress, which is exactly the bug that scored a finished quiz 0 of 83.
 * So this side only ever links.
 *
 * *Save this setup* opens in a new tab for the same reason the profile links
 * do: a session is in-memory, so leaving and coming back would lose it.
 * Loading a setup is a plain navigation, since that is a deliberate "start
 * something else" -- which is what the panel around this already says it does.
 */
export function SetupBar({
  path,
  setups,
  saveHref,
}: {
  path: string;
  setups: { id: string; name: string; summary: string; params: SetupParams }[];
  /** Null when the form has nothing selected yet, so there is nothing to save. */
  saveHref: string | null;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-[var(--border)] px-4 py-3">
      <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
        Saved setups
      </span>

      {setups.length === 0 ? (
        <span className="text-xs text-[var(--muted)]">
          none yet — set this up how you like it, then save it
        </span>
      ) : (
        setups.map((setup) => (
          <Link
            key={setup.id}
            href={{ pathname: path, query: setup.params }}
            title={setup.summary}
            className="text-sm text-[var(--accent)] underline"
          >
            {setup.name}
          </Link>
        ))
      )}

      <span className="ml-auto flex gap-3 text-xs">
        {saveHref !== null && (
          <a href={saveHref} target="_blank" rel="noreferrer" className="text-[var(--accent)] underline">
            Save this setup ↗
          </a>
        )}
        <Link href="/study/setups" className="text-[var(--muted)] underline">Manage</Link>
      </span>
    </div>
  );
}
