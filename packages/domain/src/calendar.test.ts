import { describe, expect, it } from 'vitest';
import { blockMinutes, expandOccurrences, fredToEvents, monthWeeks, recurrenceDatesBetween } from './calendar';
import { formatLocal } from './time';

describe('recurrence', () => {
  it('weekly on chosen weekdays', () => {
    // Mon/Wed/Fri from Thu 1 Oct 2026
    expect(recurrenceDatesBetween('2026-10-01', { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] }, '2026-10-01', '2026-10-09')).toEqual([
      '2026-10-02',
      '2026-10-05',
      '2026-10-07',
      '2026-10-09',
    ]);
  });
  it('daily with interval and until', () => {
    expect(recurrenceDatesBetween('2026-10-01', { freq: 'daily', interval: 2, until: '2026-10-06' }, '2026-09-01', '2026-12-31')).toEqual([
      '2026-10-01',
      '2026-10-03',
      '2026-10-05',
    ]);
  });
  it('monthly skips months without the day', () => {
    expect(recurrenceDatesBetween('2026-01-31', { freq: 'monthly', interval: 1 }, '2026-01-01', '2026-05-31')).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });
});

describe('expandOccurrences', () => {
  const weekly = { id: 'e1', date: '2026-10-05', title: 'NY session', startTime: '21:30', endTime: '00:00', recurrence: { freq: 'weekly' as const, interval: 1 } };
  const once = { id: 'e2', date: '2026-10-07', title: 'Tax return', startTime: null, endTime: null, recurrence: null, doneAt: null };

  it('expands, skips and overrides single occurrences', () => {
    const occ = expandOccurrences(
      [weekly, once],
      [
        { eventId: 'e1', occurrenceDate: '2026-10-12', skipped: true },
        { eventId: 'e1', occurrenceDate: '2026-10-19', skipped: false, override: { date: '2026-10-20', startTime: '22:00' } },
      ],
      '2026-10-01',
      '2026-10-31',
    );
    expect(occ.map((o) => [o.date, o.title, o.startTime])).toEqual([
      ['2026-10-05', 'NY session', '21:30'],
      ['2026-10-07', 'Tax return', null],
      ['2026-10-20', 'NY session', '22:00'],
      ['2026-10-26', 'NY session', '21:30'],
    ]);
    expect(occ[2]!.occurrenceDate).toBe('2026-10-19');
  });

  it('finds an occurrence moved into the window from outside it', () => {
    const occ = expandOccurrences([weekly], [{ eventId: 'e1', occurrenceDate: '2026-11-02', skipped: false, override: { date: '2026-10-31' } }], '2026-10-27', '2026-10-31');
    expect(occ.map((o) => o.date)).toEqual(['2026-10-31']);
  });

  it('measures blocks across midnight', () => {
    expect(blockMinutes('21:30', '00:00')).toBe(150);
    expect(blockMinutes('10:00', '11:15')).toBe(75);
    expect(blockMinutes(null, '11:00')).toBe(0);
  });
});

describe('monthWeeks', () => {
  it('covers the month in Monday-start weeks', () => {
    const weeks = monthWeeks('2026-10');
    expect(weeks[0]![0]).toBe('2026-09-28');
    expect(weeks.at(-1)!.at(-1)).toBe('2026-11-01');
    expect(weeks).toHaveLength(5);
  });
});

describe('fredToEvents', () => {
  it('times US releases in New York and shows them in Perth across DST', () => {
    const events = fredToEvents([
      { release_id: 10, date: '2026-10-14' },
      { release_id: 10, date: '2026-11-12' },
      { release_id: 101, date: '2026-10-28' },
      { release_id: 999, date: '2026-10-01' },
    ]);
    expect(events.map((e) => [e.title, formatLocal(e.at, 'd LLL HH:mm'), e.impact])).toEqual([
      ['CPI', '14 Oct 20:30', 'high'],
      ['CPI', '12 Nov 21:30', 'high'],
      ['FOMC Statement', '29 Oct 02:00', 'high'],
    ]);
    expect(events[0]!.providerId).toBe('10:2026-10-14');
  });
});
