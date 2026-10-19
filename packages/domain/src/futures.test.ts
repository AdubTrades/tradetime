import { describe, expect, it } from 'vitest';
import { findFutures, FUTURES_CATALOGUE, FUTURES_GROUPS, searchFutures } from './futures';

describe('futures catalogue', () => {
  it('has one entry per symbol, in a known group', () => {
    expect(new Set(FUTURES_CATALOGUE.map((s) => s.symbol)).size).toBe(FUTURES_CATALOGUE.length);
    for (const s of FUTURES_CATALOGUE) expect(FUTURES_GROUPS).toContain(s.group);
    expect(FUTURES_CATALOGUE.length).toBeGreaterThan(50);
  });

  it('tick size × point value matches the published tick value for every contract', () => {
    for (const s of FUTURES_CATALOGUE) expect(s.tickSize * s.pointValueCents, s.symbol).toBeCloseTo(s.tickValueCents, 6);
  });

  it('matches the specs the app has always used for the default contracts', () => {
    expect(findFutures('es')).toMatchObject({ tickSize: 0.25, pointValueCents: 5000 });
    expect(findFutures('NQ')).toMatchObject({ tickSize: 0.25, pointValueCents: 2000 });
    expect(findFutures('MES')).toMatchObject({ tickSize: 0.25, pointValueCents: 500 });
    expect(findFutures('MNQ')).toMatchObject({ tickSize: 0.25, pointValueCents: 200 });
  });

  it('finds contracts by symbol, name or group, symbol matches first', () => {
    expect(searchFutures('gc')[0]!.symbol).toBe('GC');
    expect(searchFutures('gold').map((s) => s.symbol)).toEqual(['GC', 'MGC']);
    expect(searchFutures('nasdaq').map((s) => s.symbol)).toEqual(['NQ', 'MNQ']);
    expect(searchFutures('crypto').map((s) => s.symbol)).toEqual(['BTC', 'MBT', 'ETH', 'MET']);
    expect(searchFutures('')).toHaveLength(FUTURES_CATALOGUE.length);
  });
});
