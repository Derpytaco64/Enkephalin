/**
 * The palette numbers its controlled-substance ramp in arabic (--sched-c2
 * through --sched-c5) while the data uses roman (CII..CV). Deriving one from
 * the other by lower-casing produces --sched-civ, which does not exist: the
 * badge then renders with no background and near-black text on a dark ground,
 * invisible but still taking up width.
 */
const SCHEDULE_TOKENS: Record<string, string> = {
  // Schedule I has no accepted medical use, so it does not appear in a top
  // drugs list; it shares the strongest colour if it ever does.
  CI: 'var(--sched-c2)',
  CII: 'var(--sched-c2)',
  CIII: 'var(--sched-c3)',
  CIV: 'var(--sched-c4)',
  CV: 'var(--sched-c5)',
};

export function scheduleColor(schedule: string | null | undefined) {
  if (!schedule) return 'var(--sched-none)';
  return SCHEDULE_TOKENS[schedule.toUpperCase()] ?? 'var(--sched-none)';
}
