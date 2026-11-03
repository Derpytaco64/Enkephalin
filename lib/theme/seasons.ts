/**
 * Seasonal decoration: a wash over the page ground and a handful of drifting
 * motes, and nothing else.
 *
 * **A season is not a theme.** Light-or-dark is a brightness and every
 * contrast guarantee in `app/globals.css` is written against it; a season is
 * decoration layered on top of whichever brightness is in force. So this is a
 * second, independent setting, and it deliberately does **not** touch `--fg`,
 * `--muted`, `--accent` or any other token text is drawn in. What it adds is a
 * low-alpha wash and two ornament colours. `tests/seasons.test.ts` composites
 * each wash over each theme's ground and checks the text still clears 4.5:1,
 * which is the whole safety argument.
 *
 * **It is also the most purely cosmetic thing in the app, and must stay that
 * way.** The ornament is one layer in the root layout, built from one value,
 * identical on every page -- so it cannot differ beside a question and cannot
 * hint at an answer. The mote table below is a fixed list rather than
 * randomised for exactly that reason, as well as to keep the server and the
 * client agreeing. See `tests/colour-is-cosmetic.test.ts` for the rule this
 * sits under.
 */

/** What a person can choose. */
export type SeasonPref = 'off' | 'auto' | 'spring' | 'summer' | 'autumn' | 'winter';

/** What actually gets drawn. Null is "nothing". */
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASON_PREFS: SeasonPref[] = [
  'off', 'auto', 'spring', 'summer', 'autumn', 'winter',
];

export function isSeasonPref(value: unknown): value is SeasonPref {
  return typeof value === 'string' && (SEASON_PREFS as string[]).includes(value);
}

export const SEASON_LABELS: Record<SeasonPref, string> = {
  off: 'No decoration',
  auto: 'Match the date',
  spring: 'Spring — petals',
  summer: 'Summer — fireflies',
  autumn: 'Autumn — falling leaves',
  winter: 'Winter — snow',
};

/**
 * Which season a date falls in, by the meteorological reckoning: whole months,
 * December through February being winter.
 *
 * Whole months rather than the astronomical equinoxes and solstices, which
 * drift by a day or two a year and would need a table. Nothing here is worth a
 * table -- the question is whether to draw leaves or snow, and nobody will
 * dispute that the 21st of September is autumn-ish either way.
 *
 * Northern hemisphere. This is a self-hosted study aid for one pharmacy class,
 * and a wrong guess is a cosmetic wrong guess that one select fixes -- so the
 * four explicit choices beside `auto` are the whole hemisphere setting.
 */
export function seasonFromDate(date: Date): Season {
  // getMonth is 0-based: 0 = January.
  const month = date.getMonth();
  if (month <= 1 || month === 11) return 'winter';
  if (month <= 4) return 'spring';
  if (month <= 7) return 'summer';
  return 'autumn';
}

/** The preference turned into the thing to draw. */
export function resolveSeason(pref: SeasonPref, now: Date = new Date()): Season | null {
  if (pref === 'off') return null;
  if (pref === 'auto') return seasonFromDate(now);
  return pref;
}

/* ----------------------------------------------------------- ornaments ---- */

/** How a mote moves. Falling for three seasons, rising for summer. */
export type MoteMotion = 'fall' | 'rise';

export type SeasonOrnament = {
  motion: MoteMotion;
  /** The CSS class that gives a mote its silhouette. */
  shape: 'flake' | 'leaf' | 'petal' | 'spark';
  /** How many to draw. Small on purpose -- see the comment on MOTES. */
  count: number;
  /** Whether a mote tumbles as it travels. Snow does not; a leaf does. */
  spins: boolean;
};

export const ORNAMENTS: Record<Season, SeasonOrnament> = {
  spring: { motion: 'fall', shape: 'petal', count: 14, spins: true },
  summer: { motion: 'rise', shape: 'spark', count: 16, spins: false },
  autumn: { motion: 'fall', shape: 'leaf', count: 14, spins: true },
  winter: { motion: 'fall', shape: 'flake', count: 20, spins: false },
};

export type Mote = {
  /** Percent across the viewport. */
  left: number;
  /** Pixels. */
  size: number;
  /** Seconds for one trip. */
  duration: number;
  /** Seconds, negative so the screen starts populated rather than empty. */
  delay: number;
  /** Sideways travel over the trip, in viewport-width percent. May be negative. */
  drift: number;
  /** Degrees of tumble over the trip. Ignored unless the ornament spins. */
  spin: number;
  opacity: number;
  /** Which of the season's two ornament colours this one wears. */
  ink: 1 | 2;
};

/**
 * The motes, as a fixed table.
 *
 * Fixed rather than random for three reasons, in order of importance: an
 * ornament that differed from page to page could in principle carry
 * information, and the one rule this app does not bend is that nothing studied
 * may depend on decoration; a randomised list would have to be generated
 * somewhere, and generating it on the server means it changes under every
 * navigation while generating it in the browser means a flash of nothing;
 * and a fixed table can be read and tuned, which a seeded generator cannot.
 *
 * Twenty is the ceiling. Past that it stops reading as weather and starts
 * reading as a fault, and every one of these is a composited element animating
 * forever on a page somebody is trying to read.
 *
 * The numbers are hand-spread rather than evenly spaced: evenly spaced motes
 * fall in a visible grid.
 *
 * Each delay is negative and no larger than its own duration, so it reads as a
 * phase inside one trip. A delay past the duration would behave identically --
 * the animation loops -- but it would say something that is not true about
 * where the mote starts.
 */
const MOTES: Mote[] = [
  { left: 4, size: 9, duration: 15, delay: -2, drift: 6, spin: 240, opacity: 0.55, ink: 1 },
  { left: 11, size: 6, duration: 21, delay: -9, drift: -4, spin: -180, opacity: 0.4, ink: 2 },
  { left: 17, size: 12, duration: 13, delay: -11, drift: 9, spin: 320, opacity: 0.6, ink: 1 },
  { left: 23, size: 7, duration: 25, delay: -5, drift: -7, spin: 140, opacity: 0.35, ink: 2 },
  { left: 29, size: 10, duration: 17, delay: -16, drift: 4, spin: -260, opacity: 0.5, ink: 1 },
  { left: 34, size: 5, duration: 23, delay: -11, drift: 11, spin: 200, opacity: 0.3, ink: 2 },
  { left: 41, size: 11, duration: 14, delay: -3, drift: -9, spin: -300, opacity: 0.58, ink: 1 },
  { left: 47, size: 8, duration: 19, delay: -16, drift: 7, spin: 160, opacity: 0.45, ink: 2 },
  { left: 53, size: 6, duration: 27, delay: -7, drift: -5, spin: 220, opacity: 0.32, ink: 1 },
  { left: 59, size: 13, duration: 12, delay: -9, drift: 8, spin: -340, opacity: 0.62, ink: 2 },
  { left: 65, size: 7, duration: 20, delay: -1, drift: -11, spin: 180, opacity: 0.4, ink: 1 },
  { left: 71, size: 10, duration: 16, delay: -13, drift: 5, spin: -240, opacity: 0.52, ink: 2 },
  { left: 77, size: 5, duration: 24, delay: -8, drift: 10, spin: 260, opacity: 0.3, ink: 1 },
  { left: 83, size: 12, duration: 18, delay: -17, drift: -6, spin: -200, opacity: 0.57, ink: 2 },
  { left: 88, size: 8, duration: 22, delay: -4, drift: 3, spin: 300, opacity: 0.42, ink: 1 },
  { left: 93, size: 6, duration: 15, delay: -14, drift: -8, spin: -160, opacity: 0.36, ink: 2 },
  { left: 8, size: 11, duration: 26, delay: -12, drift: 12, spin: 280, opacity: 0.48, ink: 2 },
  { left: 38, size: 7, duration: 28, delay: -6, drift: -3, spin: -220, opacity: 0.34, ink: 1 },
  { left: 62, size: 9, duration: 29, delay: -20, drift: 6, spin: 240, opacity: 0.44, ink: 2 },
  { left: 96, size: 10, duration: 13, delay: -12, drift: -10, spin: -280, opacity: 0.5, ink: 1 },
];

/** The first `count` motes, which is all any ornament uses. */
export function motesFor(season: Season): Mote[] {
  return MOTES.slice(0, ORNAMENTS[season].count);
}
