import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DAYPARTS, daypartFromHour, daypartOf, DUST, isDaypart, STARS, type AmbienceMote,
} from '@/lib/theme/ambience';

const CSS = readFileSync('app/globals.css', 'utf8');
const LAYER = readFileSync('app/_components/ambience-layer.tsx', 'utf8');

/** The body of the `.streak` rule, which several checks below pick apart. */
function streak(): string {
  const block = CSS.slice(CSS.indexOf('.streak {'));
  return block.slice(0, block.indexOf('}'));
}

/**
 * One complete at-rule block, found by a string inside it.
 *
 * Needed because this stylesheet is full of `@media` blocks that say similar
 * things, and an `indexOf` plus "everything after it" silently takes in the
 * next three — which is how the first draft of the reduced-motion check below
 * "found" a dark-theme rule and failed for entirely the wrong reason.
 */
function atRule(open: string, contains: string): string {
  let at = -1;
  for (;;) {
    at = CSS.indexOf(open, at + 1);
    if (at < 0) throw new Error(`no ${open} containing ${contains}`);
    const block = CSS.slice(at, CSS.indexOf('\n}', at));
    if (block.includes(contains)) return block;
  }
}

describe('daypartFromHour', () => {
  it('covers all twenty-four hours', () => {
    const seen = Array.from({ length: 24 }, (_, hour) => daypartFromHour(hour));
    expect(seen.every(isDaypart)).toBe(true);
    expect(new Set(seen)).toEqual(new Set(DAYPARTS));
  });

  it('hands over at each boundary and nowhere else', () => {
    expect(daypartFromHour(4)).toBe('night');
    expect(daypartFromHour(5)).toBe('morning');
    expect(daypartFromHour(10)).toBe('morning');
    expect(daypartFromHour(11)).toBe('day');
    expect(daypartFromHour(16)).toBe('day');
    expect(daypartFromHour(17)).toBe('evening');
    expect(daypartFromHour(21)).toBe('evening');
    expect(daypartFromHour(22)).toBe('night');
    expect(daypartFromHour(23)).toBe('night');
    expect(daypartFromHour(0)).toBe('night');
  });

  it('reads the clock it is given', () => {
    expect(daypartOf(new Date(2026, 10, 3, 19, 30))).toBe('evening');
    expect(daypartOf(new Date(2026, 10, 3, 2, 0))).toBe('night');
  });

  it('has a wash for every daypart, so none renders undecorated', () => {
    for (const daypart of DAYPARTS) {
      expect(CSS, daypart).toContain(`:root[data-ambience][data-daypart="${daypart}"] {`);
    }
  });
});

describe('the mote tables', () => {
  const tables: [string, AmbienceMote[]][] = [['stars', STARS], ['dust', DUST]];

  it('are fixed, not generated', () => {
    // Same rule as the seasons: a decoration that differed from page to page
    // could in principle carry information, and nothing studied in this app
    // may depend on decoration.
    expect(readFileSync('lib/theme/ambience.ts', 'utf8')).not.toContain('Math.random');
  });

  it('stay small enough to be weather rather than a fault', () => {
    for (const [name, table] of tables) {
      expect(table.length, name).toBeGreaterThan(5);
      expect(table.length, name).toBeLessThanOrEqual(20);
    }
  });

  it('spreads both sets across the whole viewport', () => {
    for (const [name, table] of tables) {
      expect(Math.min(...table.map((mote) => mote.left)), `${name} left`).toBeLessThan(15);
      expect(Math.max(...table.map((mote) => mote.left)), `${name} right`).toBeGreaterThan(85);
      expect(Math.min(...table.map((mote) => mote.top)), `${name} top`).toBeLessThan(20);
      expect(Math.max(...table.map((mote) => mote.top)), `${name} bottom`).toBeGreaterThan(80);
    }
  });

  it('starts every one mid-cycle, so nothing begins in step', () => {
    for (const [name, table] of tables) {
      for (const mote of table) {
        expect(mote.delay, `${name} delay`).toBeLessThan(0);
        expect(Math.abs(mote.delay), `${name} delay within one cycle`)
          .toBeLessThanOrEqual(mote.duration);
      }
      // No two sharing a duration is what stops them pulsing together.
      expect(new Set(table.map((mote) => mote.duration)).size, `${name} durations`)
        .toBeGreaterThan(3);
    }
  });

  it('keeps stars small and dust slow', () => {
    // A 6px star is a dot; a fast dust mote is an insect. Both ruin the thing
    // they are meant to be.
    for (const star of STARS) expect(star.size).toBeLessThanOrEqual(3);
    for (const mote of DUST) expect(mote.duration).toBeGreaterThanOrEqual(90);
  });
});

describe('the ambience layer is inert', () => {
  it('renders nothing at all when it is off', () => {
    expect(LAYER).toContain('if (!on) return null;');
  });

  it('takes one boolean and nothing drug-shaped', () => {
    expect(LAYER).toContain('export function AmbienceLayer({ on }: { on: boolean })');
  });

  it('is hidden from assistive technology and takes no click', () => {
    expect(LAYER).toContain('aria-hidden="true"');
    const block = CSS.slice(CSS.indexOf('.ambience {'));
    const body = block.slice(0, block.indexOf('}'));
    expect(body).toContain('pointer-events: none');
    expect(body).toContain('position: fixed');
    expect(body).toContain('z-index: 0');
  });

  it('is drawn once by the layout and never by a study page', () => {
    expect(readFileSync('app/layout.tsx', 'utf8'))
      .toContain('<AmbienceLayer on={decor.ambience} />');

    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const walk = (path: string): string[] => readdirSync(path).flatMap((entry) => {
      const full = `${path}/${entry}`;
      if (statSync(full).isDirectory()) return walk(full);
      return /\.tsx?$/.test(entry)
        && /AmbienceLayer|data-ambience|ambience-|data-daypart/.test(readFileSync(full, 'utf8'))
        ? [full]
        : [];
    });
    expect([...walk('app/study'), ...walk('lib/study')]).toEqual([]);
  });

  it('stands down where it moves, under reduced motion', () => {
    // The beam goes with the motes: its whole character is the sweep, so a
    // frozen one is a strange bright stripe across the page.
    const reduced = atRule('@media (prefers-reduced-motion: reduce)', '.ambience-mote');
    expect(reduced).toContain('.ambience-mote,\n  .ambience-beam { display: none; }');
  });

  it('keeps the two things that do not move', () => {
    // The washes and the grain are static, so there is nothing to stand down
    // from -- and a study aid that reads as paper should go on doing so.
    const reduced = atRule('@media (prefers-reduced-motion: reduce)', '.ambience-mote');
    expect(reduced).not.toContain('.ambience-grain');
    expect(reduced).not.toContain('.ambience-wash');
  });

  it('is left off a printed page', () => {
    expect(CSS).toContain('@media print {\n  .ambience { display: none; }');
  });
});

describe('which half shows is settled by CSS, not by the server', () => {
  it('renders both sets, because `system` means the server cannot know', () => {
    // Choosing here would mean choosing wrong for half the readers, or waiting
    // for the browser and flashing the other one.
    expect(LAYER).toContain('STARS.map');
    expect(LAYER).toContain('DUST.map');
  });

  it('hides the starfield by default and shows it in both dark paths', () => {
    expect(CSS).toContain('.ambience-star { display: none; }');
    expect(CSS).toContain(':root:not([data-theme="light"]) .ambience-star { display: block; }');
    expect(CSS).toContain(':root[data-theme="dark"] .ambience-star { display: block; }');
  });

  it('hides the light-only three in both dark paths', () => {
    for (const guard of [':root:not([data-theme="light"])', ':root[data-theme="dark"]']) {
      for (const part of ['dust', 'beam', 'grain']) {
        expect(CSS, `${guard} ${part}`).toContain(`${guard} .ambience-${part}`);
      }
    }
  });

  it('puts an explicit light choice back, over a dark system preference', () => {
    // Without these the media query would win for someone who chose light on a
    // dark-mode machine, and they would get a starfield they did not ask for.
    expect(CSS).toContain(':root[data-theme="light"] .ambience-star { display: none; }');
    expect(CSS).toContain(':root[data-theme="light"] .ambience-dust,');
  });
});

describe('the three with no switch', () => {
  it('rings a keyboard focus, and only a keyboard focus', () => {
    const block = CSS.slice(CSS.indexOf(':focus-visible {'));
    const body = block.slice(0, block.indexOf('}'));
    expect(body).toContain('outline: 2px solid var(--accent)');
    expect(body).toContain('outline-offset');
    // `:focus`, not `:focus-visible`, would ring everything a mouse clicked.
    expect(CSS).not.toContain('\n:focus {');
  });

  it('scales the streak pill without animating it', () => {
    // A fill cannot be animated on the compositor any more than a shadow can,
    // and the pulse was never the interesting half. The run length is.
    const body = streak();
    expect(body).toContain('var(--streak, 0)');
    expect(body).not.toContain('animation');
    expect(CSS).not.toContain('streak-breathe');
  });

  it('is a pill with no blur in it, after two attempts that had one', () => {
    // Attempt one was a text-shadow, invisible at a one-day run. Attempt two
    // added a hard ring and a growing halo, which was visible and looked bad.
    // What is left fills a pill -- 5% at one day, 20% at six -- and blurs
    // nothing, so there is nothing to look smeared.
    const body = streak();
    expect(body).toMatch(/background-color: rgb\(var\(--streak-ink\) \/ calc\(/);
    expect(body).toContain('border-radius: 999px');
    expect(body).not.toContain('text-shadow');
    // A shadow is still allowed for the hairline edge, but not a blurred one:
    // every shadow here has a 0 blur radius.
    for (const [, shadow] of body.matchAll(/box-shadow:([^;]+);/g)) {
      expect(shadow, 'blur radius').toMatch(/inset 0 0 0 1px/);
    }
  });

  it('has an edge at one day as well as at six', () => {
    // A fill alone is nearly nothing at 5%, and an edge that faded in with the
    // run would read as a rendering fault at the low end. So the hairline
    // carries no `var(--streak)`.
    const body = streak();
    const [, edge] = /box-shadow:([^;]+);/.exec(body) ?? [];
    expect(edge).toBeTruthy();
    expect(edge).not.toContain('--streak,');
  });

  it('never breaks the pill across two lines', () => {
    expect(streak()).toContain('white-space: nowrap');
  });

  it('writes the fill as rgb(channels / alpha), not color-mix', () => {
    // `color-mix` makes the minifier emit a solid-colour fallback for older
    // browsers, and a solid fill under --fg is the one version of this that
    // fails contrast. Checked on the built stylesheet rather than the source,
    // because the fallback is something the build adds.
    expect(streak()).not.toContain('color-mix');
    expect(CSS).toContain(':root { --streak-ink: 181 71 8; }');
    expect(CSS).toContain(':root[data-theme="dark"] { --streak-ink: 255 160 106; }');
  });

  it('states the dark ink twice, as every other decoration does', () => {
    expect(CSS).toContain(
      ':root:not([data-theme="light"]) { --streak-ink: 255 160 106; }',
    );
  });

  it('leaves the words their own colour', () => {
    // The pill fills behind them; it does not recolour them. That is what lets
    // the contrast guards go on measuring --fg.
    expect(streak()).not.toMatch(/^\s*color:/m);
  });

  it('drives the streak pill from the run it already prints in words', () => {
    const home = readFileSync('app/page.tsx', 'utf8');
    expect(home).toContain('className="streak');
    // Capped, or a hundred-day run would be a solid orange lozenge.
    expect(home).toContain('Math.min(overview.streak, 6)');
    // The whole phrase inside the pill: a pill around half a sentence reads as
    // a box somebody forgot to close.
    expect(home).toMatch(/\{overview\.streak\} day\{[^}]+\} running\n/);
  });

  it('tilts the mark with rotate, which composites', () => {
    const frames = CSS.slice(CSS.indexOf('@keyframes mark-idle'));
    expect(frames.slice(0, frames.indexOf('\n}'))).toContain('rotate:');
    expect(readFileSync('app/_components/site-header.tsx', 'utf8')).toContain('className="mark ');
  });

  it('stops the mark under reduced motion', () => {
    expect(atRule('@media (prefers-reduced-motion: reduce)', '.mark'))
      .toContain('.mark { animation: none; }');
  });
});
