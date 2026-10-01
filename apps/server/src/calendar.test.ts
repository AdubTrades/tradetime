import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DateTime } from 'luxon';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fomcEvents } from '@tc/domain';

let cal: typeof import('./calendar');
let market: typeof import('./marketEvents');
let settings: typeof import('./settings');
let sessions: typeof import('./sessions');
let expenses: typeof import('./expenses');
let ctx: typeof import('./context');

beforeAll(async () => {
  process.env.TC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tc-calendar-'));
  ctx = await import('./context');
  cal = await import('./calendar');
  market = await import('./marketEvents');
  settings = await import('./settings');
  sessions = await import('./sessions');
  expenses = await import('./expenses');
});

beforeEach(() => {
  ctx.sqlite.exec(`DELETE FROM calendar_event_exception; DELETE FROM calendar_event; DELETE FROM market_event; DELETE FROM session; DELETE FROM expense; DELETE FROM setting WHERE key LIKE 'state.%';`);
  settings.updateSettings({ fredApiKey: null, includeMediumEvents: false });
});

const KEY = 'abcdefabcdefabcdefabcdefabcdef12';

/** Stand-in for the FRED API: CPI and jobless claims dates, keyed by release id. */
const fakeFred = (failWith?: string) => async (url: string) => {
  const rid = Number(new URL(url).searchParams.get('release_id'));
  const dates: Record<number, string[]> = { 10: ['2026-10-14'], 180: ['2026-10-15'], 101: ['2026-10-03', '2026-10-04', '2026-10-05'] };
  if (failWith) return { ok: false, status: 400, json: async () => ({ error_message: failWith }) };
  return { ok: true, status: 200, json: async () => ({ release_dates: (dates[rid] ?? []).map((date) => ({ release_id: rid, date })) }) };
};

describe('market events', () => {
  it('needs a key, stores events, and is idempotent', async () => {
    expect((await market.refreshMarketEvents(fakeFred())).lastError).toMatch(/FRED API key/);
    settings.updateSettings({ fredApiKey: KEY });
    const s = await market.refreshMarketEvents(fakeFred());
    // 2 FRED releases (rid 101's daily dates are ignored) + FOMC meetings from the Fed schedule in the fetch window.
    const ny = DateTime.now().setZone('America/New_York');
    const fomc = fomcEvents(ny.minus({ days: 30 }).toISODate()!, ny.plus({ days: 120 }).toISODate()!).length;
    expect(s).toMatchObject({ lastError: null, count: 2 + fomc });
    await market.refreshMarketEvents(fakeFred());
    const all = market.listMarketEvents('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', ['high', 'medium']);
    expect(all.map((e) => e.title)).toEqual(['CPI', 'Unemployment Claims', 'FOMC Statement']);
  });

  it('filters by impact setting and reports provider errors', async () => {
    settings.updateSettings({ fredApiKey: KEY });
    await market.refreshMarketEvents(fakeFred());
    expect(market.listMarketEvents('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z').map((e) => e.impact)).toEqual(['high', 'high']);
    settings.updateSettings({ includeMediumEvents: true });
    expect(market.listMarketEvents('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z')).toHaveLength(3);
    const failed = await market.refreshMarketEvents(fakeFred('Bad Request. The value for variable api_key is not registered.'));
    expect(failed.lastError).toMatch(/not registered/);
    expect(failed.lastSuccessAt).not.toBeNull(); // keeps the last good fetch
  });

  it('removes stale events on refresh, including the old daily FOMC series', async () => {
    // What the previous version stored: FRED rid 101 every day, plus a CPI date that has since moved.
    market.upsertMarketEvents([
      { provider: 'fred', providerId: '101:2026-10-03', title: 'FOMC Statement', at: '2026-10-03T18:00:00Z', impact: 'high', country: 'US', currency: 'USD' },
      { provider: 'fred', providerId: '101:2026-10-04', title: 'FOMC Statement', at: '2026-10-04T18:00:00Z', impact: 'high', country: 'US', currency: 'USD' },
      { provider: 'fred', providerId: '10:2026-10-13', title: 'CPI', at: '2026-10-13T12:30:00Z', impact: 'high', country: 'US', currency: 'USD' },
    ]);
    settings.updateSettings({ fredApiKey: KEY });
    await market.refreshMarketEvents(fakeFred());
    const oct = market.listMarketEvents('2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', ['high']);
    expect(oct.map((e) => [e.title, e.at])).toEqual([
      ['CPI', '2026-10-14T12:30:00Z'],
      ['FOMC Statement', '2026-10-28T18:00:00Z'],
    ]);
  });

  it('rejects malformed keys', () => {
    expect(() => settings.updateSettings({ fredApiKey: 'nope' })).toThrow(/32 letters/);
  });
});

describe('own events', () => {
  it('expands repeats with a skipped and a moved occurrence', () => {
    const e = cal.createEvent({ typeId: 'cet_trading', title: 'NY open', date: '2026-10-05', startTime: '21:30', endTime: '00:00', recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] } });
    cal.upsertException(e.id, '2026-10-06', { skipped: true });
    cal.upsertException(e.id, '2026-10-07', { override: { startTime: '22:30' } });
    const occ = cal.listOccurrences('2026-10-05', '2026-10-09');
    expect(occ.map((o) => [o.date, o.startTime])).toEqual([
      ['2026-10-05', '21:30'],
      ['2026-10-07', '22:30'],
      ['2026-10-08', '21:30'],
      ['2026-10-09', '21:30'],
    ]);
    expect(occ[0]!.startAt).toBe('2026-10-05T13:30:00Z');
  });

  it('keeps unfinished tasks visible until done', () => {
    const t = cal.createEvent({ typeId: 'cet_admin', title: 'Send receipts to accountant', date: '2026-09-20', allDay: true, isTask: true });
    expect(cal.listOccurrences('2026-10-01', '2026-10-07', true).map((o) => o.title)).toContain('Send receipts to accountant');
    cal.setTaskDone(t.id, true);
    expect(cal.listOccurrences('2026-10-01', '2026-10-07', true)).toHaveLength(0);
  });

  it('marks a single occurrence of a repeating task done', () => {
    const t = cal.createEvent({ typeId: 'cet_admin', title: 'Weekly review', date: '2026-10-02', isTask: true, allDay: true, recurrence: { freq: 'weekly', interval: 1 } });
    cal.upsertException(t.id, '2026-10-09', { done: true });
    expect(cal.listOccurrences('2026-10-01', '2026-10-16').map((o) => [o.date, o.done])).toEqual([
      ['2026-10-02', false],
      ['2026-10-09', true],
      ['2026-10-16', false],
    ]);
    expect(() => cal.setTaskDone(t.id, true)).toThrow(/single occurrence/);
  });

  it('validates links and repeat ends', () => {
    expect(() => cal.createEvent({ typeId: 'cet_education', title: 'Stream', date: '2026-10-05', link: 'javascript:alert(1)' })).toThrow(/http/);
    expect(() => cal.createEvent({ typeId: 'cet_general', title: 'X', date: '2026-10-05', recurrence: { freq: 'daily', interval: 1, until: '2026-10-01' } })).toThrow(/before/);
  });

  it('fires reminders once when their time passes', () => {
    cal.createEvent({ typeId: 'cet_education', title: 'Live stream', date: '2026-10-05', startTime: '20:00', endTime: '21:00', reminderMinutes: 15 });
    const remindAt = Date.parse('2026-10-05T11:45:00Z'); // 19:45 Perth
    expect(cal.dueReminders(remindAt - 60_000, remindAt).map((o) => o.title)).toEqual(['Live stream']);
    expect(cal.dueReminders(remindAt, remindAt + 60_000)).toHaveLength(0);
  });
});

describe('calendar range', () => {
  it('aggregates screen time by trading day and puts market events on their trading day', async () => {
    sessions.createManualSession({ typeId: 'st_trading', start: '2026-09-29T13:00:00Z', end: '2026-09-29T15:00:00Z' });
    sessions.createManualSession({ typeId: 'st_backtesting', start: '2026-09-29T02:00:00Z', end: '2026-09-29T03:30:00Z' });
    expenses.createExpense({ name: 'Feed', date: '2026-09-29', exGstCents: 5000, gstCents: 0 });
    settings.updateSettings({ fredApiKey: KEY });
    await market.refreshMarketEvents(fakeFred());
    const r = cal.calendarRange('2026-09-28', '2026-11-01');
    expect(r.days['2026-09-29']).toMatchObject({ tradingMinutes: 120, otherMinutes: 90, expensesCents: 5000 });
    // FOMC at 14:00 NY on 28 Oct is 02:00 Perth on 29 Oct, before the 10:00 rollover → trading day 28 Oct.
    expect(r.market.find((m) => m.title === 'FOMC Statement')?.tradingDay).toBe('2026-10-28');
  });
});
