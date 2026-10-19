import { describe, expect, it } from 'vitest';
import { findFutures, FUTURES_CATALOGUE, FUTURES_GROUPS, needsCrossRate, searchFutures, usdPerQuoteUnit } from './futures';

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

  it('has FOREX.com pairs, found however the symbol is written', () => {
    expect(findFutures('EUR/USD')).toMatchObject({ symbol: 'EURUSD', exchange: 'FOREX.com', group: 'Forex', currency: 'USD', tickSize: 0.00001, pointValueCents: 100 });
    expect(findFutures('usd_jpy')).toMatchObject({ symbol: 'USDJPY', currency: 'JPY', tickSize: 0.001 });
    expect(searchFutures('eur/usd')[0]!.symbol).toBe('EURUSD');
    expect(searchFutures('yen').length).toBeGreaterThan(5);
    expect(FUTURES_CATALOGUE.filter((s) => s.group === 'Forex').every((s) => s.symbol.length === 6)).toBe(true);
  });

  it('converts P&L to USD: USD pairs as is, USD-first pairs by the exit price, crosses by the day’s rate', () => {
    expect(usdPerQuoteUnit({ symbol: 'ES', currency: 'USD' }, 5000)).toBe(1);
    expect(usdPerQuoteUnit({ symbol: 'EURUSD', currency: 'USD' }, 1.08)).toBe(1);
    expect(usdPerQuoteUnit({ symbol: 'USDJPY', currency: 'JPY' }, 150)).toBeCloseTo(1 / 150, 12);
    expect(usdPerQuoteUnit({ symbol: 'EURGBP', currency: 'GBP' }, 0.86, 1.3335)).toBe(1.3335);
    expect(usdPerQuoteUnit({ symbol: 'EURGBP', currency: 'GBP' }, 0.86)).toBeNull();
    expect(needsCrossRate({ symbol: 'EURGBP', currency: 'GBP' })).toBe(true);
    expect(needsCrossRate({ symbol: 'USDJPY', currency: 'JPY' })).toBe(false);
    expect(needsCrossRate({ symbol: 'NQ', currency: 'USD' })).toBe(false);
  });
});
