/**
 * The rules for editing a palette, with no store attached.
 *
 * There are two palettes -- one per user and one for the site -- and they have
 * to agree about what a key is, what a colour is, and what clearing one means.
 * Two copies of that would be two answers, so the rules live here as plain
 * functions over a map and both stores call them.
 */
import type { Result } from '@/lib/drugs/mutations';
import { normalizeHex, type ColorAxis } from './palette';

export type Overrides = Record<string, string>;

/** `axis:value`, as `paletteKey` builds it. */
const KEY = /^[a-z]+:[^:]{1,200}$/;

export function isPaletteKey(key: unknown): key is string {
  return typeof key === 'string' && KEY.test(key);
}

/**
 * One colour set, or cleared when `color` is blank.
 *
 * Returns the whole new map rather than mutating: the caller writes it, and a
 * rejected edit must leave what was stored untouched.
 */
export function withColor(
  overrides: Overrides,
  key: unknown,
  color: string,
): Result<{ overrides: Overrides; color: string | null }> {
  if (!isPaletteKey(key)) {
    return { ok: false, message: 'That is not something with a colour.' };
  }

  const next = { ...overrides };

  if (color.trim() === '') {
    delete next[key];
    return { ok: true, value: { overrides: next, color: null } };
  }

  const hex = normalizeHex(color);
  if (hex === null) {
    return { ok: false, message: 'Give a colour as a hex code, like #2563eb.' };
  }

  next[key] = hex;
  return { ok: true, value: { overrides: next, color: hex } };
}

/**
 * Every colour on one axis at once, leaving the other axes alone.
 *
 * Scoped by the key prefix rather than by clearing the lot: shuffling the
 * classes should not quietly throw away a schedule colour someone chose
 * deliberately, and the schedule ramp is the one place colour carries meaning
 * -- CII strongest through CV faintest -- so it is not something to overwrite
 * as a side effect.
 */
export function withAxisColors(
  overrides: Overrides,
  axis: Exclude<ColorAxis, 'none'>,
  entries: Overrides,
): Result<{ overrides: Overrides; changed: number }> {
  const prefix = `${axis}:`;

  const cleaned: Overrides = {};
  for (const [key, color] of Object.entries(entries)) {
    if (!key.startsWith(prefix)) {
      return { ok: false, message: 'Those colours are not all on that axis.' };
    }
    const hex = normalizeHex(color);
    if (hex === null) return { ok: false, message: 'Give a colour as a hex code, like #2563eb.' };
    cleaned[key] = hex;
  }

  const kept = Object.fromEntries(
    Object.entries(overrides).filter(([key]) => !key.startsWith(prefix)),
  );

  return { ok: true, value: { overrides: { ...kept, ...cleaned }, changed: Object.keys(cleaned).length } };
}
