import { describe, expect, it } from 'vitest';
import { aggregate, barStart, BACKTEST_INSTRUMENTS, bucketTime, mergeBars, replayView, sessionDate, sessionOpen, timeframesFor, type Bar } from './bars';

const at = (iso: string) => Date.parse(iso) / 1000;
const iso = (t: number) => new Date(t * 1000).toISOString().replace('.000', '');
const bar = (t: number, o: number, h: number, l: number, c: number, v = 1): Bar => ({ t, o, h, l, c, v });

describe('timeframes', () => {
  it('offers 30s to futures and starts crypto at 1 minute', () => {
    expect(timeframesFor(BACKTEST_INSTRUMENTS[0]!)).toEqual(['30s', '1m', '2m', '5m', '15m', '1h', '4h', '12h', '1D', '1W', '1M']);
    expect(timeframesFor({ baseSeconds: 60 })).toEqual(['1m', '5m', '15m', '1h', '4h', '12h', '1D', '1W', '1M']);
  });
});

describe('CME sessions', () => {
  it('counts the evening session toward the next day, in summer and winter', () => {
    // 18:00 New York is 22:00 UTC in summer (EDT) and 23:00 UTC in winter (EST).
    expect(sessionDate(at('2026-07-14T21:59:00Z'), 'futures')).toBe('2026-07-14');
    expect(sessionDate(at('2026-07-14T22:00:00Z'), 'futures')).toBe('2026-07-15');
    expect(sessionDate(at('2026-01-14T22:30:00Z'), 'futures')).toBe('2026-01-14');
    expect(sessionDate(at('2026-01-14T23:00:00Z'), 'futures')).toBe('2026-01-15');
    expect(iso(sessionOpen('2026-07-15'))).toBe('2026-07-14T22:00:00Z');
    expect(iso(sessionOpen('2026-01-15'))).toBe('2026-01-14T23:00:00Z');
  });

  it('puts Sunday evening into Monday, and the week starts there', () => {
    const sundayOpen = at('2026-07-12T22:00:00Z');
    expect(sessionDate(sundayOpen, 'futures')).toBe('2026-07-13');
    expect(iso(bucketTime(sundayOpen, '1D', 'futures'))).toBe('2026-07-13T00:00:00Z');
    expect(iso(bucketTime(sundayOpen, '1W', 'futures'))).toBe('2026-07-13T00:00:00Z');
    // Friday afternoon is still the same week.
    expect(iso(bucketTime(at('2026-07-17T20:59:00Z'), '1W', 'futures'))).toBe('2026-07-13T00:00:00Z');
  });

  it('counts 4h and 12h bars from the 18:00 open, across the clock change', () => {
    expect(iso(bucketTime(at('2026-07-15T01:30:00Z'), '4h', 'futures'))).toBe('2026-07-14T22:00:00Z');
    expect(iso(bucketTime(at('2026-07-15T02:00:00Z'), '4h', 'futures'))).toBe('2026-07-15T02:00:00Z');
    expect(iso(bucketTime(at('2026-07-15T09:59:00Z'), '12h', 'futures'))).toBe('2026-07-14T22:00:00Z');
    expect(iso(bucketTime(at('2026-07-15T10:00:00Z'), '12h', 'futures'))).toBe('2026-07-15T10:00:00Z');
    expect(iso(bucketTime(at('2026-01-15T11:00:00Z'), '12h', 'futures'))).toBe('2026-01-15T11:00:00Z');
    // Monday 9 March 2026: the session opened Sunday 18:00 EDT (22:00 UTC), just after the US clocks changed.
    expect(iso(bucketTime(at('2026-03-09T02:00:00Z'), '4h', 'futures'))).toBe('2026-03-09T02:00:00Z');
  });

  it('keeps short intraday bars on the clock', () => {
    expect(iso(bucketTime(at('2026-07-15T13:31:45Z'), '30s', 'futures'))).toBe('2026-07-15T13:31:30Z');
    expect(iso(bucketTime(at('2026-07-15T13:33:45Z'), '2m', 'futures'))).toBe('2026-07-15T13:32:00Z');
    expect(iso(bucketTime(at('2026-07-15T13:44:59Z'), '15m', 'futures'))).toBe('2026-07-15T13:30:00Z');
  });

  it('labels a month by the trading date, so the last evening of a month belongs to the next', () => {
    expect(iso(bucketTime(at('2026-06-30T22:00:00Z'), '1M', 'futures'))).toBe('2026-07-01T00:00:00Z');
  });
});

describe('crypto on UTC', () => {
  it('uses UTC days, Monday weeks, months and 12h at 00:00/12:00', () => {
    const t = at('2026-07-15T13:05:00Z'); // a Wednesday
    expect(iso(bucketTime(t, '12h', 'crypto'))).toBe('2026-07-15T12:00:00Z');
    expect(iso(bucketTime(t, '4h', 'crypto'))).toBe('2026-07-15T12:00:00Z');
    expect(iso(bucketTime(t, '1D', 'crypto'))).toBe('2026-07-15T00:00:00Z');
    expect(iso(bucketTime(t, '1W', 'crypto'))).toBe('2026-07-13T00:00:00Z');
    expect(iso(bucketTime(t, '1M', 'crypto'))).toBe('2026-07-01T00:00:00Z');
  });
});

describe('aggregate', () => {
  it('combines open, high, low, close and volume', () => {
    const t0 = at('2026-07-15T13:30:00Z');
    const bars = [bar(t0, 10, 12, 9, 11, 2), bar(t0 + 30, 11, 15, 10, 14, 3), bar(t0 + 60, 14, 14, 8, 9, 1)];
    expect(aggregate(bars, '1m', 'futures')).toEqual([bar(t0, 10, 15, 9, 14, 5), bar(t0 + 60, 14, 14, 8, 9, 1)]);
  });
});

describe('replayView', () => {
  const t0 = at('2026-07-15T13:30:00Z');
  const base = Array.from({ length: 10 }, (_, i) => bar(t0 + i * 30, 100 + i, 101 + i, 99 + i, 100.5 + i));

  it('shows only bars closed by the cursor, with the forming bar built from them', () => {
    // Cursor at 13:31:45: base bars to 13:31:30 have closed (13:31:30 closes at 13:32:00, so not yet).
    const view = replayView({
      tf: '1m',
      kind: 'futures',
      cursor: t0 + 105,
      baseSeconds: 30,
      base,
    });
    expect(view).toEqual([bar(t0, 100, 102, 99, 101.5, 2), bar(t0 + 60, 102, 103, 101, 102.5, 1)]);
  });

  it('fills history from a coarser series without overlap', () => {
    const h = at('2026-07-15T14:00:00Z');
    const hourBase = base.map((b) => ({ ...b, t: b.t - t0 + h }));
    const coarse = [bar(h - 7200, 50, 60, 40, 55, 9), bar(h - 3600, 55, 70, 50, 99, 9), bar(h, 1, 1, 1, 1, 1)];
    const view = replayView({
      tf: '1h',
      kind: 'futures',
      cursor: h + 120,
      baseSeconds: 30,
      base: hourBase,
      history: coarse,
    });
    expect(view.map((b) => b.t)).toEqual([h - 7200, h - 3600, h]);
    expect(view[2]).toEqual(bar(h, 100, 104, 99, 103.5, 4));
  });
});

describe('replayView on daily and up', () => {
  it('builds the forming week from earlier daily bars and today’s base bars (futures)', () => {
    // Wednesday 15 July 2026's session opened Tuesday 18:00 New York (22:00 UTC).
    const open = at('2026-07-14T22:00:00Z');
    const base = [bar(open, 200, 210, 195, 205), bar(open + 30, 205, 220, 204, 219)];
    const daily = [
      bar(at('2026-07-10T00:00:00Z'), 90, 95, 85, 92),
      bar(at('2026-07-13T00:00:00Z'), 100, 150, 98, 120),
      bar(at('2026-07-14T00:00:00Z'), 120, 130, 110, 200),
      bar(at('2026-07-15T00:00:00Z'), 1, 1, 1, 1),
    ];
    const week = replayView({
      tf: '1W',
      kind: 'futures',
      cursor: open + 60,
      baseSeconds: 30,
      base,
      history: daily,
    });
    expect(week.map((b) => iso(b.t))).toEqual(['2026-07-06T00:00:00Z', '2026-07-13T00:00:00Z']);
    expect(week[1]).toEqual(bar(at('2026-07-13T00:00:00Z'), 100, 220, 98, 219, 4));
    const day = replayView({
      tf: '1D',
      kind: 'futures',
      cursor: open + 30,
      baseSeconds: 30,
      base,
      history: daily,
    });
    expect(day.at(-1)).toEqual(bar(at('2026-07-15T00:00:00Z'), 200, 210, 195, 205, 1));
  });
});

describe('barStart', () => {
  it('turns a date-labelled bar into the moment its session opens, so it maps back to the same bar', () => {
    const label = at('2026-07-15T00:00:00Z');
    expect(iso(barStart(label, '1D', 'futures'))).toBe('2026-07-14T22:00:00Z');
    expect(bucketTime(barStart(label, '1D', 'futures'), '1D', 'futures')).toBe(label);
    expect(barStart(label, '1D', 'crypto')).toBe(label);
    expect(barStart(label + 300, '5m', 'futures')).toBe(label + 300);
  });
});

describe('mergeBars', () => {
  it('keeps one bar per time, oldest first', () => {
    expect(mergeBars([bar(60, 1, 1, 1, 1)], [bar(0, 2, 2, 2, 2), bar(60, 3, 3, 3, 3)]).map((b) => [b.t, b.o])).toEqual([
      [0, 2],
      [60, 3],
    ]);
  });
});
