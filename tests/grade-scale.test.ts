import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '@/lib/theme/palette';

/* The grade ramp lives in app/globals.css, because the study pages may not
   import lib/theme (tests/colour-is-cosmetic.test.ts). A test may, so the
   contrast is checked here by parsing the stylesheet the browser is served. */

const CSS = readFileSync('app/globals.css', 'utf8');

/** The three blocks that define the chrome: light, system dark, explicit dark. */
function blocks(): Record<string, string> {
  const light = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('@media'));
  const systemDark = CSS.slice(CSS.indexOf('@media'), CSS.indexOf(':root[data-theme="dark"]'));
  const explicitDark = CSS.slice(CSS.indexOf(':root[data-theme="dark"]'));
  return { light, systemDark, explicitDark };
}

function tokens(block: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    found[name] = value.toLowerCase();
  }
  return found;
}

/** What `color-mix(in srgb, fill pct%, ground)` produces. */
function mix(fill: string, ground: string, pct: number): string {
  const channels = [1, 3, 5].map((i) => {
    const a = parseInt(fill.slice(i, i + 2), 16);
    const b = parseInt(ground.slice(i, i + 2), 16);
    return Math.round(a * pct + b * (1 - pct));
  });
  return `#${channels.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

const STEPS = ['--grade-1', '--grade-2', '--grade-3', '--grade-4'];
const FILL = 0.2;
const BORDER = 0.7;

describe('the grade scale', () => {
  it('finds the three theme blocks it is meant to be checking', () => {
    const parsed = blocks();
    for (const [name, block] of Object.entries(parsed)) {
      expect(block.length, name).toBeGreaterThan(200);
      expect(tokens(block)['--surface'], name).toBeDefined();
    }
    expect(tokens(parsed.light)['--surface']).toBe('#ffffff');
  });

  it('defines all four steps in every theme block', () => {
    for (const [name, block] of Object.entries(blocks())) {
      const found = tokens(block);
      for (const step of STEPS) expect(found[step], `${step} in ${name}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  // The file states the dark values twice -- once for the system preference,
  // once for an explicit choice. Nothing but this test stops them drifting,
  // and a drift would show only to whichever half of the users hit the other
  // code path.
  it('keeps the two dark blocks identical, token for token', () => {
    const { systemDark, explicitDark } = blocks();
    expect(tokens(explicitDark)).toEqual(tokens(systemDark));
  });

  it('reads as text on its own tinted fill, in both themes', () => {
    const { light, explicitDark } = blocks();
    for (const [name, block] of [['light', light], ['dark', explicitDark]] as const) {
      const found = tokens(block);
      const surface = found['--surface'];
      for (const step of STEPS) {
        const colour = found[step];
        const ratio = contrastRatio(colour, mix(colour, surface, FILL));
        expect(ratio, `${step} text in ${name} (${ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  // WCAG 1.4.11: the edge of a control, not text, so 3:1.
  it('draws a border that clears 3:1 against the surface', () => {
    const { light, explicitDark } = blocks();
    for (const [name, block] of [['light', light], ['dark', explicitDark]] as const) {
      const found = tokens(block);
      const surface = found['--surface'];
      for (const step of STEPS) {
        const border = mix(found[step], surface, BORDER);
        const ratio = contrastRatio(border, surface);
        expect(ratio, `${step} border in ${name} (${ratio.toFixed(2)}:1)`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('runs red to green, so the steps are an order and not a set', () => {
    const hue = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max === min) return 0;
      const d = max - min;
      const raw = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      return ((raw * 60) + 360) % 360;
    };

    for (const [name, block] of Object.entries(blocks())) {
      const found = tokens(block);
      const hues = STEPS.map((step) => hue(found[step]));
      expect(hues[0], `${name} starts red`).toBeLessThan(25);
      expect(hues[3], `${name} ends green`).toBeGreaterThan(100);
      for (let i = 1; i < hues.length; i += 1) {
        expect(hues[i], `${name} step ${i + 1} is further along than ${i}`).toBeGreaterThan(hues[i - 1]);
      }
    }
  });

  // The compiler generates a fallback for browsers without color-mix by
  // dropping the mix, which for `background` means the full-strength colour
  // under same-coloured text: an invisible label. The base rule has to say
  // what it wants instead.
  it('states a readable fallback before it reaches for color-mix', () => {
    // Declarations only: the prose above the rule says "color-mix" too.
    const base = CSS.slice(CSS.indexOf('.grade-step {'), CSS.indexOf('@supports'))
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(base).toContain('background: transparent;');
    expect(base).not.toContain('color-mix');

    const supported = CSS.slice(CSS.indexOf('@supports'));
    expect(supported).toContain('color-mix(in srgb, var(--grade) 20%, var(--surface))');
    expect(supported).toContain('color-mix(in srgb, var(--grade) 70%, var(--surface))');
  });

  it('is applied by a class the runner actually asks for', () => {
    expect(CSS).toContain('.grade-step {');
    const runner = readFileSync('app/study/flashcards/session-runner.tsx', 'utf8');
    expect(runner).toContain('grade-step');
    for (const step of STEPS) expect(runner).toContain(step);
  });
});
