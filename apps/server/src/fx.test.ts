import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as accounts from './accounts';
import * as contracts from './contracts';
import { setRateFetcher, usdRate } from './fx';
import { getAppState } from './settings';
import { asUser, useTestDb } from './testing';
import * as trades from './trades';

useTestDb();

let acct: string;
const asked: string[] = [];
beforeEach(async () => {
  asked.length = 0;
  // A fake rate service: GBP is worth 1.3335 USD.
  setRateFetcher(async (currency, date) => {
    asked.push(`${currency} ${date}`);
    if (currency === 'GBP') return 1.3335;
    throw new Error('unknown currency');
  });
  await asUser(async () => {
    acct = (await accounts.createAccount({ name: 'FOREX.com', type: 'live' })).id;
  });
});
afterEach(() => setRateFetcher(null));

/** Buy `units` at `entry`, sell at `exit`. */
const forexTrade = (contractId: string, units: number, entry: number, exit: number) => ({
  tradingDay: '2026-09-29',
  contractId,
  fills: [
    { at: '2026-09-29T13:31:00Z', side: 'buy' as const, qty: units, price: entry },
    { at: '2026-09-29T13:38:00Z', side: 'sell' as const, qty: units, price: exit },
  ],
  accounts: [{ accountId: acct, multiplier: 1, feesCents: 0 }],
});

describe('forex trades', () => {
  it('EUR/USD: P&L in USD directly (10,000 units × 10 pips = $10)', () =>
    asUser(async () => {
      const c = (await contracts.ensureContract('EUR/USD'))!;
      expect(c).toMatchObject({ id: 'ct_eurusd', symbol: 'EURUSD', currency: 'USD' });
      const t = await trades.createTrade(forexTrade(c.id, 10_000, 1.085, 1.086));
      expect(t.accounts[0]).toMatchObject({ grossCents: 1000, netCents: 1000 });
      expect(asked).toEqual([]);
    }));

  it('USD/JPY: yen P&L converted at the exit price (100,000 units × 50 pips = ¥50,000 ≈ $333.11)', () =>
    asUser(async () => {
      const c = (await contracts.ensureContract('USDJPY'))!;
      expect(c.currency).toBe('JPY');
      const t = await trades.createTrade(forexTrade(c.id, 100_000, 149.6, 150.1));
      expect(t.accounts[0]!.grossCents).toBe(Math.round((50_000 / 150.1) * 100));
      expect(asked).toEqual([]);
    }));

  it('EUR/GBP: pound P&L converted at the day’s rate, fetched once and kept', async () => {
    const id = await asUser(async () => (await contracts.ensureContract('EURGBP'))!.id);
    // 10,000 units × 20 pips = £20 → $26.67
    const t = await asUser(() => trades.createTrade(forexTrade(id, 10_000, 0.86, 0.862)));
    expect(t.accounts[0]!.grossCents).toBe(Math.round(20 * 1.3335 * 100));
    await asUser(() => trades.createTrade(forexTrade(id, 10_000, 0.86, 0.861)));
    expect(asked).toEqual(['GBP 2026-09-29']);
    expect(await asUser(() => getAppState('fx.GBP.2026-09-29'))).toBe(1.3335);
  });

  it('refuses to save a cross when the rate can’t be found, rather than guessing', async () => {
    setRateFetcher(async () => {
      throw new Error('offline');
    });
    const id = await asUser(async () => (await contracts.ensureContract('EURGBP'))!.id);
    await expect(asUser(() => trades.createTrade(forexTrade(id, 10_000, 0.86, 0.862)))).rejects.toThrow(/Couldn’t get the GBP to USD rate/);
    expect(await asUser(() => usdRate('USD', '2026-09-29'))).toBe(1);
  });

  it('keeps futures exactly as before', () =>
    asUser(async () => {
      const t = await trades.createTrade({ ...forexTrade('ct_mnq', 1, 20000, 20010) });
      expect(t.accounts[0]).toMatchObject({ grossCents: 2000, pointValueCents: 200 });
    }));
});
