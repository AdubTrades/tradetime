import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DateTime } from 'luxon';
import {
  BACKTEST_INSTRUMENTS,
  currentZone,
  findInstrument,
  isIntraday,
  replayView,
  sessionDate,
  sessionOpen,
  timeframesFor,
  zoneLabel,
  type Bar,
  type BacktestInstrument,
  type Timeframe,
} from '@tc/domain';
import { Select } from '../../components/Select';
import { Button, cn, PageHeader } from '../../components/ui';
import { dailyFile, dayFile, hourlyFile, loadAll, peekBars, useMe } from '../../lib/marketData';
import { useLines, useLineTools } from '../../lib/drawings';
import { ReplayChart } from './ReplayChart';

/** History shown behind the replay for short timeframes, in trading days of base bars. */
const BASE_DAYS: Partial<Record<Timeframe, number>> = {
  '30s': 2,
  '1m': 3,
  '2m': 4,
  '5m': 7,
  '15m': 15,
};
const SPEEDS = [1, 2, 5, 10, 25] as const;
const STEPS: { value: number; label: string }[] = [
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 300, label: '5m' },
  { value: 900, label: '15m' },
  { value: 3600, label: '1h' },
];
const STATE_KEY = 'tc-backtest';

interface Saved {
  instrument: string;
  tf: Timeframe;
  cursor: number | null;
  speed: number;
  step: number;
}

function loadSaved(): Saved {
  const fallback: Saved = {
    instrument: 'NQ',
    tf: '5m',
    cursor: null,
    speed: 5,
    step: 60,
  };
  try {
    return {
      ...fallback,
      ...(JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') as Partial<Saved>),
    };
  } catch {
    return fallback;
  }
}

/** Trading dates with data, from the instrument's daily file (labelled midnight UTC of each date). */
const datesOf = (daily: Bar[] | null | undefined) => (daily ?? []).map((b) => new Date(b.t * 1000).toISOString().slice(0, 10));

/** When a trading date's bars start: 18:00 New York the evening before for futures, midnight UTC for crypto. */
const dateStart = (inst: BacktestInstrument, date: string) => (inst.kind === 'futures' ? sessionOpen(date) : Date.parse(`${date}T00:00:00Z`) / 1000);

/** Files the chart needs at a replay moment, and how to put them together. */
function plan(inst: BacktestInstrument, tf: Timeframe, cursor: number, dates: string[]) {
  const cur = sessionDate(cursor, inst.kind);
  const upTo = dates.filter((d) => d <= cur);
  const n = BASE_DAYS[tf];
  const baseDates = n ? upTo.slice(-n) : upTo.filter((d) => d === cur);
  const nextDate = dates.find((d) => d > cur) ?? null;
  const year = Number(cur.slice(0, 4));
  const history = isIntraday(tf) ? (BASE_DAYS[tf] ? [] : [hourlyFile(inst.id, year - 1), hourlyFile(inst.id, year)]) : [dailyFile(inst.id)];
  return {
    cur,
    nextDate,
    baseFiles: baseDates.map((d) => dayFile(inst.id, d)),
    history,
    nextFile: nextDate ? dayFile(inst.id, nextDate) : null,
  };
}

export function BacktestPage() {
  const { data: me, isLoading } = useMe();
  if (isLoading) return null;
  if (!me?.backtest) return <PageHeader title="Backtesting" description="This page isn’t available on your account." />;
  return <Backtester />;
}

function Backtester() {
  const [saved] = useState(loadSaved);
  const [instrumentId, setInstrumentId] = useState(findInstrument(saved.instrument) ? saved.instrument : 'NQ');
  const inst = findInstrument(instrumentId)!;
  const tfs = timeframesFor(inst);
  const [tfPicked, setTf] = useState<Timeframe>(saved.tf);
  const tf = tfs.includes(tfPicked) ? tfPicked : '1m';
  const [cursor, setCursor] = useState<number | null>(saved.cursor);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(saved.speed);
  const [stepPicked, setStep] = useState(saved.step);
  const step = Math.max(stepPicked, inst.baseSeconds);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [daily, setDaily] = useState<Bar[] | null | undefined>(undefined);
  const [lines, setLines, linesError] = useLines(instrumentId);
  const { tools, saveTools } = useLineTools();

  useEffect(() => {
    try {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          instrument: instrumentId,
          tf,
          cursor,
          speed,
          step: stepPicked,
        } satisfies Saved),
      );
    } catch {
      // Only a convenience.
    }
  }, [instrumentId, tf, cursor, speed, stepPicked]);

  // Which dates have data.
  useEffect(() => {
    setDaily(undefined);
    let live = true;
    loadAll([dailyFile(instrumentId)])
      .then(() => live && setDaily(peekBars(dailyFile(instrumentId))))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [instrumentId]);
  const dates = useMemo(() => datesOf(daily), [daily]);

  // Start a new instrument a few days before its latest data, or keep the time if it has data then.
  useEffect(() => {
    if (!dates.length) return;
    setCursor((c) => {
      if (c !== null && sessionDate(c, inst.kind) >= dates[0]! && sessionDate(c, inst.kind) <= dates.at(-1)!) return c;
      const d = dates[Math.max(0, dates.length - 5)]!;
      return dateStart(inst, d) + 6 * 3600;
    });
  }, [dates, inst]);

  const p = useMemo(() => (cursor !== null && dates.length ? plan(inst, tf, cursor, dates) : null), [inst, tf, cursor, dates]);

  // Load what the chart needs (and the next day, so playing doesn't stall), then redraw.
  useEffect(() => {
    if (!p) return;
    const files = [...p.baseFiles, ...p.history, ...(p.nextFile ? [p.nextFile] : [])];
    if (files.every((f) => peekBars(f) !== undefined)) return;
    let live = true;
    loadAll(files)
      .then(() => live && setVersion((v) => v + 1))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [p]);

  const ready = !!p && [...p.baseFiles, ...p.history].every((f) => peekBars(f) !== undefined);
  const bars = useMemo(() => {
    if (!p || !ready || cursor === null) return null;
    const base = p.baseFiles.flatMap((f) => peekBars(f) ?? []);
    const history = p.history.flatMap((f) => peekBars(f) ?? []);
    return replayView({
      tf,
      kind: inst.kind,
      cursor,
      baseSeconds: inst.baseSeconds,
      base,
      history,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, ready, version, cursor, tf, inst]);

  /** The next replay moment: one step on, skipping closed markets (nights, weekends) straight to the next bar. */
  const advance = useCallback(
    (c: number): number | 'wait' | 'end' => {
      const pl = plan(inst, tf, c, dates);
      const today = peekBars(dayFile(inst.id, pl.cur));
      const next = pl.nextFile ? peekBars(pl.nextFile) : null;
      if (today === undefined || next === undefined) return 'wait';
      const upcoming = [...(today ?? []), ...(next ?? [])].find((b) => b.t + inst.baseSeconds > c);
      // Nothing left today and the next day's file is missing: jump to that day's start.
      if (!upcoming) return pl.nextDate ? Math.max(c + step, dateStart(inst, pl.nextDate)) : 'end';
      const target = Math.floor(c / step) * step + step;
      return upcoming.t >= target ? upcoming.t + inst.baseSeconds : target;
    },
    [inst, tf, dates, step],
  );

  const stepForward = useCallback(() => {
    setCursor((c) => {
      if (c === null) return c;
      const n = advance(c);
      if (n === 'end') setPlaying(false);
      return typeof n === 'number' ? n : c;
    });
  }, [advance]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(stepForward, 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, stepForward]);

  const stepBack = () => setCursor((c) => (c === null ? c : Math.max(dateStart(inst, dates[0] ?? '2000-01-01'), Math.ceil(c / step) * step - step)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        setPlaying((v) => !v);
      } else if (e.key === 'ArrowRight' && e.shiftKey) {
        e.preventDefault();
        stepForward();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepForward]);

  const zone = currentZone();
  const local = cursor !== null ? DateTime.fromSeconds(cursor, { zone }) : null;

  return (
    <div className="flex h-[calc(100vh-40px)] min-h-[560px] flex-col gap-3">
      <div className="md:hidden">
        <PageHeader title="Backtesting" description="Backtesting needs a bigger screen. Open TradeTime on a computer to replay the charts." />
      </div>
      <div className="hidden flex-wrap items-center gap-3 md:flex">
        <h1 className="mr-2 text-xl font-semibold tracking-tight">Backtesting</h1>
        <Select aria-label="Instrument" value={instrumentId} onChange={(e) => (setPlaying(false), setInstrumentId(e.target.value))} size="sm" className="w-64">
          {BACKTEST_INSTRUMENTS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </Select>
        <div role="tablist" aria-label="Timeframe" className="inline-flex rounded-md bg-tabs-track p-[3px]">
          {tfs.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tf}
              onClick={() => setTf(t)}
              className={cn('h-8 rounded-[7px] px-2.5 font-mono text-[12px] font-medium', t === tf ? 'bg-card text-text shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-muted hover:text-text')}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="relative hidden min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-card md:block">
        {error ? (
          <p className="p-6 text-sm text-loss">{error}</p>
        ) : daily === null || (daily && daily.length === 0) ? (
          <div className="p-6 text-sm text-secondary">
            <p className="font-medium text-text">No price data for {inst.label.split(' · ')[0]} yet.</p>
            <p className="mt-1">
              {inst.kind === 'crypto' ? (
                <>
                  Download it with <code className="font-mono text-[13px]">pnpm --filter @tc/server market-data crypto</code>.
                </>
              ) : (
                'Futures data comes from Databento, once the API key is set up (see docs/backtesting-plan.md).'
              )}
            </p>
          </div>
        ) : (
          <ReplayChart bars={bars} tf={tf} inst={inst} lines={lines} onLinesChange={setLines} tools={tools} onToolsChange={saveTools} />
        )}
      </div>

      <div className="hidden flex-wrap items-center gap-3 md:flex">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label="Step back" title="Step back" onClick={stepBack} disabled={cursor === null}>
            <SkipBack size={15} />
          </Button>
          <Button variant="primary" size="sm" aria-label={playing ? 'Pause' : 'Play'} title="Play/pause (space)" onClick={() => setPlaying((v) => !v)} disabled={!bars} className="w-20">
            {playing ? <Pause size={15} /> : <Play size={15} />}
            {playing ? 'Pause' : 'Play'}
          </Button>
          <Button variant="secondary" size="sm" aria-label="Step forward" title="Step forward (shift →)" onClick={stepForward} disabled={!bars}>
            <SkipForward size={15} />
          </Button>
        </div>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Step
          <Select aria-label="Step" value={String(step)} onChange={(e) => setStep(Number(e.target.value))} size="sm" className="w-20">
            {STEPS.filter((s) => s.value >= inst.baseSeconds).map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 text-[13px] text-muted">
          Speed
          <Select aria-label="Speed" value={String(speed)} onChange={(e) => setSpeed(Number(e.target.value))} size="sm" className="w-24">
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s} / sec
              </option>
            ))}
          </Select>
        </label>
        <JumpTo
          key={cursor === null ? 'none' : 'set'}
          initial={local}
          min={dates[0]}
          max={dates.at(-1)}
          onJump={(date, time) => {
            setPlaying(false);
            setCursor(DateTime.fromISO(`${date}T${time}`, { zone }).toSeconds());
          }}
        />
        {linesError && <p className="text-[13px] text-loss">{linesError}</p>}
        <div className="ml-auto text-right font-mono text-[13px] text-secondary">
          {local ? local.toFormat('ccc d LLL yyyy · HH:mm:ss') : '–'}
          <span className="ml-2 font-sans text-muted">{zoneLabel()}</span>
        </div>
      </div>
    </div>
  );
}

/** Pick a date and time (in the user's zone) to replay from. */
function JumpTo({ initial, min, max, onJump }: { initial: DateTime | null; min?: string; max?: string; onJump: (date: string, time: string) => void }) {
  const [date, setDate] = useState(initial?.toISODate() ?? '');
  const [time, setTime] = useState(initial?.toFormat('HH:mm') ?? '09:00');
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (date && time) onJump(date, time);
      }}
    >
      <input type="date" aria-label="Replay date" value={date} min={min} max={max} onChange={(e) => setDate(e.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-[13px]" />
      <input type="time" aria-label="Replay time" value={time} onChange={(e) => setTime(e.target.value)} className="h-8 rounded-md border border-border bg-card px-2 font-mono text-[13px]" />
      <Button type="submit" variant="secondary" size="sm">
        Go
      </Button>
    </form>
  );
}
