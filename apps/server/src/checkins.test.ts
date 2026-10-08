import { beforeEach, describe, expect, it } from 'vitest';
import * as accounts from './accounts';
import * as ci from './checkins';
import * as sessions from './sessions';
import * as settings from './settings';
import * as trades from './trades';
import { asUser, useTestDb } from './testing';

useTestDb();

let acct: string;
beforeEach(() =>
  asUser(async () => {
    await settings.updateSettings({ checkInEnabled: true, checkInMinutes: 90, checkInSecondMinutes: 150 });
    acct = (await accounts.createAccount({ name: 'A', type: 'funded' })).id;
  }),
);

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const core = [
  { questionId: 'q_mood', value: 'li_mood_focused' },
  { questionId: 'q_focus', value: 4 },
  { questionId: 'q_plan', value: 'yes' },
];

const tradeAt = async (sessionId: string | undefined, at: string) => {
  const exit = new Date(Date.parse(at) + 60_000).toISOString();
  return await trades.createTrade({
    tradingDay: '2026-09-29',
    contractId: 'ct_mnq',
    sessionId,
    fills: [
      { at, side: 'buy', qty: 1, price: 20000 },
      { at: exit, side: 'sell', qty: 1, price: 20005 },
    ],
    accounts: [{ accountId: acct, multiplier: 1 }],
  });
};

describe('readings', () => {
  it('snapshots answers with labels and only the questions for that kind', () =>
    asUser(async () => {
      const s = await sessions.startTimer('st_trading', minsAgo(30));
      const r = await ci.createReading(s.id, { kind: 'start', answers: [...core, { questionId: 'q_day_plan', value: '  ORB only  ' }] });
      expect(r.at).toBe(s.start);
      expect(r.answers.map((a) => a.questionId)).toEqual(['q_mood', 'q_focus', 'q_energy', 'q_plan', 'q_day_plan', 'q_levels']);
      expect(r.answers.find((a) => a.questionId === 'q_mood')).toMatchObject({ value: 'li_mood_focused', label: 'Focused' });
      expect(r.answers.find((a) => a.questionId === 'q_day_plan')?.value).toBe('ORB only');
      await expect(ci.createReading(s.id, { kind: 'checkin', answers: [{ questionId: 'q_day_plan', value: 'x' }], decision: 'keep_trading' })).rejects.toThrow(/current question/);
    }));

  it('validates values, decisions and session type', () =>
    asUser(async () => {
      const s = await sessions.startTimer('st_trading', minsAgo(30));
      await expect(ci.createReading(s.id, { kind: 'checkin', answers: [{ questionId: 'q_focus', value: 9 }], decision: 'stop' })).rejects.toThrow(/1 to 5/);
      await expect(ci.createReading(s.id, { kind: 'checkin', answers: core })).rejects.toThrow(/decision/);
      await sessions.stopTimer(s.id);
      const other = await sessions.startTimer('st_backtesting');
      await expect(ci.createReading(other.id, { kind: 'start', answers: core })).rejects.toThrow(/only for trading/);
    }));
});

describe('state on trades', () => {
  it('attaches the latest reading before entry and re-attaches when a later check-in arrives', () =>
    asUser(async () => {
      const s = await sessions.startTimer('st_trading', minsAgo(120));
      const start = await ci.createReading(s.id, { kind: 'start', answers: core });
      const early = await tradeAt(undefined, minsAgo(100));
      expect(early.sessionId).toBe(s.id);
      expect(early.stateReadingId).toBe(start.id);

      const late = await tradeAt(undefined, minsAgo(2));
      const check = await ci.createReading(s.id, { kind: 'checkin', answers: core, decision: 'keep_trading', at: minsAgo(10) });
      expect((await trades.getTrade(late.id)).stateReadingId).toBe(check.id);
      expect((await trades.getTrade(early.id)).stateReadingId).toBe(start.id);
      expect((await trades.getTrade(late.id)).state?.kind).toBe('checkin');
    }));

  it('moves the start reading with the session start and re-links trades', () =>
    asUser(async () => {
      const s = await sessions.startTimer('st_trading', minsAgo(60));
      const start = await ci.createReading(s.id, { kind: 'start', answers: core });
      const t = await tradeAt(undefined, minsAgo(90));
      expect(t.stateReadingId).toBeNull();
      await sessions.updateSession(s.id, { start: minsAgo(100) }, 'started earlier', true);
      await ci.relinkSessionTrades(s.id);
      expect(await trades.getTrade(t.id)).toMatchObject({ sessionId: s.id, stateReadingId: start.id });
    }));

  it('keeps a manual override', () =>
    asUser(async () => {
      const s = await sessions.startTimer('st_trading', minsAgo(120));
      await ci.createReading(s.id, { kind: 'start', answers: core });
      const at = minsAgo(60);
      const t = await trades.createTrade({
        tradingDay: '2026-09-29',
        contractId: 'ct_mnq',
        stateReadingId: null,
        fills: [
          { at, side: 'buy', qty: 1, price: 20000 },
          { at: minsAgo(59), side: 'sell', qty: 1, price: 20005 },
        ],
        accounts: [{ accountId: acct, multiplier: 1 }],
      });
      expect(t).toMatchObject({ stateReadingId: null, stateOverridden: true });
      await ci.createReading(s.id, { kind: 'checkin', answers: core, decision: 'keep_trading', at: minsAgo(70) });
      expect((await trades.getTrade(t.id)).stateReadingId).toBeNull();
    }));
});

describe('check-in prompt', () => {
  it('is due at each threshold, and snooze/dismiss/answer quiet it', () =>
    asUser(async () => {
      const s = await sessions.startTimer('st_trading', minsAgo(95));
      expect(await ci.getDueCheckIn()).toMatchObject({ sessionId: s.id, level: 1, thresholdMinutes: 90 });
      await ci.snoozeCheckIn(s.id);
      expect(await ci.getDueCheckIn()).toBeNull();
      await ci.dismissCheckIn(s.id);
      expect(await ci.getDueCheckIn()).toBeNull();
    }));

  it('answering a check-in handles the current level; notifications fire once per level', () =>
    asUser(async () => {
      const s = await sessions.startTimer('st_trading', minsAgo(160));
      expect(await ci.checkInToNotify()).toMatchObject({ level: 2 });
      expect(await ci.checkInToNotify()).toBeNull();
      await ci.createReading(s.id, { kind: 'checkin', answers: core, decision: 'take_break' });
      expect(await ci.getDueCheckIn()).toBeNull();
    }));

  it('never prompts for non-trading sessions or when switched off', () =>
    asUser(async () => {
      await sessions.startTimer('st_backtesting', minsAgo(200));
      expect(await ci.getDueCheckIn()).toBeNull();
      await sessions.deleteSession((await sessions.getRunningSession())!.id);
      await sessions.startTimer('st_trading', minsAgo(200));
      await settings.updateSettings({ checkInEnabled: false });
      expect(await ci.getDueCheckIn()).toBeNull();
    }));
});
