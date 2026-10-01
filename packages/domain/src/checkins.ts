export interface CheckInState {
  /** How many thresholds have been answered or dismissed this session. */
  handled: number;
  /** Epoch ms until which the prompt is snoozed. */
  snoozedUntil: number | null;
}

/**
 * Whether a check-in is due, based purely on screen time since the session started.
 * Reaching a later threshold re-prompts even if an earlier one was dismissed.
 */
export function dueCheckIn(
  elapsedMinutes: number,
  thresholds: readonly number[],
  state: CheckInState,
  now: number = Date.now(),
): { level: number; thresholdMinutes: number } | null {
  const sorted = [...thresholds].filter((t) => t > 0).sort((a, b) => a - b);
  const reached = sorted.filter((t) => elapsedMinutes >= t).length;
  if (reached === 0 || reached <= state.handled) return null;
  if (state.snoozedUntil !== null && now < state.snoozedUntil) return null;
  return { level: reached, thresholdMinutes: sorted[reached - 1]! };
}

/** The most recent reading at or before `at`. Readings are matched within one session by the caller. */
export function latestReadingBefore<T extends { at: string }>(readings: readonly T[], at: string): T | null {
  let best: T | null = null;
  for (const r of readings) {
    if (r.at <= at && (!best || r.at > best.at)) best = r;
  }
  return best;
}
