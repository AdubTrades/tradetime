import { barStart, bucketTime, timeframeSeconds, type Bar, type BacktestInstrument, type Timeframe } from '@tc/domain';

/** Rough length of daily-and-up bars, for positions past the last bar. */
const LONG_BAR: Partial<Record<Timeframe, number>> = { '1D': 86_400, '1W': 604_800, '1M': 2_629_800 };

/**
 * Converting between moments and the chart's bar positions ("logical" indexes) on the current timeframe. Drawings
 * store real moments so they land on the right bar in every timeframe; past the last bar (the empty space on the
 * right) positions continue at one bar per timeframe step.
 */
export function chartCoords(bars: readonly Bar[], tf: Timeframe, kind: BacktestInstrument['kind']) {
  const step = timeframeSeconds(tf) ?? LONG_BAR[tf] ?? 86_400;
  const last = bars.length - 1;
  const indexOf = (bucket: number) => {
    let lo = 0;
    let hi = bars.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid]!.t < bucket) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return {
    /** Bar position of a moment (fractional past either end). */
    logicalOf(t: number): number {
      if (!bars.length) return 0;
      const bucket = bucketTime(t, tf, kind);
      if (bucket > bars[last]!.t) return last + (bucket - bars[last]!.t) / step;
      if (bucket < bars[0]!.t) return (bucket - bars[0]!.t) / step;
      return indexOf(bucket);
    },
    /** The moment at a bar position (the bar's start; past the last bar, counted on in timeframe steps). */
    timeAt(logical: number): number {
      if (!bars.length) return 0;
      const i = Math.round(logical);
      if (i > last) return barStart(bars[last]!.t, tf, kind) + (i - last) * step;
      if (i < 0) return barStart(bars[0]!.t, tf, kind) + i * step;
      return barStart(bars[i]!.t, tf, kind);
    },
    /** Whether a moment is after the last bar shown (still in the replay's future). */
    future(t: number): boolean {
      return !bars.length || bucketTime(t, tf, kind) > bars[last]!.t;
    },
    last,
  };
}

export type ChartCoords = ReturnType<typeof chartCoords>;
