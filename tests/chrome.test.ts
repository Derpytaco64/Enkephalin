import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/theme/palette';

/**
 * The chrome the browser used to draw for us.
 *
 * Three things in this file, and they are here together because they are the
 * same kind of thing: parts of the interface that were left at their defaults
 * and so were the only parts not taking part in the theme. The scrollbar, the
 * `color-scheme` the OS reads, the two smallest steps of the type scale, and
 * the pill that says which page you are on.
 *
 * Read out of the stylesheet rather than trusted, for the reason every other
 * CSS guard in this suite exists: none of this has a runtime, so a regression
 * here is silent. The app renders, nothing throws, and a bar is the wrong
 * colour on one theme.
 */

const CSS = readFileSync('app/globals.css', 'utf8');

/** `--name: value;` pairs out of the one rule a selector opens. */
function rule(selector: string): Record<string, string> {
  const at = CSS.indexOf(selector);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  const body = CSS.slice(at + selector.length, CSS.indexOf('}', at));

  const found: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/gi)) {
    found[name] = value.trim();
  }
  return found;
}

/** The whole declaration block a selector opens, comments stripped. */
function block(selector: string): string {
  const at = CSS.indexOf(selector);
  if (at < 0) throw new Error(`no rule for ${selector}`);
  return CSS.slice(at, CSS.indexOf('}', at) + 1).replace(/\/\*[\s\S]*?\*\//g, '');
}

/* ------------------------------------------------------------------------
   The scrollbar.

   Left to the browser it was a grey bar in the operating system's taste:
   the only neutral rectangle on a tinted season, and -- worse -- a *light*
   bar beside dark text whenever dark was chosen on a light machine, because
   `color-scheme: light dark` hands that choice to the OS.
   --------------------------------------------------------------------- */

describe('the scrollbar wears the theme', () => {
  it('is the foreground at an alpha, so it is the same ink as the text', () => {
    // Stated as the chrome's own --fg channels rather than as a colour of its
    // own: a scrollbar is the quietest possible restatement of "this is the
    // reading colour", and two hand-kept values would drift.
    expect(rule(':root {')['--fg']).toBe('#18181b');
    expect(CSS).toContain(':root { --scroll-ink: 24 24 27; }');

    expect(rule(':root[data-theme="dark"] {')['--fg']).toBe('#ececf1');
    expect(CSS).toContain(':root[data-theme="dark"] { --scroll-ink: 236 236 241; }');
  });

  it('states the dark ink twice, as every other token in this file does', () => {
    // Once guarded for the system preference, once for an explicit choice.
    expect(CSS).toContain(
      ':root:not([data-theme="light"]) { --scroll-ink: 236 236 241; }',
    );
  });

  it('runs over a transparent track, so the season shows through it', () => {
    // The whole reason it follows the decorations with nothing per-season to
    // keep in step: what is behind the bar is the page's own washed, tinted
    // ground, not a colour this rule had to guess.
    const bar = block(':root {\n  scrollbar-width: thin;');
    expect(bar).toContain('scrollbar-color: rgb(var(--scroll-ink) / 0.3) transparent');
    expect(block('*::-webkit-scrollbar-track {')).toContain('background: transparent');
    expect(block('*::-webkit-scrollbar-corner {')).toContain('background: transparent');
  });

  it('writes the thumb as rgb(channels / alpha), not color-mix', () => {
    // The streak pill's lesson: `color-mix` makes the minifier emit a
    // solid-colour fallback, and a solid thumb is a black bar on a white page.
    const thumb = block('*::-webkit-scrollbar-thumb {');
    expect(thumb).toContain('rgb(var(--scroll-ink) / 0.3)');
    expect(thumb).not.toContain('color-mix');
  });

  it('reaches a scroller that is not the page', () => {
    // `scrollbar-color` is inherited, so :root carries it everywhere. The
    // WebKit pseudo-elements are not, which is why they are on `*` -- the
    // lookup panel scrolls its own body, and so does the drug browser.
    for (const part of ['scrollbar', 'scrollbar-track', 'scrollbar-thumb', 'scrollbar-corner']) {
      expect(CSS, part).toContain(`*::-webkit-${part} `);
    }
  });

  it('narrows color-scheme to whichever theme was actually chosen', () => {
    // The bug this fixes: dark picked in Settings on a light machine got a
    // light scrollbar, light form controls and a light overscroll gutter,
    // because the OS was still being asked.
    expect(CSS).toContain('html { color-scheme: light dark; }');
    expect(CSS).toContain(':root[data-theme="dark"] { color-scheme: dark; }');
    expect(CSS).toContain(':root[data-theme="light"] { color-scheme: light; }');
  });
});

/* ------------------------------------------------------------------------
   The type scale.
   --------------------------------------------------------------------- */

describe('the two smallest steps', () => {
  const theme = rule('@theme {');

  it('is bigger than the framework default, which is where they were', () => {
    // Tailwind's own 0.75rem and 0.875rem -- 12px and 14px. Nearly every
    // sentence in this app is one of those two, and 12px is below what anyone
    // should have to read prose at.
    const rem = (value: string) => Number(value.replace('rem', ''));

    expect(rem(theme['--text-xs'])).toBeGreaterThan(0.75);
    expect(rem(theme['--text-sm'])).toBeGreaterThan(0.875);
    // And not so far that they collide with the step above.
    expect(rem(theme['--text-xs'])).toBeLessThan(rem(theme['--text-sm']));
    expect(rem(theme['--text-sm'])).toBeLessThan(1);
  });

  it('moves the line height with the size', () => {
    // Left behind, the default pairing would set 13px type on a 12px rhythm.
    expect(theme['--text-xs--line-height']).toBeTruthy();
    expect(theme['--text-sm--line-height']).toBeTruthy();
  });

  it('leaves text-base alone', () => {
    // It is the question on a quiz card and the body of a drug profile, it is
    // already 16px, and every heading in the app is scaled off it.
    expect(theme['--text-base']).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------
   The current-page pill.
   --------------------------------------------------------------------- */

describe('the pill that says where you are', () => {
  const NAV = readFileSync('app/_components/nav-links.tsx', 'utf8');
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

  it('is filled in the theme rather than in link blue', () => {
    // --accent is the colour of a link in a sentence. As a lozenge it was the
    // one piece of the chrome that ignored the rest of it: in a tinted autumn
    // the whole bar goes warm and the pill stayed cold blue.
    const current = NAV.slice(NAV.indexOf('here\n'), NAV.indexOf(': \'text-[var(--muted)]'));
    expect(current).toContain('bg-[var(--border)]');
    expect(current).toContain('text-[var(--fg)]');
    expect(current).not.toContain('--accent');
  });

  it('keeps its words readable on every ground it can take', () => {
    // --border is the token the seasons move most, which is the point -- and
    // which is why this is measured across all four tints rather than once.
    const grounds: [string, string, string][] = [
      ['light', '#18181b', rule(':root {')['--border']],
      ['dark', '#ececf1', rule(':root[data-theme="dark"] {')['--border']],
      ...SEASONS.map((season): [string, string, string] => [
        `light ${season}`,
        '#18181b',
        rule(`:root[data-tint="season"][data-season="${season}"] {`)['--border'],
      ]),
      ...SEASONS.map((season): [string, string, string] => [
        `dark ${season}`,
        '#ececf1',
        rule(`:root[data-theme="dark"][data-tint="season"][data-season="${season}"] {`)['--border'],
      ]),
    ];

    for (const [name, ink, ground] of grounds) {
      expect(ground, name).toMatch(/^#[0-9a-f]{6}$/);
      const ratio = contrastRatio(ink, ground);
      // Well past the 4.5:1 text needs. Stated at 7 because that is the grade
      // this actually earns, and a guard that only holds the floor would let
      // the pill drift to the edge of legibility without saying so.
      expect(ratio, `${name} (${ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(7);
    }
  });

  it('says which pill is current in more than a colour', () => {
    // Colour is confirmation. `aria-current` is what a screen reader reads,
    // and the weight is what anyone who cannot tell the fill from the hover
    // sees.
    expect(NAV).toContain("aria-current={here ? 'page' : undefined}");
    expect(NAV).toContain('font-medium');
  });
});

/* ------------------------------------------------------------------------
   Buttons.

   They were `bg-[var(--accent)]`, which is the *link* colour: a fixed blue
   the seasons deliberately never touch. Right for a link in a sentence,
   wrong for a filled button -- on a tinted autumn page the whole chrome
   goes warm and a cold blue lozenge sat in the middle of it.
   --------------------------------------------------------------------- */

describe('every button is the page’s own ink', () => {
  /** Every .tsx under app/, so a new button cannot slip in uncounted. */
  function screens(): string[] {
    const walk = (path: string): string[] => readdirSync(path).flatMap((entry) => {
      const full = `${path}/${entry}`;
      if (statSync(full).isDirectory()) return walk(full);
      return entry.endsWith('.tsx') ? [full] : [];
    });
    return walk('app');
  }

  it('fills with the reading pair, inverted', () => {
    // --fg on --bg, both of which the seasons already retint, so the button
    // takes the season with it and there is no new contrast figure to defend:
    // it is the body text's own pair swapped over.
    const primary = block('.btn-primary {');
    expect(primary).toContain('background-color: var(--fg)');
    expect(primary).toContain('color: var(--bg)');
    expect(primary).not.toContain('--accent');

    const quiet = block('.btn-quiet {');
    expect(quiet).toContain('background-color: var(--surface)');
    expect(quiet).not.toContain('--accent');
  });

  it('drops the underline a link brings with it', () => {
    // Half of these are `next/link`, and a button that is underlined is a
    // link wearing a button's clothes.
    expect(block('.btn {')).toContain('text-decoration: none');
  });

  it('leaves no accent fill anywhere but the avatar', () => {
    // The one deliberate exception, and it is not a button: the initials
    // circle in the top bar, where a filled accent reads as an identity chip.
    const offenders = screens().filter((file) =>
      readFileSync(file, 'utf8').includes('bg-[var(--accent)]'));

    expect(offenders.map((file) => file.replaceAll('\\', '/')))
      .toEqual(['app/_components/avatar.tsx']);
  });

  it('is a button wherever it reads as one', () => {
    // The owner's note: a link that looks like the button beside it should be
    // the button beside it. Both session-end screens offer "start another",
    // and both were underlined blue text next to a filled control.
    expect(readFileSync('app/study/quiz/quiz-runner.tsx', 'utf8'))
      .toMatch(/className="btn btn-quiet">\s*\n\s*Another quiz/);
    expect(readFileSync('app/study/flashcards/session-runner.tsx', 'utf8'))
      .toMatch(/className="btn btn-quiet mt-4">\s*\n\s*Start another/);
  });
});
