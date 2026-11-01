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
}

export const DEFAULT_LINE_STYLE: LineStyle = { color: '#2962ff', width: 1, dash: 'solid', priceLabel: true };
export const DEFAULT_LINE_LABEL: LineLabel = { text: '', color: null, size: 12, bold: false, align: 'right', place: 'above' };

/** TradingView's colour row, so lines look familiar. */
export const LINE_COLORS = ['#f23645', '#ff9800', '#ffeb3b', '#4caf50', '#089981', '#00bcd4', '#2962ff', '#673ab7', '#9c27b0', '#e91e63', '#787b86', '#131722', '#ffffff'];

/** Templates sorted by name, the way the template menu lists them. */
export const sortTemplates = (list: readonly LineTemplate[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
