import type { Bar } from './bars';
import { newId } from './ids';

/**
 * Simulated trading on the backtesting page. One position per contract (fills net against it, like a broker), with an
 * optional bracket (stop loss and target, one cancels the other). Pending limit and stop orders, and the brackets, fill
 * from the replay's base bars (30s futures, 1m crypto) as it moves forward:
 * - Limits fill at their price, or at the bar's open if it opened through them; stops likewise (gaps fill at the open).
 * - If one bar reaches both the stop and the target, the side nearer the bar's open is taken to have filled first, and
 *   the trade is flagged as ambiguous. A bracket reached in the same bar its entry filled takes the stop if the bar
 *   reached it (we can't know the order within the bar), and is flagged too.
 * Money is in USD (floats; the journal converts to cents when trades are saved).
 */
export type OrderSide = 'buy' | 'sell';
export type PositionSide = 'long' | 'short';
export type FillReason = 'entry' | 'manual' | 'stop' | 'target';

export interface Bracket {
  stop: number | null;
  target: number | null;
}

/** How a contract trades in the simulator. */
export interface SimSpec {
  symbol: string;
  /** USD per 1.0 of price per unit (contract or coin). */
  pointValue: number;
  /** USD per unit per side (futures commission and fees). */
  feePerSide: number;
  /** Fraction of the traded value per side (crypto exchange fee). */
  feeRate: number;
}

export interface SimOrder {
  id: string;
  symbol: string;
  type: 'limit' | 'stop';
  side: OrderSide;
  qty: number;
  price: number;
  /** Applied to the position when the order fills. */
  bracket: Bracket;
  placedAt: number;
}

export interface SimFill {
  time: number;
  side: OrderSide;
  qty: number;
  price: number;
  fee: number;
  reason: FillReason;
}

export interface SimPosition {
  id: string;
  symbol: string;
  side: PositionSide;
  qty: number;
  /** Average price of what's still open. */
  avgEntry: number;
  openedAt: number;
  bracket: Bracket;
  /** The stop when the position opened, for R. */
  initialStop: number | null;
  /** The target when the position opened (the plan, for the journal). */
  initialTarget?: number | null;
  fills: SimFill[];
  /** Gross P&L already taken by partial exits. */
  realised: number;
  maxQty: number;
  ambiguous: boolean;
}

export interface SimTrade {
  id: string;
  symbol: string;
  side: PositionSide;
  /** Largest size held. */
  qty: number;
  avgEntry: number;
  avgExit: number;
  openedAt: number;
  closedAt: number;
  gross: number;
  fees: number;
  net: number;
  initialStop: number | null;
  initialTarget?: number | null;
  /** Points between the average entry and the first stop. */
  riskPoints: number | null;
  /** Gross P&L over the planned risk. */
  r: number | null;
  exitReason: FillReason;
  ambiguous: boolean;
  fills: SimFill[];
}

export interface SimAccount {
  startBalance: number;
  orders: SimOrder[];
  positions: SimPosition[];
  trades: SimTrade[];
  /** The end of the last bar processed (Unix seconds), or null before the first. */
  processedTo: number | null;
  /** Crypto exchange fee per side (fraction of traded value). Futures fees come from the contract settings. */
  fees: { cryptoRate: number };
}

export const newSimAccount = (startBalance: number, cryptoRate = 0.001): SimAccount => ({ startBalance, orders: [], positions: [], trades: [], processedTo: null, fees: { cryptoRate } });

const EPS = 1e-9;
const dirOf = (side: OrderSide): PositionSide => (side === 'buy' ? 'long' : 'short');
const sign = (side: PositionSide) => (side === 'long' ? 1 : -1);
const exitSide = (side: PositionSide): OrderSide => (side === 'long' ? 'sell' : 'buy');
export const feeFor = (spec: SimSpec, qty: number, price: number) => spec.feePerSide * qty + spec.feeRate * qty * price;
const clone = (a: SimAccount): SimAccount => structuredClone(a);

function finish(acc: SimAccount, pos: SimPosition, spec: SimSpec, time: number, reason: FillReason): void {
  const entries = pos.fills.filter((f) => dirOf(f.side) === pos.side);
  const exits = pos.fills.filter((f) => dirOf(f.side) !== pos.side);
  const wavg = (fs: SimFill[]) => fs.reduce((s, f) => s + f.price * f.qty, 0) / fs.reduce((s, f) => s + f.qty, 0);
  const avgEntry = wavg(entries);
  const fees = pos.fills.reduce((s, f) => s + f.fee, 0);
  const riskPoints = pos.initialStop !== null ? Math.abs(avgEntry - pos.initialStop) : null;
  acc.trades.push({
    id: pos.id,
    symbol: pos.symbol,
    side: pos.side,
    qty: pos.maxQty,
    avgEntry,
    avgExit: wavg(exits),
    openedAt: pos.openedAt,
    closedAt: time,
    gross: pos.realised,
    fees,
    net: pos.realised - fees,
    initialStop: pos.initialStop,
    initialTarget: pos.initialTarget ?? null,
    riskPoints,
    r: riskPoints ? pos.realised / (riskPoints * pos.maxQty * spec.pointValue) : null,
    exitReason: reason,
    ambiguous: pos.ambiguous,
    fills: pos.fills,
  });
  acc.positions = acc.positions.filter((p) => p.id !== pos.id);
}

/** Apply a fill to the account (mutates `acc`): opens, adds to, reduces, closes or flips the contract's position. */
function applyFill(acc: SimAccount, spec: SimSpec, side: OrderSide, qty: number, price: number, time: number, reason: FillReason, bracket?: Bracket): SimPosition | null {
  const pos = acc.positions.find((p) => p.symbol === spec.symbol);
  const open = (q: number): SimPosition => {
    const p: SimPosition = {
      id: newId(),
      symbol: spec.symbol,
      side: dirOf(side),
      qty: q,
      avgEntry: price,
      openedAt: time,
      bracket: bracket ?? { stop: null, target: null },
      initialStop: bracket?.stop ?? null,
      initialTarget: bracket?.target ?? null,
      fills: [{ time, side, qty: q, price, fee: feeFor(spec, q, price), reason }],
      realised: 0,
      maxQty: q,
      ambiguous: false,
    };
    acc.positions.push(p);
    return p;
  };
  if (!pos) return open(qty);
  if (pos.side === dirOf(side)) {
    pos.avgEntry = (pos.avgEntry * pos.qty + price * qty) / (pos.qty + qty);
    pos.qty += qty;
    pos.maxQty = Math.max(pos.maxQty, pos.qty);
    pos.fills.push({ time, side, qty, price, fee: feeFor(spec, qty, price), reason });
    if (bracket && (bracket.stop !== null || bracket.target !== null)) pos.bracket = bracket;
    return pos;
  }
  const closing = Math.min(qty, pos.qty);
  pos.realised += (price - pos.avgEntry) * closing * spec.pointValue * sign(pos.side);
  pos.qty -= closing;
  pos.fills.push({ time, side, qty: closing, price, fee: feeFor(spec, closing, price), reason });
  if (pos.qty <= EPS) {
    finish(acc, pos, spec, time, reason);
    const rest = qty - closing;
    return rest > EPS ? open(rest) : null;
  }
  return pos;
}

// ---------- Actions ----------

/** Buy or sell at the current price straight away. */
export function marketOrder(account: SimAccount, spec: SimSpec, side: OrderSide, qty: number, price: number, time: number, bracket?: Bracket): SimAccount {
  const acc = clone(account);
  acc.processedTo = upTo(acc.processedTo, time);
  applyFill(acc, spec, side, qty, price, time, acc.positions.some((p) => p.symbol === spec.symbol && p.side !== dirOf(side)) ? 'manual' : 'entry', bracket);
  return acc;
}

export function placeOrder(account: SimAccount, order: Omit<SimOrder, 'id'>): SimAccount {
  return { ...account, processedTo: upTo(account.processedTo, order.placedAt), orders: [...account.orders, { ...order, id: newId() }] };
}

export function cancelOrder(account: SimAccount, id: string): SimAccount {
  return { ...account, orders: account.orders.filter((o) => o.id !== id) };
}

/** Change a position's stop and target. A first stop or target added after entry becomes the plan (for R). */
export function setBracket(account: SimAccount, positionId: string, bracket: Bracket): SimAccount {
  return {
    ...account,
    positions: account.positions.map((p) =>
      p.id === positionId ? { ...p, bracket, initialStop: p.initialStop ?? bracket.stop, initialTarget: p.initialTarget ?? bracket.target } : p,
    ),
  };
}

/** Move a working order to a new price; its stop and target move with it, keeping their distances. */
export function moveOrder(account: SimAccount, orderId: string, price: number): SimAccount {
  return {
    ...account,
    orders: account.orders.map((o) => {
      if (o.id !== orderId) return o;
      const d = price - o.price;
      return { ...o, price, bracket: { stop: o.bracket.stop === null ? null : o.bracket.stop + d, target: o.bracket.target === null ? null : o.bracket.target + d } };
    }),
  };
}

export function setOrderBracket(account: SimAccount, orderId: string, bracket: Bracket): SimAccount {
  return { ...account, orders: account.orders.map((o) => (o.id === orderId ? { ...o, bracket } : o)) };
}

/** Move the stop to the average entry. */
export function breakeven(account: SimAccount, positionId: string): SimAccount {
  return { ...account, positions: account.positions.map((p) => (p.id === positionId ? { ...p, bracket: { ...p.bracket, stop: p.avgEntry } } : p)) };
}

/** Close a position (or part of it) at the current price. */
export function closePosition(account: SimAccount, spec: SimSpec, positionId: string, price: number, time: number, qty?: number): SimAccount {
  const acc = clone(account);
  acc.processedTo = upTo(acc.processedTo, time);
  const pos = acc.positions.find((p) => p.id === positionId);
  if (!pos) return account;
  applyFill(acc, spec, exitSide(pos.side), Math.min(qty ?? pos.qty, pos.qty), price, time, 'manual');
  return acc;
}

// ---------- Replay ----------

function triggered(o: SimOrder, bar: Bar): number | null {
  if (o.type === 'limit') {
    if (o.side === 'buy') return bar.l <= o.price ? Math.min(bar.o, o.price) : null;
    return bar.h >= o.price ? Math.max(bar.o, o.price) : null;
  }
  if (o.side === 'buy') return bar.h >= o.price ? Math.max(bar.o, o.price) : null;
  return bar.l <= o.price ? Math.min(bar.o, o.price) : null;
}

/** Where a bracket exits within a bar, if it does. `sameBar`: the position opened during this bar. */
function bracketExit(pos: SimPosition, bar: Bar, sameBar: boolean): { price: number; reason: 'stop' | 'target'; ambiguous: boolean } | null {
  const { stop, target } = pos.bracket;
  const long = pos.side === 'long';
  const stopHit = stop !== null && (long ? bar.l <= stop : bar.h >= stop);
  const targetHit = target !== null && (long ? bar.h >= target : bar.l <= target);
  if (!stopHit && !targetHit) return null;
  // On the entry bar the open came before the entry, so it can't be a gap fill: exits fill at their own price.
  const stopPrice = sameBar ? stop! : long ? Math.min(bar.o, stop!) : Math.max(bar.o, stop!);
  const targetPrice = sameBar ? target! : long ? Math.max(bar.o, target!) : Math.min(bar.o, target!);
  if (sameBar) return stopHit ? { price: stopPrice, reason: 'stop', ambiguous: true } : { price: targetPrice, reason: 'target', ambiguous: true };
  if (stopHit && targetHit) {
    const stopFirst = Math.abs(bar.o - stop!) <= Math.abs(target! - bar.o);
    return stopFirst ? { price: stopPrice, reason: 'stop', ambiguous: true } : { price: targetPrice, reason: 'target', ambiguous: true };
  }
  return stopHit ? { price: stopPrice, reason: 'stop', ambiguous: false } : { price: targetPrice, reason: 'target', ambiguous: false };
}

function exitBracket(acc: SimAccount, spec: SimSpec, pos: SimPosition, bar: Bar, sameBar: boolean): void {
  const exit = bracketExit(pos, bar, sameBar);
  if (!exit) return;
  if (exit.ambiguous) pos.ambiguous = true;
  applyFill(acc, spec, exitSide(pos.side), pos.qty, exit.price, bar.t, exit.reason);
}

/**
 * Run one closed base bar through the account: brackets on positions first, then pending orders (and the bracket of
 * anything they open). Bars at or before `processedTo` are skipped, so replaying the same bars twice changes nothing.
 */
export function stepBar(account: SimAccount, specs: Record<string, SimSpec>, bar: Bar, barSeconds: number): SimAccount {
  if (account.processedTo !== null && bar.t + barSeconds <= account.processedTo) return account;
  const acc = clone(account);
  acc.processedTo = bar.t + barSeconds;
  for (const pos of [...acc.positions]) {
    const spec = specs[pos.symbol];
    if (spec) exitBracket(acc, spec, pos, bar, false);
  }
  for (const order of [...acc.orders]) {
    const spec = specs[order.symbol];
    if (!spec) continue;
    const price = triggered(order, bar);
    if (price === null) continue;
    acc.orders = acc.orders.filter((o) => o.id !== order.id);
    const pos = applyFill(acc, spec, order.side, order.qty, price, bar.t, 'entry', order.bracket);
    if (pos && pos.side === dirOf(order.side)) exitBracket(acc, spec, pos, bar, true);
  }
  return acc;
}

/** Run every closed bar after the last one processed, up to `until`. */
export function replayTo(account: SimAccount, specs: Record<string, SimSpec>, bars: readonly Bar[], barSeconds: number, until: number): SimAccount {
  let acc = account;
  for (const b of bars) {
    if (b.t + barSeconds > until) break;
    acc = stepBar(acc, specs, b, barSeconds);
  }
  return acc;
}

/** Nothing before an action's moment may fill it later: bars up to then count as processed. */
const upTo = (processedTo: number | null, time: number) => Math.max(processedTo ?? time, time);

// ---------- Summary ----------

export interface SimSummary {
  balance: number;
  realised: number;
  openPnl: number;
  equity: number;
  trades: number;
  wins: number;
  winRate: number | null;
}

/** Balance from closed trades; open P&L marked at `marks` (price per contract symbol), less fees already paid. */
export function summariseSim(acc: SimAccount, specs: Record<string, SimSpec>, marks: Record<string, number>): SimSummary {
  const realised = acc.trades.reduce((s, t) => s + t.net, 0);
  let openPnl = 0;
  for (const p of acc.positions) {
    const spec = specs[p.symbol];
    const mark = marks[p.symbol];
    if (!spec || mark === undefined) continue;
    openPnl += p.realised + (mark - p.avgEntry) * p.qty * spec.pointValue * sign(p.side) - p.fills.reduce((s, f) => s + f.fee, 0);
  }
  const wins = acc.trades.filter((t) => t.net > 0).length;
  return {
    balance: acc.startBalance + realised,
    realised,
    openPnl,
    equity: acc.startBalance + realised + openPnl,
    trades: acc.trades.length,
    wins,
    winRate: acc.trades.length ? wins / acc.trades.length : null,
  };
}

/** Size for a dollar risk: whole contracts for futures, `step`-sized units for crypto. Zero if the stop is too close. */
export function sizeForRisk(riskUsd: number, entry: number, stop: number, pointValue: number, step: number): number {
  const perUnit = Math.abs(entry - stop) * pointValue;
  if (perUnit <= 0 || riskUsd <= 0) return 0;
  const units = Math.floor(riskUsd / perUnit / step + EPS) * step;
  return Number(units.toFixed(Math.max(0, -Math.floor(Math.log10(step)))));
}
