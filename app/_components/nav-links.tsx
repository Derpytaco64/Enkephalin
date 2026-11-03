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
            className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
              here
                ? 'bg-[var(--accent)] font-medium text-[var(--accent-fg)]'
                : 'text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--fg)]'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
