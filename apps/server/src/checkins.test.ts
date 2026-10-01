import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

let ci: typeof import('./checkins');
let sessions: typeof import('./sessions');
let trades: typeof import('./trades');
let accounts: typeof import('./accounts');
let settings: typeof import('./settings');
let ctx: typeof import('./context');

beforeAll(async () => {
  process.env.TC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tc-checkins-'));
  ctx = await import('./context');
  ci = await import('./checkins');
  sessions = await import('./sessions');
  trades = await import('./trades');
  accounts = await import('./accounts');
  settings = await import('./settings');
});

let acct: string;
beforeEach(() => {
  ctx.sqlite.exec(`DELETE FROM fill; DELETE FROM trade_account; DELETE FROM trade_criterion_check; DELETE FROM trade_tag; DELETE FROM trade;
    DELETE FROM state_reading; DELETE FROM session; DELETE FROM setting WHERE key = 'state.checkin';`);
  settings.updateSettings({ checkInEnabled: true, checkInMinutes: 90, checkInSecondMinutes: 150 });
  acct = accounts.createAccount({ name: 'A', type: 'funded' }).id;
});

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const core = [
  { questionId: 'q_mood', value: 'li_mood_focused' },
  { questionId: 'q_focus', value: 4 },
  { questionId: 'q_plan', value: 'yes' },
];

const tradeAt = (sessionId: string | undefined, at: string) => {
  const exit = new Date(Date.parse(at) + 60_000).toISOString();
  return trades.createTrade({
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
  it('snapshots answers with labels and only the questions for that kind', () => {
    const s = sessions.startTimer('st_trading', minsAgo(30));
    const r = ci.createReading(s.id, { kind: 'start', answers: [...core, { questionId: 'q_day_plan', value: '  ORB only  ' }] });
    expect(r.at).toBe(s.start);
    expect(r.answers.map((a) => a.questionId)).toEqual(['q_mood', 'q_focus', 'q_energy', 'q_plan', 'q_day_plan', 'q_levels']);
    expect(r.answers.find((a) => a.questionId === 'q_mood')).toMatchObject({ value: 'li_mood_focused', label: 'Focused' });
    expect(r.answers.find((a) => a.questionId === 'q_day_plan')?.value).toBe('ORB only');
    expect(() => ci.createReading(s.id, { kind: 'checkin', answers: [{ questionId: 'q_day_plan', value: 'x' }], decision: 'keep_trading' })).toThrow(/current question/);
  });

  it('validates values, decisions and session type', () => {
    const s = sessions.startTimer('st_trading', minsAgo(30));
    expect(() => ci.createReading(s.id, { kind: 'checkin', answers: [{ questionId: 'q_focus', value: 9 }], decision: 'stop' })).toThrow(/1 to 5/);
    expect(() => ci.createReading(s.id, { kind: 'checkin', answers: core })).toThrow(/decision/);
    sessions.stopTimer(s.id);
    const other = sessions.startTimer('st_backtesting');
    expect(() => ci.createReading(other.id, { kind: 'start', answers: core })).toThrow(/only for trading/);
  });
});

describe('state on trades', () => {
  it('attaches the latest reading before entry and re-attaches when a later check-in arrives', () => {
    const s = sessions.startTimer('st_trading', minsAgo(120));
    const start = ci.createReading(s.id, { kind: 'start', answers: core });
    const early = tradeAt(undefined, minsAgo(100));
    expect(early.sessionId).toBe(s.id);
    expect(early.stateReadingId).toBe(start.id);

    const late = tradeAt(undefined, minsAgo(2));
    const check = ci.createReading(s.id, { kind: 'checkin', answers: core, decision: 'keep_trading', at: minsAgo(10) });
    expect(trades.getTrade(late.id).stateReadingId).toBe(check.id);
    expect(trades.getTrade(early.id).stateReadingId).toBe(start.id);
    expect(trades.getTrade(late.id).state?.kind).toBe('checkin');
  });

  it('moves the start reading with the session start and re-links trades', () => {
    const s = sessions.startTimer('st_trading', minsAgo(60));
    const start = ci.createReading(s.id, { kind: 'start', answers: core });
    const t = tradeAt(undefined, minsAgo(90));
    expect(t.stateReadingId).toBeNull();
    sessions.updateSession(s.id, { start: minsAgo(100) }, 'started earlier', true);
    ci.relinkSessionTrades(s.id);
    expect(trades.getTrade(t.id)).toMatchObject({ sessionId: s.id, stateReadingId: start.id });
  });

  it('keeps a manual override', () => {
    const s = sessions.startTimer('st_trading', minsAgo(120));
    ci.createReading(s.id, { kind: 'start', answers: core });
    const at = minsAgo(60);
    const t = trades.createTrade({
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
    ci.createReading(s.id, { kind: 'checkin', answers: core, decision: 'keep_trading', at: minsAgo(70) });
    expect(trades.getTrade(t.id).stateReadingId).toBeNull();
  });
});

describe('check-in prompt', () => {
  it('is due at each threshold, and snooze/dismiss/answer quiet it', () => {
    const s = sessions.startTimer('st_trading', minsAgo(95));
    expect(ci.getDueCheckIn()).toMatchObject({ sessionId: s.id, level: 1, thresholdMinutes: 90 });
    ci.snoozeCheckIn(s.id);
    expect(ci.getDueCheckIn()).toBeNull();
    ci.dismissCheckIn(s.id);
    expect(ci.getDueCheckIn()).toBeNull();
  });

  it('answering a check-in handles the current level; notifications fire once per level', () => {
    const s = sessions.startTimer('st_trading', minsAgo(160));
    expect(ci.checkInToNotify()).toMatchObject({ level: 2 });
    expect(ci.checkInToNotify()).toBeNull();
    ci.createReading(s.id, { kind: 'checkin', answers: core, decision: 'take_break' });
    expect(ci.getDueCheckIn()).toBeNull();
  });

  it('never prompts for non-trading sessions or when switched off', () => {
    sessions.startTimer('st_backtesting', minsAgo(200));
    expect(ci.getDueCheckIn()).toBeNull();
    ctx.sqlite.exec('DELETE FROM session;');
    sessions.startTimer('st_trading', minsAgo(200));
    settings.updateSettings({ checkInEnabled: false });
    expect(ci.getDueCheckIn()).toBeNull();
  });
});
