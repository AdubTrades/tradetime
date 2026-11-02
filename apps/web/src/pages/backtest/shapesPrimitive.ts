import type { IChartApi, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { fibPrice, type Bar, type FibDrawing, type TrendDrawing, type RectDrawing, type RiskRewardDrawing, type Shape, type Timeframe } from '@tc/domain';
import { chartCoords, type ChartCoords } from './chartCoords';

type DrawTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export type ShapePart = 'body' | 'a' | 'b' | 'c' | 'd' | 'entry' | 'stop' | 'target' | 'end';

const HANDLE = 5;
const alpha = (hex: string, a: number) =>
  `${hex.slice(0, 7)}${Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0')}`;

/** What a long/short tool says in each zone, and in the middle (size and R). */
export interface RiskRewardText {
  target: string;
  stop: string;
  middle: string;
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
  /**
   * The shape being drawn or dragged, shown in place of its saved version. Kept apart from `shapes` so a re-render
   * mid-drag (the price readout updates on every mouse move) can't swap the old version back in.
   */
  preview: Shape | null = null;

  /** What's on screen: the saved shapes with the preview in place of (or added to) its saved version. */
  private get list(): Shape[] {
    const p = this.preview;
    return p ? [...this.shapes.filter((s) => s.id !== p.id), p] : this.shapes;
  }
  bars: Bar[] = [];
  tf: Timeframe = '1m';
  kind: 'futures' | 'crypto' = 'crypto';
  selected: string | null = null;
  /** Price step, for the trend line's "change in ticks". */
  tickSize = 0.01;
  hovered: string | null = null;
  colours = { profit: '#089981', loss: '#f23645', text: '#131722', muted: '#787b86', background: '#ffffff' };
  describe: (rr: RiskRewardDrawing) => RiskRewardText = () => ({ target: '', stop: '', middle: '' });

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
    if (!this.chart || !this.series || s.hiddenOn.includes(this.tf) || c.future(s.drawnAt ?? Math.min(s.t1, s.t2))) return null;
    const ts = this.chart.timeScale();
    const x = (t: number) => ts.logicalToCoordinate(c.logicalOf(t) as never);
    const xa = x(s.t1);
    const xb = x(s.t2);
    if (xa === null || xb === null) return null;
    const y = (p: number) => this.series!.priceToCoordinate(p);
    const fibOn = s.kind === 'fib' ? s.levels.filter((l) => l.on).map((l) => fibPrice(s, l.value)) : [];
    const prices: Record<string, number> =
      s.kind === 'rect' || s.kind === 'trend'
        ? { p1: s.p1, p2: s.p2 }
        : s.kind === 'fib'
          ? { p1: s.p1, p2: s.p2, lo: Math.min(s.p1, s.p2, ...fibOn), hi: Math.max(s.p1, s.p2, ...fibOn) }
          : { entry: s.entry, stop: s.stop, target: s.target };
    const ys: Record<string, number> = {};
    for (const [k, p] of Object.entries(prices)) {
      const v = y(p);
      if (v === null) return null;
      ys[k] = v;
    }
    const extendRight = (s.kind === 'rect' && s.style.extendRight) || (s.kind === 'fib' && (s.style.extend === 'right' || s.style.extend === 'both'));
    const extendLeft = s.kind === 'fib' && (s.style.extend === 'left' || s.style.extend === 'both');
    return { x1: extendLeft ? 0 : Math.min(xa, xb), x2: extendRight ? ts.width() : Math.max(xa, xb), ys };
  }

  /** The shape and handle under a point, topmost first. */
  shapeAt(x: number, y: number): { shape: Shape; part: ShapePart } | null {
    const c = this.coords();
    const near = (hx: number, hy: number) => Math.hypot(x - hx, y - hy) <= HANDLE + 3;
    for (const s of [...this.list].reverse()) {
      const b = this.box(s, c);
      if (!b) continue;
      const ts = this.chart!.timeScale();
      const xt1 = ts.logicalToCoordinate(c.logicalOf(s.t1) as never)!;
      const xt2 = ts.logicalToCoordinate(c.logicalOf(s.t2) as never)!;
      if (s.kind === 'trend') {
        if (s.id === this.selected) {
          if (near(xt1, b.ys.p1!)) return { shape: s, part: 'a' };
          if (near(xt2, b.ys.p2!)) return { shape: s, part: 'b' };
        }
        const [ax, ay, bx, by] = this.trendEnds(s, xt1, b.ys.p1!, xt2, b.ys.p2!);
        if (distToSegment(x, y, ax, ay, bx, by) <= 5 + s.style.width / 2) return { shape: s, part: 'body' };
        continue;
      }
      if (s.kind === 'fib') {
        if (s.id === this.selected) {
          if (near(xt1, b.ys.p1!)) return { shape: s, part: 'a' };
          if (near(xt2, b.ys.p2!)) return { shape: s, part: 'b' };
        }
        // Screen y grows downwards: "hi" (the highest price) is the top.
        if (x >= Math.min(xt1, xt2) - 3 && x <= Math.max(xt1, xt2) + 3 && y >= b.ys.hi! - 3 && y <= b.ys.lo! + 3) return { shape: s, part: 'body' };
      } else if (s.kind === 'rect') {
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

  /** The stop and target prices of each long/short tool as red and green tags on the price axis. */
  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    const series = this.series;
    if (!series) return [];
    const c = this.coords();
    const tag = (price: number, colour: string): ISeriesPrimitiveAxisView => ({
      coordinate: () => series.priceToCoordinate(price) ?? -100,
      text: () => series.priceFormatter().format(price),
      textColor: () => '#ffffff',
      backColor: () => colour,
      visible: () => true,
      tickVisible: () => true,
    });
    const trendTags = this.list.filter((s): s is TrendDrawing => s.kind === 'trend' && s.style.priceLabels && !!this.box(s, c)).flatMap((s) => [tag(s.p1, s.style.color), tag(s.p2, s.style.color)]);
    return trendTags.concat(
      this.list
        .filter((s): s is RiskRewardDrawing => (s.kind === 'long' || s.kind === 'short') && !!this.box(s, c))
        .flatMap((s) => [tag(s.stop, this.colours.loss), tag(s.target, this.colours.profit)]),
    );
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
      for (const s of this.list) {
        const b = this.box(s, c);
        if (!b) continue;
        const active = s.id === this.selected || s.id === this.hovered;
        const ts = this.chart!.timeScale();
        const xt1 = ts.logicalToCoordinate(c.logicalOf(s.t1) as never)!;
        const xt2 = ts.logicalToCoordinate(c.logicalOf(s.t2) as never)!;
        if (s.kind === 'rect') this.drawRect(ctx, s, b, hr, vr, text);
        else if (s.kind === 'fib') this.drawFib(ctx, s, b, xt1, xt2, hr, vr, text);
        else if (s.kind === 'trend') this.drawTrend(ctx, s, b, xt1, xt2, hr, vr, active, c);
        else this.drawRiskReward(ctx, s, b, hr, vr, text);
        if (s.id === this.selected) {
          if (s.kind === 'fib' || s.kind === 'trend') {
            handle(xt1, b.ys.p1!, '#2962ff');
            handle(xt2, b.ys.p2!, '#2962ff');
          } else if (s.kind === 'rect') {
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

  /** A trend line's drawn ends: its two points, or past them to the chart's edge when extended. */
  trendEnds(s: TrendDrawing, x1: number, y1: number, x2: number, y2: number): [number, number, number, number] {
    if (x1 === x2 || s.style.extend === 'none') return [x1, y1, x2, y2];
    const w = this.chart!.timeScale().width();
    const at = (x: number) => y1 + ((y2 - y1) * (x - x1)) / (x2 - x1);
    let [ax, ay, bx, by] = [x1, y1, x2, y2];
    if (s.style.extend === 'left' || s.style.extend === 'both') {
      ax = x1 < x2 ? 0 : w;
      ay = at(ax);
    }
    if (s.style.extend === 'right' || s.style.extend === 'both') {
      bx = x2 > x1 ? w : 0;
      by = at(bx);
    }
    return [ax, ay, bx, by];
  }

  private drawTrend(
    ctx: CanvasRenderingContext2D,
    s: TrendDrawing,
    b: { x1: number; x2: number; ys: Record<string, number> },
    xt1: number,
    xt2: number,
    hr: number,
    vr: number,
    active: boolean,
    c: ChartCoords,
  ) {
    const st = s.style;
    const y1 = b.ys.p1!;
    const y2 = b.ys.p2!;
    const [ax, ay, bx, by] = this.trendEnds(s, xt1, y1, xt2, y2);
    const lw = Math.max(1, Math.round(st.width * hr));
    ctx.strokeStyle = st.color;
    ctx.fillStyle = st.color;
    ctx.lineWidth = lw;
    ctx.setLineDash(st.dash === 'dashed' ? [6 * hr, 4 * hr] : st.dash === 'dotted' ? [lw, 3 * hr] : []);
    ctx.beginPath();
    ctx.moveTo(ax * hr, ay * vr);
    ctx.lineTo(bx * hr, by * vr);
    ctx.stroke();
    ctx.setLineDash([]);
    // Arrowheads at the two points, pointing away from the line.
    const arrow = (tipX: number, tipY: number, fromX: number, fromY: number) => {
      const ang = Math.atan2((tipY - fromY) * vr, (tipX - fromX) * hr);
      const len = (7 + st.width * 2) * hr;
      ctx.beginPath();
      ctx.moveTo(tipX * hr, tipY * vr);
      ctx.lineTo(tipX * hr - len * Math.cos(ang - 0.45), tipY * vr - len * Math.sin(ang - 0.45));
      ctx.lineTo(tipX * hr - len * Math.cos(ang + 0.45), tipY * vr - len * Math.sin(ang + 0.45));
      ctx.closePath();
      ctx.fill();
    };
    if (st.startCap === 'arrow') arrow(xt1, y1, xt2, y2);
    if (st.endCap === 'arrow') arrow(xt2, y2, xt1, y1);
    if (st.middlePoint) {
      ctx.beginPath();
      ctx.arc(((xt1 + xt2) / 2) * hr, ((y1 + y2) / 2) * vr, 3 * hr, 0, Math.PI * 2);
      ctx.fill();
    }
    // Label along the line, kept upright.
    const label = s.label.text.trim();
    if (label) {
      const f = s.label.align === 'left' ? 0.08 : s.label.align === 'right' ? 0.92 : 0.5;
      let ang = Math.atan2((y2 - y1) * vr, (xt2 - xt1) * hr);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      ctx.save();
      ctx.translate((xt1 + (xt2 - xt1) * f) * hr, (y1 + (y2 - y1) * f) * vr);
      ctx.rotate(ang);
      ctx.font = `${s.label.bold ? '600 ' : ''}${s.label.size * vr}px Geist, system-ui, sans-serif`;
      ctx.fillStyle = s.label.color ?? st.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = s.label.place === 'below' ? 'top' : s.label.place === 'middle' ? 'middle' : 'bottom';
      ctx.fillText(label, 0, s.label.place === 'below' ? 4 * vr : s.label.place === 'middle' ? 0 : -4 * vr);
      ctx.restore();
    }
    // Stats box: shown all the time, or only while selected / under the mouse.
    if (!st.stats.length || !(st.alwaysStats || active)) return;
    const series = this.series!;
    const diff = s.p2 - s.p1;
    const sign = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '');
    const lines: string[] = [];
    const first = [
      st.stats.includes('priceRange') ? `${sign(diff)}${series.priceFormatter().format(Math.abs(diff))}` : '',
      st.stats.includes('percent') ? `(${sign(diff)}${Math.abs((diff / s.p1) * 100).toFixed(2)}%)` : '',
      st.stats.includes('ticks') ? `${sign(diff)}${Math.round(Math.abs(diff) / this.tickSize)} ticks` : '',
    ].filter(Boolean);
    if (first.length) lines.push(first.join(' '));
    const bars = Math.round(c.logicalOf(s.t2) - c.logicalOf(s.t1));
    const secs = Math.abs(s.t2 - s.t1);
    const d = Math.floor(secs / 86_400);
    const h = Math.floor((secs % 86_400) / 3600);
    const span = [d ? `${d}d` : '', h ? `${h}h` : '', `${Math.floor((secs % 3600) / 60)}m`].filter(Boolean).join(' ');
    const second = [st.stats.includes('bars') ? `${bars} bars` : '', st.stats.includes('dateRange') ? span : ''].filter(Boolean);
    if (second.length) lines.push(second.join(', '));
    if (st.stats.includes('angle')) lines.push(`∠ ${(-Math.atan2(y2 - y1, xt2 - xt1) * (180 / Math.PI)).toFixed(1)}°`);
    if (!lines.length) return;
    const size = 11;
    ctx.font = `${size * vr}px Geist, system-ui, sans-serif`;
    const wpx = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12 * hr;
    const hpx = (lines.length * (size + 4) + 6) * vr;
    const anchorX = st.statsPos === 'left' ? xt1 : st.statsPos === 'center' ? (xt1 + xt2) / 2 : xt2;
    const anchorY = st.statsPos === 'left' ? y1 : st.statsPos === 'center' ? (y1 + y2) / 2 : y2;
    const bxp = anchorX * hr + (st.statsPos === 'left' ? -wpx - 10 * hr : st.statsPos === 'center' ? -wpx / 2 : 10 * hr);
    const byp = anchorY * vr + 10 * vr;
    ctx.fillStyle = this.colours.background;
    ctx.strokeStyle = st.color;
    ctx.lineWidth = Math.max(1, hr);
    ctx.beginPath();
    ctx.roundRect(bxp, byp, wpx, hpx, 4 * hr);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.colours.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach((l, i) => ctx.fillText(l, bxp + 6 * hr, byp + (4 + i * (size + 4)) * vr));
  }

  private drawFib(
    ctx: CanvasRenderingContext2D,
    s: FibDrawing,
    b: { x1: number; x2: number; ys: Record<string, number> },
    xt1: number,
    xt2: number,
    hr: number,
    vr: number,
    text: (str: string, x: number, y: number, colour: string, opts?: { size?: number; bold?: boolean; align?: CanvasTextAlign; baseline?: CanvasTextBaseline }) => void,
  ) {
    const series = this.series!;
    const st = s.style;
    const levels = s.levels
      .filter((l) => l.on)
      .map((l) => ({ ...l, price: fibPrice(s, l.value), y: series.priceToCoordinate(fibPrice(s, l.value)) }))
      .filter((l): l is typeof l & { y: number } => l.y !== null)
      .sort((a, b2) => a.value - b2.value);
    const colourOf = (l: { color: string }) => st.oneColor ?? l.color;
    const x = Math.round(b.x1 * hr);
    const w = Math.round((b.x2 - b.x1) * hr);
    // Shading between neighbouring levels, in the colour of the further one.
    if (st.background)
      for (let i = 1; i < levels.length; i++) {
        const a = levels[i - 1]!;
        const l = levels[i]!;
        ctx.fillStyle = alpha(colourOf(l), st.bgOpacity);
        ctx.fillRect(x, Math.round(Math.min(a.y, l.y) * vr), w, Math.round(Math.abs(l.y - a.y) * vr));
      }
    const lw = Math.max(1, Math.round(st.lineWidth * hr));
    for (const l of levels) {
      const y = Math.round(l.y * vr) + (lw % 2 ? 0.5 : 0);
      ctx.strokeStyle = colourOf(l);
      ctx.lineWidth = lw;
      ctx.setLineDash(st.lineDash === 'dashed' ? [6 * hr, 4 * hr] : st.lineDash === 'dotted' ? [lw, 3 * hr] : []);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
      ctx.stroke();
      const parts = [
        st.showLevels === 'values' ? String(l.value) : st.showLevels === 'percent' ? `${Number((l.value * 100).toFixed(1))}%` : '',
        st.showPrices ? `(${series.priceFormatter().format(l.price)})` : '',
      ].filter(Boolean);
      if (parts.length) {
        const left = st.labelAlign === 'left';
        text(parts.join(' '), left ? b.x1 - 4 : b.x2 + 4, st.labelPlace === 'top' ? l.y - 2 : st.labelPlace === 'bottom' ? l.y + 2 : l.y, colourOf(l), {
          size: st.fontSize,
          align: left ? 'right' : 'left',
          baseline: st.labelPlace === 'top' ? 'bottom' : st.labelPlace === 'bottom' ? 'top' : 'middle',
        });
      }
    }
    ctx.setLineDash([]);
    if (st.trendLine) {
      ctx.strokeStyle = st.trendColor;
      ctx.lineWidth = Math.max(1, Math.round(hr));
      ctx.setLineDash([4 * hr, 4 * hr]);
      ctx.beginPath();
      ctx.moveTo(xt1 * hr, b.ys.p1! * vr);
      ctx.lineTo(xt2 * hr, b.ys.p2! * vr);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (s.text.trim()) text(s.text.trim(), (Math.min(xt1, xt2) + Math.max(xt1, xt2)) / 2, (b.ys.p1! + b.ys.p2!) / 2, this.colours.text, { size: st.fontSize, align: 'center' });
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
    const zone = (y1: number, y2: number, colour: string) => {
      ctx.fillStyle = alpha(colour, 0.18);
      ctx.fillRect(x, Math.round(Math.min(y1, y2) * vr), w, Math.round(Math.abs(y2 - y1) * vr));
    };
    zone(entry, target, this.colours.profit);
    zone(entry, stop, this.colours.loss);
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

/** Shortest distance from a point to a line segment (CSS pixels). */
function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
