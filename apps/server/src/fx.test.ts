import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as accounts from './accounts';
import * as contracts from './contracts';
import { setRangeFetcher, setRateFetcher, usdRate, usdRates } from './fx';
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

describe('your own forex pairs (Settings → Contracts → Add your own)', () => {
  it('takes the P&L currency from the pair, stores it as EURUSD-style, and never charges a per-unit fee', () =>
    asUser(async () => {
      const c = await contracts.createContract({ symbol: 'eur/sek', name: 'Euro / Swedish Krona', tickSize: 0.00001, pointValueCents: 100, feePerSideCents: 50 });
      expect(c).toMatchObject({ symbol: 'EURSEK', currency: 'SEK', feePerSideCents: 0 });
      const edited = await contracts.updateContract(c.id, { feePerSideCents: 25, name: 'EUR/SEK' });
      expect(edited).toMatchObject({ currency: 'SEK', feePerSideCents: 0, name: 'EUR/SEK' });
    }));

  it('a custom USD-quoted pair is already in USD; a custom futures contract stays USD with its fee', () =>
    asUser(async () => {
      const pair = await contracts.createContract({ symbol: 'USD/ZAR', name: 'US Dollar / Rand', tickSize: 0.00001, pointValueCents: 100 });
      expect(pair.currency).toBe('ZAR');
      const eurusd = await contracts.createContract({ symbol: 'EUR/NOK', name: 'Euro / Norwegian Krone', tickSize: 0.00001, pointValueCents: 100 });
      expect(eurusd.currency).toBe('NOK');
      const fut = await contracts.createContract({ symbol: 'zb', name: 'Custom bond', tickSize: 0.5, pointValueCents: 100_000, feePerSideCents: 210 });
      expect(fut).toMatchObject({ symbol: 'ZB', currency: 'USD', feePerSideCents: 210 });
    }));

  it('a pair that comes from your own list converts to USD like a built-in one', () =>
    asUser(async () => {
      const c = await contracts.createContract({ symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc', tickSize: 0.00001, pointValueCents: 100 });
      const t = await trades.createTrade(forexTrade(c.id, 100_000, 0.9, 0.901));
      // 100,000 units × 0.001 = CHF 100, converted at the exit price
      expect(t.accounts[0]!.grossCents).toBe(Math.round((100 / 0.901) * 100));
    }));
});

describe('usdRates (a range of days, for showing totals in AUD)', () => {
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    // Published business days only, as the ECB feed does: Thu 24, Fri 25, Mon 28 September 2026.
    setRangeFetcher(async (currency, from, to) => {
      calls.push(`${currency} ${from}..${to}`);
      return { '2026-09-24': 0.66, '2026-09-25': 0.67, '2026-09-28': 0.68 };
    });
  });

  it('answers every calendar day in one request; weekends use the last published rate', () =>
    asUser(async () => {
      const rates = await usdRates('AUD', '2026-09-25', '2026-09-28');
      expect(rates).toEqual({ '2026-09-25': 0.67, '2026-09-26': 0.67, '2026-09-27': 0.67, '2026-09-28': 0.68 });
      expect(calls).toHaveLength(1);
    }));

  it('keeps what it fetched, so asking again (or for part of it) makes no new request', () =>
    asUser(async () => {
      await usdRates('AUD', '2026-09-25', '2026-09-28');
      expect(await usdRates('AUD', '2026-09-25', '2026-09-28')).toMatchObject({ '2026-09-27': 0.67 });
      expect(await usdRates('AUD', '2026-09-26', '2026-09-26')).toEqual({ '2026-09-26': 0.67 });
      expect(calls).toHaveLength(1);
      expect(await getAppState('fx.AUD.2026-09-27')).toBe(0.67);
    }));

  it('agrees with the single-day lookup used for forex trades', () =>
    asUser(async () => {
      await usdRates('AUD', '2026-09-28', '2026-09-28');
      expect(await usdRate('AUD', '2026-09-28')).toBe(0.68);
      expect(asked).toEqual([]);
    }));

  it('USD is always 1 and needs no request', () =>
    asUser(async () => {
      expect(await usdRates('USD', '2026-09-25', '2026-09-27')).toEqual({ '2026-09-25': 1, '2026-09-26': 1, '2026-09-27': 1 });
      expect(calls).toEqual([]);
    }));

  it('today is answered with the latest published rate but not kept, since today’s may not be out yet', () =>
    asUser(async () => {
      const today = new Date().toISOString().slice(0, 10);
      setRangeFetcher(async () => ({ '2020-01-01': 0.7 }));
      expect(await usdRates('AUD', today, today)).toEqual({ [today]: 0.7 });
      expect(await getAppState(`fx.AUD.${today}`)).toBeUndefined();
    }));

  it('fails clearly, and stores nothing, when the rate service is down', () =>
    asUser(async () => {
      setRangeFetcher(async () => {
        throw new Error('offline');
      });
      await expect(usdRates('AUD', '2026-09-25', '2026-09-28')).rejects.toThrow(/Couldn’t get the AUD to USD rates/);
      expect(await getAppState('fx.AUD.2026-09-25')).toBeUndefined();
    }));

  it('rejects bad input and over-long ranges', () =>
    asUser(async () => {
      await expect(usdRates('AUD', '2026-09-28', '2026-09-25')).rejects.toThrow(/Invalid/);
      await expect(usdRates('A', '2026-09-25', '2026-09-28')).rejects.toThrow(/Invalid/);
      await expect(usdRates('AUD', '2025-01-01', '2026-09-28')).rejects.toThrow(/at most/);
    }));
});
