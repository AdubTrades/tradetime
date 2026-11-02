import type { Timeframe } from './bars';

/**
 * Chart drawings on the backtesting page. Horizontal lines for now (a ray from a bar to the right, or a line across the
 * whole chart), each with a style, an optional label and the timeframes it shows on. Templates save a style and label
 * under a name ("Asia High") so a line can be labelled in one click.
 */
export type LineDash = 'solid' | 'dashed' | 'dotted';
export type LabelAlign = 'left' | 'center' | 'right';
export type LabelPlace = 'above' | 'middle' | 'below';

export interface LineStyle {
  color: string;
  width: 1 | 2 | 3 | 4;
  dash: LineDash;
  /** Show the price on the price axis. */
  priceLabel: boolean;
}

export interface LineLabel {
  text: string;
  /** Null: same colour as the line. */
  color: string | null;
  size: number;
  bold: boolean;
  align: LabelAlign;
  place: LabelPlace;
}

export interface HorizontalLine {
  id: string;
  kind: 'hray' | 'hline';
  price: number;
  /** Unix seconds of the bar the ray starts at (also kept for full lines, so they appear only from then in replay). */
  time: number;
  style: LineStyle;
  label: LineLabel;
  /** Timeframes the line is hidden on. */
  hiddenOn: Timeframe[];
}

export interface LineTemplate {
  id: string;
  name: string;
  style: LineStyle;
  label: LineLabel;
}

/** Saved per user: the templates, and the look the next new line gets (the last one used). */
export interface LineTools {
  templates: LineTemplate[];
  last: { style: LineStyle; label: LineLabel } | null;
  /** The look of the next rectangle, and the dollar risk of the next long/short tool. */
  rectLast?: RectStyle | null;
  riskUsd?: number | null;
  /** How the last long/short tool was sized, so the next one starts the same. */
  riskMode?: 'usd' | 'percent' | null;
  riskPct?: number | null;
  /** Rectangle templates (kept apart from the line templates). */
  rectTemplates?: RectTemplate[];
  /** Trend line templates, and the look of the next trend line. */
  trendTemplates?: TrendTemplate[];
  trendLast?: { style: TrendStyle; label: LineLabel } | null;
  /** Fib retracement templates. */
  fibTemplates?: FibTemplate[];
  /** The levels and look of the next Fib retracement (the last one set). */
  fibLast?: { levels: FibLevel[]; style: FibStyle } | null;
}

export const DEFAULT_LINE_STYLE: LineStyle = { color: '#2962ff', width: 1, dash: 'solid', priceLabel: true };
export const DEFAULT_LINE_LABEL: LineLabel = { text: '', color: null, size: 12, bold: false, align: 'right', place: 'above' };

/** TradingView's colour row, so lines look familiar. */
export const LINE_COLORS = ['#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63', '#787b86', '#131722', '#ffffff'];

/** Templates sorted by name, the way the template menu lists them. */
export const sortTemplates = <T extends { name: string }>(list: readonly T[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

// ---------- Rectangles and the risk-reward tool ----------

export interface RectStyle {
  border: string;
  borderWidth: 1 | 2 | 3 | 4;
  fill: string;
  /** 0–1. */
  fillOpacity: number;
  /** A line through the middle (TradingView's "middle line"), e.g. the 50% of a fair value gap. */
  midline: boolean;
  midDash: LineDash;
  /** Keep going to the right edge of the chart. */
  extendRight: boolean;
}

export interface RectDrawing {
  id: string;
  kind: 'rect';
  /** Corners: times (Unix seconds of bars, or past the last bar) and prices. */
  t1: number;
  t2: number;
  p1: number;
  p2: number;
  style: RectStyle;
  label: LineLabel;
  hiddenOn: Timeframe[];
}

/**
 * TradingView's long / short position tool: an entry with a stop zone and a target zone, from a start bar to an end
 * bar. Sized from a dollar risk on one of the instrument's contracts.
 */
export interface RiskRewardDrawing {
  id: string;
  kind: 'long' | 'short';
  t1: number;
  t2: number;
  entry: number;
  stop: number;
  target: number;
  /** Contract the size is worked out for (MNQ, NQ…). */
  symbol: string;
  /** Size from a dollar amount, or a percentage of the practice account's balance. */
  riskMode?: 'usd' | 'percent';
  riskUsd: number;
  riskPct?: number;
  hiddenOn: Timeframe[];
}

/** Dollars at risk for a long/short tool: its dollar amount, or its percentage of `balance`. */
export const riskDollars = (rr: Pick<RiskRewardDrawing, 'riskMode' | 'riskUsd' | 'riskPct'>, balance: number) => (rr.riskMode === 'percent' ? (balance * (rr.riskPct ?? 1)) / 100 : rr.riskUsd);

// ---------- Fib retracement ----------

export interface FibLevel {
  value: number;
  color: string;
  on: boolean;
}

export interface FibStyle {
  /** The diagonal from the first point to the second. */
  trendLine: boolean;
  trendColor: string;
  lineWidth: 1 | 2 | 3 | 4;
  lineDash: LineDash;
  extend: 'none' | 'left' | 'right' | 'both';
  /** One colour for every level (null: each level's own). */
  oneColor: string | null;
  /** Shade between neighbouring levels. */
  background: boolean;
  bgOpacity: number;
  /** Swap the ends: 0 at the first point instead of the second. */
  reverse: boolean;
  showPrices: boolean;
  /** Level labels as values (0.5) or percentages (50%), or hidden. */
  showLevels: 'values' | 'percent' | null;
  labelAlign: 'left' | 'right';
  labelPlace: 'top' | 'middle' | 'bottom';
  fontSize: number;
}

/** TradingView's Fib retracement: level 1 at the first point, 0 at the second (unless reversed). */
export interface FibDrawing {
  id: string;
  kind: 'fib';
  t1: number;
  t2: number;
  p1: number;
  p2: number;
  levels: FibLevel[];
  style: FibStyle;
  /** Optional text on the middle of the tool. */
  text: string;
  hiddenOn: Timeframe[];
}

/** Price of a level: 0 at the second point and 1 at the first (the other way round when reversed). */
export const fibPrice = (f: Pick<FibDrawing, 'p1' | 'p2' | 'style'>, value: number) => {
  const [zero, one] = f.style.reverse ? [f.p1, f.p2] : [f.p2, f.p1];
  return zero + (one - zero) * value;
};

/** TradingView's 24 levels; 0, 0.5 and 1 on to start with. */
export const DEFAULT_FIB_LEVELS: FibLevel[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236, 1.272, 1.414, 2.272, 2.414, 2, 3, 3.272, 3.414, 4, 4.272, 4.414, 4.618, 4.764].map(
  (value) => ({
    value,
    color: value === 0.5 ? '#f23645' : value === 0 || value === 1 ? '#2962ff' : '#787b86',
    on: value === 0 || value === 0.5 || value === 1,
  }),
);

export const DEFAULT_FIB_STYLE: FibStyle = {
  trendLine: false,
  trendColor: '#787b86',
  lineWidth: 1,
  lineDash: 'solid',
  extend: 'none',
  oneColor: null,
  background: false,
  bgOpacity: 0.12,
  reverse: false,
  showPrices: false,
  showLevels: 'values',
  labelAlign: 'left',
  labelPlace: 'middle',
  fontSize: 12,
};

/** A Fib's levels and look saved under a name (the text label isn't part of it). */
export interface FibTemplate {
  id: string;
  name: string;
  levels: FibLevel[];
  style: FibStyle;
}

// ---------- Trend line ----------

export type TrendStat = 'priceRange' | 'percent' | 'ticks' | 'bars' | 'dateRange' | 'angle';
export const TREND_STATS: { value: TrendStat; label: string }[] = [
  { value: 'priceRange', label: 'Price range' },
  { value: 'percent', label: 'Percent change' },
  { value: 'ticks', label: 'Change in ticks' },
  { value: 'bars', label: 'Bars range' },
  { value: 'dateRange', label: 'Date/time range' },
  { value: 'angle', label: 'Angle' },
];

export interface TrendStyle {
  color: string;
  width: 1 | 2 | 3 | 4;
  dash: LineDash;
  startCap: 'normal' | 'arrow';
  endCap: 'normal' | 'arrow';
  extend: 'none' | 'left' | 'right' | 'both';
  /** A dot at the middle of the line. */
  middlePoint: boolean;
  /** Both ends' prices as tags on the price axis. */
  priceLabels: boolean;
  stats: TrendStat[];
  statsPos: 'left' | 'center' | 'right';
  /** Show the stats all the time, not just while the line is selected or under the mouse. */
  alwaysStats: boolean;
}

export interface TrendDrawing {
  id: string;
  kind: 'trend';
  t1: number;
  t2: number;
  p1: number;
  p2: number;
  style: TrendStyle;
  label: LineLabel;
  hiddenOn: Timeframe[];
}

export interface TrendTemplate {
  id: string;
  name: string;
  style: TrendStyle;
  label: LineLabel;
}

export const DEFAULT_TREND_STYLE: TrendStyle = {
  color: '#787b86',
  width: 1,
  dash: 'solid',
  startCap: 'normal',
  endCap: 'normal',
  extend: 'none',
  middlePoint: false,
  priceLabels: false,
  stats: [],
  statsPos: 'right',
  alwaysStats: false,
};
export const DEFAULT_TREND_LABEL: LineLabel = { text: '', color: null, size: 12, bold: false, align: 'center', place: 'above' };

export type Shape = RectDrawing | RiskRewardDrawing | FibDrawing | TrendDrawing;

export interface Drawings {
  lines: HorizontalLine[];
  shapes?: Shape[];
}

/** A rectangle's look and label saved under a name ("H1 FVG"). */
export interface RectTemplate {
  id: string;
  name: string;
  style: RectStyle;
  label: LineLabel;
}

export const DEFAULT_RECT_LABEL: LineLabel = { text: '', color: null, size: 12, bold: false, align: 'left', place: 'above' };

export const DEFAULT_RECT_STYLE: RectStyle = { border: '#2962ff', borderWidth: 1, fill: '#2962ff', fillOpacity: 0.15, midline: true, midDash: 'dashed', extendRight: false };
