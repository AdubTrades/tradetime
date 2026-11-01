import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { Bar, RectDrawing, RiskRewardDrawing, Shape, Timeframe } from '@tc/domain';
import { chartCoords, type ChartCoords } from './chartCoords';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export type ShapePart = 'body' | 'a' | 'b' | 'c' | 'd' | 'entry' | 'stop' | 'target' | 'end';

const HANDLE = 5;
const alpha = (hex: string, a: number) =>
  `${hex.slice(0, 7)}${Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0')}`;

/** What a long/short tool says in each zone, and whether the replay has reached its stop or target. */
export interface RiskRewardText {
  target: string;
  stop: string;
  middle: string;
  outcome: 'target' | 'stop' | null;
}

/**
 * Draws rectangles (with an optional middle line) and TradingView-style long/short position tools on the candles, and
 * finds which one (and which handle) is under the mouse. Shapes stay hidden until the replay reaches their start.
 */
export class ShapesPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: () => void = () => {};
  shapes: Shape[] = [];
  bars: Bar[] = [];
  tf: Timeframe = '1m';
  kind: 'futures' | 'crypto' = 'crypto';
  selected: string | null = null;
  hovered: string | null = null;
  colours = { profit: '#089981', loss: '#f23645', text: '#131722', muted: '#787b86', background: '#ffffff' };
  describe: (rr: RiskRewardDrawing) => RiskRewardText = () => ({ target: '', stop: '', middle: '', outcome: null });

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

  coords(): ChartCoords {
    return chartCoords(this.bars, this.tf, this.kind);
  }

  /** Screen box of a shape (CSS pixels), or null when hidden. */
  box(s: Shape, c = this.coords()): { x1: number; x2: number; ys: Record<string, number> } | null {
    if (!this.chart || !this.series || s.hiddenOn.includes(this.tf) || c.future(Math.min(s.t1, s.t2))) return null;
    const ts = this.chart.timeScale();
    const x = (t: number) => ts.logicalToCoordinate(c.logicalOf(t) as never);
    const xa = x(s.t1);
    const xb = x(s.t2);
    if (xa === null || xb === null) return null;
    const y = (p: number) => this.series!.priceToCoordinate(p);
    const prices: Record<string, number> = s.kind === 'rect' ? { p1: s.p1, p2: s.p2 } : { entry: s.entry, stop: s.stop, target: s.target };
    const ys: Record<string, number> = {};
    for (const [k, p] of Object.entries(prices)) {
      const v = y(p);
      if (v === null) return null;
      ys[k] = v;
    }
    const extend = s.kind === 'rect' && s.style.extendRight;
    return { x1: Math.min(xa, xb), x2: extend ? ts.width() : Math.max(xa, xb), ys };
  }

  /** The shape and handle under a point, topmost first. */
  shapeAt(x: number, y: number): { shape: Shape; part: ShapePart } | null {
    const c = this.coords();
    const near = (hx: number, hy: number) => Math.hypot(x - hx, y - hy) <= HANDLE + 3;
    for (const s of [...this.shapes].reverse()) {
      const b = this.box(s, c);
      if (!b) continue;
      const ts = this.chart!.timeScale();
      const xt1 = ts.logicalToCoordinate(c.logicalOf(s.t1) as never)!;
      const xt2 = ts.logicalToCoordinate(c.logicalOf(s.t2) as never)!;
      if (s.kind === 'rect') {
        const corners: [ShapePart, number, number][] = [
          ['a', xt1, b.ys.p1!],
          ['b', xt2, b.ys.p2!],
          ['c', xt1, b.ys.p2!],
          ['d', xt2, b.ys.p1!],
        ];
        if (s.id === this.selected) for (const [part, hx, hy] of corners) if (near(hx, hy)) return { shape: s, part };
        const top = Math.min(b.ys.p1!, b.ys.p2!);
        const bottom = Math.max(b.ys.p1!, b.ys.p2!);
        if (x >= b.x1 - 3 && x <= b.x2 + 3 && y >= top - 3 && y <= bottom + 3) return { shape: s, part: 'body' };
      } else {
        if (s.id === this.selected) {
          if (near(xt1, b.ys.target!)) return { shape: s, part: 'target' };
          if (near(xt1, b.ys.stop!)) return { shape: s, part: 'stop' };
          if (near(xt1, b.ys.entry!)) return { shape: s, part: 'entry' };
          if (near(b.x2, b.ys.entry!)) return { shape: s, part: 'end' };
        }
        const top = Math.min(b.ys.stop!, b.ys.target!);
        const bottom = Math.max(b.ys.stop!, b.ys.target!);
        if (x >= b.x1 && x <= b.x2 && y >= top && y <= bottom) return { shape: s, part: 'body' };
      }
    }
    return null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [{ zOrder: () => 'normal', renderer: () => ({ draw: (target: DrawTarget) => this.draw(target) }) }];
  }

  private draw(target: DrawTarget) {
    const c = this.coords();
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const handle = (x: number, y: number, colour: string) => {
        ctx.beginPath();
        ctx.arc(x * hr, y * vr, HANDLE * hr, 0, Math.PI * 2);
        ctx.fillStyle = this.colours.background;
        ctx.fill();
        ctx.lineWidth = Math.max(1, 1.5 * hr);
        ctx.strokeStyle = colour;
        ctx.stroke();
      };
      const text = (str: string, x: number, y: number, colour: string, opts: { size?: number; bold?: boolean; align?: CanvasTextAlign; baseline?: CanvasTextBaseline } = {}) => {
        if (!str) return;
        ctx.font = `${opts.bold ? '600 ' : ''}${(opts.size ?? 11) * vr}px Geist, system-ui, sans-serif`;
        ctx.fillStyle = colour;
        ctx.textAlign = opts.align ?? 'left';
        ctx.textBaseline = opts.baseline ?? 'middle';
        ctx.fillText(str, x * hr, y * vr);
      };
      for (const s of this.shapes) {
        const b = this.box(s, c);
        if (!b) continue;
        const active = s.id === this.selected || s.id === this.hovered;
        const ts = this.chart!.timeScale();
        const xt1 = ts.logicalToCoordinate(c.logicalOf(s.t1) as never)!;
        const xt2 = ts.logicalToCoordinate(c.logicalOf(s.t2) as never)!;
        if (s.kind === 'rect') this.drawRect(ctx, s, b, hr, vr, text);
        else this.drawRiskReward(ctx, s, b, hr, vr, text);
        if (s.id === this.selected) {
          if (s.kind === 'rect') {
            for (const [hx, hy] of [
              [xt1, b.ys.p1!],
              [xt2, b.ys.p2!],
              [xt1, b.ys.p2!],
              [xt2, b.ys.p1!],
            ] as const)
              handle(hx, hy, '#2962ff');
          } else {
            handle(xt1, b.ys.target!, this.colours.profit);
            handle(xt1, b.ys.stop!, this.colours.loss);
            handle(xt1, b.ys.entry!, this.colours.muted);
            handle(b.x2, b.ys.entry!, this.colours.muted);
          }
        } else if (active && s.kind === 'rect') {
          ctx.lineWidth = Math.max(1, hr);
          ctx.strokeStyle = s.style.border;
          ctx.setLineDash([]);
        }
      }
    });
  }

  private drawRect(
    ctx: CanvasRenderingContext2D,
    s: RectDrawing,
    b: { x1: number; x2: number; ys: Record<string, number> },
    hr: number,
    vr: number,
    text: (str: string, x: number, y: number, colour: string, opts?: { size?: number; bold?: boolean; align?: CanvasTextAlign; baseline?: CanvasTextBaseline }) => void,
  ) {
    const top = Math.min(b.ys.p1!, b.ys.p2!);
    const bottom = Math.max(b.ys.p1!, b.ys.p2!);
    const x = Math.round(b.x1 * hr);
    const w = Math.round((b.x2 - b.x1) * hr);
    const y = Math.round(top * vr);
    const h = Math.round((bottom - top) * vr);
    ctx.fillStyle = alpha(s.style.fill, s.style.fillOpacity);
    ctx.fillRect(x, y, w, h);
    const lw = Math.max(1, Math.round(s.style.borderWidth * hr));
    ctx.lineWidth = lw;
    ctx.strokeStyle = s.style.border;
    ctx.setLineDash([]);
    ctx.strokeRect(x + (lw % 2 ? 0.5 : 0), y + (lw % 2 ? 0.5 : 0), w, h);
    if (s.style.midline) {
      const my = Math.round(((top + bottom) / 2) * vr) + 0.5;
      ctx.setLineDash(s.style.midDash === 'dashed' ? [6 * hr, 4 * hr] : s.style.midDash === 'dotted' ? [hr, 3 * hr] : []);
      ctx.lineWidth = Math.max(1, Math.round(hr));
      ctx.beginPath();
      ctx.moveTo(x, my);
      ctx.lineTo(x + w, my);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const label = s.label.text.trim();
    if (label) {
      const pad = 6;
      const tx = s.label.align === 'left' ? b.x1 + pad : s.label.align === 'right' ? b.x2 - pad : (b.x1 + b.x2) / 2;
      const ty = s.label.place === 'above' ? top - 4 : s.label.place === 'below' ? bottom + 4 : (top + bottom) / 2;
      text(label, tx, ty, s.label.color ?? s.style.border, {
        size: s.label.size,
        bold: s.label.bold,
        align: s.label.align === 'left' ? 'left' : s.label.align === 'right' ? 'right' : 'center',
        baseline: s.label.place === 'above' ? 'bottom' : s.label.place === 'below' ? 'top' : 'middle',
      });
    }
  }

  private drawRiskReward(
    ctx: CanvasRenderingContext2D,
    s: RiskRewardDrawing,
    b: { x1: number; x2: number; ys: Record<string, number> },
    hr: number,
    vr: number,
    text: (str: string, x: number, y: number, colour: string, opts?: { size?: number; bold?: boolean; align?: CanvasTextAlign; baseline?: CanvasTextBaseline }) => void,
  ) {
    const { entry, stop, target } = b.ys as { entry: number; stop: number; target: number };
    const info = this.describe(s);
    const x = Math.round(b.x1 * hr);
    const w = Math.max(1, Math.round((b.x2 - b.x1) * hr));
    const zone = (y1: number, y2: number, colour: string, strong: boolean) => {
      ctx.fillStyle = alpha(colour, strong ? 0.32 : 0.18);
      ctx.fillRect(x, Math.round(Math.min(y1, y2) * vr), w, Math.round(Math.abs(y2 - y1) * vr));
    };
    zone(entry, target, this.colours.profit, info.outcome === 'target');
    zone(entry, stop, this.colours.loss, info.outcome === 'stop');
    ctx.strokeStyle = this.colours.muted;
    ctx.lineWidth = Math.max(1, Math.round(hr));
    ctx.beginPath();
    ctx.moveTo(x, Math.round(entry * vr) + 0.5);
    ctx.lineTo(x + w, Math.round(entry * vr) + 0.5);
    ctx.stroke();
    const cx = (b.x1 + b.x2) / 2;
    const up = target < entry; // screen y: smaller is higher
    text(info.target, cx, up ? target + 10 : target - 10, this.colours.profit, { align: 'center', bold: true });
    text(info.stop, cx, up ? stop - 10 : stop + 10, this.colours.loss, { align: 'center', bold: true });
    text(info.middle, cx, up ? entry + 10 : entry - 10, this.colours.text, { align: 'center' });
  }
}
