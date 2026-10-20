import { useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { api } from './api';
import { useSettings } from './settings';

export type PnlCurrency = 'USD' | 'AUD';

export interface PnlCurrencyValue {
  /** The currency amounts are shown in right now: the chosen one once its rates are in, USD until then. */
  currency: PnlCurrency;
  /** What the user picked. Differs from `currency` while rates load or if they can't be fetched. */
  chosen: PnlCurrency;
  status: 'ready' | 'loading' | 'error';
  /** A stored USD amount (cents) for a trading day, in the shown currency. */
  toDisplay: (usdCents: number, day: string) => number;
}

const USD_ONLY: PnlCurrencyValue = { currency: 'USD', chosen: 'USD', status: 'ready', toDisplay: (cents) => cents };
const Context = createContext<PnlCurrencyValue>(USD_ONLY);

/**
 * Trades are stored in USD. When AUD is chosen, each day's P&L is converted at that day's ECB rate (so a past total never
 * moves when today's rate does). The rates for every day since the first trade come from one request.
 */
export function PnlCurrencyProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useSettings();
  const chosen: PnlCurrency = settings?.pnlCurrency ?? 'USD';
  const today = new Date().toISOString().slice(0, 10);
  const rates = useQuery({
    queryKey: ['pnl-rates', chosen, today],
    queryFn: () => api.get<{ rates: Record<string, number> }>(`/trades/rates?currency=${chosen}`).then((r) => r.rates),
    enabled: chosen !== 'USD',
    staleTime: 30 * 60_000,
    retry: 1,
  });

  const value = useMemo<PnlCurrencyValue>(() => {
    if (chosen === 'USD') return USD_ONLY;
    const table = rates.data;
    if (!table) return { currency: 'USD', chosen, status: rates.isError ? 'error' : 'loading', toDisplay: (cents) => cents };
    const days = Object.keys(table).sort();
    // The rate for a day, or for the nearest day we have one for (a trade just added on a new day, say).
    const rateOn = (day: string): number | undefined => {
      if (table[day]) return table[day];
      let best = days[0];
      for (const d of days) {
        if (d > day) break;
        best = d;
      }
      return best ? table[best] : undefined;
    };
    return {
      currency: chosen,
      chosen,
      status: 'ready',
      toDisplay: (cents, day) => {
        const rate = rateOn(day);
        return rate ? Math.round(cents / rate) : cents;
      },
    };
  }, [chosen, rates.data, rates.isError]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const usePnlCurrency = () => useContext(Context);

const formatter = (currency: PnlCurrency, digits: number, sign: boolean) =>
  new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
    ...(sign ? { signDisplay: 'exceptZero' as const } : {}),
  });

/**
 * Money text in a currency. en-AU writes both dollars as "$", so say which: A$ for Australian dollars, and US$ for US
 * dollars whenever the app is showing Australian ones (plain "$" is kept when everything is USD, as it always was).
 */
export function moneyText(cents: number, currency: PnlCurrency, appCurrency: PnlCurrency, opts: { digits?: number; sign?: boolean } = {}): string {
  const text = formatter(currency, opts.digits ?? 2, opts.sign ?? false).format(cents / 100);
  if (currency === 'AUD') return text.replace('$', 'A$');
  return appCurrency === 'AUD' ? text.replace('$', 'US$') : text;
}

/**
 * A formatter for plain (uncoloured) amounts that follows the shown currency. `day` marks the amount as stored USD for
 * that trading day, to be converted; leave it out for amounts already in the shown currency.
 */
export function useMoneyFormat() {
  const { currency, toDisplay } = usePnlCurrency();
  return (cents: number, opts: { day?: string; digits?: number; sign?: boolean } = {}) =>
    moneyText(opts.day !== undefined ? toDisplay(cents, opts.day) : cents, currency, currency, opts);
}
