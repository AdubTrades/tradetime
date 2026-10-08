import { beforeEach, describe, expect, it } from 'vitest';
import * as settings from './settings';
import * as svc from './sessions';
import { asUser, useTestDb } from './testing';

useTestDb();
beforeEach(() => asUser(() => settings.updateSettings({ rolloverTime: '10:00' })));

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('session types', () => {
  it('seeds the default list with Trading flagged', () =>
    asUser(async () => {
      const types = await svc.listSessionTypes();
      expect(types.map((t) => t.name)).toEqual(['Trading', 'Daily review', 'Weekly review', 'Backtesting', 'Education', 'Other']);
      expect(types.filter((t) => t.isTrading).map((t) => t.id)).toEqual(['st_trading']);
    }));
});

describe('timer', () => {
  it('starts, refuses a second timer, and stops', () =>
    asUser(async () => {
      const s = await svc.startTimer('st_trading', hoursAgo(1));
      expect(s.source).toBe('timer');
      await expect(svc.startTimer('st_other')).rejects.toThrow(/already running/);
      const stopped = await svc.stopTimer(s.id);
      expect(stopped.end).not.toBeNull();
      expect(stopped.editedAt).toBeNull();
      expect(await svc.getRunningSession()).toBeNull();
    }));

  it('records an adjusted stop time as an edit', () =>
    asUser(async () => {
      const s = await svc.startTimer('st_trading', hoursAgo(3));
      const end = hoursAgo(1);
      const stopped = await svc.stopTimer(s.id, end);
      expect(stopped.end).toBe(end);
      expect(stopped.editedAt).not.toBeNull();
      const history = await svc.sessionHistory(s.id);
      expect(history.map((h) => h.action)).toEqual(['create', 'update']);
      expect(history[1]).toMatchObject({ field: 'end', newValue: end });
    }));
});

describe('manual sessions', () => {
  it('assigns the trading day using the rollover', () =>
    asUser(async () => {
      // 23:30–01:30 Perth on 5/6 Aug 2026 belongs to 5 Aug.
      const s = await svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T15:30:00Z', end: '2026-08-05T17:30:00Z' });
      expect(s.tradingDay).toBe('2026-08-05');
      expect(s.source).toBe('manual');
    }));

  it('rejects overlaps unless forced', () =>
    asUser(async () => {
      await svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T13:00:00Z', end: '2026-08-05T15:00:00Z' });
      const overlapping = { typeId: 'st_daily_review', start: '2026-08-05T14:30:00Z', end: '2026-08-05T15:30:00Z' };
      await expect(svc.createManualSession(overlapping)).rejects.toThrow(/overlaps/);
      expect((await svc.createManualSession(overlapping, true)).id).toBeTruthy();
    }));

  it('validates times', () =>
    asUser(async () => {
      await expect(svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T15:00:00Z', end: '2026-08-05T14:00:00Z' })).rejects.toThrow(/after the start/);
      await expect(svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T00:00:00Z', end: '2026-08-06T01:00:00Z' })).rejects.toThrow(/24 hours/);
    }));
});

describe('edits and history', () => {
  it('keeps old and new values with a reason', () =>
    asUser(async () => {
      const s = await svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T13:00:00Z', end: '2026-08-05T15:00:00Z' });
      const updated = await svc.updateSession(s.id, { end: '2026-08-05T14:00:00Z', typeId: 'st_backtesting' }, 'Forgot to stop');
      expect(updated.editedAt).not.toBeNull();
      const changes = (await svc.sessionHistory(s.id)).filter((h) => h.action === 'update');
      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'end', oldValue: '2026-08-05T15:00:00Z', newValue: '2026-08-05T14:00:00Z', reason: 'Forgot to stop' }),
          expect.objectContaining({ field: 'typeId', oldValue: 'st_trading', newValue: 'st_backtesting' }),
        ]),
      );
    }));

  it('soft-deletes and restores', () =>
    asUser(async () => {
      const s = await svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T13:00:00Z', end: '2026-08-05T15:00:00Z' });
      await svc.deleteSession(s.id);
      expect(await svc.listSessions({ from: '2026-08-01', to: '2026-08-31' })).toHaveLength(0);
      await svc.restoreSession(s.id);
      expect(await svc.listSessions({ from: '2026-08-01', to: '2026-08-31' })).toHaveLength(1);
    }));

  it('recomputes trading days when the rollover changes', () =>
    asUser(async () => {
      // 01:30 Perth 6 Aug: trading day 5 Aug with a 10:00 rollover, 6 Aug with a 01:00 rollover.
      const s = await svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T17:30:00Z', end: '2026-08-05T18:00:00Z' });
      expect(s.tradingDay).toBe('2026-08-05');
      expect(await svc.recomputeTradingDays('01:00')).toBe(1);
      expect(await svc.listSessions({ from: '2026-08-06', to: '2026-08-06' })).toHaveLength(1);
    }));
});

describe('financial year report', () => {
  it('includes only completed sessions in the FY, oldest first', () =>
    asUser(async () => {
      await svc.createManualSession({ typeId: 'st_trading', start: '2026-06-30T13:00:00Z', end: '2026-06-30T14:00:00Z' });
      await svc.createManualSession({ typeId: 'st_trading', start: '2026-07-02T13:00:00Z', end: '2026-07-02T14:00:00Z' });
      await svc.createManualSession({ typeId: 'st_trading', start: '2026-07-01T13:00:00Z', end: '2026-07-01T14:00:00Z' });
      const { fy, sessions } = await svc.sessionsForFinancialYear(2026);
      expect(fy.label).toBe('2026–27');
      expect(sessions.map((s) => s.tradingDay)).toEqual(['2026-07-01', '2026-07-02']);
    }));
});

describe('sessionFinancialYears', () => {
  it('lists years with sessions, newest first, always including the current one', () =>
    asUser(async () => {
      expect(await svc.sessionFinancialYears(2026)).toEqual([2026]);
      await svc.createManualSession({ typeId: 'st_trading', start: '2025-03-05T12:00:00Z', end: '2025-03-05T13:00:00Z' }); // FY 2024–25
      await svc.createManualSession({ typeId: 'st_trading', start: '2025-07-02T12:00:00Z', end: '2025-07-02T13:00:00Z' }); // FY 2025–26
      expect(await svc.sessionFinancialYears(2026)).toEqual([2026, 2025, 2024]);
    }));
});
