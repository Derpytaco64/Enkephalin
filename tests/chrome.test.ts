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
    //
    // Read off the stylesheet rather than the component, because the shape
    // moved there: `.pill` started as this bar's private styling and is now
    // every target in the app.
    const on = block('.pill-on {');
    expect(on).toContain('background-color: var(--border)');
    expect(on).toContain('color: var(--fg)');
    expect(on).not.toContain('--accent');
  });

  it('is drawn from the shared pill rather than its own utilities', () => {
    // One definition. Two would drift, and the bar is the one place where the
    // pill's states are all visible at once.
    expect(NAV).toContain("className={`pill ${here ? 'pill-on' : 'pill-soft'}`}");
    expect(NAV).not.toContain('bg-[var(--');
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
    // sees -- which now lives in `.pill-on` with the fill it belongs to.
    expect(NAV).toContain("aria-current={here ? 'page' : undefined}");
    expect(block('.pill-on {')).toContain('font-weight: 500');
  });

  it('keeps a neighbour’s hover quieter than the current fill', () => {
    // Otherwise hovering the pill beside the current one draws exactly the
    // same lozenge, and the row stops saying where you are.
    expect(block('.pill-soft {')).toContain('--pill-hover: var(--surface)');
    expect(NAV).toContain('pill-soft');
  });
});

/* ------------------------------------------------------------------------
   Pills, and the blue that is left.

   `--accent` is the colour of a link inside a sentence, and it is the one
   chrome token the seasons deliberately never move. Everything that was not
   quite a button wore it anyway -- a back link, a tag, a class-mate, *Clear
   filters*, *Remove*, a disclosure row -- which is a sentence's treatment on
   things that are not sentences, in the one colour that cannot take a season.

   Three kinds now, and the two tests at the end of this block are the ones
   that matter: no decoration state may reach for accent, and the accent text
   that is left has to be on a list with a reason beside it.
   --------------------------------------------------------------------- */

describe('the pill, for everything that is not a button', () => {
  function screens(): string[] {
    const walk = (path: string): string[] => readdirSync(path).flatMap((entry) => {
      const full = `${path}/${entry}`;
      if (statSync(full).isDirectory()) return walk(full);
      return entry.endsWith('.tsx') ? [full] : [];
    });
    return walk('app');
  }

  it('rests in the chrome and lights up in it', () => {
    // --muted at rest, --fg on a --border fill on hover: the same pair the
    // current pill in the bar is drawn in, which the test above measures at
    // 11:1 across both themes and all four tints.
    const pill = block('.pill {');
    expect(pill).toContain('color: var(--muted)');
    expect(pill).toContain('--pill-hover: var(--border)');
    expect(pill).not.toContain('--accent');
    // A pill is not a sentence; half of these are links and would arrive
    // underlined.
    expect(pill).toContain('text-decoration: none');

    const hover = block('.pill:hover:not(:disabled) {');
    expect(hover).toContain('background-color: var(--pill-hover)');
    expect(hover).toContain('color: var(--fg)');
  });

  it('lifts a chip’s edge to the button’s edge, not to link blue', () => {
    // The owner's report, and the whole reason this pass happened: hovering
    // the avatar and Sign out drew a cold blue ring in a warm autumn bar.
    // --btn-edge is the seasonal token held at 3:1 against every ground.
    expect(block('.pill-edge {')).toContain('inset 0 0 0 1px var(--border)');
    expect(block('.pill-edge:hover:not(:disabled) {'))
      .toContain('inset 0 0 0 1px var(--btn-edge)');
  });

  it('keeps a destructive pill alarming while the cursor is on it', () => {
    // Without the second rule the shared hover takes it to --fg, so Remove
    // and Revoke would go quiet at exactly the moment they are aimed at.
    expect(block('.pill-danger {')).toContain('color: var(--danger)');
    expect(block('.pill-danger:hover:not(:disabled) {')).toContain('color: var(--danger)');
  });

  it('never puts muted text on a border fill', () => {
    // The one pair in this family to keep away from: --muted on --border
    // reads 4.47:1 in a light autumn. Which is why hover takes the text to
    // --fg in the same rule that fills the pill, rather than only filling it.
    const hover = block('.pill:hover:not(:disabled) {');
    expect(hover).toContain('color: var(--fg)');
    expect(block('.pill-on {')).toContain('color: var(--fg)');
  });

  it('leaves no hover or focus state reaching for the link colour', () => {
    // The actual complaint: a hover that ignores the season. The global
    // focus ring is the deliberate exception and is not a utility -- it is
    // `:focus-visible` in globals.css, an accessibility affordance nobody can
    // switch off, where the strongest fixed contrast is the right answer.
    const offenders = screens().filter((file) =>
      /(?:hover|focus|focus-visible|active|group-hover):[a-z-]*-\[var\(--accent\)\]/
        .test(readFileSync(file, 'utf8')));

    expect(offenders.map((file) => file.replaceAll('\\', '/'))).toEqual([]);
  });

  it('keeps the accent text that is left on a list, with a reason', () => {
    // Same shape as tests/form-reset.test.ts: the rule is not "no accent", it
    // is "accent where a sentence or a row identity earns it", and a new one
    // has to come here and say which.
    const allowed: Record<string, string> = {
      // A link inside a sentence, which is what accent is for.
      'app/(auth)/login/page.tsx': 'Have an invite code? Create an account',
      'app/(auth)/register/page.tsx': 'Already have an account? Sign in',
      'app/account/page.tsx': 'Settings is where the theme and the colours live',
      'app/admin/look/page.tsx': 'will not show on your own pages until you clear yours',
      'app/study/flashcards/page.tsx': 'There are 236 drugs to draw from',

      // The identity of a row in a list or a table. The row is already the
      // target; a column of pills reads as a wall of buttons.
      'app/admin/fields/page.tsx': 'the field being named in each row',
      'app/admin/tags/page.tsx': 'the list being named in each row',
      'app/drugs/drug-browser.tsx': 'the drug named in each row of 236',
      // Both kinds at once: the subject of each log entry is that row's
      // identity and its link to the thing that changed, and the empty state
      // offers "Clear them" inside a sentence.
      'app/admin/audit/page.tsx': 'the drug, tag or person named in each entry',
      'app/admin/flagged/page.tsx': 'the drug named in each flagged value',
      'app/admin/pairing/page.tsx': 'the drug named above each brand grid',

      // The set section, where the accent marks the thing itself: a set's own
      // name in a list, and the two links that start studying it. The links
      // are the page's whole purpose rather than chrome around it, which is
      // the same argument the drug browser already won.
      'app/sets/page.tsx': 'each set named, and the links that start it',
      'app/sets/[slug]/page.tsx': 'the set named in the crumb, and the links that start it',
      'app/sets/[slug]/quiz/page.tsx': 'the crumb back to the set, and the flashcard offer',
      'app/admin/sets/page.tsx': 'each imported set named in the list',
      'app/admin/sets/import-form.tsx': 'the set just imported, named, and the links that start it',

      // Not text at all, and not a button: the initials circle, where a
      // filled accent reads as an identity chip. Pinned again below.
      'app/_components/avatar.tsx': 'the identity chip in the top bar',
    };

    const found = screens()
      .filter((file) => readFileSync(file, 'utf8').includes('var(--accent)'))
      .map((file) => file.replaceAll('\\', '/'))
      .sort();

    expect(found).toEqual(Object.keys(allowed).sort());
  });
});

/* ------------------------------------------------------------------------
   Buttons.

   They were `bg-[var(--accent)]`, which is the *link* colour: a fixed blue
   the seasons deliberately never touch. Right for a link in a sentence,
   wrong for a filled button -- on a tinted autumn page the whole chrome
   goes warm and a cold blue lozenge sat in the middle of it.

   The fix after that was the reading pair inverted, --fg on --bg, which
   solved the clash by leaving the button no colour of its own: black on
   white, the one neutral thing on an icy page. So it has its own three
   tokens now. Their shape is checked here with the rest of the chrome; what
   the four seasons do with them, and whether any of it is legible, is
   measured in tests/seasons.test.ts.
   --------------------------------------------------------------------- */

describe('the filled button has a colour of its own', () => {
  /** Every .tsx under app/, so a new button cannot slip in uncounted. */
  function screens(): string[] {
    const walk = (path: string): string[] => readdirSync(path).flatMap((entry) => {
      const full = `${path}/${entry}`;
      if (statSync(full).isDirectory()) return walk(full);
      return entry.endsWith('.tsx') ? [full] : [];
    });
    return walk('app');
  }

  it('fills, inks and edges itself from its own tokens', () => {
    // Three, not two: a pale fill cannot be told from a pale page, so the
    // boundary is a token rather than an accident of the fill. Not one of
    // them is a chrome token borrowed -- borrowing --fg is exactly what made
    // the button the only unseasonal thing on a seasonal page.
    const primary = block('.btn-primary {');
    expect(primary).toContain('background-color: var(--btn-fill)');
    expect(primary).toContain('color: var(--btn-ink)');
    expect(primary).toContain('box-shadow: inset 0 0 0 1px var(--btn-edge)');
    expect(primary).not.toContain('--accent');
    expect(primary).not.toContain('var(--fg)');

    const quiet = block('.btn-quiet {');
    expect(quiet).toContain('background-color: var(--surface)');
    expect(quiet).not.toContain('--accent');
    // Quiet stays the page's own surface. Two seasonal fills in a row would
    // read as two primary actions, which is the opposite of what it is for.
    expect(quiet).not.toContain('--btn-fill');
  });

  it('states all three of them in all three theme blocks', () => {
    // Same drift risk as every other token in this file: the dark values are
    // written twice, once guarded for the system preference and once for an
    // explicit choice, and a missing one is a button that keeps light's fill
    // on a dark page.
    const light = rule(':root {');
    const explicit = rule(':root[data-theme="dark"] {');
    const system = rule(':root:not([data-theme="light"]) {');

    for (const token of ['--btn-fill', '--btn-ink', '--btn-edge']) {
      expect(light[token], `${token} in light`).toMatch(/^#[0-9a-f]{6}$/);
      expect(explicit[token], `${token} in dark`).toMatch(/^#[0-9a-f]{6}$/);
      expect(system[token], `${token} in system dark`).toBe(explicit[token]);
      expect(light[token], `${token} differs by theme`).not.toBe(explicit[token]);
    }
  });

  it('grows its edge on hover rather than moving the ground under the words', () => {
    // Inset, so the button does not change size, and the edge rather than the
    // fill, so the figure the words were measured against does not move.
    const hover = block('.btn-primary:hover:not(:disabled) {');
    expect(hover).toContain('box-shadow: inset 0 0 0 2px var(--btn-edge)');
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
