import { ArrowRightFromLine, Magnet, Minus, MousePointer2, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import {
  CandlestickSeries,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  LineStyle,
  TickMarkType,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { currentZone, isIntraday, type Bar, type BacktestInstrument, type HorizontalLine, type LineTools, type Timeframe } from '@tc/domain';
import { cn } from '../../components/ui';
import { LineLayer, type DrawTool } from './LineLayer';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function palette() {
  return {
    bg: css('--bg-card'),
    text: css('--text-muted'),
    grid: css('--border-subtle'),
    border: css('--border'),
    up: css('--positive'),
    down: css('--negative'),
    crosshair: css('--text-faint'),
  };
}

const decimals = (tick: number) => Math.max(0, (String(tick).split('.')[1] ?? '').length);

const MAGNET_KEY = 'tc-backtest-magnet';

/** A trading level on the chart: a position's entry, stop or target, or a working order. */
export interface ChartPriceLine {
  price: number;
  kind: 'entry' | 'stop' | 'target' | 'order';
  title: string;
  /** A working order's bracket: shown lighter. */
  faint?: boolean;
  /** Set when the line can be dragged to a new price. */
  drag?: LevelRef;
}
/** What a draggable level belongs to. */
export interface LevelRef {
  what: 'stop' | 'target' | 'order';
  owner: 'position' | 'order';
  id: string;
}
/** A fill, on the bar it happened in. */
export interface ChartMarker {
  time: number;
  side: 'buy' | 'sell';
  text: string;
}

/** A TradingView-style candle chart with volume and drawing tools, redrawn as the replay moves. Times show in the user's zone. */
export function ReplayChart({
  bars,
  tf,
  inst,
  lines,
  onLinesChange,
  tools,
  onToolsChange,
  priceLines = [],
  markers = [],
  onLevelMove,
  describeLevel,
}: {
  bars: Bar[] | null;
  tf: Timeframe;
  inst: BacktestInstrument;
  lines: HorizontalLine[];
  onLinesChange: (lines: HorizontalLine[]) => void;
  tools: LineTools;
  onToolsChange: (tools: LineTools) => void;
  priceLines?: ChartPriceLine[];
  markers?: ChartMarker[];
  /** A level was dragged to a new price. */
  onLevelMove?: (ref: LevelRef, price: number) => void;
  /** The label while dragging, e.g. "SL −$300.00". */
  describeLevel?: (ref: LevelRef, price: number) => string;
}) {
  const [ready, setReady] = useState<{ chart: IChartApi; series: ISeriesApi<'Candlestick'>; host: HTMLDivElement } | null>(null);
  const [tool, setTool] = useState<DrawTool>('cursor');
  const [magnet, setMagnet] = useState(() => {
    try {
      return localStorage.getItem(MAGNET_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [background, setBackground] = useState(() => palette().bg);
  const levelLines = useRef<IPriceLine[]>([]);
  const fillMarkers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const el = useRef<HTMLDivElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const levels = useRef({ priceLines, onLevelMove, describeLevel, tool });
  levels.current = { priceLines, onLevelMove, describeLevel, tool };
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volume = useRef<ISeriesApi<'Histogram'> | null>(null);
  const shown = useRef<{ key: string; first: number; count: number } | null>(null);
  const [legend, setLegend] = useState<Bar | null>(null);
  const intraday = isIntraday(tf);
  const intradayRef = useRef(intraday);
  intradayRef.current = intraday;

  useEffect(() => {
    const c = palette();
    const zone = currentZone();
    // Intraday bars are real moments (shown in the user's zone); daily and up are labelled by their UTC date.
    const fmt = (t: Time, f: string) =>
      DateTime.fromSeconds(t as number, {
        zone: intradayRef.current ? zone : 'utc',
      }).toFormat(f);
    const api = createChart(el.current!, {
      autoSize: true,
      layout: {
        background: { color: c.bg },
        textColor: c.text,
        fontFamily: 'Geist, system-ui, sans-serif',
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: c.crosshair, labelBackgroundColor: c.text },
        horzLine: { color: c.crosshair, labelBackgroundColor: c.text },
      },
      rightPriceScale: { borderColor: c.border },
      timeScale: {
        borderColor: c.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12,
        tickMarkFormatter: (t: Time, type: TickMarkType) =>
          type === TickMarkType.Year
            ? fmt(t, 'yyyy')
            : type === TickMarkType.Month
              ? fmt(t, 'LLL')
              : type === TickMarkType.DayOfMonth
                ? fmt(t, 'd')
                : type === TickMarkType.TimeWithSeconds
                  ? fmt(t, 'HH:mm:ss')
                  : fmt(t, 'HH:mm'),
      },
      localization: {
        timeFormatter: (t: Time) => fmt(t, intradayRef.current ? 'ccc d LLL yy  HH:mm:ss' : 'ccc d LLL yy'),
      },
    });
    candles.current = api.addSeries(CandlestickSeries, {
      upColor: c.up,
      downColor: c.down,
      wickUpColor: c.up,
      wickDownColor: c.down,
      borderVisible: false,
    });
    candles.current.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    volume.current = api.addSeries(HistogramSeries, {
      priceScaleId: 'vol',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    api.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    api.subscribeCrosshairMove((param) => {
      const d = param.seriesData.get(candles.current!) as
        | {
            time: number;
            open: number;
            high: number;
            low: number;
            close: number;
          }
        | undefined;
      setLegend(d ? { t: d.time, o: d.open, h: d.high, l: d.low, c: d.close, v: 0 } : null);
    });
    chart.current = api;
    fillMarkers.current = createSeriesMarkers(candles.current, []);
    setReady({ chart: api, series: candles.current, host: el.current! });

    // Follow light/dark changes.
    const observer = new MutationObserver(() => {
      const p = palette();
      api.applyOptions({
        layout: { background: { color: p.bg }, textColor: p.text },
        grid: { vertLines: { color: p.grid }, horzLines: { color: p.grid } },
        rightPriceScale: { borderColor: p.border },
        timeScale: { borderColor: p.border },
      });
      candles.current?.applyOptions({
        upColor: p.up,
        downColor: p.down,
        wickUpColor: p.up,
        wickDownColor: p.down,
      });
      shown.current = null; // volume colours are per bar: redraw
      setBackground(p.bg);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => {
      observer.disconnect();
      setReady(null);
      levelLines.current = [];
      fillMarkers.current = null;
      api.remove();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    candles.current?.applyOptions({
      priceFormat: {
        type: 'price',
        precision: decimals(inst.tickSize),
        minMove: inst.tickSize,
      },
    });
    chart.current?.applyOptions({
      timeScale: { secondsVisible: tf === '30s' },
    });
  }, [inst, tf]);

  useEffect(() => {
    if (!bars || !candles.current || !volume.current) return;
    const p = palette();
    const candle = (b: Bar) => ({
      time: b.t as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    });
    const vol = (b: Bar) => ({
      time: b.t as UTCTimestamp,
      value: b.v,
      color: `${b.c >= b.o ? p.up : p.down}55`,
    });
    const key = `${inst.id}/${tf}`;
    const prev = shown.current;
    const last = bars.at(-1);
    // Each replay step only changes the last bar or adds one, so update in place instead of redrawing everything.
    if (prev && prev.key === key && last && bars[0]?.t === prev.first && bars.length - prev.count <= 1 && bars.length >= prev.count) {
      for (const b of bars.slice(Math.max(0, prev.count - 1))) {
        candles.current.update(candle(b));
        volume.current.update(vol(b));
      }
    } else {
      candles.current.setData(bars.map(candle));
      volume.current.setData(bars.map(vol));
      if (!prev || prev.key !== key) chart.current?.timeScale().scrollToRealTime();
    }
    shown.current = { key, first: bars[0]?.t ?? 0, count: bars.length };
  }, [bars, inst, tf]);

  // Trading levels: redrawn whenever they change (there are only a handful).
  useEffect(() => {
    const series = candles.current;
    if (!series) return;
    for (const l of levelLines.current) series.removePriceLine(l);
    const p = palette();
    const colour = { entry: css('--text-secondary'), stop: p.down, target: p.up, order: '#2962ff' };
    levelLines.current = priceLines.map((l) =>
      series.createPriceLine({
        price: l.price,
        color: l.faint ? `${colour[l.kind]}88` : colour[l.kind],
        lineWidth: 1,
        lineStyle: l.kind === 'entry' ? LineStyle.Solid : LineStyle.Dashed,
        axisLabelVisible: true,
        title: l.title,
      }),
    );
  }, [priceLines, background]);

  useEffect(() => {
    const p = palette();
    fillMarkers.current?.setMarkers(
      markers.map((m) => ({
        time: m.time as UTCTimestamp,
        position: m.side === 'buy' ? 'belowBar' : 'aboveBar',
        shape: m.side === 'buy' ? 'arrowUp' : 'arrowDown',
        color: m.side === 'buy' ? p.up : p.down,
        text: m.text,
      })),
    );
  }, [markers, background]);

  // Drag stops, targets and working orders. Listening on the wrapper (capture) runs before the drawing layer and the
  // chart, so grabbing a level never moves a drawn line or pans the chart.
  useEffect(() => {
    const box = wrap.current;
    if (!ready || !box) return;
    const { chart: api, series, host } = ready;
    const tick = inst.tickSize;
    const dp = Math.max(0, (String(tick).split('.')[1] ?? '').length);
    const local = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const levelAt = (x: number, y: number) => {
      if (levels.current.tool !== 'cursor' || x < 0 || x > host.clientWidth) return -1;
      let best = -1;
      let bestD = 6;
      levels.current.priceLines.forEach((l, i) => {
        if (!l.drag) return;
        const ly = series.priceToCoordinate(l.price);
        if (ly !== null && Math.abs(ly - y) < bestD) {
          best = i;
          bestD = Math.abs(ly - y);
        }
      });
      return best;
    };
    let swallow = false;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { x, y } = local(e);
      const i = levelAt(x, y);
      if (i < 0) return;
      const level = levels.current.priceLines[i]!;
      const line = levelLines.current[i];
      if (!line || !level.drag) return;
      e.preventDefault();
      e.stopPropagation();
      swallow = true;
      api.applyOptions({ handleScroll: false, handleScale: false });
      let price = level.price;
      const move = (ev: PointerEvent) => {
        const raw = series.coordinateToPrice(local(ev).y);
        if (raw === null) return;
        price = Number((Math.round(raw / tick) * tick).toFixed(dp));
        line.applyOptions({ price, title: levels.current.describeLevel?.(level.drag!, price) ?? level.title });
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        api.applyOptions({ handleScroll: true, handleScale: true });
        if (price !== level.price) levels.current.onLevelMove?.(level.drag!, price);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (swallow) {
        e.stopPropagation();
        swallow = false;
      }
    };
    const onHover = (e: PointerEvent) => {
      if (e.buttons) return;
      const { x, y } = local(e);
      if (levelAt(x, y) >= 0) box.dataset.level = '1';
      else delete box.dataset.level;
    };
    box.addEventListener('pointerdown', onDown, true);
    box.addEventListener('mousedown', onMouseDown, true);
    box.addEventListener('pointermove', onHover, true);
    return () => {
      box.removeEventListener('pointerdown', onDown, true);
      box.removeEventListener('mousedown', onMouseDown, true);
      box.removeEventListener('pointermove', onHover, true);
    };
  }, [ready, inst]);

  const show = legend ?? bars?.at(-1) ?? null;
  const dp = decimals(inst.tickSize);
  const up = show ? show.c >= show.o : true;
  const toggleMagnet = () =>
    setMagnet((m) => {
      try {
        localStorage.setItem(MAGNET_KEY, m ? '0' : '1');
      } catch {
        // Only a convenience.
      }
      return !m;
    });

  return (
    <div className="absolute inset-0 flex">
      <div role="toolbar" aria-label="Drawing tools" aria-orientation="vertical" className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-border py-2">
        <ToolButton icon={MousePointer2} label="Cursor (Esc)" active={tool === 'cursor'} onClick={() => setTool('cursor')} />
        <ToolButton icon={ArrowRightFromLine} label="Horizontal ray (Alt+J)" active={tool === 'hray'} onClick={() => setTool(tool === 'hray' ? 'cursor' : 'hray')} />
        <ToolButton icon={Minus} label="Horizontal line (Alt+H)" active={tool === 'hline'} onClick={() => setTool(tool === 'hline' ? 'cursor' : 'hline')} />
        <div className="my-1 w-6 border-t border-border" />
        <ToolButton icon={Magnet} label={magnet ? 'Magnet on: snaps to open, high, low and close' : 'Magnet off'} active={magnet} onClick={toggleMagnet} />
      </div>
      <div ref={wrap} className="group/levels relative min-w-0 flex-1">
        <div ref={el} className="absolute inset-0 group-data-[level]/levels:[&_*]:cursor-ns-resize! [&[data-cursor=crosshair]_*]:cursor-crosshair! [&[data-cursor=pointer]_*]:cursor-pointer!" />
        {ready && bars && (
          <LineLayer
            chart={ready.chart}
            series={ready.series}
            host={ready.host}
            bars={bars}
            tf={tf}
            inst={inst}
            lines={lines}
            onLinesChange={onLinesChange}
            tools={tools}
            onToolsChange={onToolsChange}
            tool={tool}
            setTool={setTool}
            magnet={magnet}
            background={background}
          />
        )}
        <div className="pointer-events-none absolute top-2.5 left-3 z-10 flex items-center gap-3 font-mono text-[12px]">
          <span className="font-sans font-semibold text-text">
            {inst.id} · {tf}
          </span>
          {show && (
            <span className={up ? 'text-profit' : 'text-loss'}>
              <span className="text-muted">O</span> {show.o.toFixed(dp)} <span className="text-muted">H</span> {show.h.toFixed(dp)} <span className="text-muted">L</span> {show.l.toFixed(dp)}{' '}
              <span className="text-muted">C</span> {show.c.toFixed(dp)}
            </span>
          )}
        </div>
        {!bars && <p className="absolute inset-0 grid place-items-center text-sm text-muted">Loading prices…</p>}
      </div>
    </div>
  );
}

function ToolButton({ icon: Icon, label, active, onClick }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn('flex h-8 w-8 items-center justify-center rounded-md transition', active ? 'bg-nav-active text-text' : 'text-muted hover:bg-hover hover:text-text')}
    >
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}
