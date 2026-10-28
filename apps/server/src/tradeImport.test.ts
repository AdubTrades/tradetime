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
      // XYZ is in neither the user's contracts nor the futures catalogue.
      const csv = [nt, 'XYZ 12-26,Buy,1,2300.0,30/09/2026 21:40:00,x1,Entry,1 L,o,E,$1,1,LFE-0001,Lucid', 'XYZ 12-26,Sell,1,2301.0,30/09/2026 21:45:00,x2,Exit,-,o,E,$1,1,LFE-0001,Lucid'].join('\n');
      const p = await imp.previewImport({ csv, accountMap: { 'LFE-0001': a1, 'LFE-0002': 'skip' } });
      expect(p.trades[0]!.accounts.map((a) => a.name)).toEqual(['LFE-0001']);
      expect(p.trades.find((t) => t.symbol === 'XYZ')!.issues[0]).toMatch(/isn't in TradeTime’s futures list/);
    }));
});

describe('contracts from the futures catalogue', () => {
  it('adds a catalogue contract once, brings back an archived one, and prefers the user’s own', () =>
    asUser(async () => {
      const gc = (await contracts.ensureContract('gc'))!;
      expect(gc).toMatchObject({ id: 'ct_gc', symbol: 'GC', name: 'Gold', tickSize: 0.1, pointValueCents: 10000, archived: false });
      expect((await contracts.ensureContract('GC'))!.id).toBe('ct_gc');
      await contracts.updateContract('ct_gc', { archived: true });
      expect((await contracts.ensureContract('GC'))!.archived).toBe(false);
      // A contract the user made themselves wins over the catalogue.
      const custom = await contracts.createContract({ symbol: 'CL', name: 'My crude', tickSize: 0.01, pointValueCents: 100000 });
      expect((await contracts.ensureContract('CL'))!.id).toBe(custom.id);
      expect(await contracts.ensureContract('NOPE')).toBeNull();
      expect((await contracts.listContracts()).filter((c) => c.symbol === 'GC')).toHaveLength(1);
    }));

  it('imports trades in a contract the user hasn’t set up, adding it from the catalogue', async () => {
    const gold = [HEADER, 'GC 12-26,Buy,1,"2,650.0",29/09/2026 21:31:05,g1,Entry,1 L,o1,Entry,$1.00,1,LFE-0001,Lucid', 'GC 12-26,Sell,1,"2,652.5",29/09/2026 21:40:00,g2,Exit,-,o2,Exit,$1.00,1,LFE-0001,Lucid'].join('\n');
    const accountMap = { 'LFE-0001': a1 };
    await asUser(async () => {
      const p = await imp.previewImport({ csv: gold, accountMap });
      expect(p.addsContracts).toEqual(['GC']);
      expect(p.trades).toMatchObject([{ symbol: 'GC', status: 'new', netCents: 25000 - 200 }]);
      // Previewing doesn't add anything.
      expect((await contracts.listContracts()).some((c) => c.symbol === 'GC')).toBe(false);
    });
    await asUser(async () => {
      const res = await imp.commitImport({ csv: gold, accountMap });
      expect(res.created).toBe(1);
      expect((await contracts.listContracts()).find((c) => c.symbol === 'GC')?.id).toBe('ct_gc');
    });
  });
});

describe('trade lists (one row per trade, e.g. TradeZella)', () => {
  // Same layout as a TradeZella export: no side, size or entry time; P&L tells us both.
  const list = [
    'Open Date,Symbol,Status,Close Date,Entry Price,Exit Price,Net P&L,Net ROI,Zella Score,Close Time,Commission',
    '2026-04-16,NQ,Win,2026-04-16,26376.25,26374.75,30.0,0.00005687,4.8,21:42:57 AWST,0.0',
    '2026-04-16,NQ,Win,2026-04-16,26382.75,26467.5,1695.0,0.0032,99.4,23:09:25 AWST,0.0',
    '2026-04-21,NQ,Win,2026-04-21,26807.5,26832.5,1000.0,0.0009,79.4,21:59:53 AWST,0.0',
    '2026-04-22,MNQ,Loss,2026-04-22,26827.25,26847.0,-40.5,-0.0007,-91.9,21:52:28 AWST,1.0',
    '2026-04-23,NQ,Win,2026-04-23,27053.0,27053.0,0,0,0,22:57:52 AWST,0.0',
  ].join('\n');

  it('works out side and size from the P&L, at the close time in the zone the file names', () =>
    asUser(async () => {
      const p = await imp.previewImport({ csv: list, defaultAccount: 'Backtesting', accountMap: { Backtesting: a1 } });
      expect(p.format).toBe('trade-list');
      expect(p.rowIssues).toEqual([{ line: 6, message: 'Entry and exit are the same, so the direction and size can’t be worked out' }]);
      const byNet = Object.fromEntries(p.trades.map((t) => [t.netCents, t]));
      // 1.5 points against a short × $20 = +$30
      expect(byNet[3000]).toMatchObject({ symbol: 'NQ', direction: 'short', tradingDay: '2026-04-16', openedAt: '2026-04-16T13:42:57Z' });
      expect(byNet[169500]).toMatchObject({ direction: 'long' });
      // 25 points × $20 × 2 contracts = $1,000
      expect(byNet[100000]!.accounts[0]!.maxQty).toBe(2);
      // MNQ: 19.75 points × $2 = $39.50 gross loss, short, $1 commission → net −$40.50
      expect(byNet[-4050]).toMatchObject({ symbol: 'MNQ', direction: 'short' });
    }));

  it('keeps a stated $0 commission (a backtest) instead of applying the contract’s fee', () =>
    asUser(async () => {
      await contracts.updateContract('ct_nq', { feePerSideCents: 129 });
      const p = await imp.previewImport({ csv: list, defaultAccount: 'Backtesting', accountMap: { Backtesting: a1 } });
      expect(p.trades.map((t) => t.netCents).sort((x, y) => x! - y!)).toEqual([-4050, 3000, 100000, 169500]);
    }));

  it('imports into the chosen account and skips the same file the second time', async () => {
    const opts = { csv: list, defaultAccount: 'Backtesting', accountMap: { Backtesting: a1 } };
    expect((await asUser(() => imp.commitImport(opts))).created).toBe(4);
    const all = await asUser(() => trades.listTrades({ from: '2026-04-01', to: '2026-04-30' }));
    expect(all).toHaveLength(4);
    expect(all.every((t) => t.accounts.length === 1 && t.accounts[0]!.accountId === a1 && t.needsReview)).toBe(true);
    expect(all.reduce((s, t) => s + t.netCents, 0)).toBe(3000 + 169500 + 100000 - 4050);
    expect((await asUser(() => imp.commitImport(opts))).created).toBe(0);
  });
});

describe('trade lists with the extra columns (Open Time, Gross P&L, Realized RR)', () => {
  const list = [
    'Open Date,Symbol,Status,Close Date,Entry Price,Exit Price,Net P&L,Net ROI,Close Time,Commission,Realized RR,Points,Open Time,Gross P&L,Executions,Duration',
    '2026-04-16,NQ,Loss,2026-04-16,26323.5,26348.75,-505.0,-0.0009583,22:26:26 AWST,0.0,-1.0,-25.25,22:19:29 AWST,-505.0,2,417.0',
    '2026-04-16,NQ,Win,2026-04-16,26382.75,26467.5,1695.0,0.00321233,23:09:25 AWST,0.0,3.35643564,84.75,22:43:29 AWST,1695.0,2,1556.0',
    '2026-04-21,NQ,Win,2026-04-21,26807.5,26832.5,1000.0,0.00093257,21:59:53 AWST,0.0,1.0,25.0,21:55:59 AWST,1000.0,3,233.001',
  ].join('\n');

  it('uses the real entry time and gives each trade its R from the realized RR', async () => {
    const opts = { csv: list, defaultAccount: 'Backtesting', accountMap: { Backtesting: a1 } };
    const p = await asUser(() => imp.previewImport(opts));
    expect(p.trades.find((t) => t.netCents === -50500)).toMatchObject({ direction: 'short', openedAt: '2026-04-16T14:19:29Z', closedAt: '2026-04-16T14:26:26Z' });
    expect((await asUser(() => imp.commitImport(opts))).created).toBe(3);
    const all = await asUser(() => trades.listTrades({ from: '2026-04-01', to: '2026-04-30' }));
    const r = Object.fromEntries(all.map((t) => [t.netCents, t.r]));
    expect(r[-50500]).toBe(-1);
    expect(r[169500]).toBeCloseTo(3.36, 2);
    // 2 contracts, 25 points of risk each: +$1,000 is 1R
    expect(r[100000]).toBe(1);
  });
});
