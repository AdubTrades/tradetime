import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

let trades: typeof import('./trades');
let plays: typeof import('./plays');
let accounts: typeof import('./accounts');
let contracts: typeof import('./contracts');
let sessions: typeof import('./sessions');
let ctx: typeof import('./context');

beforeAll(async () => {
  process.env.TC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tc-trades-'));
  ctx = await import('./context');
  trades = await import('./trades');
  plays = await import('./plays');
  accounts = await import('./accounts');
  contracts = await import('./contracts');
  sessions = await import('./sessions');
});

let acctA: string;
let acctB: string;
let playId: string;
let crit: { must: string; s1: string; s2: string };

beforeEach(() => {
  ctx.sqlite.exec(`DELETE FROM fill; DELETE FROM trade_account; DELETE FROM trade_criterion_check; DELETE FROM trade_tag; DELETE FROM trade;
    DELETE FROM play_example; DELETE FROM play_criterion; DELETE FROM play; DELETE FROM session; DELETE FROM audit_log; UPDATE contract SET fee_per_side_cents = 0;`);
  acctA = accounts.createAccount({ name: 'Lucid A', type: 'funded' }).id;
  acctB = accounts.createAccount({ name: 'Lucid B', type: 'funded' }).id;
  playId = plays.createPlay({ title: 'Opening range break' }).id;
  crit = {
    must: plays.addCriterion(playId, { label: 'Break of OR high/low', mustHave: true }).id,
    s1: plays.addCriterion(playId, { label: 'Volume expansion' }).id,
    s2: plays.addCriterion(playId, { label: 'With higher-timeframe trend' }).id,
  };
});

const fills = (entry: number, exit: number, qty = 1) => [
  { at: '2026-09-29T13:31:00Z', side: 'buy' as const, qty, price: entry },
  { at: '2026-09-29T13:38:00Z', side: 'sell' as const, qty, price: exit },
];

const baseInput = () => ({
  tradingDay: '2026-09-29',
  contractId: 'ct_mnq',
  playId,
  checks: [
    { criterionId: crit.must, checked: true },
    { criterionId: crit.s1, checked: true },
    { criterionId: crit.s2, checked: false },
  ],
  stopPrice: 19990,
  targetPrice: 20030,
  fills: fills(20000, 20015),
  accounts: [
    { accountId: acctA, multiplier: 1 },
    { accountId: acctB, multiplier: 2 },
  ],
});

describe('creating trades', () => {
  it('copies to accounts at their multipliers and totals P&L and R', () => {
    const t = trades.createTrade(baseInput());
    // MNQ $2/pt: 15 pts → A $30, B $60. Risk 10 pts → A $20, B $40.
    expect(t.accounts.map((a) => [a.multiplier, a.grossCents, a.plannedRiskCents, a.fills[0]!.qty])).toEqual([
      [1, 3000, 2000, 1],
      [2, 6000, 4000, 2],
    ]);
    expect(t).toMatchObject({ direction: 'long', netCents: 9000, r: 1.5, plannedRiskPoints: 10, grade: 'A', outsidePlan: false });
  });

  it('prefills fees from the contract per side', () => {
    contracts.updateContract('ct_mnq', { feePerSideCents: 37 });
    const t = trades.createTrade(baseInput());
    expect(t.accounts.map((a) => a.feesCents)).toEqual([74, 148]);
    expect(t.netCents).toBe(9000 - 222);
  });

  it('flags a missed must-have as outside the plan', () => {
    const input = baseInput();
    input.checks[0]!.checked = false;
    expect(trades.createTrade(input)).toMatchObject({ grade: null, outsidePlan: true });
  });

  it('keeps the criteria snapshot when the Play changes later', () => {
    const t = trades.createTrade(baseInput());
    plays.updateCriterion(crit.s1, { label: 'Renamed', archived: true });
    expect(trades.getTrade(t.id).checks.map((c) => c.label)).toEqual(['Break of OR high/low', 'Volume expansion', 'With higher-timeframe trend']);
    expect(trades.getTrade(t.id).grade).toBe('A');
  });

  it('rejects off-tick prices, future fills, bad quantities and duplicate accounts', () => {
    expect(() =>
      trades.createTrade({ ...baseInput(), fills: [{ ...fills(20000, 20015)[0]!, at: '2099-01-01T00:00:00Z' }, { ...fills(20000, 20015)[1]!, at: '2099-01-01T00:05:00Z' }] }),
    ).toThrow(/future/);
    expect(() => trades.createTrade({ ...baseInput(), fills: fills(20000.1, 20015) })).toThrow(/tick size/);
    expect(() => trades.createTrade({ ...baseInput(), fills: [fills(20000, 20015)[0]!, { ...fills(20000, 20015)[1]!, qty: 0 }] })).toThrow();
    expect(() => trades.createTrade({ ...baseInput(), accounts: [{ accountId: acctA, multiplier: 1 }, { accountId: acctA, multiplier: 1 }] })).toThrow(/twice/);
  });

  it('links the trading session that was running at entry', () => {
    const s = sessions.createManualSession({ typeId: 'st_trading', start: '2026-09-29T13:00:00Z', end: '2026-09-29T15:00:00Z' });
    sessions.createManualSession({ typeId: 'st_backtesting', start: '2026-09-29T15:00:00Z', end: '2026-09-29T16:00:00Z' });
    expect(trades.createTrade(baseInput()).sessionId).toBe(s.id);
    expect(trades.createTrade({ ...baseInput(), sessionId: null }).sessionId).toBeNull();
  });
});

describe('editing trades', () => {
  it('replaces fills, recalculates, and audits what changed', () => {
    const t = trades.createTrade(baseInput());
    const updated = trades.updateTrade(t.id, { ...baseInput(), fills: fills(20000, 19990) }, 'Wrong exit');
    expect(updated.netCents).toBe(-6000);
    expect(updated.r).toBe(-1);
    const changes = trades.tradeHistory(t.id).filter((h) => h.action === 'update');
    expect(changes.map((h) => h.field)).toEqual(expect.arrayContaining(['fills', 'accounts']));
    expect(changes[0]!.reason).toBe('Wrong exit');
  });

  it('lists trades in a day range with totals', () => {
    trades.createTrade(baseInput());
    trades.createTrade({ ...baseInput(), tradingDay: '2026-09-30' });
    const list = trades.listTrades({ from: '2026-09-29', to: '2026-09-29' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ netCents: 9000, r: 1.5 });
    expect(list[0]!.accounts).toHaveLength(2);
  });
});

describe('playbook', () => {
  it('validates grade rules', () => {
    const rules = plays.getPlay(playId).gradeRules;
    rules[1]!.maxMissed = 5;
    expect(() => plays.updatePlay(playId, { gradeRules: rules })).toThrow(/can't allow fewer/);
  });

  it('labels results for gallery examples', () => {
    expect(trades.resultLabel({ netCents: 9000, r: 1.5 })).toBe('Win +1.5R');
    expect(trades.resultLabel({ netCents: -100, r: -1 })).toBe('Loss -1R');
    expect(trades.resultLabel({ netCents: 0, r: null })).toBe('Breakeven');
  });
});
