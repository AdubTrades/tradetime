import { describe, expect, it } from 'vitest';
import { isOnTick, pnlFromFills, replicateFills, riskPlan, rMultiple, simpleFills, type Fill } from './trades';

const f = (at: string, side: 'buy' | 'sell', qty: number, price: number): Fill => ({ at: `2026-10-06T13:${at}:00Z`, side, qty, price });

describe('pnlFromFills', () => {
  it('ES long 1 contract: 4.5 points × $50 = $225', () => {
    const r = pnlFromFills([f('30', 'buy', 1, 5000), f('35', 'sell', 1, 5004.5)], 5000);
    expect(r).toMatchObject({ direction: 'long', maxQty: 1, totalQty: 2, grossPoints: 4.5, grossCents: 22500, avgEntry: 5000, avgExit: 5004.5 });
  });

  it('MNQ short 2, scaled out: (10 + 5.25) points × $2 = $30.50', () => {
    const r = pnlFromFills([f('30', 'sell', 2, 20000.25), f('32', 'buy', 1, 19990.25), f('40', 'buy', 1, 19995)], 200);
    expect(r).toMatchObject({ direction: 'short', maxQty: 2, grossPoints: 15.25, grossCents: 3050, avgExit: 19992.625 });
  });

  it('ES scale-in long: FIFO 3 + 5 = 8 points × $50 = $400', () => {
    const r = pnlFromFills([f('30', 'buy', 1, 5000), f('31', 'buy', 1, 4998), f('40', 'sell', 2, 5003)], 5000);
    expect(r).toMatchObject({ maxQty: 2, avgEntry: 4999, avgExit: 5003, grossCents: 40000 });
  });

  it('matches exits to the earliest entries first', () => {
    // +4 on the first lot, −1 on the second.
    const r = pnlFromFills([f('30', 'buy', 1, 100), f('31', 'buy', 1, 102), f('32', 'sell', 1, 104), f('33', 'sell', 1, 101)], 100);
    expect(r.grossPoints).toBe(3);
  });

  it('sorts fills by time regardless of input order', () => {
    const r = pnlFromFills([f('35', 'sell', 1, 5004.5), f('30', 'buy', 1, 5000)], 5000);
    expect(r.direction).toBe('long');
    expect(r.openedAt < r.closedAt).toBe(true);
  });

  it('rejects open positions, reversals and re-opening after flat', () => {
    expect(() => pnlFromFills([f('30', 'buy', 2, 100), f('31', 'sell', 1, 101)], 100)).toThrow(/isn't flat/);
    expect(() => pnlFromFills([f('30', 'buy', 1, 100), f('31', 'sell', 2, 101)], 100)).toThrow(/reversal/);
    expect(() => pnlFromFills([f('30', 'buy', 1, 100), f('31', 'sell', 1, 101), f('32', 'buy', 1, 100), f('33', 'sell', 1, 99)], 100)).toThrow(
      /separate trade/,
    );
    expect(() => pnlFromFills([f('30', 'buy', 1, 100)], 100)).toThrow(/at least/);
  });
});

describe('helpers', () => {
  it('replicates fills for copy accounts', () => {
    const base = simpleFills('long', 1, { at: '2026-10-06T13:30:00Z', price: 5000 }, { at: '2026-10-06T13:35:00Z', price: 5002 });
    expect(pnlFromFills(replicateFills(base, 3), 5000).grossCents).toBe(30000);
  });

  it('checks tick alignment', () => {
    expect(isOnTick(5000.25, 0.25)).toBe(true);
    expect(isOnTick(5000.1, 0.25)).toBe(false);
  });

  it('computes planned risk, reward:risk and R', () => {
    const plan = riskPlan(5000, 2, 5000, { stopPrice: 4996, targetPrice: 5012 });
    expect(plan).toEqual({ riskPoints: 4, riskCents: 40000, plannedRR: 3 });
    expect(rMultiple(22500, plan.riskCents)).toBe(0.56);
    expect(riskPlan(5000, 1, 5000, { riskPoints: 3 })).toEqual({ riskPoints: 3, riskCents: 15000, plannedRR: null });
    expect(riskPlan(5000, 1, 5000, {})).toEqual({ riskPoints: null, riskCents: null, plannedRR: null });
    expect(rMultiple(100, null)).toBeNull();
  });
});
