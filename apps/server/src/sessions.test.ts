import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

let svc: typeof import('./sessions');
let ctx: typeof import('./context');
let settings: typeof import('./settings');

beforeAll(async () => {
  process.env.TC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tc-sessions-'));
  ctx = await import('./context');
  svc = await import('./sessions');
  settings = await import('./settings');
});

beforeEach(() => {
  ctx.sqlite.exec('DELETE FROM session; DELETE FROM audit_log;');
  settings.updateSettings({ rolloverTime: '10:00' });
});

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

describe('session types', () => {
  it('seeds the default list with Trading flagged', () => {
    const types = svc.listSessionTypes();
    expect(types.map((t) => t.name)).toEqual(['Trading', 'Daily review', 'Weekly review', 'Backtesting', 'Education', 'Other']);
    expect(types.filter((t) => t.isTrading).map((t) => t.id)).toEqual(['st_trading']);
  });
});

describe('timer', () => {
  it('starts, refuses a second timer, and stops', () => {
    const s = svc.startTimer('st_trading', hoursAgo(1));
    expect(s.source).toBe('timer');
    expect(() => svc.startTimer('st_other')).toThrow(/already running/);
    const stopped = svc.stopTimer(s.id);
    expect(stopped.end).not.toBeNull();
    expect(stopped.editedAt).toBeNull();
    expect(svc.getRunningSession()).toBeNull();
  });

  it('records an adjusted stop time as an edit', () => {
    const s = svc.startTimer('st_trading', hoursAgo(3));
    const end = hoursAgo(1);
    const stopped = svc.stopTimer(s.id, end);
    expect(stopped.end).toBe(end);
    expect(stopped.editedAt).not.toBeNull();
    const history = svc.sessionHistory(s.id);
    expect(history.map((h) => h.action)).toEqual(['create', 'update']);
    expect(history[1]).toMatchObject({ field: 'end', newValue: end });
  });
});

describe('manual sessions', () => {
  it('assigns the trading day using the rollover', () => {
    // 23:30–01:30 Perth on 5/6 Aug 2026 belongs to 5 Aug.
    const s = svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T15:30:00Z', end: '2026-08-05T17:30:00Z' });
    expect(s.tradingDay).toBe('2026-08-05');
    expect(s.source).toBe('manual');
  });

  it('rejects overlaps unless forced', () => {
    svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T13:00:00Z', end: '2026-08-05T15:00:00Z' });
    const overlapping = { typeId: 'st_daily_review', start: '2026-08-05T14:30:00Z', end: '2026-08-05T15:30:00Z' };
    expect(() => svc.createManualSession(overlapping)).toThrow(/overlaps/);
    expect(svc.createManualSession(overlapping, true).id).toBeTruthy();
  });

  it('validates times', () => {
    expect(() => svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T15:00:00Z', end: '2026-08-05T14:00:00Z' })).toThrow(/after the start/);
    expect(() => svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T00:00:00Z', end: '2026-08-06T01:00:00Z' })).toThrow(/24 hours/);
  });
});

describe('edits and history', () => {
  it('keeps old and new values with a reason', () => {
    const s = svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T13:00:00Z', end: '2026-08-05T15:00:00Z' });
    const updated = svc.updateSession(s.id, { end: '2026-08-05T14:00:00Z', typeId: 'st_backtesting' }, 'Forgot to stop');
    expect(updated.editedAt).not.toBeNull();
    const changes = svc.sessionHistory(s.id).filter((h) => h.action === 'update');
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'end', oldValue: '2026-08-05T15:00:00Z', newValue: '2026-08-05T14:00:00Z', reason: 'Forgot to stop' }),
        expect.objectContaining({ field: 'typeId', oldValue: 'st_trading', newValue: 'st_backtesting' }),
      ]),
    );
  });

  it('soft-deletes and restores', () => {
    const s = svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T13:00:00Z', end: '2026-08-05T15:00:00Z' });
    svc.deleteSession(s.id);
    expect(svc.listSessions({ from: '2026-08-01', to: '2026-08-31' })).toHaveLength(0);
    svc.restoreSession(s.id);
    expect(svc.listSessions({ from: '2026-08-01', to: '2026-08-31' })).toHaveLength(1);
  });

  it('recomputes trading days when the rollover changes', () => {
    // 01:30 Perth 6 Aug: trading day 5 Aug with a 10:00 rollover, 6 Aug with a 01:00 rollover.
    const s = svc.createManualSession({ typeId: 'st_trading', start: '2026-08-05T17:30:00Z', end: '2026-08-05T18:00:00Z' });
    expect(s.tradingDay).toBe('2026-08-05');
    expect(svc.recomputeTradingDays('01:00')).toBe(1);
    expect(svc.listSessions({ from: '2026-08-06', to: '2026-08-06' })).toHaveLength(1);
  });
});

describe('financial year report', () => {
  it('includes only completed sessions in the FY, oldest first', () => {
    svc.createManualSession({ typeId: 'st_trading', start: '2026-06-30T13:00:00Z', end: '2026-06-30T14:00:00Z' });
    svc.createManualSession({ typeId: 'st_trading', start: '2026-07-02T13:00:00Z', end: '2026-07-02T14:00:00Z' });
    svc.createManualSession({ typeId: 'st_trading', start: '2026-07-01T13:00:00Z', end: '2026-07-01T14:00:00Z' });
    const { fy, sessions } = svc.sessionsForFinancialYear(2026);
    expect(fy.label).toBe('2026–27');
    expect(sessions.map((s) => s.tradingDay)).toEqual(['2026-07-01', '2026-07-02']);
  });
});
