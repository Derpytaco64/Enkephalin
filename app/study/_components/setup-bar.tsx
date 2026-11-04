import Link from 'next/link';
import type { SetupParams } from '@/lib/study/presets';

/**
 * The saved setups for this page, at the top of its settings.
 *
 * Above the settings panel and outside it. Inside, it was invisible exactly
 * when it mattered: the panel collapses the moment a session starts, and a
 * session starting is what puts the settings in the URL and so makes there be
 * anything to save.
 *
 * Read-only on purpose. Saving and removing happen on `/study/setups`, because
 * a write here would have to re-render this page to show its result -- and
 * re-rendering a study page redraws the deck or the paper underneath a session
 * in progress, which is exactly the bug that scored a finished quiz 0 of 83.
 * So this side only ever links.
 *
 * The link here saves *what is running*, and appears only when something is:
 * it reads the URL, and the URL holds the settings only once a session has
 * started. Saving before that is the button beside Start, which reads the live
 * form -- see `save-setup-button.tsx`. The two are worth having separately
 * because this one needs no click on a panel that warns it will throw the
 * session away.
 *
 * It opens in a new tab for the same reason the profile links do: a session is
 * in-memory, so leaving and coming back would lose it.
 * Loading a setup is a plain navigation, since that is a deliberate "start
 * something else" -- which is what the panel around this already says it does.
 *
 * `compact` is the form it takes once a session is actually running, where it
 * shares one line with the page's title and the settings it was started with.
 * It drops the two things that are only worth space before you start: the
 * "Saved setups" caption, which the links beside it make obvious, and the
 * empty-state sentence pointing at a button in a panel that is now collapsed.
 */
export function SetupBar({
  path,
  setups,
  saveHref,
  compact = false,
}: {
  path: string;
  setups: { id: string; name: string; summary: string; params: SetupParams }[];
  /** Null until a session is running, since until then the URL holds nothing. */
  saveHref: string | null;
  /** The one-line form, for a page with a session already on it. */
  compact?: boolean;
}) {
  return (
    <div
      className={compact
        ? 'flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs sm:ml-auto'
        : 'mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1'}
    >
      {!compact && (
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
          Saved setups
        </span>
      )}

      {setups.length === 0 ? (
        !compact && (
          <span className="text-xs text-[var(--muted)]">
            {/* Points at the button that exists right now, in the settings
                below, rather than at one that appears later. */}
            none yet — pick your settings below and use{' '}
            <span className="font-medium">Save this setup</span>
          </span>
        )
      ) : (
        setups.map((setup) => (
          <Link
            key={setup.id}
            href={{ pathname: path, query: setup.params }}
            title={setup.summary}
            // A saved setup is a chip: it stands for a thing you made, and
            // a row of them was a row of blue underlines.
            className={compact ? 'pill pill-xs pill-edge' : 'pill pill-edge'}
          >
            {setup.name}
          </Link>
        ))
      )}

      <span className={compact ? 'flex gap-3' : 'ml-auto flex gap-3 text-xs'}>
        {saveHref !== null && (
          <a href={saveHref} target="_blank" rel="noreferrer" className="pill pill-xs">
            Save what’s running ↗
          </a>
        )}
        <Link href="/study/setups" className="pill pill-xs">Manage</Link>
      </span>
    </div>
  );
}
