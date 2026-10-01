import { DateTime } from 'luxon';
import type { Cents } from './money';
import { LOCAL_ZONE } from './time';

export interface TradeOutcome {
  netCents: Cents;
  /** Actual R multiple, when a planned risk was recorded. */
  r: number | null;
}

export interface Summary {
  n: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  netCents: Cents;
  avgWinCents: Cents | null;
  avgLossCents: Cents | null;
  /** Gross wins ÷ gross losses. Null when there are no losses. */
  profitFactor: number | null;
  expectancyCents: Cents | null;
  avgR: number | null;
  /** Number of trades with an R multiple (avgR's sample size). */
  nR: number;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarise(trades: readonly TradeOutcome[]): Summary {
  const wins = trades.filter((t) => t.netCents > 0);
  const losses = trades.filter((t) => t.netCents < 0);
  const grossWin = wins.reduce((s, t) => s + t.netCents, 0);
  const grossLoss = -losses.reduce((s, t) => s + t.netCents, 0);
  const rs = trades.map((t) => t.r).filter((r): r is number => r !== null);
  const net = trades.reduce((s, t) => s + t.netCents, 0);
  const avgR = mean(rs);
  return {
    n: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: trades.length - wins.length - losses.length,
    winRate: trades.length ? wins.length / trades.length : null,
    netCents: net,
    avgWinCents: wins.length ? Math.round(grossWin / wins.length) : null,
    avgLossCents: losses.length ? -Math.round(grossLoss / losses.length) : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancyCents: trades.length ? Math.round(net / trades.length) : null,
    avgR: avgR === null ? null : Math.round(avgR * 100) / 100,
    nR: rs.length,
  };
}

/** Summaries per group, in the order keys first appear unless `order` is given. */
export function summariseBy<T extends TradeOutcome>(trades: readonly T[], key: (t: T) => string, order?: readonly string[]): { key: string; summary: Summary }[] {
  const groups = new Map<string, T[]>();
  for (const k of order ?? []) groups.set(k, []);
  for (const t of trades) {
    const k = key(t);
    groups.set(k, [...(groups.get(k) ?? []), t]);
  }
  return [...groups.entries()].filter(([, ts]) => ts.length > 0).map(([k, ts]) => ({ key: k, summary: summarise(ts) }));
}

export interface EquityPoint {
  index: number;
  at: string;
  netCents: Cents;
  equityCents: Cents;
  /** Distance below the running peak (≤ 0). */
  drawdownCents: Cents;
}

/** Cumulative P&L and drawdown in trade order (sorted by `at`). */
export function equityCurve(trades: readonly (TradeOutcome & { at: string })[]): EquityPoint[] {
  let equity = 0;
  let peak = 0;
  return [...trades]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((t, index) => {
      equity += t.netCents;
      peak = Math.max(peak, equity);
      return { index: index + 1, at: t.at, netCents: t.netCents, equityCents: equity, drawdownCents: equity - peak };
    });
}

export const maxDrawdown = (curve: readonly EquityPoint[]): Cents => curve.reduce((m, p) => Math.min(m, p.drawdownCents), 0);

/** Perth hour bucket like "21:00" for time-of-day breakdowns. */
export const hourBucket = (instant: string): string => `${DateTime.fromISO(instant, { zone: 'utc' }).setZone(LOCAL_ZONE).toFormat('HH')}:00`;

export const weekdayOf = (isoDate: string): string => DateTime.fromISO(isoDate).toFormat('ccc');
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface Streaks {
  longestWin: number;
  longestLoss: number;
  /** Positive for a current winning streak, negative for losing, 0 after a breakeven or with no trades. */
  current: number;
}

/** Consecutive wins/losses in trade order (sorted by `at`). Breakeven trades end a streak. */
export function streaks(trades: readonly (TradeOutcome & { at: string })[]): Streaks {
  let longestWin = 0;
  let longestLoss = 0;
  let current = 0;
  for (const t of [...trades].sort((a, b) => a.at.localeCompare(b.at))) {
    if (t.netCents > 0) current = current > 0 ? current + 1 : 1;
    else if (t.netCents < 0) current = current < 0 ? current - 1 : -1;
    else current = 0;
    longestWin = Math.max(longestWin, current);
    longestLoss = Math.max(longestLoss, -current);
  }
  return { longestWin, longestLoss, current };
}

export const SESSION_BUCKETS = ['0–30m', '30–60m', '60–90m', '90–120m', '2h+'] as const;

/** Bucket for how long into the session a trade was entered (screen-time fatigue). */
export function sessionBucket(sessionStart: string, entryAt: string): (typeof SESSION_BUCKETS)[number] {
  const m = (Date.parse(entryAt) - Date.parse(sessionStart)) / 60_000;
  if (m < 30) return '0–30m';
  if (m < 60) return '30–60m';
  if (m < 90) return '60–90m';
  if (m < 120) return '90–120m';
  return '2h+';
}

export interface PlanAdherence {
  /** Trades with both a planned R:R and an actual R. */
  n: number;
  avgPlannedRR: number | null;
  avgActualR: number | null;
  /** Share of those trades that reached at least their planned R:R. */
  reachedPlan: number | null;
  /** Losing trades with an R, and how many lost more than the planned risk (R below −1.1). */
  losersWithR: number;
  oversizedLosses: number;
  oversizedLossCents: Cents;
}

/** How results compared with the risk plan: target reached, and losses bigger than planned. */
export function planAdherence(trades: readonly (TradeOutcome & { plannedRR: number | null })[]): PlanAdherence {
  const both = trades.filter((t) => t.plannedRR !== null && t.r !== null);
  const losers = trades.filter((t) => t.r !== null && t.netCents < 0);
  const oversized = losers.filter((t) => t.r! < -1.1);
  const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
  return {
    n: both.length,
    avgPlannedRR: avg(both.map((t) => t.plannedRR!)),
    avgActualR: avg(both.map((t) => t.r!)),
    reachedPlan: both.length ? both.filter((t) => t.r! >= t.plannedRR!).length / both.length : null,
    losersWithR: losers.length,
    oversizedLosses: oversized.length,
    oversizedLossCents: oversized.reduce((s, t) => s + t.netCents, 0),
  };
}
