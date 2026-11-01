import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { bucketTime, type Bar, type BacktestInstrument, type HorizontalLine, type Timeframe } from '@tc/domain';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

const HIT_PX = 6;
const HANDLE_PX = 5;

/** Black or white text, whichever reads better on a colour. */
function textOn(hex: string): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#131722' : '#ffffff';
}

/**
 * Draws the horizontal lines and rays (with labels and price-axis tags) on top of the candles, and answers "which line
 * is under the mouse". Lines start at the bar they were drawn on, in whatever timeframe is showing, and stay hidden
 * while the replay is before that bar.
 */
export class LinesPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: () => void = () => {};
  lines: HorizontalLine[] = [];
  bars: Bar[] = [];
  tf: Timeframe = '1m';
  kind: BacktestInstrument['kind'] = 'crypto';
  selected: string | null = null;
  hovered: string | null = null;
  /** Card colour, behind labels placed in the middle of a line. */
  background = '#ffffff';

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = p.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
  }

  update() {
    this.requestUpdate();
  }

  /** Index of the bar a moment falls in on the current chart; past the end means it hasn't happened yet. */
  barIndex(time: number): number {
    const t = bucketTime(time, this.tf, this.kind);
    let lo = 0;
    let hi = this.bars.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.bars[mid]!.t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Where a line sits on screen (CSS pixels), or null when it isn't shown. */
  geometry(line: HorizontalLine): { y: number; x0: number } | null {
    if (!this.chart || !this.series || line.hiddenOn.includes(this.tf) || !this.bars.length) return null;
    const idx = this.barIndex(line.time);
    if (idx >= this.bars.length) return null;
    const y = this.series.priceToCoordinate(line.price);
    if (y === null) return null;
    const x0 = line.kind === 'hline' ? 0 : (this.chart.timeScale().logicalToCoordinate(idx as never) ?? 0);
    return { y, x0 };
  }

  /** The line under a point (CSS pixels within the pane), and whether it's the start handle. */
  lineAt(x: number, y: number): { line: HorizontalLine; handle: boolean } | null {
    for (const line of [...this.lines].reverse()) {
      const g = this.geometry(line);
      if (!g) continue;
      if (line.kind === 'hray' && Math.hypot(x - g.x0, y - g.y) <= HANDLE_PX + 3) return { line, handle: true };
      if (Math.abs(y - g.y) <= HIT_PX + line.style.width / 2 && x >= g.x0 - HIT_PX) return { line, handle: false };
    }
    return null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => 'top', renderer: () => ({ draw: (target: DrawTarget) => this.draw(target) }) }];
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const series = this.series;
    if (!series) return [];
    return this.lines
      .filter((l) => l.style.priceLabel && this.geometry(l))
      .map((l) => ({
        coordinate: () => series.priceToCoordinate(l.price) ?? -100,
        text: () => series.priceFormatter().format(l.price),
        textColor: () => textOn(l.style.color),
        backColor: () => l.style.color,
        visible: () => true,
        tickVisible: () => true,
      }));
  }

  private draw(target: DrawTarget) {
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      for (const line of this.lines) {
        const g = this.geometry(line);
        if (!g) continue;
        const { style, label } = line;
        const lw = Math.max(1, Math.round(style.width * hr));
        const y = Math.round(g.y * vr) + (lw % 2 ? 0.5 : 0);
        const x0 = Math.round(g.x0 * hr);
        const x1 = bitmapSize.width;
        const emphasised = line.id === this.selected || line.id === this.hovered;

        // Label first, so a label in the middle of the line can leave a gap in it.
        let gap: [number, number] | null = null;
        if (label.text.trim()) {
          const size = label.size * vr;
          ctx.font = `${label.bold ? '600 ' : ''}${size}px Geist, system-ui, sans-serif`;
          const text = label.text.trim();
          const w = ctx.measureText(text).width;
          const pad = 6 * hr;
          const tx = label.align === 'left' ? x0 + pad : label.align === 'right' ? x1 - pad - w : (x0 + x1 - w) / 2;
          const ty = label.place === 'above' ? y - lw / 2 - 4 * vr : label.place === 'below' ? y + lw / 2 + 4 * vr + size * 0.8 : y + size * 0.35;
          if (label.place === 'middle') gap = [tx - 4 * hr, tx + w + 4 * hr];
          ctx.fillStyle = label.color ?? style.color;
          ctx.fillText(text, tx, ty);
        }

        ctx.strokeStyle = style.color;
        ctx.lineWidth = lw;
        ctx.setLineDash(style.dash === 'dashed' ? [6 * hr, 4 * hr] : style.dash === 'dotted' ? [lw, 3 * hr] : []);
        ctx.beginPath();
        if (gap) {
          ctx.moveTo(x0, y);
          ctx.lineTo(Math.max(x0, gap[0]), y);
          ctx.moveTo(gap[1], y);
          ctx.lineTo(x1, y);
        } else {
          ctx.moveTo(x0, y);
          ctx.lineTo(x1, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        if (emphasised) {
          const hx = line.kind === 'hray' ? x0 : (x0 + x1) / 2;
          ctx.beginPath();
          ctx.arc(hx, y, HANDLE_PX * hr, 0, Math.PI * 2);
          ctx.fillStyle = this.background;
          ctx.fill();
          ctx.lineWidth = Math.max(1, Math.round(1.5 * hr));
          ctx.strokeStyle = line.id === this.selected ? '#2962ff' : style.color;
          ctx.stroke();
        }
      }
    });
  }
}
