'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';

/**
 * The main navigation, as pills rather than as a row of blue underlines.
 *
 * Underlined accent text is the right treatment for a link *inside a
 * sentence*, and the wrong one for a set of destinations: five of them side by
 * side read as five unrelated interruptions, and none of them could say which
 * one you were looking at. A pill is a target, and the filled one is where you
 * are.
 *
 * The current pill is filled in `--border` rather than in `--accent`. Accent
 * is the link blue, and a blue lozenge was the one piece of the chrome that
 * ignored the rest of it: in a tinted autumn the whole bar goes warm and the
 * pill saying where you are stayed the same cold blue. `--border` is the token
 * the seasons move *most* -- it is what makes the app read as seasonal at all
 * -- so the pill now takes the season with it, and `--fg` on it measures 11:1
 * at worst across both themes and all four tints (tests/seasons.test.ts).
 *
 * `.pill-nav` is the bar's own size, a notch smaller than a pill elsewhere:
 * five of these at full size plus the wordmark and the account end did not fit
 * a window at half of a 1366-wide screen, and the row's fallback is to wrap,
 * which doubles the height of the chrome on every page.
 *
 * The shape itself lives in `globals.css` as `.pill`, which this used to own
 * privately and now shares with every other target in the app -- a back link,
 * a tag, a saved setup, the colour-axis switcher. `.pill-soft` is what keeps
 * the bar's hover quieter than its fill: hovering a neighbour must not draw
 * the same lozenge as the current pill, or the row lies about where you are.
 *
 * A client component for one reason -- `usePathname`, to know which pill is
 * the current one. There is no other state here, and the links themselves are
 * ordinary `next/link` navigations.
 */
export type NavItem = { href: Route; label: string };

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-wrap items-center gap-1">
      {items.map((item) => {
        // Prefix match, so a drug profile keeps Drugs lit and a quiz in
        // progress keeps Quiz lit. Guarded with a boundary check, or /settings
        // would also light for a hypothetical /settings-export.
        const here = pathname === item.href
          || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={here ? 'page' : undefined}
            className={`pill pill-nav ${here ? 'pill-on' : 'pill-soft'}`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
