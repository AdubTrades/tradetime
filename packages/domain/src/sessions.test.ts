import { describe, expect, it } from 'vitest';
import { decimalHours, durationMinutes, findOverlaps, formatDuration, summarise, weekStart } from './sessions';

const s = (id: string, start: string, end: string | null, extra: Partial<{ tradingDay: string; typeId: string }> = {}) => ({
  id,
  start,
  end,
  tradingDay: extra.tradingDay ?? start.slice(0, 10),
  typeId: extra.typeId ?? 'trading',
});

describe('durationMinutes', () => {
  it('measures closed and running sessions', () => {
    expect(durationMinutes(s('a', '2026-10-06T13:30:00Z', '2026-10-06T15:45:00Z'))).toBe(135);
    expect(durationMinutes(s('a', '2026-10-06T13:30:00Z', null), new Date('2026-10-06T14:00:00Z'))).toBe(30);
  });
});

describe('findOverlaps', () => {
  const existing = [s('a', '2026-10-06T13:00:00Z', '2026-10-06T15:00:00Z'), s('b', '2026-10-06T16:00:00Z', '2026-10-06T17:00:00Z')];

  it('detects partial overlap', () => {
    expect(findOverlaps({ start: '2026-10-06T14:30:00Z', end: '2026-10-06T15:30:00Z' }, existing).map((x) => x.id)).toEqual(['a']);
  });

  it('allows back-to-back sessions', () => {
    expect(findOverlaps({ start: '2026-10-06T15:00:00Z', end: '2026-10-06T16:00:00Z' }, existing)).toEqual([]);
  });

  it('ignores the session being edited', () => {
    expect(findOverlaps({ id: 'a', start: '2026-10-06T13:30:00Z', end: '2026-10-06T14:00:00Z' }, existing)).toEqual([]);
  });

  it('treats a running session as extending to now', () => {
    const running = [s('r', '2026-10-06T13:00:00Z', null)];
    const now = new Date('2026-10-06T14:00:00Z');
    expect(findOverlaps({ start: '2026-10-06T13:30:00Z', end: '2026-10-06T13:45:00Z' }, running, now)).toHaveLength(1);
  });
});

describe('formatting', () => {
  it('formats durations and decimal hours', () => {
    expect(formatDuration(185)).toBe('3h 05m');
    expect(formatDuration(42)).toBe('42m');
    expect(decimalHours(185)).toBe(3.08);
  });

  it('finds the Monday of a week', () => {
    expect(weekStart('2026-10-01')).toBe('2026-09-28'); // Thursday
    expect(weekStart('2026-09-28')).toBe('2026-09-28'); // Monday
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sunday
  });
});

describe('summarise', () => {
  const sessions = [
    s('a', '2026-06-30T13:00:00Z', '2026-06-30T15:00:00Z', { tradingDay: '2026-06-30' }),
    s('b', '2026-07-01T13:00:00Z', '2026-07-01T14:00:00Z', { tradingDay: '2026-07-01', typeId: 'review' }),
    s('c', '2026-07-02T13:00:00Z', '2026-07-02T13:30:00Z', { tradingDay: '2026-07-02' }),
  ];

  it('splits totals across the financial-year boundary', () => {
    expect(summarise(sessions, 'fy')).toEqual([
      { key: '2025–26', minutes: 120, sessions: 1, byType: { trading: 120 } },
      { key: '2026–27', minutes: 90, sessions: 2, byType: { review: 60, trading: 30 } },
    ]);
  });

  it('groups by month and week', () => {
    expect(summarise(sessions, 'month').map((t) => [t.key, t.minutes])).toEqual([
      ['2026-06', 120],
      ['2026-07', 90],
    ]);
    expect(summarise(sessions, 'week').map((t) => t.key)).toEqual(['2026-06-29']);
  });
});
