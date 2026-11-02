import { describe, expect, it } from 'vitest';
import { DEFAULT_FIB_LEVELS, DEFAULT_FIB_STYLE, fibPrice, riskDollars } from './drawings';

describe('Fib retracement', () => {
  const fib = { p1: 100, p2: 200, style: DEFAULT_FIB_STYLE };
  it('puts 1 at the first point and 0 at the second, and swaps them when reversed', () => {
    expect(fibPrice(fib, 1)).toBe(100);
    expect(fibPrice(fib, 0)).toBe(200);
    expect(fibPrice(fib, 0.5)).toBe(150);
    expect(fibPrice(fib, 1.618)).toBeCloseTo(38.2);
    expect(fibPrice({ ...fib, style: { ...DEFAULT_FIB_STYLE, reverse: true } }, 0)).toBe(100);
  });
  it('starts with TradingView’s 24 levels and 0, 0.5 and 1 on', () => {
    expect(DEFAULT_FIB_LEVELS).toHaveLength(24);
    expect(DEFAULT_FIB_LEVELS.filter((l) => l.on).map((l) => l.value)).toEqual([0, 0.5, 1]);
  });
});

describe('long/short tool risk', () => {
  it('is a dollar amount or a percentage of the balance', () => {
    expect(riskDollars({ riskUsd: 200 }, 50_000)).toBe(200);
    expect(riskDollars({ riskMode: 'percent', riskUsd: 200, riskPct: 0.5 }, 50_000)).toBe(250);
  });
});
