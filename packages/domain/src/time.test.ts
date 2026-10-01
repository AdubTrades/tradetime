import { describe, expect, it } from 'vitest';
import { financialYearOf, formatLocal, localDate, tradingDay, zonedToUtc } from './time';

describe('tradingDay (Perth, 10:00 rollover)', () => {
  it('keeps a session that crosses midnight on the day it started', () => {
    // 23:30 Tue 6 Oct Perth = 15:30 UTC
    expect(tradingDay('2026-10-06T15:30:00Z')).toBe('2026-10-06');
    // 02:00 Wed 7 Oct Perth = 18:00 UTC Tue
    expect(tradingDay('2026-10-06T18:00:00Z')).toBe('2026-10-06');
  });

  it('rolls over exactly at 10:00 local', () => {
    // 09:59 Wed Perth = 01:59 UTC Wed
    expect(tradingDay('2026-10-07T01:59:00Z')).toBe('2026-10-06');
    // 10:00 Wed Perth = 02:00 UTC Wed
    expect(tradingDay('2026-10-07T02:00:00Z')).toBe('2026-10-07');
  });

  it('respects a custom rollover', () => {
    expect(tradingDay('2026-10-07T01:59:00Z', '06:00')).toBe('2026-10-07');
    expect(tradingDay('2026-10-06T21:59:00Z', '06:00')).toBe('2026-10-06');
  });

  it('differs from the plain local date after midnight', () => {
    expect(localDate('2026-10-06T18:00:00Z')).toBe('2026-10-07');
  });

  it('rejects a bad rollover', () => {
    expect(() => tradingDay('2026-10-06T18:00:00Z', '25:00')).toThrow();
  });
});

describe('financial year', () => {
  it('splits on 30 June / 1 July', () => {
    expect(financialYearOf('2026-06-30').label).toBe('2025–26');
    expect(financialYearOf('2026-07-01').label).toBe('2026–27');
    expect(financialYearOf('2026-07-01')).toMatchObject({ start: '2026-07-01', end: '2027-06-30' });
  });
});

describe('US events in Perth time across US daylight saving', () => {
  it('shifts an 08:30 New York release by an hour when US DST starts (8 Mar 2026)', () => {
    const beforeDst = zonedToUtc('2026-03-06', '08:30', 'America/New_York');
    const afterDst = zonedToUtc('2026-03-10', '08:30', 'America/New_York');
    expect(beforeDst).toBe('2026-03-06T13:30:00Z');
    expect(afterDst).toBe('2026-03-10T12:30:00Z');
    expect(formatLocal(beforeDst, 'HH:mm')).toBe('21:30');
    expect(formatLocal(afterDst, 'HH:mm')).toBe('20:30');
  });

  it('shifts back when US DST ends (1 Nov 2026)', () => {
    expect(formatLocal(zonedToUtc('2026-10-30', '08:30', 'America/New_York'), 'HH:mm')).toBe('20:30');
    expect(formatLocal(zonedToUtc('2026-11-03', '08:30', 'America/New_York'), 'HH:mm')).toBe('21:30');
  });
});
