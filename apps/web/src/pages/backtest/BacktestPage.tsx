import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import {
  BACKTEST_INSTRUMENTS,
  currentZone,
  findInstrument,
  bucketTime,
  isIntraday,
  moveOrder,
  newSimAccount,
  placeOrder,
  replayTo,
  setBracket,
  setOrderBracket,
  replayView,
  sessionDate,
  sessionOpen,
  timeframesFor,
  zoneLabel,
  type Bar,
  type BacktestInstrument,
  type Timeframe,
  type SimAccount,
  type RiskRewardDrawing,
} from '@tc/domain';
import { Link } from '@tanstack/react-router';
import { Dialog } from '../../components/Dialog';
import { MenuButton } from '../../components/Menu';
import { Select } from '../../components/Select';
import { useAccounts } from '../../lib/expenses';
import { Button, cn, PageHeader } from '../../components/ui';
import { dailyFile, dayFile, hourlyFile, loadAll, peekBars, useMe } from '../../lib/marketData';
import { useCreateSession, useDeleteSession, useDrawings, useLineTools, useSessions, useSimAccount, useUpdateSession, type BacktestSession } from '../../lib/drawings';
import { ReplayChart, type ChartMarker, type ChartPriceLine, type LevelRef } from './ReplayChart';
import { DEFAULT_START_BALANCE, OrderTicket, SimPanel, useSimSpecs } from './SimTrading';
import { riskRewardSize } from './ShapeLayer';

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
const PREFS_KEY = 'tc-backtest-prefs';
const NEW = '__new__';
const SESSION_KEY = 'tc-backtest-session';

/** Replay speed and step, remembered in this browser. */
interface Prefs {
  speed: number;
  step: number;
}

function loadPrefs(): Prefs {
  const fallback: Prefs = { speed: 5, step: 60 };
  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
  } catch {
    return fallback;
  }
}

const readLocal = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeLocal = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Only a convenience.
  }
};

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
  return <Sessions />;
}

/** Pick (or start) a session, then replay it. */
function Sessions() {
  const { data: sessions, error } = useSessions();
  const [currentId, setCurrentId] = useState(() => readLocal(SESSION_KEY));
  const [creating, setCreating] = useState(false);
  const choose = (id: string) => {
    setCurrentId(id);
    writeLocal(SESSION_KEY, id);
  };
  if (error) return <p className="text-sm text-loss">Couldn’t load your sessions: {error.message}</p>;
  if (!sessions) return null;
  const current = sessions.find((s) => s.id === currentId) ?? [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return (
    <>
      {current ? (
        <Backtester key={current.id} session={current} sessions={sessions} onSwitch={choose} onNew={() => setCreating(true)} />
      ) : (
        <div className="mx-auto mt-10 max-w-md">
          <PageHeader
            title="Backtesting"
            description="Replay the charts bar by bar and practise trades. Each session has its own instrument, balance, replay time and lines, and its trades go to your journal."
          />
          <div className="hidden md:block">
            <NewSessionForm onCreated={(s) => choose(s.id)} />
          </div>
          <p className="text-sm text-muted md:hidden">Backtesting needs a bigger screen. Open TradeTime on a computer to replay the charts.</p>
        </div>
      )}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New backtesting session">
        <NewSessionForm
          onCreated={(s) => {
            setCreating(false);
            choose(s.id);
          }}
        />
      </Dialog>
    </>
  );
}

function Backtester({ session, sessions, onSwitch, onNew }: { session: BacktestSession; sessions: BacktestSession[]; onSwitch: (id: string) => void; onNew: () => void }) {
  const [prefs] = useState(loadPrefs);
  const instrumentId = session.instrument;
  const inst = findInstrument(instrumentId)!;
  const tfs = timeframesFor(inst);
  const [tfPicked, setTf] = useState<Timeframe>(session.tf);
  const tf = tfs.includes(tfPicked) ? tfPicked : '1m';
  const [cursor, setCursor] = useState<number | null>(session.cursor);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(prefs.speed);
  const [stepPicked, setStep] = useState(prefs.step);
  const updateSession = useUpdateSession();
  const deleteSession = useDeleteSession();
  const [notice, setNotice] = useState<{ text: string; bad: boolean; journal?: boolean } | null>(null);
  const { data: accounts } = useAccounts();
  const journalName = accounts?.find((a) => a.id === session.accountId)?.name ?? 'Backtesting';
  const step = Math.max(stepPicked, inst.baseSeconds);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [daily, setDaily] = useState<Bar[] | null | undefined>(undefined);
  const { lines, shapes, setLines, setShapes, error: linesError } = useDrawings(session.id);
  const { tools, saveTools } = useLineTools();
  const [savedAccount, setAccount, simError] = useSimAccount(session.id, (r) => {
    if (r.failed.length) setNotice({ text: `Couldn’t save ${r.failed.length === 1 ? 'a trade' : `${r.failed.length} trades`} to the journal: ${r.failed[0]!.message}`, bad: true });
    else if (r.journaled) setNotice({ text: `Saved ${r.journaled === 1 ? 'the trade' : `${r.journaled} trades`} to your journal (${journalName}, needs review).`, bad: false, journal: true });
  });

  useEffect(() => writeLocal(PREFS_KEY, JSON.stringify({ speed, step: stepPicked } satisfies Prefs)), [speed, stepPicked]);

  // The session keeps its replay time and timeframe (saved once the replay settles).
  const mutateSession = updateSession.mutate;
  useEffect(() => {
    if (cursor === session.cursor && tf === session.tf) return;
    const id = setTimeout(() => mutateSession({ id: session.id, cursor, tf }), 1500);
    return () => clearTimeout(id);
  }, [cursor, tf, session.id, session.cursor, session.tf, mutateSession]);

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

  // ---------- Simulated trading ----------

  // Before the first trade on an instrument there's nothing saved: start a fresh practice account.
  const flat = !savedAccount || (savedAccount.positions.length === 0 && savedAccount.orders.length === 0);
  const account: SimAccount | null = useMemo(() => {
    if (savedAccount === undefined) return null;
    const a = savedAccount ?? newSimAccount(DEFAULT_START_BALANCE);
    // With nothing open, the replay can go anywhere: actions start from the current moment.
    return a.positions.length === 0 && a.orders.length === 0 ? { ...a, processedTo: null } : a;
  }, [savedAccount]);
  const specs = useSimSpecs(inst, account);

  /** The latest closed base bar at the cursor: its close is the price you'd trade at. */
  const last = useMemo(() => {
    if (cursor === null || !dates.length) return null;
    const cur = sessionDate(cursor, inst.kind);
    for (const d of [...dates.filter((x) => x <= cur)].reverse().slice(0, 3)) {
      const day = peekBars(dayFile(inst.id, d));
      const b = day ? [...day].reverse().find((x) => x.t + inst.baseSeconds <= cursor) : undefined;
      if (b) return b;
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, dates, inst, version]);
  const price = last?.c ?? null;

  // As the replay moves on, run the new bars through working orders, stops and targets.
  useEffect(() => {
    if (!account || flat || cursor === null || account.processedTo === null || cursor <= account.processedTo) return;
    const from = sessionDate(account.processedTo, inst.kind);
    const files = dates.filter((d) => d >= from && d <= sessionDate(cursor, inst.kind)).map((d) => dayFile(inst.id, d));
    if (files.some((f) => peekBars(f) === undefined)) {
      loadAll(files)
        .then(() => setVersion((v) => v + 1))
        .catch((err: Error) => setError(err.message));
      return;
    }
    const bars = files.flatMap((f) => peekBars(f) ?? []).filter((b) => b.t + inst.baseSeconds > account.processedTo!);
    const next = replayTo(account, specs, bars, inst.baseSeconds, cursor);
    if (next !== account) setAccount(next);
  }, [account, flat, cursor, dates, inst, specs, setAccount, version]);

  // Orders, positions and fills drawn on the chart. Stops, targets and working orders can be dragged.
  const usdAt = useCallback(
    (symbol: string, side: 'long' | 'short', qty: number, from: number, to: number) => {
      const spec = specs[symbol];
      if (!spec) return '';
      const v = (to - from) * qty * spec.pointValue * (side === 'long' ? 1 : -1);
      return `${v >= 0 ? '+' : '−'}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    },
    [specs],
  );
  const describeLevel = useCallback(
    (ref: LevelRef, at: number): string => {
      if (!account) return '';
      const tag = ref.what === 'stop' ? 'SL' : ref.what === 'target' ? 'TP' : '';
      if (ref.owner === 'position') {
        const p = account.positions.find((x) => x.id === ref.id);
        return p ? `${tag} ${usdAt(p.symbol, p.side, p.qty, p.avgEntry, at)}` : tag;
      }
      const o = account.orders.find((x) => x.id === ref.id);
      if (!o) return tag;
      if (ref.what === 'order') return `${o.side === 'buy' ? 'Buy' : 'Sell'} ${o.type} ${o.qty}`;
      return `${tag} ${usdAt(o.symbol, o.side === 'buy' ? 'long' : 'short', o.qty, o.price, at)}`;
    },
    [account, usdAt],
  );
  const priceLines = useMemo<ChartPriceLine[]>(() => {
    if (!account) return [];
    const out: ChartPriceLine[] = [];
    for (const p of account.positions) {
      out.push({ price: p.avgEntry, kind: 'entry', title: `${p.side === 'long' ? 'Long' : 'Short'} ${p.qty} ${p.symbol}` });
      for (const what of ['stop', 'target'] as const) {
        const at = p.bracket[what];
        const drag: LevelRef = { what, owner: 'position', id: p.id };
        if (at !== null) out.push({ price: at, kind: what, title: describeLevel(drag, at), drag });
      }
    }
    for (const o of account.orders) {
      const drag: LevelRef = { what: 'order', owner: 'order', id: o.id };
      out.push({ price: o.price, kind: 'order', title: describeLevel(drag, o.price), drag });
      for (const what of ['stop', 'target'] as const) {
        const at = o.bracket[what];
        const ref: LevelRef = { what, owner: 'order', id: o.id };
        if (at !== null) out.push({ price: at, kind: what, title: describeLevel(ref, at), faint: true, drag: ref });
      }
    }
    return out;
  }, [account, describeLevel]);
  const moveLevel = useCallback(
    (ref: LevelRef, at: number) => {
      if (!account) return;
      if (ref.owner === 'position') {
        const p = account.positions.find((x) => x.id === ref.id);
        if (p) setAccount(setBracket(account, p.id, { ...p.bracket, [ref.what]: at }));
      } else if (ref.what === 'order') setAccount(moveOrder(account, ref.id, at));
      else {
        const o = account.orders.find((x) => x.id === ref.id);
        if (o) setAccount(setOrderBracket(account, o.id, { ...o.bracket, [ref.what]: at }));
      }
    },
    [account, setAccount],
  );
  const markers = useMemo<ChartMarker[]>(() => {
    if (!account || !bars?.length) return [];
    const lastBar = bars.at(-1)!.t;
    const fills = [...account.trades.slice(-100).flatMap((t) => t.fills), ...account.positions.flatMap((p) => p.fills)];
    return fills
      .map((f) => ({ time: bucketTime(f.time, tf, inst.kind), side: f.side, text: `${f.side === 'buy' ? 'B' : 'S'} ${f.qty}` }))
      .filter((m) => m.time <= lastBar)
      .sort((a, b) => a.time - b.time);
  }, [account, bars, tf, inst]);

  /** A long/short tool as a working order: a limit (or stop, if price must rise/fall to it) at its entry, with its stop and target. */
  const placeFromTool = useCallback(
    (rr: RiskRewardDrawing) => {
      if (!account || price === null || cursor === null) return;
      const spec = specs[rr.symbol];
      const qty = riskRewardSize(rr, spec, inst.kind === 'crypto');
      if (!spec || qty <= 0) {
        setNotice({ text: 'That risk is too small for one contract at this stop distance.', bad: true });
        return;
      }
      const side = rr.kind === 'long' ? 'buy' : 'sell';
      const type = (side === 'buy') === rr.entry <= price ? 'limit' : 'stop';
      setAccount(placeOrder(account, { symbol: rr.symbol, type, side, qty, price: rr.entry, bracket: { stop: rr.stop, target: rr.target }, placedAt: cursor }));
      setNotice({ text: `${side === 'buy' ? 'Buy' : 'Sell'} ${type} ${qty} ${rr.symbol} @ ${rr.entry} placed, with its stop and target.`, bad: false });
    },
    [account, price, cursor, specs, inst, setAccount],
  );

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
        <Select
          aria-label="Session"
          value={session.id}
          onChange={(e) => {
            setPlaying(false);
            if (e.target.value === NEW) onNew();
            else onSwitch(e.target.value);
          }}
          size="sm"
          className="w-64"
        >
          {[...sessions]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} · {s.instrument}
              </option>
            ))}
          <option value={NEW}>+ New session…</option>
        </Select>
        <MenuButton
          icon
          label="Session options"
          items={[
            {
              label: 'Rename…',
              onSelect: () => {
                const name = window.prompt('Session name', session.name)?.trim();
                if (name && name !== session.name) updateSession.mutate({ id: session.id, name }, { onError: (err) => setNotice({ text: err.message, bad: true }) });
              },
            },
            {
              label: 'Delete session…',
              danger: true,
              onSelect: () => {
                if (window.confirm(`Delete “${session.name}”? Its practice account and lines go too. Trades already saved to your journal stay there.`)) deleteSession.mutate(session.id);
              },
            },
          ]}
        />
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

      <div className="hidden min-h-0 flex-1 gap-3 md:flex">
        <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-card">
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
            <ReplayChart
              bars={bars}
              tf={tf}
              inst={inst}
              lines={lines}
              shapes={shapes}
              onShapesChange={setShapes}
              specs={specs}
              onPlaceOrder={placeFromTool}
              onLinesChange={setLines}
              tools={tools}
              onToolsChange={saveTools}
              priceLines={priceLines}
              markers={markers}
              onLevelMove={moveLevel}
              describeLevel={describeLevel}
            />
          )}
        </div>
        <aside aria-label="Order ticket" className="w-72 shrink-0 overflow-y-auto rounded-lg border border-border bg-card">
          {account ? <OrderTicket inst={inst} account={account} specs={specs} price={price} time={cursor} onChange={setAccount} /> : <p className="p-3 text-[13px] text-muted">Loading…</p>}
        </aside>
      </div>

      <div className="hidden flex-wrap items-center gap-3 md:flex">
        <div className="flex items-center gap-1">
          <Button variant="secondary" size="sm" aria-label="Step back" title="Step back" onClick={stepBack} disabled={cursor === null || !flat}>
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
          disabled={!flat}
          onJump={(date, time) => {
            setPlaying(false);
            setCursor(DateTime.fromISO(`${date}T${time}`, { zone }).toSeconds());
          }}
        />
        {!flat && <p className="text-[12px] text-muted">Going back is off while you have a position or order open.</p>}
        {(linesError || simError) && <p className="text-[13px] text-loss">{linesError ?? simError}</p>}
        {notice && (
          <p className={cn('text-[13px]', notice.bad ? 'text-loss' : 'text-secondary')}>
            {notice.text}{' '}
            {notice.journal && (
              <Link to="/journal" className="link-ember">
                Open journal
              </Link>
            )}
          </p>
        )}
        <div className="ml-auto text-right font-mono text-[13px] text-secondary">
          {local ? local.toFormat('ccc d LLL yyyy · HH:mm:ss') : '–'}
          <span className="ml-2 font-sans text-muted">{zoneLabel()}</span>
        </div>
      </div>

      <div className="hidden h-56 shrink-0 overflow-hidden rounded-lg border border-border bg-card md:block">
        {account && <SimPanel inst={inst} account={account} specs={specs} price={price} time={cursor} onChange={setAccount} />}
      </div>
    </div>
  );
}

/** Pick a date and time (in the user's zone) to replay from. */
function JumpTo({ initial, min, max, disabled, onJump }: { initial: DateTime | null; min?: string; max?: string; disabled?: boolean; onJump: (date: string, time: string) => void }) {
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
      <Button type="submit" variant="secondary" size="sm" disabled={disabled}>
        Go
      </Button>
    </form>
  );
}

/** Name, instrument, start time, balance and journal account for a new session. */
function NewSessionForm({ onCreated }: { onCreated: (s: BacktestSession) => void }) {
  const create = useCreateSession();
  const { data: accounts } = useAccounts();
  const [instrument, setInstrument] = useState('NQ');
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('09:00');
  const [balance, setBalance] = useState('50000');
  const existing = accounts?.find((a) => a.name.toLowerCase() === 'backtesting');
  const [accountId, setAccountId] = useState<string>('');
  const inst = findInstrument(instrument)!;
  const submit = () => {
    const zone = currentZone();
    create.mutate(
      {
        name: name.trim() || `${inst.id} practice`,
        instrument,
        accountId: accountId || existing?.id || null,
        startBalance: Math.max(0, Number(balance) || 0),
        cursor: date ? DateTime.fromISO(`${date}T${time}`, { zone }).toSeconds() : null,
        tf: inst.kind === 'futures' ? '1m' : '5m',
      },
      { onSuccess: onCreated },
    );
  };
  const field = 'h-10 w-full rounded-md border border-border bg-card px-3 text-sm';
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${inst.id} practice`} maxLength={60} className={field} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-[13px] font-medium">Instrument</span>
        <Select aria-label="Instrument" value={instrument} onChange={(e) => setInstrument(e.target.value)} className="w-full">
          {BACKTEST_INSTRUMENTS.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-[13px] font-medium">Start date</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[13px] font-medium">Time ({zoneLabel()})</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cn(field, 'font-mono')} />
        </label>
      </div>
      <p className="-mt-2 text-[12px] text-muted">Leave the date empty to start a few days before the latest data.</p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-[13px] font-medium">Starting balance ($)</span>
          <input type="number" min={0} value={balance} onChange={(e) => setBalance(e.target.value)} className={cn(field, 'font-mono')} />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[13px] font-medium">Journal account</span>
          <Select aria-label="Journal account" value={accountId || existing?.id || ''} onChange={(e) => setAccountId(e.target.value)} className="w-full">
            {!existing && <option value="">Backtesting (new)</option>}
            {(accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {create.error && <p className="text-[13px] text-loss">{create.error.message}</p>}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" disabled={create.isPending}>
          Start session
        </Button>
      </div>
    </form>
  );
}
