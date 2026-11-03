/**
 * Which colour a drug wears, and whether a colour anyone picks is readable.
 *
 * Pure and client-safe: the palette editor needs the same contrast maths the
 * server does, and a number shown to a person next to a swatch must be the
 * number the check actually used.
 *
 * ## One colour per value, not one per theme
 *
 * The theme tokens in `globals.css` are defined twice, light and dark, because
 * a page background has to be. These are not that. A categorical colour is a
 * **fill** -- a schedule badge, a class dot -- and it is one value used in
 * both themes, because the thing being edited is "what colour is CIV", and an
 * answer that differed by theme would be two answers to one question.
 *
 * That is only possible inside a band. Measured against both page surfaces:
 * of the eight class colours this replaces, five cleared 3:1 on white *and*
 * on the dark surface and three did not; every dark-mode value failed on
 * white, some as low as 1.6:1. So the ramps below are chosen from the band
 * that works in both, and anything a person types is checked against both.
 *
 * ## 3:1, not 4.5:1
 *
 * PLAN.md said warn below 4.5:1 against both surfaces. No colour can do that
 * -- the best of the existing palette managed 4.6 on white and 3.9 on dark,
 * and the arithmetic is against it: clearing 4.5 on white means being dark,
 * which is exactly what fails on a dark ground.
 *
 * 4.5:1 is the threshold for *text*, and these are not text. A fill needs 3:1
 * against what surrounds it (WCAG 1.4.11, non-text contrast), and the text
 * drawn *on* the fill is handled separately and exactly: `readableTextOn`
 * picks black or white, whichever wins, which lands between 4.6:1 and 13.4:1
 * for every colour in these ramps. So the readable-text promise is kept by
 * construction rather than by hoping the user picks well.
 */

export type ColorAxis = 'class' | 'schedule' | 'tag' | 'none';

export function isColorAxis(value: unknown): value is ColorAxis {
  return value === 'class' || value === 'schedule' || value === 'tag' || value === 'none';
}

/** The two grounds a fill has to sit on, from `globals.css`. */
export const SURFACE_LIGHT = '#ffffff';
export const SURFACE_DARK = '#14171c';

/** WCAG 1.4.11: a non-text fill needs this much against what surrounds it. */
export const MIN_FILL_CONTRAST = 3;

/**
 * Eight hues, each clearing 3:1 on both surfaces, in the order the old
 * `--class-*` tokens ran so a drug that was blue stays blue-ish.
 */
export const CATEGORICAL_RAMP = [
  '#2563eb', // blue
  '#059669', // emerald
  '#8b5cf6', // violet
  '#ea580c', // orange
  '#0891b2', // cyan
  '#d946ef', // fuchsia
  '#65a30d', // lime
  '#f43f5e', // rose
] as const;

/**
 * Ordinal, not categorical: CII is the strongest and CV the faintest, and the
 * ramp runs warm to cool so the order survives being seen in either theme.
 * Schedule I has no accepted medical use and so no place in a top-drugs list;
 * it shares CII's colour if it ever turns up.
 */
export const SCHEDULE_COLORS: Record<string, string> = {
  CI: '#dc2626',
  CII: '#dc2626',
  CIII: '#ea580c',
  CIV: '#d97706',
  CV: '#78716c',
};

/** Not controlled is still a value on this axis, and it is the quietest one. */
export const NO_SCHEDULE_COLOR = '#64748b';

/** `#abc`, `abcdef`, `#ABCDEF` all land on `#aabbcc`-style output; else null. */
export function normalizeHex(input: string): string | null {
  const text = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(text)) {
    return `#${text[0]}${text[0]}${text[1]}${text[1]}${text[2]}${text[2]}`;
  }
  return /^[0-9a-f]{6}$/.test(text) ? `#${text}` : null;
}

function channel(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const value = normalizeHex(hex) ?? '#000000';
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const one = relativeLuminance(a);
  const two = relativeLuminance(b);
  const lighter = Math.max(one, two);
  const darker = Math.min(one, two);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Black or white on this fill, whichever reads better.
 *
 * This is what keeps "colour is never the only signal" true: every badge
 * carries its text, and the text is legible on whatever colour was chosen
 * rather than on the colour someone hoped for.
 */
export function readableTextOn(fill: string): '#000000' | '#ffffff' {
  return contrastRatio(fill, '#000000') >= contrastRatio(fill, '#ffffff')
    ? '#000000'
    : '#ffffff';
}

export type FillCheck = {
  light: number;
  dark: number;
  /** Clears `MIN_FILL_CONTRAST` on both grounds. */
  ok: boolean;
  /** The ratio on the text drawn over it, which is always comfortable. */
  text: number;
};

export function checkFill(fill: string): FillCheck {
  const light = contrastRatio(fill, SURFACE_LIGHT);
  const dark = contrastRatio(fill, SURFACE_DARK);
  return {
    light,
    dark,
    ok: Math.min(light, dark) >= MIN_FILL_CONTRAST,
    text: contrastRatio(fill, readableTextOn(fill)),
  };
}

/** How a palette override is addressed: the axis, then the value on it. */
export function paletteKey(axis: Exclude<ColorAxis, 'none'>, value: string): string {
  return `${axis}:${value}`;
}

/**
 * FNV-1a over the value, so a class keeps its colour across sessions, servers
 * and restarts. Assignment has to be stable or the colour means nothing: a
 * drug that is blue today and orange tomorrow is worse than no colour.
 */
function ramp(value: string): string {
  let hash = 0x811c9dc5;
  for (let at = 0; at < value.length; at += 1) {
    hash ^= value.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return CATEGORICAL_RAMP[hash % CATEGORICAL_RAMP.length];
}

/**
 * The colour for one drug on the chosen axis, or null where there is nothing
 * to colour -- the axis is off, or the drug has no value on it.
 *
 * `overrides` are the user's own, layered over the site default, layered over
 * the ramp. Resolved here rather than in CSS so the editor and the page cannot
 * disagree about what colour something is.
 */
export function colorFor(
  axis: ColorAxis,
  subject: { drugClass?: string | null; schedule?: string | null; tags?: string[] },
  overrides: Record<string, string> = {},
): string | null {
  const pick = (key: string, fallback: string) => normalizeHex(overrides[key] ?? '') ?? fallback;

  if (axis === 'none') return null;

  if (axis === 'schedule') {
    // Not controlled is a value, not a gap: on this axis every drug has one.
    const schedule = subject.schedule ?? null;
    const key = paletteKey('schedule', schedule ?? 'none');
    return pick(key, schedule === null
      ? NO_SCHEDULE_COLOR
      : SCHEDULE_COLORS[schedule.toUpperCase()] ?? NO_SCHEDULE_COLOR);
  }

  if (axis === 'class') {
    const drugClass = subject.drugClass;
    if (!drugClass) return null;
    return pick(paletteKey('class', drugClass), ramp(drugClass));
  }

  // The first tag, which is the only one a single swatch can stand for.
  const tag = subject.tags?.[0];
  if (tag === undefined) return null;
  return pick(paletteKey('tag', tag), ramp(tag));
}
