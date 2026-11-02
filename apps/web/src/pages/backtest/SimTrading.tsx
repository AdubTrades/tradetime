import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import {
  breakeven,
  cancelOrder,
  closePosition,
  currentZone,
  findFutures,
  marketOrder,
  newSimAccount,
  placeOrder,
  setBracket,
  sizeForRisk,
  summariseSim,
  type BacktestInstrument,
  type Bracket,
  type OrderSide,
  type SimAccount,
  type SimSpec,
} from '@tc/domain';
import { Select } from '../../components/Select';
import { Button, cn, SegmentedTabs } from '../../components/ui';
import { useContracts } from '../../lib/journal';

export const DEFAULT_START_BALANCE = 50_000;
const CRYPTO_STEP = 0.0001;

const usd = (n: number, signed = false) => `${signed && n > 0 ? '+' : ''}${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const decimals = (tick: number) => Math.max(0, (String(tick).split('.')[1] ?? '').length);
const roundTo = (v: number, tick: number) => Number((Math.round(v / tick) * tick).toFixed(decimals(tick)));

/** How each contract on this chart trades: CME point values with your own fees per side, or spot crypto by the coin. */
export function useSimSpecs(inst: BacktestInstrument, account: SimAccount | null | undefined): Record<string, SimSpec> {
  const { data: contracts } = useContracts();
  return useMemo(() => {
    const out: Record<string, SimSpec> = {};
    for (const symbol of inst.trades) {
      if (inst.kind === 'crypto') {
        out[symbol] = { symbol, pointValue: 1, feePerSide: 0, feeRate: account?.fees.cryptoRate ?? 0.001 };
        continue;
      }
      const mine = contracts?.find((c) => c.symbol === symbol && !c.archived);
      const cat = findFutures(symbol);
      out[symbol] = { symbol, pointValue: (mine?.pointValueCents ?? cat?.pointValueCents ?? 100) / 100, feePerSide: (mine?.feePerSideCents ?? 0) / 100, feeRate: 0 };
    }
    return out;
  }, [inst, contracts, account?.fees.cryptoRate]);
}

type Kind = 'market' | 'limit' | 'stop';

/**
 * The order ticket: buy or sell, market / limit / stop, size in contracts (or coins) or from a dollar risk, and an
 * optional stop loss and target in points from the entry.
 */
export function OrderTicket({
  inst,
  account,
  specs,
  price,
  time,
  onChange,
  side,
  onSideChange,
  onPlaced,
}: {
  inst: BacktestInstrument;
  account: SimAccount;
  specs: Record<string, SimSpec>;
  price: number | null;
  time: number | null;
  onChange: (a: SimAccount) => void;
  /** Buy or sell, chosen with the Buy / Sell buttons that open the ticket. */
  side: OrderSide;
  onSideChange: (side: OrderSide) => void;
  /** The order went in (the ticket closes). */
  onPlaced?: () => void;
}) {
  const [symbol, setSymbol] = useState(inst.trades.at(-1)!);
  const setSide = onSideChange;
  const [kind, setKind] = useState<Kind>('market');
  const [orderPrice, setOrderPrice] = useState('');
  const [sizeMode, setSizeMode] = useState<'qty' | 'risk'>('qty');
  const [qty, setQty] = useState(inst.kind === 'crypto' ? '0.01' : '1');
  const [risk, setRisk] = useState('200');
  const [useStop, setUseStop] = useState(true);
  const [stopPts, setStopPts] = useState('');
  const [useTarget, setUseTarget] = useState(true);
  const [targetPts, setTargetPts] = useState('');

  useEffect(() => {
    setSymbol(inst.trades.at(-1)!);
    setQty(inst.kind === 'crypto' ? '0.01' : '1');
    setStopPts('');
    setTargetPts('');
  }, [inst]);

  const spec = specs[symbol];
  const dp = decimals(inst.tickSize);
  const entry = kind === 'market' ? price : Number(orderPrice) ? roundTo(Number(orderPrice), inst.tickSize) : null;
  const dir = side === 'buy' ? 1 : -1;
  const stop = useStop && entry && Number(stopPts) > 0 ? roundTo(entry - dir * Number(stopPts), inst.tickSize) : null;
  const target = useTarget && entry && Number(targetPts) > 0 ? roundTo(entry + dir * Number(targetPts), inst.tickSize) : null;
  const size = sizeMode === 'qty' ? Number(qty) || 0 : entry && stop && spec ? sizeForRisk(Number(risk), entry, stop, spec.pointValue, inst.kind === 'crypto' ? CRYPTO_STEP : 1) : 0;
  const riskUsd = entry && stop && spec ? Math.abs(entry - stop) * size * spec.pointValue : null;
  const rewardUsd = entry && target && spec ? Math.abs(target - entry) * size * spec.pointValue : null;
  const wholeOnly = inst.kind === 'futures' && !Number.isInteger(size);
  const problem =
    price === null || time === null
      ? 'Waiting for prices'
      : size <= 0
        ? sizeMode === 'risk' && !stop
          ? 'Set a stop loss to size by risk'
          : 'Size is too small'
        : wholeOnly
          ? 'Futures trade in whole contracts'
          : kind !== 'market' && !entry
            ? 'Set the order price'
            : null;

  const submit = () => {
    if (problem || !spec || price === null || time === null || !entry) return;
    const bracket: Bracket = { stop, target };
    if (kind === 'market') onChange(marketOrder(account, spec, side, size, price, time, bracket));
    else onChange(placeOrder(account, { symbol, type: kind, side, qty: size, price: entry, bracket, placedAt: time }));
    onPlaced?.();
  };

  const label = `${side === 'buy' ? 'Buy' : 'Sell'} ${size > 0 ? size : ''} ${symbol}${kind === 'market' ? ' at market' : ` ${kind} @ ${entry?.toFixed(dp) ?? '–'}`}`;

  return (
    <div className="flex flex-col gap-3 p-3 text-[13px]">
      <div className="grid grid-cols-2 gap-1 rounded-md bg-tabs-track p-[3px]">
        {(['buy', 'sell'] as const).map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={side === s}
            onClick={() => setSide(s)}
            className={cn('h-8 rounded-[7px] font-semibold', side === s ? (s === 'buy' ? 'bg-profit text-white' : 'bg-loss text-white') : 'text-muted hover:text-text')}
          >
            {s === 'buy' ? 'Buy' : 'Sell'}
          </button>
        ))}
      </div>
      {inst.trades.length > 1 && (
        <Field label="Contract">
          <Select size="sm" aria-label="Contract" value={symbol} onChange={(e) => setSymbol(e.target.value)} className="w-full">
            {inst.trades.map((s) => (
              <option key={s} value={s}>
                {s} · ${specs[s]?.pointValue}/pt
              </option>
            ))}
          </Select>
        </Field>
      )}
      <SegmentedTabs
        label="Order type"
        value={kind}
        onChange={(k) => {
          setKind(k);
          if (k !== 'market' && price !== null && !orderPrice) setOrderPrice(price.toFixed(dp));
        }}
        options={[
          { value: 'market', label: 'Market' },
          { value: 'limit', label: 'Limit' },
          { value: 'stop', label: 'Stop' },
        ]}
        className="w-full [&>button]:flex-1"
      />
      {kind !== 'market' && (
        <Field label="Price">
          <div className="flex gap-1">
            <NumberInput aria-label="Order price" value={orderPrice} onChange={setOrderPrice} step={inst.tickSize} />
            <Button size="sm" onClick={() => price !== null && setOrderPrice(price.toFixed(dp))} title="Use the current price">
              Now
            </Button>
          </div>
        </Field>
      )}
      <Field
        label={
          <SegmentedTabs
            label="Size by"
            value={sizeMode}
            onChange={setSizeMode}
            options={[
              { value: 'qty', label: inst.kind === 'crypto' ? 'Quantity' : 'Contracts' },
              { value: 'risk', label: 'Risk $' },
            ]}
            className="[&>button]:h-6 [&>button]:px-2 [&>button]:text-[12px]"
          />
        }
      >
        {sizeMode === 'qty' ? (
          <NumberInput aria-label="Quantity" value={qty} onChange={setQty} step={inst.kind === 'crypto' ? CRYPTO_STEP : 1} />
        ) : (
          <div className="flex items-center gap-2">
            <NumberInput aria-label="Risk in dollars" value={risk} onChange={setRisk} step={10} />
            <span className="shrink-0 text-muted">= {size || 0}</span>
          </div>
        )}
      </Field>
      <BracketField label="Stop loss" on={useStop} setOn={setUseStop} points={stopPts} setPoints={setStopPts} price={stop} dp={dp} tone="loss" />
      <BracketField label="Target" on={useTarget} setOn={setUseTarget} points={targetPts} setPoints={setTargetPts} price={target} dp={dp} tone="profit" />
      <div className="space-y-0.5 rounded-md bg-inset px-3 py-2 font-mono text-[12px] text-secondary">
        <div className="flex justify-between">
          <span className="font-sans text-muted">Risk</span>
          <span className={riskUsd ? 'text-loss' : ''}>{riskUsd !== null ? usd(riskUsd) : '–'}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-sans text-muted">Reward</span>
          <span className={rewardUsd ? 'text-profit' : ''}>{rewardUsd !== null ? usd(rewardUsd) : '–'}</span>
        </div>
        <div className="flex justify-between">
          <span className="font-sans text-muted">R:R</span>
          <span>{riskUsd && rewardUsd ? `1 : ${(rewardUsd / riskUsd).toFixed(2)}` : '–'}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={!!problem}
        title={problem ?? undefined}
        className={cn('h-10 rounded-md text-sm font-semibold text-white transition disabled:opacity-40', side === 'buy' ? 'bg-profit hover:opacity-90' : 'bg-loss hover:opacity-90')}
      >
        {problem ?? label}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[12px] text-muted">{label}</div>
      {children}
    </div>
  );
}

function NumberInput({ value, onChange, step, ...rest }: { value: string; onChange: (v: string) => void; step: number; 'aria-label': string }) {
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      step={step}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-full min-w-0 rounded-md border border-border bg-card px-2 font-mono text-[13px]"
      {...rest}
    />
  );
}

function BracketField({
  label,
  on,
  setOn,
  points,
  setPoints,
  price,
  dp,
  tone,
}: {
  label: string;
  on: boolean;
  setOn: (v: boolean) => void;
  points: string;
  setPoints: (v: string) => void;
  price: number | null;
  dp: number;
  tone: 'profit' | 'loss';
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-[12px] text-muted">
        <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--text)]" />
        {label}
      </label>
      {on && (
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <NumberInput aria-label={`${label} in points`} value={points} onChange={setPoints} step={1} />
            <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[11px] text-muted">pts</span>
          </div>
          <span className={cn('w-24 shrink-0 text-right font-mono text-[12px]', price !== null && (tone === 'profit' ? 'text-profit' : 'text-loss'))}>{price !== null ? price.toFixed(dp) : '–'}</span>
        </div>
      )}
    </div>
  );
}

type PanelTab = 'positions' | 'orders' | 'history';

/** Balance and the Positions, Orders and History tabs under the chart. */
export function SimPanel({
  inst,
  account,
  specs,
  price,
  time,
  onChange,
  collapsed = false,
  onToggleCollapsed,
}: {
  inst: BacktestInstrument;
  account: SimAccount;
  specs: Record<string, SimSpec>;
  price: number | null;
  time: number | null;
  onChange: (a: SimAccount) => void;
  /** Collapsed: just the tabs and balance row, so the chart gets the room. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}) {
  const [tab, setTab] = useState<PanelTab>('positions');
  const [settings, setSettings] = useState(false);
  const marks = useMemo(() => (price === null ? {} : Object.fromEntries(inst.trades.map((s) => [s, price]))), [inst, price]);
  const sum = summariseSim(account, specs, marks);
  const dp = decimals(inst.tickSize);
  const zone = currentZone();
  const when = (t: number) => DateTime.fromSeconds(t, { zone }).toFormat('d LLL HH:mm');
  const pnlClass = (n: number) => (n > 0 ? 'text-profit' : n < 0 ? 'text-loss' : '');

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-3 py-2 text-[12px]">
        <SegmentedTabs
          label="Trading"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'positions', label: `Positions${account.positions.length ? ` (${account.positions.length})` : ''}` },
            { value: 'orders', label: `Orders${account.orders.length ? ` (${account.orders.length})` : ''}` },
            { value: 'history', label: `History${account.trades.length ? ` (${account.trades.length})` : ''}` },
          ]}
        />
        <Stat label="Balance" value={usd(sum.balance)} />
        <Stat label="Open P&L" value={usd(sum.openPnl, true)} className={pnlClass(sum.openPnl)} />
        <Stat label="Realised" value={usd(sum.realised, true)} className={pnlClass(sum.realised)} />
        <Stat label="Trades" value={String(sum.trades)} />
        <Stat label="Win rate" value={sum.winRate === null ? '–' : `${Math.round(sum.winRate * 100)}%`} />
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSettings((s) => !s)}>
          Account settings
        </Button>
        {onToggleCollapsed && (
          <Button size="sm" variant="ghost" onClick={onToggleCollapsed} aria-label={collapsed ? 'Show the trading panel' : 'Hide the trading panel'} title={collapsed ? 'Show' : 'Hide'}>
            {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </Button>
        )}
      </div>
      {settings && <AccountSettings inst={inst} account={account} onChange={onChange} onClose={() => setSettings(false)} />}
      <div className={cn('min-h-0 flex-1 overflow-auto', collapsed && 'hidden')}>
        {tab === 'positions' &&
          (account.positions.length === 0 ? (
            <Empty>No open positions.</Empty>
          ) : (
            <Table head={['Contract', 'Side', 'Size', 'Entry', 'Price', 'Open P&L', 'Stop loss', 'Target', '']}>
              {account.positions.map((p) => {
                const spec = specs[p.symbol];
                const open = spec && price !== null ? p.realised + (price - p.avgEntry) * p.qty * spec.pointValue * (p.side === 'long' ? 1 : -1) : 0;
                return (
                  <tr key={p.id} className="border-t border-border-subtle">
                    <td className="px-3 py-1.5 font-medium">{p.symbol}</td>
                    <td className={cn('px-3', p.side === 'long' ? 'text-profit' : 'text-loss')}>{p.side === 'long' ? 'Long' : 'Short'}</td>
                    <td className="px-3 font-mono">{p.qty}</td>
                    <td className="px-3 font-mono">{p.avgEntry.toFixed(dp)}</td>
                    <td className="px-3 font-mono">{price?.toFixed(dp) ?? '–'}</td>
                    <td className={cn('px-3 font-mono', pnlClass(open))}>{usd(open, true)}</td>
                    <td className="px-3">
                      <PriceEdit value={p.bracket.stop} tick={inst.tickSize} label="Stop loss" onSave={(stop) => onChange(setBracket(account, p.id, { ...p.bracket, stop }))} />
                    </td>
                    <td className="px-3">
                      <PriceEdit value={p.bracket.target} tick={inst.tickSize} label="Target" onSave={(target) => onChange(setBracket(account, p.id, { ...p.bracket, target }))} />
                    </td>
                    <td className="px-3 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => onChange(breakeven(account, p.id))} title="Move the stop to the entry price">
                        Breakeven
                      </Button>
                      <Button size="sm" onClick={() => spec && price !== null && time !== null && onChange(closePosition(account, spec, p.id, price, time))} disabled={price === null}>
                        Close
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ))}
        {tab === 'orders' &&
          (account.orders.length === 0 ? (
            <Empty>No working orders.</Empty>
          ) : (
            <Table head={['Contract', 'Order', 'Size', 'Price', 'Stop loss', 'Target', 'Placed', '']}>
              {account.orders.map((o) => (
                <tr key={o.id} className="border-t border-border-subtle">
                  <td className="px-3 py-1.5 font-medium">{o.symbol}</td>
                  <td className={cn('px-3', o.side === 'buy' ? 'text-profit' : 'text-loss')}>
                    {o.side === 'buy' ? 'Buy' : 'Sell'} {o.type}
                  </td>
                  <td className="px-3 font-mono">{o.qty}</td>
                  <td className="px-3 font-mono">{o.price.toFixed(dp)}</td>
                  <td className="px-3 font-mono">{o.bracket.stop?.toFixed(dp) ?? '–'}</td>
                  <td className="px-3 font-mono">{o.bracket.target?.toFixed(dp) ?? '–'}</td>
                  <td className="px-3 font-mono text-muted">{when(o.placedAt)}</td>
                  <td className="px-3 text-right">
                    <Button size="sm" onClick={() => onChange(cancelOrder(account, o.id))}>
                      Cancel
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          ))}
        {tab === 'history' &&
          (account.trades.length === 0 ? (
            <Empty>Closed trades show here.</Empty>
          ) : (
            <Table head={['Opened', 'Closed', 'Contract', 'Side', 'Size', 'Entry', 'Exit', 'Exit by', 'Net P&L', 'R']}>
              {[...account.trades].reverse().map((t) => (
                <tr key={t.id} className="border-t border-border-subtle">
                  <td className="px-3 py-1.5 font-mono text-muted">{when(t.openedAt)}</td>
                  <td className="px-3 font-mono text-muted">{when(t.closedAt)}</td>
                  <td className="px-3 font-medium">{t.symbol}</td>
                  <td className={cn('px-3', t.side === 'long' ? 'text-profit' : 'text-loss')}>{t.side === 'long' ? 'Long' : 'Short'}</td>
                  <td className="px-3 font-mono">{t.qty}</td>
                  <td className="px-3 font-mono">{t.avgEntry.toFixed(dp)}</td>
                  <td className="px-3 font-mono">{t.avgExit.toFixed(dp)}</td>
                  <td className="px-3">
                    <span className="inline-flex items-center gap-1">
                      {t.exitReason === 'stop' ? 'Stop' : t.exitReason === 'target' ? 'Target' : 'Manual'}
                      {t.ambiguous && (
                        <span title="This bar reached both the stop and the target (or the entry and an exit), so which came first is a guess. Check it on a smaller timeframe.">
                          <AlertTriangle size={13} className="text-warning" aria-label="Uncertain fill" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className={cn('px-3 font-mono', pnlClass(t.net))}>{usd(t.net, true)}</td>
                  <td className="px-3 font-mono">{t.r === null ? '–' : `${t.r >= 0 ? '' : '−'}${Math.abs(t.r).toFixed(2)}R`}</td>
                </tr>
              ))}
            </Table>
          ))}
      </div>
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted">{label}</span>
      <span className={cn('font-mono text-[13px] text-text', className)}>{value}</span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-4 text-[13px] text-muted">{children}</p>;
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table className="w-full text-[13px]">
      <thead className="sticky top-0 bg-card text-left text-[12px] text-muted">
        <tr>
          {head.map((h, i) => (
            <th key={i} className="px-3 py-1.5 font-normal">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

/** A price you can change in place; empty removes it. */
function PriceEdit({ value, tick, label, onSave }: { value: number | null; tick: number; label: string; onSave: (v: number | null) => void }) {
  const [text, setText] = useState(value?.toFixed(decimals(tick)) ?? '');
  useEffect(() => setText(value?.toFixed(decimals(tick)) ?? ''), [value, tick]);
  const commit = () => {
    const v = text.trim() === '' ? null : roundTo(Number(text), tick);
    if (v !== value && (v === null || Number.isFinite(v))) onSave(v);
  };
  return (
    <input
      type="number"
      aria-label={label}
      step={tick}
      value={text}
      placeholder="–"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="h-7 w-28 rounded border border-border bg-card px-1.5 font-mono text-[12px]"
    />
  );
}

function AccountSettings({ inst, account, onChange, onClose }: { inst: BacktestInstrument; account: SimAccount; onChange: (a: SimAccount) => void; onClose: () => void }) {
  const [start, setStart] = useState(String(account.startBalance));
  const [rate, setRate] = useState(String(account.fees.cryptoRate * 100));
  return (
    <div className="flex flex-wrap items-end gap-3 border-b border-border bg-inset px-3 py-2 text-[12px]">
      <label className="space-y-1">
        <span className="block text-muted">Starting balance ($)</span>
        <input type="number" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 w-32 rounded-md border border-border bg-card px-2 font-mono text-[13px]" />
      </label>
      {inst.kind === 'crypto' ? (
        <label className="space-y-1">
          <span className="block text-muted">Exchange fee per side (%)</span>
          <input type="number" step={0.01} value={rate} onChange={(e) => setRate(e.target.value)} className="h-8 w-24 rounded-md border border-border bg-card px-2 font-mono text-[13px]" />
        </label>
      ) : (
        <p className="max-w-xs pb-1.5 text-muted">Futures fees per side come from your contracts in Settings → Journal.</p>
      )}
      <Button
        size="sm"
        variant="primary"
        onClick={() => {
          onChange({ ...account, startBalance: Math.max(0, Number(start) || 0), fees: { cryptoRate: Math.min(5, Math.max(0, Number(rate) || 0)) / 100 } });
          onClose();
        }}
      >
        Save
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={() => {
          if (window.confirm('Start this practice account again? Positions, orders and the trade history here will be cleared.')) {
            onChange(newSimAccount(Math.max(0, Number(start) || DEFAULT_START_BALANCE), account.fees.cryptoRate));
            onClose();
          }
        }}
      >
        Reset account
      </Button>
    </div>
  );
}
