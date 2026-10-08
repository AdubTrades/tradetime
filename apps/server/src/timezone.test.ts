import { describe, expect, it } from 'vitest';
import { currentZone, localDate, localInstant } from '@tc/domain';
import * as cal from './calendar';
import * as sessions from './sessions';
import * as settings from './settings';
import { asUser, useTestDb } from './testing';

useTestDb();

describe('per-user time zone', () => {
  it('defaults to Perth until the user chooses', () =>
    asUser(async () => {
      expect(settings.getSettings().timeZone).toBeNull();
      expect(currentZone()).toBe('Australia/Perth');
    }));

  it('rejects zones that don’t exist', () =>
    asUser(async () => {
      await expect(settings.updateSettings({ timeZone: 'Mars/Olympus' })).rejects.toThrow(/valid time zone/);
    }));

  it('puts sessions on the trading day in the user’s own zone, and re-dates them when the zone changes', async () => {
    // 2026-10-06 01:30 UTC = 21:30 on 5 Oct in New York (EDT), 09:30 on 6 Oct in Perth.
    const start = '2026-10-06T01:30:00Z';
    const end = '2026-10-06T03:00:00Z';
    await asUser(async () => {
      await settings.updateSettings({ timeZone: 'America/New_York', rolloverTime: '04:00' });
      expect((await sessions.createManualSession({ typeId: 'st_trading', start, end })).tradingDay).toBe('2026-10-05');
    }, 'nyc');
    await asUser(async () => {
      await settings.updateSettings({ timeZone: 'Australia/Perth', rolloverTime: '04:00' });
      expect((await sessions.listSessions({ from: '2026-10-06', to: '2026-10-06' })).map((s) => s.start)).toEqual([start]);
    }, 'nyc');
  });

  it('keeps each user in their own zone, even when requests overlap', async () => {
    await asUser(() => settings.updateSettings({ timeZone: 'America/New_York' }), 'nyc');
    await asUser(() => settings.updateSettings({ timeZone: 'Australia/Perth' }), 'per');
    const instant = '2026-10-06T02:00:00Z';
    const [ny, perth] = await Promise.all([
      asUser(async () => ({ zone: currentZone(), date: localDate(instant), nine: localInstant('2026-10-06', '09:00') }), 'nyc'),
      asUser(async () => ({ zone: currentZone(), date: localDate(instant), nine: localInstant('2026-10-06', '09:00') }), 'per'),
    ]);
    expect(ny).toEqual({ zone: 'America/New_York', date: '2026-10-05', nine: '2026-10-06T13:00:00Z' });
    expect(perth).toEqual({ zone: 'Australia/Perth', date: '2026-10-06', nine: '2026-10-06T01:00:00Z' });
  });

  it('times calendar events and reminders in the user’s zone', async () => {
    await asUser(async () => {
      await settings.updateSettings({ timeZone: 'Europe/London' });
      const e = await cal.createEvent({ typeId: 'cet_general', title: 'London open', date: '2026-10-07', startTime: '08:00', reminderMinutes: 10 });
      const [occ] = await cal.listOccurrences('2026-10-07', '2026-10-07');
      expect(occ).toMatchObject({ eventId: e.id, startAt: '2026-10-07T07:00:00Z' }); // BST, UTC+1
      const due = await cal.dueReminders(Date.parse('2026-10-07T06:45:00Z'), Date.parse('2026-10-07T06:55:00Z'));
      expect(due.map((o) => o.title)).toEqual(['London open']);
    }, 'ldn');
  });
});
