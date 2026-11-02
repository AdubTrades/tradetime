import { describe, expect, it } from 'vitest';
import type { Bar } from './bars';
import {
  addSnapshot,
  breakeven,
  cancelOrder,
  moveOrder,
  setOrderBracket,
  closePosition,
  marketOrder,
  newSimAccount,
  placeOrder,
  replayTo,
  sizeForRisk,
  stepBar,
  summariseSim,
  type SimSpec,
} from './sim';

const MNQ: SimSpec = { symbol: 'MNQ', pointValue: 2, feePerSide: 0.5, feeRate: 0 };
const BTC: SimSpec = { symbol: 'BTCUSDT', pointValue: 1, feePerSide: 0, feeRate: 0.001 };
const specs = { MNQ, BTCUSDT: BTC };
const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({ t, o, h, l, c, v: 1 });
const T = 1_800_000_000;

describe('market orders and closing', () => {
  it('opens, closes and records a trade with fees, P&L and R', () => {
    let acc = marketOrder(newSimAccount(50_000), MNQ, 'buy', 2, 21_000, T, { stop: 20_990, target: null });
    expect(acc.positions).toHaveLength(1);
    acc = closePosition(acc, MNQ, acc.positions[0]!.id, 21_015, T + 600);
    expect(acc.positions).toHaveLength(0);
    const t = acc.trades[0]!;
    // 15 points × 2 contracts × $2 = $60 gross; $0.50 × 4 contract-sides = $2 fees.
    expect(t).toMatchObject({ side: 'long', qty: 2, avgEntry: 21_000, avgExit: 21_015, gross: 60, fees: 2, net: 58, riskPoints: 10, exitReason: 'manual' });
    expect(t.r).toBeCloseTo(1.5);
    expect(summariseSim(acc, specs, {}).balance).toBe(50_058);
  });

  it('nets fills: adding averages in, an opposite order reduces, closes or flips', () => {
    let acc = marketOrder(newSimAccount(0), MNQ, 'sell', 1, 100, T);
    acc = marketOrder(acc, MNQ, 'sell', 1, 110, T + 30);
    expect(acc.positions[0]).toMatchObject({ side: 'short', qty: 2, avgEntry: 105 });
    acc = marketOrder(acc, MNQ, 'buy', 3, 95, T + 60);
    expect(acc.trades[0]).toMatchObject({ side: 'short', qty: 2, gross: 40 });
    expect(acc.positions[0]).toMatchObject({ side: 'long', qty: 1, avgEntry: 95 });
  });

  it('charges crypto fees on traded value and allows fractional sizes', () => {
    let acc = marketOrder(newSimAccount(1000), BTC, 'buy', 0.05, 80_000, T);
    acc = closePosition(acc, BTC, acc.positions[0]!.id, 81_000, T + 60);
    expect(acc.trades[0]!.gross).toBeCloseTo(50);
    expect(acc.trades[0]!.fees).toBeCloseTo(0.05 * 80_000 * 0.001 + 0.05 * 81_000 * 0.001);
  });
});

describe('pending orders', () => {
  it('fills a buy limit at its price, or at the open when the bar gaps through', () => {
    let acc = placeOrder(newSimAccount(0), { symbol: 'MNQ', type: 'limit', side: 'buy', qty: 1, price: 100, bracket: { stop: null, target: null }, placedAt: T });
    acc = stepBar(acc, specs, bar(T, 105, 106, 101, 102), 30);
    expect(acc.positions).toHaveLength(0);
    acc = stepBar(acc, specs, bar(T + 30, 102, 103, 99, 100), 30);
    expect(acc.positions[0]).toMatchObject({ avgEntry: 100, openedAt: T + 30 });

    let gap = placeOrder(newSimAccount(0), { symbol: 'MNQ', type: 'limit', side: 'buy', qty: 1, price: 100, bracket: { stop: null, target: null }, placedAt: T });
    gap = stepBar(gap, specs, bar(T, 97, 98, 96, 97), 30);
    expect(gap.positions[0]!.avgEntry).toBe(97);
  });

  it('fills a sell stop when price trades down to it', () => {
    let acc = placeOrder(newSimAccount(0), { symbol: 'MNQ', type: 'stop', side: 'sell', qty: 1, price: 95, bracket: { stop: 100, target: 85 }, placedAt: T });
    acc = stepBar(acc, specs, bar(T, 97, 98, 94, 96), 30);
    expect(acc.positions[0]).toMatchObject({ side: 'short', avgEntry: 95, bracket: { stop: 100, target: 85 }, initialStop: 100 });
    expect(acc.orders).toHaveLength(0);
  });

  it('moves with its bracket, and its bracket can be changed', () => {
    let acc = placeOrder(newSimAccount(0), { symbol: 'MNQ', type: 'limit', side: 'buy', qty: 1, price: 100, bracket: { stop: 90, target: 120 }, placedAt: T });
    acc = moveOrder(acc, acc.orders[0]!.id, 105);
    expect(acc.orders[0]).toMatchObject({ price: 105, bracket: { stop: 95, target: 125 } });
    acc = setOrderBracket(acc, acc.orders[0]!.id, { stop: 97, target: null });
    expect(acc.orders[0]!.bracket).toEqual({ stop: 97, target: null });
  });

  it('can be cancelled, and never fills on bars from before it was placed', () => {
    let acc = placeOrder(newSimAccount(0), { symbol: 'MNQ', type: 'limit', side: 'buy', qty: 1, price: 100, bracket: { stop: null, target: null }, placedAt: T + 60 });
    acc = replayTo(acc, specs, [bar(T, 99, 99, 90, 95), bar(T + 30, 95, 96, 94, 95)], 30, T + 60);
    expect(acc.positions).toHaveLength(0);
    expect(cancelOrder(acc, acc.orders[0]!.id).orders).toHaveLength(0);
  });
});

describe('brackets', () => {
  const long = () => marketOrder(newSimAccount(0), MNQ, 'buy', 1, 100, T, { stop: 90, target: 120 });

  it('takes the target, or the stop, and fills a gap at the open', () => {
    expect(stepBar(long(), specs, bar(T, 101, 121, 99, 118), 30).trades[0]).toMatchObject({ exitReason: 'target', avgExit: 120, ambiguous: false });
    expect(stepBar(long(), specs, bar(T, 101, 102, 89, 95), 30).trades[0]).toMatchObject({ exitReason: 'stop', avgExit: 90 });
    expect(stepBar(long(), specs, bar(T, 85, 87, 84, 86), 30).trades[0]).toMatchObject({ exitReason: 'stop', avgExit: 85 });
  });

  it('when a bar reaches both, takes the side nearer the open and flags the trade', () => {
    expect(stepBar(long(), specs, bar(T, 92, 121, 89, 100), 30).trades[0]).toMatchObject({ exitReason: 'stop', ambiguous: true });
    expect(stepBar(long(), specs, bar(T, 118, 121, 89, 100), 30).trades[0]).toMatchObject({ exitReason: 'target', ambiguous: true });
  });

  it('takes the stop if the entry bar also reached it, flagged', () => {
    let acc = placeOrder(newSimAccount(0), { symbol: 'MNQ', type: 'limit', side: 'buy', qty: 1, price: 100, bracket: { stop: 95, target: 110 }, placedAt: T });
    acc = stepBar(acc, specs, bar(T, 102, 111, 94, 105), 30);
    expect(acc.trades[0]).toMatchObject({ exitReason: 'stop', avgExit: 95, ambiguous: true });
  });

  it('moves the stop to breakeven', () => {
    const start = long();
    let acc = breakeven(start, start.positions[0]!.id);
    expect(acc.positions[0]!.bracket).toEqual({ stop: 100, target: 120 });
    acc = stepBar(acc, specs, bar(T, 104, 105, 99, 101), 30);
    expect(acc.trades[0]).toMatchObject({ exitReason: 'stop', gross: 0, r: 0 });
  });
});

describe('summary and sizing', () => {
  it('marks open positions and counts wins', () => {
    let acc = marketOrder(newSimAccount(1000), MNQ, 'buy', 1, 100, T);
    expect(summariseSim(acc, specs, { MNQ: 110 })).toMatchObject({ balance: 1000, openPnl: 19.5, equity: 1019.5, trades: 0, winRate: null });
    acc = closePosition(acc, MNQ, acc.positions[0]!.id, 110, T + 30);
    expect(summariseSim(acc, specs, {})).toMatchObject({ balance: 1019, trades: 1, wins: 1, winRate: 1 });
  });

  it('sizes a position from a dollar risk', () => {
    expect(sizeForRisk(200, 21_000, 20_980, 2, 1)).toBe(5); // 20 points × $2 = $40 per contract
    expect(sizeForRisk(30, 21_000, 20_980, 2, 1)).toBe(0);
    expect(sizeForRisk(100, 80_000, 79_500, 1, 0.0001)).toBe(0.2);
  });
});

describe('snapshots', () => {
  it('go to the open position, then travel with it into the closed trade', () => {
    let acc = marketOrder(newSimAccount(0), MNQ, 'buy', 1, 100, T);
    acc = addSnapshot(acc, 'att-entry')!;
    acc = closePosition(acc, MNQ, acc.positions[0]!.id, 110, T + 30);
    expect(acc.trades[0]!.snapshots).toEqual(['att-entry']);
    // Flat: the latest closed trade; or a named position that has since closed.
    acc = addSnapshot(acc, 'att-after')!;
    acc = addSnapshot(acc, 'att-exit', { positionId: acc.trades[0]!.id })!;
    expect(acc.trades[0]!.snapshots).toEqual(['att-entry', 'att-after', 'att-exit']);
  });
  it('have nowhere to go before the first trade', () => {
    expect(addSnapshot(newSimAccount(0), 'x')).toBeNull();
  });
});
