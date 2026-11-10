import Link from 'next/link';
import type { Route } from 'next';

/**
 * The way into every admin screen, and the one page in the app that never
 * took part in the look.
 *
 * It was a bulleted list of eight underlined blue links with grey sentences
 * trailing after them -- the browser's own idea of a list of links, on a site
 * where every other index is a grid of cards. Same cards as the home page's
 * areas now, same hover, read off one table so adding a screen is a row.
 *
 * Grouped, because nine destinations in one grid is a wall and these are not
 * nine of a kind: four are the content, two are the people who reach it, and
 * three are the site itself -- what it is, how it looks, where it is kept. The
 * headings are what make the one you want findable without reading all nine.
 */
type Area = { href: Route; title: string; blurb: string };

const GROUPS: { heading: string; areas: Area[] }[] = [
  {
    heading: 'Content',
    areas: [
      {
        href: '/admin/fields',
        title: 'Fields',
        blurb: 'What a drug profile is made of: add one, reorder, retype, retire.',
      },
      {
        href: '/admin/tags',
        title: 'Tags',
        blurb: 'Lists and courses, and which drugs are on each.',
      },
      {
        href: '/admin/indications',
        title: 'Indications',
        blurb: 'The sheet’s own vocabulary — rename a wording, merge two into one.',
      },
      {
        href: '/admin/dosing',
        title: 'Dosing review',
        blurb: 'The readings the parser would not stand behind, worst first.',
      },
      {
        href: '/admin/flagged',
        title: 'Flagged values',
        blurb: 'Values somebody doubted, the ones already asked first.',
      },
      {
        href: '/admin/pairing',
        title: 'Brand pairing',
        blurb: 'Which brand treats which condition, where a drug has several of both.',
      },
      {
        href: '/admin/bulk',
        title: 'Bulk field set',
        blurb: 'One value across many drugs, with what it would overwrite shown first.',
      },
      {
        href: '/admin/import',
        title: 'Import drugs',
        blurb: 'A lecture’s worth of profiles from one file, previewed before it writes.',
      },
    ],
  },
  {
    heading: 'People',
    areas: [
      {
        href: '/admin/users',
        title: 'Users',
        blurb: 'Roles, access, and the only route back into a locked-out account.',
      },
      {
        href: '/admin/invites',
        title: 'Invites',
        blurb: 'Mint a code, see who redeemed it, revoke one.',
      },
    ],
  },
  {
    heading: 'The site itself',
    areas: [
      {
        href: '/admin/site',
        title: 'Site',
        blurb: 'Its name, who may register, and the disclaimer everyone reads.',
      },
      {
        href: '/admin/look',
        title: 'Look',
        blurb: 'The default theme, season and colour palette everyone starts from.',
      },
      {
        href: '/admin/data',
        title: 'Data',
        blurb: 'The whole database as one JSON file: download it, or restore one.',
      },
      {
        href: '/admin/audit',
        title: 'Audit log',
        blurb: 'Every change anyone has made, and what it was before.',
      },
    ],
  },
];

export default function AdminHome() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Everything that is the site rather than the studying.
      </p>

      {GROUPS.map((group) => (
        <section key={group.heading} className="mt-8">
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--muted)]">
            {group.heading}
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {group.areas.map((area) => (
              <Link
                key={area.href}
                href={area.href}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4
                  hover:border-[var(--btn-edge)]"
              >
                <p className="font-medium">{area.title}</p>
                <p className="mt-1 text-sm text-[var(--muted)]">{area.blurb}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
