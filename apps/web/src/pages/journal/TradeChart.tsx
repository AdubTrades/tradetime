import { Camera } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import { CandlestickSeries, createChart, createSeriesMarkers, CrosshairMode, HistogramSeries, LineStyle, TickMarkType, type IChartApi, type Time, type UTCTimestamp } from 'lightweight-charts';
import { aggregate, bucketTime, currentZone, sessionDate, timeframeSeconds, type Bar, type BacktestInstrument, type Timeframe } from '@tc/domain';
import { Button, Card, cn } from '../../components/ui';
import type { TradeDetail } from '../../lib/api';
import { dailyFile, dayFile, loadBars } from '../../lib/marketData';
import { uploadFiles } from '../../lib/upload';

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const decimals = (tick: number) => Math.max(0, (String(tick).split('.')[1] ?? '').length);
/** Bars shown before the entry and after the exit. */
const BEFORE = 60;
const AFTER = 30;

/** A sensible first timeframe: the trade spans a readable number of bars. */
function defaultTimeframe(inst: BacktestInstrument, seconds: number): Timeframe {
  if (inst.kind === 'futures' && seconds < 5 * 60) return '30s';
  if (seconds < 30 * 60) return '1m';
  if (seconds < 3 * 3600) return '5m';
  return '15m';
}

type Loaded = { kind: 'ok'; base: Bar[] } | { kind: 'missing'; range: [string, string] | null } | { kind: 'error'; message: string };

/**
 * The trade drawn on the stored price history (the backtester's data): candles around it, an arrow at each fill and
 * the stop and target. Drawn when the page opens, so it needs no storage; "Save as screenshot" adds a picture.
 */
export function TradeChart({ trade, symbol, inst }: { trade: TradeDetail; symbol: string; inst: BacktestInstrument }) {
  const opened = Date.parse(trade.openedAt) / 1000;
  const closed = Date.parse(trade.closedAt) / 1000;
  const tfs: Timeframe[] = inst.kind === 'futures' ? ['30s', '1m', '5m', '15m'] : ['1m', '5m', '15m', '1h'];
  const [tf, setTf] = useState<Timeframe>(() => defaultTimeframe(inst, closed - opened));
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const qc = useQueryClient();
  const zone = currentZone();
  const account = trade.accounts[0];

  // The trading days from the one before entry to the one of the exit.
  useEffect(() => {
    let live = true;
    (async () => {
      const daily = await loadBars(dailyFile(inst.id));
      const dates = (daily ?? []).map((b) => new Date(b.t * 1000).toISOString().slice(0, 10));
      const from = sessionDate(opened, inst.kind);
      const to = sessionDate(closed, inst.kind);
      if (!dates.includes(from)) return { kind: 'missing', range: dates.length ? [dates[0]!, dates.at(-1)!] : null } as Loaded;
      const before = [...dates].reverse().find((d) => d < from);
      const wanted = dates.filter((d) => (before ? d >= before : d >= from) && d <= to);
      const days = await Promise.all(wanted.map((d) => loadBars(dayFile(inst.id, d))));
      return { kind: 'ok', base: days.flatMap((d) => d ?? []) } as Loaded;
    })()
      .then((l) => live && setLoaded(l))
      .catch((err: Error) => live && setLoaded({ kind: 'error', message: err.message }));
    return () => {
      live = false;
    };
  }, [inst, opened, closed]);

  // Bars of the chosen timeframe around the trade.
  const bars = useMemo(() => {
    if (loaded?.kind !== 'ok') return null;
    const all = aggregate(loaded.base, tf, inst.kind);
    const first = all.findIndex((b) => b.t >= bucketTime(opened, tf, inst.kind));
    const lastAt = bucketTime(closed, tf, inst.kind);
    let last = all.findIndex((b) => b.t > lastAt);
    if (last < 0) last = all.length;
    return all.slice(Math.max(0, first - BEFORE), Math.min(all.length, last + AFTER));
  }, [loaded, tf, inst, opened, closed]);

  useEffect(() => {
    if (!el.current || !bars?.length) return;
    const up = css('--positive');
    const down = css('--negative');
    const intraday = timeframeSeconds(tf) !== null;
    const fmt = (t: Time, f: string) => DateTime.fromSeconds(t as number, { zone: intraday ? zone : 'utc' }).toFormat(f);
    const api = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: css('--bg-card') }, textColor: css('--text-muted'), fontFamily: 'Geist, system-ui, sans-serif', fontSize: 11, attributionLogo: false },
      grid: { vertLines: { color: css('--border-subtle') }, horzLines: { color: css('--border-subtle') } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: css('--border') },
      timeScale: {
        borderColor: css('--border'),
        timeVisible: true,
        secondsVisible: tf === '30s',
        tickMarkFormatter: (t: Time, type: TickMarkType) => (type === TickMarkType.DayOfMonth ? fmt(t, 'd LLL') : type <= TickMarkType.Month ? fmt(t, 'LLL yyyy') : fmt(t, 'HH:mm')),
      },
      localization: { timeFormatter: (t: Time) => fmt(t, 'ccc d LLL HH:mm:ss') },
      handleScroll: true,
      handleScale: true,
    });
    const candles = api.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      wickUpColor: up,
      wickDownColor: down,
      borderVisible: false,
      priceFormat: { type: 'price', precision: decimals(inst.tickSize), minMove: inst.tickSize },
    });
    candles.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.22 } });
    candles.setData(bars.map((b) => ({ time: b.t as UTCTimestamp, open: b.o, high: b.h, low: b.l, close: b.c })));
    const volume = api.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    api.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    volume.setData(bars.map((b) => ({ time: b.t as UTCTimestamp, value: b.v, color: `${b.c >= b.o ? up : down}55` })));
    // An arrow at each fill (base size), and the planned stop and target.
    const fills = [...(account?.fills ?? [])].sort((a, b) => a.at.localeCompare(b.at));
    createSeriesMarkers(
      candles,
      fills.map((f) => ({
        time: bucketTime(Date.parse(f.at) / 1000, tf, inst.kind) as UTCTimestamp,
        // At the fill's own price: buys point up from below it, sells down from above.
        position: f.side === 'buy' ? 'atPriceBottom' : 'atPriceTop',
        price: f.price,
        shape: f.side === 'buy' ? 'arrowUp' : 'arrowDown',
        color: f.side === 'buy' ? up : down,
        text: `${f.side === 'buy' ? 'B' : 'S'} ${f.qty / (account?.multiplier ?? 1)} @ ${f.price}`,
      })),
    );
    if (trade.stopPrice !== null) candles.createPriceLine({ price: trade.stopPrice, color: down, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Stop' });
    if (trade.targetPrice !== null) candles.createPriceLine({ price: trade.targetPrice, color: up, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Target' });
    api.timeScale().fitContent();
    chart.current = api;
    return () => {
      chart.current = null;
      api.remove();
    };
  }, [bars, tf, inst, zone, account, trade.stopPrice, trade.targetPrice]);

  /** The chart as a JPEG with a caption, added to the trade's screenshots. */
  const save = async () => {
    const api = chart.current;
    if (!api) return;
    setSaving('saving');
    try {
      const shot = api.takeScreenshot();
      const scale = Math.min(1, 1600 / shot.width);
      const w = Math.round(shot.width * scale);
      const h = Math.round(shot.height * scale);
      const ratio = w / Math.max(1, el.current?.clientWidth ?? w);
      const band = Math.round(30 * ratio);
      const out = document.createElement('canvas');
      out.width = w;
      out.height = h + band;
      const ctx = out.getContext('2d')!;
      ctx.fillStyle = css('--bg-card');
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.fillStyle = css('--text');
      ctx.font = `500 ${Math.round(12 * ratio)}px Geist, system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillText(`${symbol} ${trade.direction} · ${DateTime.fromISO(trade.openedAt, { zone }).toFormat('ccc d LLL yyyy HH:mm')} · ${tf}`, Math.round(10 * ratio), band / 2);
      ctx.drawImage(shot, 0, band, w, h);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/jpeg', 0.88));
      if (!blob) throw new Error('capture failed');
      await uploadFiles([new File([blob], `${symbol} ${DateTime.fromISO(trade.openedAt, { zone }).toFormat('yyyy-LL-dd HHmm')}.jpg`, { type: 'image/jpeg' })], {
        ownerType: 'trade',
        ownerId: trade.id,
        role: 'chart',
      });
      await qc.invalidateQueries({ queryKey: ['attachments', 'trade', trade.id] });
      setSaving('saved');
    } catch {
      setSaving('error');
    }
  };

  const message =
    loaded === null
      ? 'Loading prices…'
      : loaded.kind === 'error'
        ? `Couldn’t load the prices: ${loaded.message}`
        : loaded.kind === 'missing'
          ? loaded.range
            ? `No ${inst.id} prices for this day yet. The stored data covers ${DateTime.fromISO(loaded.range[0]).toFormat('d LLL yyyy')} to ${DateTime.fromISO(loaded.range[1]).toFormat('d LLL yyyy')}; newer days appear after the next top-up.`
            : `No ${inst.id} prices are stored yet.`
          : null;

  return (
    <Card
      title="Chart"
      description={`${inst.id} prices${symbol !== inst.id ? ` (${symbol} trades on them)` : ''}, with your fills and plan. Times in ${zone.split('/').pop()?.replace(/_/g, ' ')} time.`}
      action={
        loaded?.kind === 'ok' ? (
          <div className="flex items-center gap-2">
            <div role="tablist" aria-label="Chart timeframe" className="inline-flex rounded-md bg-tabs-track p-[3px]">
              {tfs.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={t === tf}
                  onClick={() => setTf(t)}
                  className={cn('h-7 rounded-[7px] px-2 font-mono text-[12px] font-medium', t === tf ? 'bg-card text-text shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-muted hover:text-text')}
                >
                  {t}
                </button>
              ))}
            </div>
            <Button size="sm" onClick={() => void save()} disabled={saving === 'saving'} title="Add this chart to the trade’s screenshots">
              <Camera size={14} />
              {saving === 'saved' ? 'Saved' : saving === 'saving' ? 'Saving…' : 'Save as screenshot'}
            </Button>
          </div>
        ) : undefined
      }
    >
      {message ? <p className="text-sm text-muted">{message}</p> : <div ref={el} className="h-[360px] w-full" />}
      {saving === 'error' && <p className="mt-2 text-sm text-loss">Couldn’t save the screenshot. Please try again.</p>}
    </Card>
  );
}
