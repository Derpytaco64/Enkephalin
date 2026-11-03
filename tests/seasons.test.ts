import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/theme/palette';
import {
  isSeasonPref, motesFor, ORNAMENTS, resolveSeason, SEASON_LABELS, SEASON_PREFS,
  seasonFromDate, type Season,
} from '@/lib/theme/seasons';

const CSS = readFileSync('app/globals.css', 'utf8');
const SEASONS: Season[] = ['spring', 'summer', 'autumn', 'winter'];

describe('seasonFromDate', () => {
  const on = (month: number, day: number) => seasonFromDate(new Date(2026, month - 1, day));

  it('reads whole months, December through February being winter', () => {
    expect(on(12, 1)).toBe('winter');
    expect(on(1, 15)).toBe('winter');
    expect(on(2, 28)).toBe('winter');
  });

  it('hands over at each month boundary', () => {
    expect(on(3, 1)).toBe('spring');
    expect(on(5, 31)).toBe('spring');
    expect(on(6, 1)).toBe('summer');
    expect(on(8, 31)).toBe('summer');
    expect(on(9, 1)).toBe('autumn');
    expect(on(11, 30)).toBe('autumn');
  });

  it('covers every month, with no month answering twice', () => {
    const answers = Array.from({ length: 12 }, (_, index) => on(index + 1, 15));
    expect(answers.filter((season) => season === 'winter')).toHaveLength(3);
    expect(answers.filter((season) => season === 'spring')).toHaveLength(3);
    expect(answers.filter((season) => season === 'summer')).toHaveLength(3);
    expect(answers.filter((season) => season === 'autumn')).toHaveLength(3);
  });
});

describe('resolveSeason', () => {
  it('draws nothing when it is off, which is the default', () => {
    expect(resolveSeason('off')).toBeNull();
  });

  it('reads the date for auto', () => {
    expect(resolveSeason('auto', new Date(2026, 9, 31))).toBe('autumn');
    expect(resolveSeason('auto', new Date(2027, 0, 2))).toBe('winter');
  });

  it('honours an explicit season whatever the date says', () => {
    // The point of picking one: somebody who wants snow in July gets snow.
    expect(resolveSeason('winter', new Date(2026, 6, 4))).toBe('winter');
  });

  it('accepts exactly the six choices and nothing else', () => {
    for (const pref of SEASON_PREFS) expect(isSeasonPref(pref), pref).toBe(true);
    for (const junk of ['autumnal', 'AUTUMN', '', null, 7, undefined]) {
      expect(isSeasonPref(junk), String(junk)).toBe(false);
    }
  });

  it('has a label for every choice, so no select renders a raw value', () => {
    for (const pref of SEASON_PREFS) expect(SEASON_LABELS[pref]).toBeTruthy();
  });
});

/* ------------------------------------------------------------------------
   The safety argument.

   A season paints a wash over the page ground. That moves the effective
   background, and every contrast figure in the stylesheet was measured
   against the unwashed one. So each wash is composited over each ground, in
   each theme, and the text tokens are re-checked against the result. If an
   alpha is ever raised, this is what says so.
   --------------------------------------------------------------------- */

type Rgba = { r: number; g: number; b: number; a: number };

function hex(value: string): Rgba {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
  return { r, g, b, a: 1 };
}

/** `rgb(154 52 18 / 0.055)`, which is how every wash is written. */
function rgba(value: string): Rgba {
  const match = /rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)/.exec(value);
  if (match === null) throw new Error(`not an rgb() with an alpha: ${value}`);
  const [, r, g, b, a] = match;
  return { r: Number(r), g: Number(g), b: Number(b), a: Number(a) };
}

function over(top: Rgba, bottom: Rgba): string {
  const channel = (t: number, b: number) => Math.round(t * top.a + b * (1 - top.a));
  return `#${[channel(top.r, bottom.r), channel(top.g, bottom.g), channel(top.b, bottom.b)]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Pulls `--name: value;` out of one rule, found by its selector. */
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

/**
 * The grounds and inks of each theme, as the chrome declares them.
 *
 * Stated here and checked against the stylesheet below, rather than read out
 * of it: that way a chrome token moving is a failure that says so, instead of
 * this file quietly re-deriving whatever is there and passing.
 *
 * The inks are every colour the app draws *text* in. The grade ramp is not
 * among them: a grade button paints its own opaque fill, which covers the wash
 * -- as does any card with `background: var(--surface)`. Checking the washed
 * surface anyway is deliberately the stricter bound.
 */
const CHROME = {
  light: {
    bg: '#fcfcfd', surface: '#ffffff',
    inks: {
      fg: '#18181b', muted: '#5b6270',
      flagged: '#b42318', verified: '#067647', unverified: '#b54708',
    },
  },
  dark: {
    bg: '#0b0d10', surface: '#14171c',
    inks: {
      fg: '#ececf1', muted: '#9aa1ad',
      flagged: '#ff8b80', verified: '#5ddba4', unverified: '#ffa06a',
    },
  },
} as const;

describe('a season wash leaves the text readable', () => {
  it('matches the chrome the stylesheet actually declares', () => {
    // So this file cannot go on checking last month's palette: if a chrome
    // token moves, the figures above have to move with it.
    for (const [theme, chrome] of Object.entries(CHROME)) {
      const declared = rule(theme === 'light' ? ':root {' : ':root[data-theme="dark"] {');
      expect(declared['--bg'], theme).toBe(chrome.bg);
      expect(declared['--surface'], theme).toBe(chrome.surface);
      for (const [name, value] of Object.entries(chrome.inks)) {
        expect(declared[`--${name}`], `${name} in ${theme}`).toBe(value);
      }
    }
  });

  for (const [theme, chrome] of Object.entries(CHROME)) {
    for (const season of SEASONS) {
      it(`keeps every text ink over 4.5:1 — ${season}, ${theme}`, () => {
        const selector = theme === 'light'
          ? `:root[data-season="${season}"] {`
          : `:root[data-theme="dark"][data-season="${season}"] {`;
        const wash = rgba(rule(selector)['--season-wash']);

        for (const ground of ['bg', 'surface'] as const) {
          const washed = over(wash, hex(chrome[ground]));
          for (const [name, ink] of Object.entries(chrome.inks)) {
            const ratio = contrastRatio(ink, washed);
            expect(ratio, `${name} on washed ${ground} (${ratio.toFixed(2)}:1)`)
              .toBeGreaterThanOrEqual(4.5);
          }
        }
      });
    }
  }

  it('keeps every wash faint enough to be a wash', () => {
    // The cap is not arithmetic, it is intent: past about a tenth this stops
    // being a tint over the theme and starts being a different theme, which is
    // the thing a season is deliberately not.
    for (const season of SEASONS) {
      for (const selector of [
        `:root[data-season="${season}"] {`,
        `:root[data-theme="dark"][data-season="${season}"] {`,
      ]) {
        expect(rgba(rule(selector)['--season-wash']).a, selector).toBeLessThanOrEqual(0.1);
      }
    }
  });

  it('never redefines a token that text or a control edge is drawn in', () => {
    // The whole reason the figures above only have to check the wash. If a
    // season could move --fg or --border, every contrast guarantee in
    // tests/study-colour.test.ts would be measuring a palette nobody sees.
    const section = CSS.slice(CSS.indexOf('/* ===== seasons'));
    const declared = new Set(
      [...section.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(([, name]) => name),
    );

    for (const token of [
      '--fg', '--muted', '--accent', '--accent-fg', '--border', '--bg', '--surface',
      '--danger', '--ok', '--flagged', '--verified', '--unverified',
      '--grade-1', '--grade-2', '--grade-3', '--grade-4',
    ]) {
      expect([...declared], token).not.toContain(token);
    }
  });

  it('states every season in all three theme blocks', () => {
    // Same drift risk as the chrome: the dark values are written twice, once
    // for the system preference and once for an explicit choice.
    for (const season of SEASONS) {
      expect(CSS, season).toContain(`:root[data-season="${season}"] {`);
      expect(CSS, season).toContain(`:root:not([data-theme="light"])[data-season="${season}"] {`);
      expect(CSS, season).toContain(`:root[data-theme="dark"][data-season="${season}"] {`);
    }
  });

  it('keeps the two dark statements of each season identical', () => {
    for (const season of SEASONS) {
      const system = rule(`:root:not([data-theme="light"])[data-season="${season}"] {`);
      const explicit = rule(`:root[data-theme="dark"][data-season="${season}"] {`);
      expect(explicit, season).toEqual(system);
    }
  });
});

describe('the ornament is inert', () => {
  const layer = readFileSync('app/_components/season-layer.tsx', 'utf8');
  const layout = readFileSync('app/layout.tsx', 'utf8');

  it('takes no click, reads to nobody, and sits behind the page', () => {
    expect(layer).toContain('aria-hidden="true"');

    const style = CSS.slice(CSS.indexOf('.season {'), CSS.indexOf('.season-wash'));
    expect(style).toContain('pointer-events: none');
    expect(style).toContain('position: fixed');
    expect(style).toContain('z-index: 0');
    // The content has to out-stack it, or a decoration covers the page.
    expect(layout).toContain('relative z-10');
  });

  it('stops moving when the system asks for reduced motion', () => {
    const reduced = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.season-mote { display: none; }');
  });

  it('is left off a printed page', () => {
    expect(CSS).toContain('@media print {\n  .season { display: none; }');
  });

  it('animates only translate and rotate, so it stays off the main thread', () => {
    const section = CSS.slice(CSS.indexOf('/* ===== seasons'));
    const animated = new Set<string>();
    for (const [, body] of section.matchAll(/@keyframes [a-z-]+ \{([\s\S]*?)\n\}/g)) {
      for (const [, property] of body.matchAll(/^\s*(?:from|to|\d+%)\s*\{\s*([a-z-]+):/gm)) {
        animated.add(property);
      }
    }
    // Opacity is the third safe one -- also composited, and what makes a
    // firefly pulse. Anything else here would mean laying out the page on
    // every frame, forever, behind something somebody is reading.
    expect([...animated].sort()).toEqual(['opacity', 'rotate', 'translate']);
  });
});

describe('the ornament cannot carry information', () => {
  it('is drawn once by the layout and nowhere else', () => {
    // The rule the whole app runs under: nothing studied may depend on
    // decoration. An ornament rendered by a study page could differ beside a
    // question; one rendered by the layout is the same on every page.
    expect(readFileSync('app/layout.tsx', 'utf8')).toContain('<SeasonLayer season={drawn} />');

    const offenders = ['app/study', 'lib/study'].flatMap((dir) => {
      const walk = (path: string): string[] => {
        const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
        return readdirSync(path).flatMap((entry) => {
          const full = `${path}/${entry}`;
          if (statSync(full).isDirectory()) return walk(full);
          return /\.tsx?$/.test(entry) && /SeasonLayer|data-season|season-mote/.test(
            readFileSync(full, 'utf8'),
          ) ? [full] : [];
        });
      };
      return walk(dir);
    });
    expect(offenders).toEqual([]);
  });

  it('takes one value and nothing drug-shaped', () => {
    const layer = readFileSync('app/_components/season-layer.tsx', 'utf8');
    expect(layer).toContain('export function SeasonLayer({ season }: { season: Season | null })');
  });

  it('is the same motes every time it is drawn', () => {
    // Randomised, the layer would differ page to page, which is the one thing
    // a decoration in this app may not do -- quite apart from the server and
    // the browser then disagreeing about where a snowflake is.
    expect(readFileSync('lib/theme/seasons.ts', 'utf8')).not.toContain('Math.random');
    for (const season of SEASONS) {
      expect(motesFor(season)).toEqual(motesFor(season));
    }
  });
});

describe('the mote table', () => {
  it('gives every season as many motes as its ornament asks for', () => {
    for (const season of SEASONS) {
      expect(motesFor(season), season).toHaveLength(ORNAMENTS[season].count);
    }
  });

  it('stays under twenty, past which it reads as a fault', () => {
    for (const season of SEASONS) {
      expect(ORNAMENTS[season].count, season).toBeLessThanOrEqual(20);
    }
  });

  it('spreads them across the viewport rather than in a grid', () => {
    const lefts = motesFor('winter').map((mote) => mote.left);
    expect(Math.min(...lefts)).toBeLessThan(10);
    expect(Math.max(...lefts)).toBeGreaterThan(90);

    // Evenly spaced motes fall in a visible column pattern; this checks the
    // gaps actually vary.
    const sorted = [...lefts].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((value, index) => value - sorted[index]);
    expect(new Set(gaps).size).toBeGreaterThan(3);
  });

  it('starts every mote mid-flight, so the screen is never empty on arrival', () => {
    for (const season of SEASONS) {
      for (const mote of motesFor(season)) {
        expect(mote.delay, `${season} delay`).toBeLessThan(0);
        expect(Math.abs(mote.delay), `${season} delay within one trip`)
          .toBeLessThanOrEqual(mote.duration);
      }
    }
  });

  it('uses both of the season inks', () => {
    for (const season of SEASONS) {
      const inks = new Set(motesFor(season).map((mote) => mote.ink));
      expect(inks, season).toEqual(new Set([1, 2]));
    }
  });

  it('gives each ornament a shape the stylesheet knows', () => {
    for (const season of SEASONS) {
      expect(CSS, season).toContain(`.season-${ORNAMENTS[season].shape} {`);
    }
  });

  it('keeps every mote slow enough to read past', () => {
    for (const season of SEASONS) {
      for (const mote of motesFor(season)) {
        expect(mote.duration, `${season} duration`).toBeGreaterThanOrEqual(12);
      }
    }
  });
});
