/**
 * The decorations that belong to light and dark themselves, rather than to a
 * season: a drifting starfield in dark, a dust-mote sunbeam and paper grain in
 * light, and a warmth that follows the clock.
 *
 * Same rules as `seasons.ts`, and for the same reasons: one inert layer in the
 * root layout, built from values that do not vary by page, fixed tables rather
 * than randomised ones, and not one token that text is drawn in is touched.
 * Everything here is either an overlay with a measured alpha or a shape.
 *
 * **Which half shows is decided by CSS, not here.** A theme of `system` means
 * the server does not know whether it is light or dark -- only
 * `prefers-color-scheme` does -- so both mote sets are rendered and the
 * stylesheet hides the wrong one. Twenty spare spans with `display: none` is a
 * far better trade than a flash of the wrong weather on every load.
 */

/** Four buckets of the clock, which is as fine as a warmth needs to be. */
export type Daypart = 'morning' | 'day' | 'evening' | 'night';

export const DAYPARTS: Daypart[] = ['morning', 'day', 'evening', 'night'];

export function isDaypart(value: unknown): value is Daypart {
  return typeof value === 'string' && (DAYPARTS as string[]).includes(value);
}

/**
 * Which part of the day an hour belongs to.
 *
 * Four buckets rather than a continuous curve, because a continuous one would
 * have to be recomputed and re-rendered to be seen, and a page that restyles
 * itself while you read it is worse than one that does not. A bucket changes
 * at a boundary and then stays put.
 *
 * The server's own clock, like the study streak: self-hosted, so the server's
 * zone is the reader's.
 */
export function daypartFromHour(hour: number): Daypart {
  if (hour < 5) return 'night';
  if (hour < 11) return 'morning';
  if (hour < 17) return 'day';
  if (hour < 22) return 'evening';
  return 'night';
}

export function daypartOf(now: Date = new Date()): Daypart {
  return daypartFromHour(now.getHours());
}

/* ------------------------------------------------------------- motes ----- */

export type AmbienceMote = {
  /** Percent across the viewport. */
  left: number;
  /** Percent down the viewport. Stars sit still; dust drifts from here. */
  top: number;
  /** Pixels. */
  size: number;
  /** Seconds for one cycle. */
  duration: number;
  /** Seconds, negative so nothing starts at the beginning together. */
  delay: number;
  opacity: number;
};

/**
 * The starfield, for dark.
 *
 * Two things make this read as a sky rather than as dots: the sizes are all
 * 1-3px, and the durations are long and unequal, so no two stars twinkle
 * together. They do not move -- only their opacity does. A moving star is a
 * firefly, and summer already has those.
 */
export const STARS: AmbienceMote[] = [
  { left: 6, top: 12, size: 2, duration: 7, delay: -1, opacity: 0.5 },
  { left: 14, top: 44, size: 1, duration: 11, delay: -6, opacity: 0.35 },
  { left: 21, top: 8, size: 3, duration: 9, delay: -3, opacity: 0.6 },
  { left: 28, top: 71, size: 1, duration: 13, delay: -9, opacity: 0.3 },
  { left: 36, top: 27, size: 2, duration: 8, delay: -5, opacity: 0.45 },
  { left: 44, top: 88, size: 1, duration: 12, delay: -2, opacity: 0.32 },
  { left: 51, top: 17, size: 2, duration: 10, delay: -7, opacity: 0.5 },
  { left: 58, top: 58, size: 3, duration: 6, delay: -4, opacity: 0.55 },
  { left: 66, top: 33, size: 1, duration: 14, delay: -11, opacity: 0.3 },
  { left: 73, top: 79, size: 2, duration: 9, delay: -8, opacity: 0.42 },
  { left: 81, top: 21, size: 1, duration: 11, delay: -1, opacity: 0.35 },
  { left: 87, top: 63, size: 3, duration: 7, delay: -5, opacity: 0.58 },
  { left: 92, top: 38, size: 2, duration: 12, delay: -10, opacity: 0.4 },
  { left: 97, top: 85, size: 1, duration: 10, delay: -3, opacity: 0.28 },
];

/**
 * The dust motes in the sunbeam, for light.
 *
 * Fewer and slower than any other mote set. Dust in a shaft of light barely
 * moves, and the whole effect is ruined by making it hurry -- these take two
 * minutes to cross, which is slow enough to read past and notice afterwards.
 */
export const DUST: AmbienceMote[] = [
  { left: 12, top: 18, size: 3, duration: 110, delay: -14, opacity: 0.3 },
  { left: 24, top: 52, size: 2, duration: 135, delay: -48, opacity: 0.22 },
  { left: 33, top: 9, size: 4, duration: 96, delay: -70, opacity: 0.34 },
  { left: 46, top: 66, size: 2, duration: 148, delay: -22, opacity: 0.2 },
  { left: 57, top: 31, size: 3, duration: 118, delay: -90, opacity: 0.28 },
  { left: 69, top: 86, size: 2, duration: 128, delay: -36, opacity: 0.24 },
  { left: 78, top: 24, size: 4, duration: 102, delay: -60, opacity: 0.32 },
  { left: 90, top: 48, size: 3, duration: 140, delay: -8, opacity: 0.26 },
];
