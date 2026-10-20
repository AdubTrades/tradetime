import { inArray, isNull, min, sql } from 'drizzle-orm';
import { schema } from '@tc/db';
import { usdPerQuoteUnit } from '@tc/domain';
import { db } from './context';
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

/** Published rates for every business day from `from` to `to` in one call (weekends and holidays have none). */
type RangeFetcher = (currency: string, from: string, to: string) => Promise<Record<string, number>>;

const frankfurterRange: RangeFetcher = async (currency, from, to) => {
  const res = await fetch(`https://api.frankfurter.dev/v1/${from}..${to}?base=${encodeURIComponent(currency)}&symbols=USD`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`rate service answered ${res.status}`);
  const body = (await res.json()) as { rates?: Record<string, { USD?: number }> };
  const out: Record<string, number> = {};
  for (const [day, r] of Object.entries(body.rates ?? {})) if (r.USD) out[day] = r.USD;
  if (Object.keys(out).length === 0) throw new Error('no USD rates in the answer');
  return out;
};

let fetcher: RateFetcher = frankfurter;
let rangeFetcher: RangeFetcher = frankfurterRange;
/** Tests replace the rate service with a fake. A fake single-day fetcher also answers range requests, one day at a time. */
export function setRateFetcher(f: RateFetcher | null): void {
  fetcher = f ?? frankfurter;
  rangeFetcher = f
    ? async (currency, from, to) => {
        const out: Record<string, number> = {};
        for (let d = from; d <= to; d = addDays(d, 1)) out[d] = await f(currency, d);
        return out;
      }
    : frankfurterRange;
}
/** Tests that want to see how many range requests were made replace just the range service. */
export function setRangeFetcher(f: RangeFetcher | null): void {
  rangeFetcher = f ?? frankfurterRange;
}

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

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

const MAX_RATE_DAYS = 400;

/**
 * USD for one unit of `currency` on every calendar day from `from` to `to`, for showing totals in another currency.
 * Weekends and holidays use the last published rate, as `usdRate` does. Rates already known come from app_state in one
 * query, and the rest are fetched as a single range, so a financial year costs one request the first time and none after.
 * Today (and later) is answered but not kept, because the day's rate may not be published yet.
 */
export async function usdRates(currency: string, from: string, to: string): Promise<Record<string, number>> {
  const cur = currency.toUpperCase();
  const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (!/^[A-Z]{3}$/.test(cur) || !isDate(from) || !isDate(to) || to < from) throw new AppError(400, 'Invalid currency or dates');
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  if (days.length > MAX_RATE_DAYS) throw new AppError(400, `Ask for at most ${MAX_RATE_DAYS} days at a time`);
  if (cur === 'USD') return Object.fromEntries(days.map((d) => [d, 1]));

  const today = new Date().toISOString().slice(0, 10);
  const key = (d: string) => `fx.${cur}.${d}`;
  const asked = [...new Set(days.map((d) => (d > today ? today : d)))];
  const rows = await db.select().from(schema.appState).where(inArray(schema.appState.key, asked.map(key)));
  const known = new Map(rows.map((r) => [r.key, r.value as number]));
  const missing = asked.filter((d) => !known.has(key(d)));

  if (missing.length > 0) {
    let published: Record<string, number>;
    try {
      // A week of lead-in so a weekend or holiday at the start still finds the rate before it.
      published = await rangeFetcher(cur, addDays(missing[0]!, -7), missing[missing.length - 1]!);
    } catch (err) {
      throw new AppError(422, `Couldn’t get the ${cur} to USD rates (${(err as Error).message}). Please try again.`);
    }
    const publishedDays = Object.keys(published).sort();
    const toStore: { key: string; value: number; updatedAt: string }[] = [];
    for (const d of missing) {
      const last = [...publishedDays].reverse().find((p) => p <= d);
      if (last === undefined) throw new AppError(422, `Couldn’t get the ${cur} to USD rate for ${d}. Please try again.`);
      known.set(key(d), published[last]!);
      if (d < today) toStore.push({ key: key(d), value: published[last]!, updatedAt: new Date().toISOString() });
    }
    if (toStore.length > 0) {
      await db
        .insert(schema.appState)
        .values(toStore)
        .onConflictDoUpdate({ target: schema.appState.key, set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at` } });
    }
  }
  return Object.fromEntries(days.map((d) => [d, known.get(key(d > today ? today : d))!]));
}

/**
 * USD per unit of `currency` for every day from the user's first trade to today: what the app needs to show all of
 * their P&L in that currency. Fetched in year-sized pieces because the rate service answers a range in one go.
 */
export async function usdRatesSinceFirstTrade(currency: string): Promise<Record<string, number>> {
  const [row] = await db.select({ first: min(schema.trade.tradingDay) }).from(schema.trade).where(isNull(schema.trade.deletedAt));
  if (!row?.first) return {};
  const today = new Date().toISOString().slice(0, 10);
  const out: Record<string, number> = {};
  for (let from = row.first; from <= today; from = addDays(from, 366)) {
    const to = addDays(from, 365) < today ? addDays(from, 365) : today;
    Object.assign(out, await usdRates(currency, from, to));
  }
  return out;
}
