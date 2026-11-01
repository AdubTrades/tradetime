import { useEffect, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import { CandlestickSeries, createChart, CrosshairMode, HistogramSeries, TickMarkType, type IChartApi, type ISeriesApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import { currentZone, isIntraday, type Bar, type BacktestInstrument, type Timeframe } from '@tc/domain';

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

/** A TradingView-style candle chart with volume, redrawn as the replay moves. Times show in the user's zone. */
export function ReplayChart({ bars, tf, inst }: { bars: Bar[] | null; tf: Timeframe; inst: BacktestInstrument }) {
  const el = useRef<HTMLDivElement>(null);
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
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => {
      observer.disconnect();
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

  const show = legend ?? bars?.at(-1) ?? null;
  const dp = decimals(inst.tickSize);
  const up = show ? show.c >= show.o : true;
  return (
    <div className="absolute inset-0">
      <div ref={el} className="absolute inset-0" />
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
  );
}
