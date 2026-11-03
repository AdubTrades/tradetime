import { DateTime } from 'luxon';

/**
 * Price bars for the backtesting page: storage format, timeframes and how bars are combined into larger ones, with the
 * same boundaries TradingView uses. Times are Unix seconds (UTC) of the bar's open.
 */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/** How bars are stored in files: [t, o, h, l, c, v]. */
export type PackedBar = [number, number, number, number, number, number];
export const packBar = (b: Bar): PackedBar => [b.t, b.o, b.h, b.l, b.c, b.v];
export const unpackBar = (p: PackedBar): Bar => ({
  t: p[0],
  o: p[1],
  h: p[2],
  l: p[3],
  c: p[4],
  v: p[5],
});

export type Timeframe = '30s' | '1m' | '2m' | '5m' | '15m' | '1h' | '4h' | '12h' | '1D' | '1W' | '1M';
export const TIMEFRAMES: Timeframe[] = ['30s', '1m', '2m', '5m', '15m', '1h', '4h', '12h', '1D', '1W', '1M'];
const INTRADAY_SECONDS: Partial<Record<Timeframe, number>> = {
  '30s': 30,
  '1m': 60,
  '2m': 120,
  '5m': 300,
  '15m': 900,
  '1h': 3600,
  '4h': 14_400,
  '12h': 43_200,
};
export const timeframeSeconds = (tf: Timeframe): number | null => INTRADAY_SECONDS[tf] ?? null;
export const isIntraday = (tf: Timeframe) => timeframeSeconds(tf) !== null;

export interface BacktestInstrument {
  /** Id used in the app and in file paths (NQ, ES, GC, BTCUSDT…). */
  id: string;
  label: string;
  kind: 'futures' | 'crypto';
  /** Seconds per stored base bar: 30 for futures, 60 for crypto. */
  baseSeconds: 30 | 60;
  /** Contracts traded on this data (MNQ uses NQ prices). */
  trades: string[];
  /** Smallest price step. */
  tickSize: number;
}

export const BACKTEST_INSTRUMENTS: BacktestInstrument[] = [
  {
    id: 'NQ',
    label: 'NQ · E-mini Nasdaq-100',
    kind: 'futures',
    baseSeconds: 30,
    trades: ['NQ', 'MNQ'],
    tickSize: 0.25,
  },
  // ES (ES, MES) and GC (GC, MGC) come back when their data is bought.
  {
    id: 'BTCUSDT',
    label: 'BTC/USDT · Bitcoin (spot)',
    kind: 'crypto',
    baseSeconds: 60,
    trades: ['BTCUSDT'],
    tickSize: 0.01,
  },
  {
    id: 'ETHUSDT',
    label: 'ETH/USDT · Ether (spot)',
    kind: 'crypto',
    baseSeconds: 60,
    trades: ['ETHUSDT'],
    tickSize: 0.01,
  },
  {
    id: 'SOLUSDT',
    label: 'SOL/USDT · Solana (spot)',
    kind: 'crypto',
    baseSeconds: 60,
    trades: ['SOLUSDT'],
    tickSize: 0.01,
  },
];
export const findInstrument = (id: string) => BACKTEST_INSTRUMENTS.find((i) => i.id === id);
/** The price data a journal contract uses (MNQ → NQ's prices), or undefined if there's none. */
export const instrumentForContract = (symbol: string) => BACKTEST_INSTRUMENTS.find((i) => i.trades.includes(symbol.toUpperCase()));

/** Timeframes offered for an instrument: futures from 30 seconds, crypto from 1 minute. */
export const timeframesFor = (i: Pick<BacktestInstrument, 'baseSeconds'>): Timeframe[] =>
  TIMEFRAMES.filter((tf) => (timeframeSeconds(tf) ?? Infinity) >= i.baseSeconds && !(i.baseSeconds === 60 && tf === '2m'));

// ---------- Boundaries ----------

/** CME's trading day runs 18:00–17:00 New York time; a bar belongs to the date the session ends on. */
const CME_ZONE = 'America/New_York';
const SESSION_OPEN_HOUR = 18;

/** The trading date (YYYY-MM-DD) a moment belongs to: New York date for futures (sessions open at 18:00 the day before), UTC date for crypto. */
export function sessionDate(t: number, kind: BacktestInstrument['kind']): string {
  if (kind === 'crypto') return new Date(t * 1000).toISOString().slice(0, 10);
  const ny = DateTime.fromSeconds(t, { zone: CME_ZONE });
  return (ny.hour >= SESSION_OPEN_HOUR ? ny.plus({ days: 1 }) : ny).toISODate()!;
}

/** Unix seconds when a futures session opens: 18:00 New York the evening before its date. */
export function sessionOpen(date: string): number {
  return DateTime.fromISO(date, { zone: CME_ZONE }).minus({ days: 1 }).set({ hour: SESSION_OPEN_HOUR }).toSeconds();
}

/**
 * The bucket a moment falls into for a timeframe, as the bucket's time on the chart. Intraday: the bucket's open (crypto
 * on the UTC clock; futures 4h and 12h counted from the 18:00 New York open). Daily and up: midnight UTC of the trading
 * date, the Monday of its week, or the 1st of its month, so the chart labels them by date the way TradingView does.
 */
export function bucketTime(t: number, tf: Timeframe, kind: BacktestInstrument['kind']): number {
  const len = timeframeSeconds(tf);
  if (len !== null) {
    if (kind === 'futures' && len > 3600) {
      const open = sessionOpen(sessionDate(t, kind));
      return open + Math.floor((t - open) / len) * len;
    }
    return Math.floor(t / len) * len;
  }
  const date = DateTime.fromISO(sessionDate(t, kind), { zone: 'utc' });
  if (tf === '1D') return date.toSeconds();
  if (tf === '1W') return date.minus({ days: date.weekday - 1 }).toSeconds();
  return date.startOf('month').toSeconds();
}

/**
 * The real moment a chart bar starts. Intraday bars are already moments; daily and longer bars are labelled by date, so
 * this gives when that trading date opens (18:00 New York the evening before for futures, midnight UTC for crypto).
 */
export function barStart(t: number, tf: Timeframe, kind: BacktestInstrument['kind']): number {
  if (isIntraday(tf) || kind === 'crypto') return t;
  return sessionOpen(new Date(t * 1000).toISOString().slice(0, 10));
}

// ---------- Combining ----------

/** Combine bars (oldest first) into a timeframe. Bars must be no larger than the timeframe. */
export function aggregate(bars: readonly Bar[], tf: Timeframe, kind: BacktestInstrument['kind']): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  for (const b of bars) {
    const t = bucketTime(b.t, tf, kind);
    if (cur && cur.t === t) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    } else {
      cur = { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
      out.push(cur);
    }
  }
  return out;
}

/**
 * What a chart shows at a replay moment: every bar of the timeframe that had closed by `cursor`, plus the bar still
 * forming, built only from base bars that had closed by then (so nothing from the future leaks in).
 * - `base`: the stored base bars (30s or 1m), from the start of a trading date at least, covering the cursor.
 * - `history`: completed bars from before `base` to fill the chart quickly: hourly bars for intraday timeframes, daily
 *   bars (labelled by date) for 1D, 1W and 1M. Anything from `base`'s first day on is ignored.
 */
export function replayView(opts: { tf: Timeframe; kind: BacktestInstrument['kind']; cursor: number; baseSeconds: number; base: readonly Bar[]; history?: readonly Bar[] }): Bar[] {
  const { tf, kind, cursor, baseSeconds, history = [] } = opts;
  const closedBase = opts.base.filter((b) => b.t + baseSeconds <= cursor);
  if (isIntraday(tf)) {
    const start = closedBase[0]?.t ?? cursor;
    return aggregate([...history.filter((b) => b.t + 3600 <= start), ...closedBase], tf, kind);
  }
  // Daily bars are labelled midnight UTC of their trading date, so from here on the calendar is plain UTC.
  const days = aggregate(closedBase, '1D', kind);
  const firstDay = days[0]?.t ?? bucketTime(cursor, '1D', kind);
  return aggregate([...history.filter((b) => b.t < firstDay), ...days], tf, 'crypto');
}

/** Merge bar lists that may overlap (e.g. adjoining day files), keeping one bar per time, oldest first. */
export function mergeBars(...lists: (readonly Bar[])[]): Bar[] {
  const byTime = new Map<number, Bar>();
  for (const list of lists) for (const b of list) byTime.set(b.t, b);
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}
