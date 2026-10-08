import { beforeEach, describe, expect, it } from 'vitest';
import * as accounts from './accounts';
import * as contracts from './contracts';
import * as plays from './plays';
import * as sessions from './sessions';
import * as trades from './trades';
import { asUser, useTestDb } from './testing';

useTestDb();

let acctA: string;
let acctB: string;
let playId: string;
let crit: { must: string; s1: string; s2: string };

beforeEach(() =>
  asUser(async () => {
    acctA = (await accounts.createAccount({ name: 'Lucid A', type: 'funded' })).id;
    acctB = (await accounts.createAccount({ name: 'Lucid B', type: 'funded' })).id;
    playId = (await plays.createPlay({ title: 'Opening range break' })).id;
    crit = {
      must: (await plays.addCriterion(playId, { label: 'Break of OR high/low', mustHave: true })).id,
      s1: (await plays.addCriterion(playId, { label: 'Volume expansion' })).id,
      s2: (await plays.addCriterion(playId, { label: 'With higher-timeframe trend' })).id,
    };
  }),
);

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
  it('copies to accounts at their multipliers and totals P&L and R', () =>
    asUser(async () => {
      const t = await trades.createTrade(baseInput());
      // MNQ $2/pt: 15 pts → A $30, B $60. Risk 10 pts → A $20, B $40.
      expect(t.accounts.map((a) => [a.multiplier, a.grossCents, a.plannedRiskCents, a.fills[0]!.qty])).toEqual([
        [1, 3000, 2000, 1],
        [2, 6000, 4000, 2],
      ]);
      expect(t).toMatchObject({ direction: 'long', netCents: 9000, r: 1.5, plannedRiskPoints: 10, grade: 'A', outsidePlan: false });
    }));

  it('prefills fees from the contract per side', () =>
    asUser(async () => {
      await contracts.updateContract('ct_mnq', { feePerSideCents: 37 });
      const t = await trades.createTrade(baseInput());
      expect(t.accounts.map((a) => a.feesCents)).toEqual([74, 148]);
      expect(t.netCents).toBe(9000 - 222);
    }));

  it('flags a missed must-have as outside the plan', () =>
    asUser(async () => {
      const input = baseInput();
      input.checks[0]!.checked = false;
      expect(await trades.createTrade(input)).toMatchObject({ grade: null, outsidePlan: true });
    }));

  it('keeps the criteria snapshot when the Play changes later', () =>
    asUser(async () => {
      const t = await trades.createTrade(baseInput());
      await plays.updateCriterion(crit.s1, { label: 'Renamed', archived: true });
      expect((await trades.getTrade(t.id)).checks.map((c) => c.label)).toEqual(['Break of OR high/low', 'Volume expansion', 'With higher-timeframe trend']);
      expect((await trades.getTrade(t.id)).grade).toBe('A');
    }));

  it('rejects off-tick prices, future fills, bad quantities and duplicate accounts', () =>
    asUser(async () => {
      await expect(
        trades.createTrade({ ...baseInput(), fills: [{ ...fills(20000, 20015)[0]!, at: '2099-01-01T00:00:00Z' }, { ...fills(20000, 20015)[1]!, at: '2099-01-01T00:05:00Z' }] }),
      ).rejects.toThrow(/future/);
      await expect(trades.createTrade({ ...baseInput(), fills: fills(20000.1, 20015) })).rejects.toThrow(/tick size/);
      await expect(trades.createTrade({ ...baseInput(), fills: [fills(20000, 20015)[0]!, { ...fills(20000, 20015)[1]!, qty: 0 }] })).rejects.toThrow();
      await expect(trades.createTrade({ ...baseInput(), accounts: [{ accountId: acctA, multiplier: 1 }, { accountId: acctA, multiplier: 1 }] })).rejects.toThrow(/twice/);
    }));

  it('links the trading session that was running at entry', () =>
    asUser(async () => {
      const s = await sessions.createManualSession({ typeId: 'st_trading', start: '2026-09-29T13:00:00Z', end: '2026-09-29T15:00:00Z' });
      await sessions.createManualSession({ typeId: 'st_backtesting', start: '2026-09-29T15:00:00Z', end: '2026-09-29T16:00:00Z' });
      expect((await trades.createTrade(baseInput())).sessionId).toBe(s.id);
      expect((await trades.createTrade({ ...baseInput(), sessionId: null })).sessionId).toBeNull();
    }));
});

describe('editing trades', () => {
  it('replaces fills, recalculates, and audits what changed', () =>
    asUser(async () => {
      const t = await trades.createTrade(baseInput());
      const updated = await trades.updateTrade(t.id, { ...baseInput(), fills: fills(20000, 19990) }, 'Wrong exit');
      expect(updated.netCents).toBe(-6000);
      expect(updated.r).toBe(-1);
      const changes = (await trades.tradeHistory(t.id)).filter((h) => h.action === 'update');
      expect(changes.map((h) => h.field)).toEqual(expect.arrayContaining(['fills', 'accounts']));
      expect(changes[0]!.reason).toBe('Wrong exit');
    }));

  it('lists trades in a day range with totals', () =>
    asUser(async () => {
      await trades.createTrade(baseInput());
      await trades.createTrade({ ...baseInput(), tradingDay: '2026-09-30' });
      const list = await trades.listTrades({ from: '2026-09-29', to: '2026-09-29' });
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ netCents: 9000, r: 1.5 });
      expect(list[0]!.accounts).toHaveLength(2);
    }));
});

describe('playbook', () => {
  it('validates grade rules', () =>
    asUser(async () => {
      const rules = (await plays.getPlay(playId)).gradeRules;
      rules[1]!.maxMissed = 5;
      await expect(plays.updatePlay(playId, { gradeRules: rules })).rejects.toThrow(/can't allow fewer/);
    }));

  it('labels results for gallery examples', () =>
    asUser(async () => {
      expect(await trades.resultLabel({ netCents: 9000, r: 1.5 })).toBe('Win +1.5R');
      expect(await trades.resultLabel({ netCents: -100, r: -1 })).toBe('Loss -1R');
      expect(await trades.resultLabel({ netCents: 0, r: null })).toBe('Breakeven');
    }));
});
