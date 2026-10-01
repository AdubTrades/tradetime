import { describe, expect, it } from 'vitest';
import { dueCheckIn, latestReadingBefore } from './checkins';

const fresh = { handled: 0, snoozedUntil: null };

describe('dueCheckIn', () => {
  it('is due once screen time reaches the first threshold', () => {
    expect(dueCheckIn(89, [90], fresh)).toBeNull();
    expect(dueCheckIn(90, [90], fresh)).toEqual({ level: 1, thresholdMinutes: 90 });
  });

  it('stays quiet after answering until the next threshold', () => {
    const state = { handled: 1, snoozedUntil: null };
    expect(dueCheckIn(120, [90, 150], state)).toBeNull();
    expect(dueCheckIn(150, [90, 150], state)).toEqual({ level: 2, thresholdMinutes: 150 });
    expect(dueCheckIn(200, [90, 150], { handled: 2, snoozedUntil: null })).toBeNull();
  });

  it('respects snooze', () => {
    const now = 1_000_000;
    expect(dueCheckIn(95, [90], { handled: 0, snoozedUntil: now + 60_000 }, now)).toBeNull();
    expect(dueCheckIn(95, [90], { handled: 0, snoozedUntil: now - 1 }, now)).not.toBeNull();
  });

  it('jumps straight to the highest threshold reached', () => {
    expect(dueCheckIn(160, [150, 90], fresh)).toEqual({ level: 2, thresholdMinutes: 150 });
  });

  it('ignores missing thresholds', () => {
    expect(dueCheckIn(500, [], fresh)).toBeNull();
    expect(dueCheckIn(100, [90, 0], fresh)).toEqual({ level: 1, thresholdMinutes: 90 });
  });
});

describe('latestReadingBefore', () => {
  const readings = [{ at: '2026-09-29T13:00:00Z', id: 'start' }, { at: '2026-09-29T14:30:00Z', id: 'check' }];
  it('picks the latest reading at or before the time', () => {
    expect(latestReadingBefore(readings, '2026-09-29T14:00:00Z')?.id).toBe('start');
    expect(latestReadingBefore(readings, '2026-09-29T14:30:00Z')?.id).toBe('check');
    expect(latestReadingBefore(readings, '2026-09-29T12:00:00Z')).toBeNull();
  });
});
