import { describe, expect, it } from 'vitest';
import { equityCurve, hourBucket, maxDrawdown, summarise, summariseBy } from './stats';

const t = (netCents: number, r: number | null = null, at = '2026-10-06T13:30:00Z') => ({ netCents, r, at });

describe('summarise', () => {
  it('computes the basics', () => {
    const s = summarise([t(30000, 2), t(-15000, -1), t(20000, 1.33), t(0), t(-10000, -0.67)]);
    expect(s).toMatchObject({ n: 5, wins: 2, losses: 2, breakeven: 1, winRate: 0.4, netCents: 25000, avgWinCents: 25000, avgLossCents: -12500, expectancyCents: 5000, nR: 4 });
    expect(s.profitFactor).toBeCloseTo(2);
    expect(s.avgR).toBe(0.42);
  });

  it('handles empty and no-loss samples', () => {
    expect(summarise([])).toMatchObject({ n: 0, winRate: null, profitFactor: null, expectancyCents: null, avgR: null });
    expect(summarise([t(100)]).profitFactor).toBeNull();
  });
});

describe('summariseBy', () => {
  it('groups in a given order and drops empty groups', () => {
    const rows = [{ ...t(100), g: 'B' }, { ...t(-50), g: 'A+' }, { ...t(70), g: 'B' }];
    expect(summariseBy(rows, (r) => r.g, ['A+', 'A', 'B']).map((x) => [x.key, x.summary.n])).toEqual([
      ['A+', 1],
      ['B', 2],
    ]);
  });
});

describe('equity curve', () => {
  it('tracks drawdown from the running peak', () => {
    const curve = equityCurve([t(100, null, '1'), t(-300, null, '2'), t(50, null, '3'), t(400, null, '4')]);
    expect(curve.map((p) => [p.equityCents, p.drawdownCents])).toEqual([
      [100, 0],
      [-200, -300],
      [-150, -250],
      [250, 0],
    ]);
    expect(maxDrawdown(curve)).toBe(-300);
  });

  it('buckets by Perth hour', () => {
    expect(hourBucket('2026-10-06T13:45:00Z')).toBe('21:00');
  });
});
