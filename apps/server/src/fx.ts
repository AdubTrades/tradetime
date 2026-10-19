import { usdPerQuoteUnit } from '@tc/domain';
import { AppError } from './errors';
import { getAppState, setAppState } from './settings';

/**
 * Daily reference rates (European Central Bank, via Frankfurter: free, no key) for converting forex crosses' P&L to
 * USD. Rates are fixed once published, so each (currency, day) is fetched once and kept in app_state for everyone.
 */
type RateFetcher = (currency: string, date: string) => Promise<number>;

const frankfurter: RateFetcher = async (currency, date) => {
  const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${encodeURIComponent(currency)}&symbols=USD`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`rate service answered ${res.status}`);
  const body = (await res.json()) as { rates?: { USD?: number } };
  if (!body.rates?.USD) throw new Error('no USD rate in the answer');
  return body.rates.USD;
};

let fetcher: RateFetcher = frankfurter;
/** Tests replace the rate service with a fake. */
export function setRateFetcher(f: RateFetcher | null): void {
  fetcher = f ?? frankfurter;
}

/** USD for one unit of `currency` on `date` (YYYY-MM-DD; weekends and holidays use the last published rate). */
export async function usdRate(currency: string, date: string): Promise<number> {
  const cur = currency.toUpperCase();
  if (cur === 'USD') return 1;
  if (!/^[A-Z]{3}$/.test(cur) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(400, 'Invalid currency or date');
  // A future date has no rate yet: use today's.
  const day = date > new Date().toISOString().slice(0, 10) ? new Date().toISOString().slice(0, 10) : date;
  const key = `fx.${cur}.${day}`;
  const cached = await getAppState<number>(key);
  if (cached) return cached;
  try {
    const rate = await fetcher(cur, day);
    await setAppState(key, rate);
    return rate;
  } catch (err) {
    throw new AppError(422, `Couldn’t get the ${cur} to USD rate for ${day} to convert this trade’s P&L (${(err as Error).message}). Please try again.`);
  }
}

/** USD per unit of the contract's P&L currency for a trade: 1 for USD, from the exit price for USD/xxx, else the day's rate. */
export async function usdFactor(contract: { symbol: string; currency?: string | null }, avgExit: number, tradingDay: string): Promise<number> {
  const direct = usdPerQuoteUnit(contract, avgExit);
  if (direct !== null) return direct;
  return usdRate(contract.currency!, tradingDay);
}
