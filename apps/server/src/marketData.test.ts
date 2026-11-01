import { describe, expect, it } from 'vitest';
import { decodeBars, encodeBars, isMarketPath } from './marketData';

describe('market data files', () => {
  it('accepts only the known file paths for known instruments', () => {
    expect(isMarketPath('BTCUSDT/2026/2026-10-31.json.gz')).toBe(true);
    expect(isMarketPath('NQ/hourly/2026.json.gz')).toBe(true);
    expect(isMarketPath('NQ/daily.json.gz')).toBe(true);
    expect(isMarketPath('ES/daily.json.gz')).toBe(false); // not bought
    expect(isMarketPath('NQ/2025/2026-01-02.json.gz')).toBe(false);
    expect(isMarketPath('XYZ/daily.json.gz')).toBe(false);
    expect(isMarketPath('../secrets/daily.json.gz')).toBe(false);
    expect(isMarketPath('NQ/2026/2026-01-02.json.gz/../../x')).toBe(false);
  });

  it('round-trips bars through the gzipped file format', () => {
    const bars = [{ t: 1, o: 1.25, h: 2, l: 1, c: 1.5, v: 3 }];
    expect(decodeBars(encodeBars(bars))).toEqual(bars);
  });
});
