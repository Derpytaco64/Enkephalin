/**
 * Postgres unique_violation. Drizzle wraps driver errors in its own Error, so
 * the driver's code sits on the cause rather than on what was thrown — the
 * reason a duplicate registration once surfaced as a 500 instead of a message.
 */
export function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current !== 'object') return false;
    if ((current as { code?: unknown }).code === '23505') return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
