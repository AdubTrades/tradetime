import { beforeEach, describe, expect, it } from 'vitest';
import * as accounts from './accounts';
import * as contracts from './contracts';
import * as imp from './tradeImport';
import * as trades from './trades';
import { asUser, useTestDb } from './testing';

useTestDb();

let a1: string;
let a2: string;
beforeEach(() =>
  asUser(async () => {
    a1 = (await accounts.createAccount({ name: 'Lucid 50K #1', type: 'funded' })).id;
    a2 = (await accounts.createAccount({ name: 'Lucid 50K #2', type: 'funded' })).id;
    await contracts.updateContract('ct_mnq', { feePerSideCents: 50 });
  }),
);

// NinjaTrader 8 "Executions" grid export (Australian date format, Perth time). Two Lucid accounts copy each
// other; the first trade scales out on account 1; the last trade is still open at the end of the file.
const HEADER = 'Instrument,Action,Quantity,Price,Time,ID,E/X,Position,Order ID,Name,Commission,Rate,Account,Connection';
const nt = [
  HEADER,
  'MNQ 12-26,Buy,2,"20,000.00",29/09/2026 21:31:05,e1,Entry,2 L,o1,Entry,$1.00,1,LFE-0001,Lucid',
  'MNQ 12-26,Buy,2,"20,000.25",29/09/2026 21:31:06,e2,Entry,2 L,o2,Entry,$1.00,1,LFE-0002,Lucid',
  'MNQ 12-26,Sell,1,"20,010.00",29/09/2026 21:34:00,e3,Exit,1 L,o3,Target1,$0.50,1,LFE-0001,Lucid',
  'MNQ 12-26,Sell,1,"20,015.00",29/09/2026 21:36:40,e4,Exit,-,o4,Target2,$0.50,1,LFE-0001,Lucid',
  'MNQ 12-26,Sell,2,"20,014.75",29/09/2026 21:36:41,e5,Exit,-,o5,Exit,$1.00,1,LFE-0002,Lucid',
  'MNQ 12-26,Sell,1,"20,030.00",29/09/2026 22:05:00,e6,Entry,1 S,o6,Entry,$0.50,1,LFE-0001,Lucid',
  'MNQ 12-26,Buy,1,"20,036.00",29/09/2026 22:08:00,e7,Exit,-,o7,Stop,$0.50,1,LFE-0001,Lucid',
  'MNQ 12-26,Buy,1,"20,040.00",29/09/2026 22:30:00,e8,Entry,1 L,o8,Entry,$0.50,1,LFE-0001,Lucid',
].join('\n');

describe('NinjaTrader import', () => {
  it('previews round trips, merges the copy trade and reports the open position', () =>
    asUser(async () => {
      const p = await imp.previewImport({ csv: nt });
      expect(p.format).toBe('ninjatrader-executions');
      expect(p.detectedOrder).toBe('dmy');
      expect(p.counts).toMatchObject({ rows: 8, executions: 8, duplicates: 0, open: 1, issues: 0 });
      expect(p.accountsInFile.map((a) => a.name)).toEqual(['LFE-0001', 'LFE-0002']);
      expect(p.trades).toHaveLength(2);
      expect(p.trades[0]!.accounts.map((a) => [a.name, a.maxQty, a.fills])).toEqual([
        ['LFE-0001', 2, 3],
        ['LFE-0002', 2, 2],
      ]);
      // Account mapping is required before importing.
      expect(p.trades[0]!.status).toBe('error');
    }));

  it('imports with account mapping, keeps per-account prices and fees, and remembers the mapping', () =>
    asUser(async () => {
      const accountMap = { 'LFE-0001': a1, 'LFE-0002': a2 };
      const res = await imp.commitImport({ csv: nt, accountMap });
      expect(res).toMatchObject({ created: 2, attached: 0, open: 1 });
      const list = await trades.listTrades({ from: '2026-09-29', to: '2026-09-29' });
      const copy = list.find((t) => t.direction === 'long')!;
      // Account 1: +10 and +15 pts on 1 each = 25 pts × $2 = $50 − $2 fees; account 2: 14.5 pts × 2 × $2 = $58 − $2.
      expect(copy.accounts.map((a) => [a.netCents, a.feesCents])).toEqual([
        [4800, 200],
        [5600, 200],
      ]);
      expect(copy).toMatchObject({ source: 'import', needsReview: true });
      expect((await imp.listAliases()).map((x) => x.alias).sort()).toEqual(['LFE-0001', 'LFE-0002']);
      // Next time the accounts are recognised without mapping.
      expect((await imp.previewImport({ csv: nt })).accountsInFile.every((a) => a.accountId)).toBe(true);
    }));

  it('skips fills already imported, so overlapping exports only add new trades', () =>
    asUser(async () => {
      const accountMap = { 'LFE-0001': a1, 'LFE-0002': a2 };
      await imp.commitImport({ csv: nt, accountMap });
      const again = await imp.previewImport({ csv: nt, accountMap });
      expect(again.counts.duplicates).toBe(7);
      expect(again.trades).toHaveLength(0);
      // The previously open trade completes in a later export.
      const later = [nt, 'MNQ 12-26,Sell,1,"20,050.00",29/09/2026 22:40:00,e9,Exit,-,o9,Exit,$0.50,1,LFE-0001,Lucid'].join('\n');
      expect(await imp.commitImport({ csv: later, accountMap })).toMatchObject({ created: 1, duplicates: 7 });
    }));

  it('attaches fills to a trade logged live, keeping its Play and notes', () =>
    asUser(async () => {
      const logged = await trades.createTrade({
        tradingDay: '2026-09-29',
        contractId: 'ct_mnq',
        notes: 'Logged during the session',
        followedPlan: 'yes',
        fills: [
          { at: '2026-09-29T13:31:00Z', side: 'buy', qty: 2, price: 20000 },
          { at: '2026-09-29T13:37:00Z', side: 'sell', qty: 2, price: 20012 },
        ],
        accounts: [{ accountId: a1, multiplier: 1 }],
      });
      const res = await imp.commitImport({ csv: nt, accountMap: { 'LFE-0001': a1, 'LFE-0002': a2 } });
      expect(res).toMatchObject({ attached: 1, created: 1 });
      const t = await trades.getTrade(logged.id);
      expect(t).toMatchObject({ notes: 'Logged during the session', followedPlan: 'yes', source: 'import', needsReview: false });
      expect(t.accounts).toHaveLength(2);
      expect(t.accounts[0]!.fills.map((f) => f.externalId)).toEqual(['nt:e1', 'nt:e3', 'nt:e4']);
    }));

  it('reviewing an imported trade keeps its broker fills', () =>
    asUser(async () => {
      await imp.commitImport({ csv: nt, accountMap: { 'LFE-0001': a1, 'LFE-0002': a2 } });
      const t = (await trades.listTrades({ from: '2026-09-29', to: '2026-09-29' })).find((x) => x.direction === 'long')!;
      const reviewed = await trades.updateTrade(
        t.id,
        { tradingDay: t.tradingDay, contractId: t.contractId, notes: 'Reviewed', keepFills: true, fills: [], accounts: [] },
        null,
      );
      expect(reviewed).toMatchObject({ notes: 'Reviewed', needsReview: false, source: 'import' });
      expect(reviewed.accounts.map((a) => a.netCents)).toEqual([4800, 5600]);
    }));

  it('skips accounts set to skip and flags unknown contracts', () =>
    asUser(async () => {
      const csv = [nt, 'RTY 12-26,Buy,1,2300.0,30/09/2026 21:40:00,x1,Entry,1 L,o,E,$1,1,LFE-0001,Lucid', 'RTY 12-26,Sell,1,2301.0,30/09/2026 21:45:00,x2,Exit,-,o,E,$1,1,LFE-0001,Lucid'].join('\n');
      const p = await imp.previewImport({ csv, accountMap: { 'LFE-0001': a1, 'LFE-0002': 'skip' } });
      expect(p.trades[0]!.accounts.map((a) => a.name)).toEqual(['LFE-0001']);
      expect(p.trades.find((t) => t.symbol === 'RTY')!.issues[0]).toMatch(/isn't a contract/);
    }));
});
