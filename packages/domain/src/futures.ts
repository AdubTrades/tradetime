/**
 * Popular CME Group futures (CME, CBOT, NYMEX, COMEX), by root symbol only, plus FOREX.com spot forex pairs: TradeTime tracks NQ, ES, GC… rather
 * than individual contract months. Picking one in the app copies it into the user's own contract list (where fees can
 * be set), so these specs are only the starting point.
 *
 * Each entry has CME's minimum tick and its dollar value as published in the contract specs, kept separately so
 * futures.test.ts can check that tickSize × point value = tick value for every contract. Prices are in the units CME
 * quotes: grains and livestock in cents, Treasuries in decimal points (110'16 = 110.5), FX futures in USD per unit.
 */
export type FuturesGroup = 'Equity index' | 'Energy' | 'Metals' | 'Grains' | 'Livestock' | 'Interest rates' | 'FX' | 'Crypto' | 'Forex';

export interface FuturesSpec {
  symbol: string;
  name: string;
  exchange: 'CME' | 'CBOT' | 'NYMEX' | 'COMEX' | 'FOREX.com';
  group: FuturesGroup;
  tickSize: number;
  /** Dollars (in cents) for a 1.0 move in the quoted price. */
  pointValueCents: number;
  /** Dollars (in cents) for one tick, from the contract specs; a cross-check on the two numbers above. */
  tickValueCents: number;
  /** Currency the P&L comes out in before conversion: USD for futures, the quote (second) currency for forex. */
  currency: string;
}

const f = (symbol: string, name: string, exchange: FuturesSpec['exchange'], group: FuturesGroup, tickSize: number, pointValueDollars: number, tickValueDollars: number): FuturesSpec => ({
  symbol,
  name,
  exchange,
  group,
  tickSize,
  pointValueCents: Math.round(pointValueDollars * 100),
  tickValueCents: tickValueDollars * 100,
  currency: 'USD',
});

/**
 * Spot forex as FOREX.com offers it, sized in units (10,000 = a mini lot). P&L is in the quote currency: 1 per unit
 * per 1.0 move, converted to USD when the trade is saved (see `usdPerQuoteUnit`). Prices to a fifth of a pip
 * (0.00001; 0.001 for yen pairs).
 */
const fx = (base: string, quote: string, name: string): FuturesSpec => {
  const tickSize = quote === 'JPY' ? 0.001 : 0.00001;
  return { symbol: `${base}${quote}`, name: `${base}/${quote} (${name})`, exchange: 'FOREX.com', group: 'Forex', tickSize, pointValueCents: 100, tickValueCents: tickSize * 100, currency: quote };
};

export const FUTURES_CATALOGUE: FuturesSpec[] = [
  // Equity index
  f('ES', 'E-mini S&P 500', 'CME', 'Equity index', 0.25, 50, 12.5),
  f('MES', 'Micro E-mini S&P 500', 'CME', 'Equity index', 0.25, 5, 1.25),
  f('NQ', 'E-mini Nasdaq-100', 'CME', 'Equity index', 0.25, 20, 5),
  f('MNQ', 'Micro E-mini Nasdaq-100', 'CME', 'Equity index', 0.25, 2, 0.5),
  f('RTY', 'E-mini Russell 2000', 'CME', 'Equity index', 0.1, 50, 5),
  f('M2K', 'Micro E-mini Russell 2000', 'CME', 'Equity index', 0.1, 5, 0.5),
  f('YM', 'E-mini Dow ($5)', 'CBOT', 'Equity index', 1, 5, 5),
  f('MYM', 'Micro E-mini Dow', 'CBOT', 'Equity index', 1, 0.5, 0.5),
  f('EMD', 'E-mini S&P MidCap 400', 'CME', 'Equity index', 0.1, 100, 10),
  f('NKD', 'Nikkei 225 (USD)', 'CME', 'Equity index', 5, 5, 25),

  // Energy
  f('CL', 'Crude Oil (WTI)', 'NYMEX', 'Energy', 0.01, 1000, 10),
  f('MCL', 'Micro WTI Crude Oil', 'NYMEX', 'Energy', 0.01, 100, 1),
  f('QM', 'E-mini Crude Oil', 'NYMEX', 'Energy', 0.025, 500, 12.5),
  f('BZ', 'Brent Crude Oil (last day)', 'NYMEX', 'Energy', 0.01, 1000, 10),
  f('NG', 'Henry Hub Natural Gas', 'NYMEX', 'Energy', 0.001, 10000, 10),
  f('QG', 'E-mini Natural Gas', 'NYMEX', 'Energy', 0.005, 2500, 12.5),
  f('MNG', 'Micro Henry Hub Natural Gas', 'NYMEX', 'Energy', 0.001, 1000, 1),
  f('RB', 'RBOB Gasoline', 'NYMEX', 'Energy', 0.0001, 42000, 4.2),
  f('HO', 'NY Harbor ULSD (Heating Oil)', 'NYMEX', 'Energy', 0.0001, 42000, 4.2),

  // Metals
  f('GC', 'Gold', 'COMEX', 'Metals', 0.1, 100, 10),
  f('MGC', 'Micro Gold', 'COMEX', 'Metals', 0.1, 10, 1),
  f('SI', 'Silver', 'COMEX', 'Metals', 0.005, 5000, 25),
  f('SIL', 'Micro Silver', 'COMEX', 'Metals', 0.005, 1000, 5),
  f('HG', 'Copper', 'COMEX', 'Metals', 0.0005, 25000, 12.5),
  f('MHG', 'Micro Copper', 'COMEX', 'Metals', 0.0005, 2500, 1.25),
  f('PL', 'Platinum', 'NYMEX', 'Metals', 0.1, 50, 5),
  f('PA', 'Palladium', 'NYMEX', 'Metals', 0.5, 100, 50),

  // Grains (cents per bushel; meal in $/short ton; oil in cents per lb)
  f('ZC', 'Corn', 'CBOT', 'Grains', 0.25, 50, 12.5),
  f('ZS', 'Soybeans', 'CBOT', 'Grains', 0.25, 50, 12.5),
  f('ZW', 'Chicago SRW Wheat', 'CBOT', 'Grains', 0.25, 50, 12.5),
  f('KE', 'KC HRW Wheat', 'CBOT', 'Grains', 0.25, 50, 12.5),
  f('ZM', 'Soybean Meal', 'CBOT', 'Grains', 0.1, 100, 10),
  f('ZL', 'Soybean Oil', 'CBOT', 'Grains', 0.01, 600, 6),
  f('ZO', 'Oats', 'CBOT', 'Grains', 0.25, 50, 12.5),

  // Livestock (cents per lb)
  f('LE', 'Live Cattle', 'CME', 'Livestock', 0.025, 400, 10),
  f('GF', 'Feeder Cattle', 'CME', 'Livestock', 0.025, 500, 12.5),
  f('HE', 'Lean Hogs', 'CME', 'Livestock', 0.025, 400, 10),

  // Interest rates (Treasury prices in decimal points)
  f('ZT', '2-Year T-Note', 'CBOT', 'Interest rates', 0.00390625, 2000, 7.8125),
  f('ZF', '5-Year T-Note', 'CBOT', 'Interest rates', 0.0078125, 1000, 7.8125),
  f('ZN', '10-Year T-Note', 'CBOT', 'Interest rates', 0.015625, 1000, 15.625),
  f('TN', 'Ultra 10-Year T-Note', 'CBOT', 'Interest rates', 0.015625, 1000, 15.625),
  f('ZB', 'U.S. Treasury Bond', 'CBOT', 'Interest rates', 0.03125, 1000, 31.25),
  f('UB', 'Ultra U.S. Treasury Bond', 'CBOT', 'Interest rates', 0.03125, 1000, 31.25),
  f('SR3', 'Three-Month SOFR', 'CME', 'Interest rates', 0.0025, 2500, 6.25),

  // FX (USD per unit of currency)
  f('6E', 'Euro FX', 'CME', 'FX', 0.00005, 125000, 6.25),
  f('M6E', 'Micro EUR/USD', 'CME', 'FX', 0.0001, 12500, 1.25),
  f('6B', 'British Pound', 'CME', 'FX', 0.0001, 62500, 6.25),
  f('M6B', 'Micro GBP/USD', 'CME', 'FX', 0.0001, 6250, 0.625),
  f('6J', 'Japanese Yen', 'CME', 'FX', 0.0000005, 12500000, 6.25),
  f('6A', 'Australian Dollar', 'CME', 'FX', 0.00005, 100000, 5),
  f('M6A', 'Micro AUD/USD', 'CME', 'FX', 0.0001, 10000, 1),
  f('6C', 'Canadian Dollar', 'CME', 'FX', 0.00005, 100000, 5),
  f('6S', 'Swiss Franc', 'CME', 'FX', 0.00005, 125000, 6.25),
  f('6N', 'New Zealand Dollar', 'CME', 'FX', 0.00005, 100000, 5),
  f('6M', 'Mexican Peso', 'CME', 'FX', 0.00001, 500000, 5),

  // Crypto (USD per coin)
  f('BTC', 'Bitcoin', 'CME', 'Crypto', 5, 5, 25),
  f('MBT', 'Micro Bitcoin', 'CME', 'Crypto', 5, 0.1, 0.5),
  f('ETH', 'Ether', 'CME', 'Crypto', 0.25, 50, 12.5),
  f('MET', 'Micro Ether', 'CME', 'Crypto', 0.5, 0.1, 0.05),

  // Spot forex (FOREX.com): majors, then popular crosses
  fx('EUR', 'USD', 'Euro / US Dollar'),
  fx('GBP', 'USD', 'British Pound / US Dollar'),
  fx('AUD', 'USD', 'Australian Dollar / US Dollar'),
  fx('NZD', 'USD', 'New Zealand Dollar / US Dollar'),
  fx('USD', 'JPY', 'US Dollar / Japanese Yen'),
  fx('USD', 'CAD', 'US Dollar / Canadian Dollar'),
  fx('USD', 'CHF', 'US Dollar / Swiss Franc'),
  fx('USD', 'MXN', 'US Dollar / Mexican Peso'),
  fx('USD', 'SGD', 'US Dollar / Singapore Dollar'),
  fx('EUR', 'GBP', 'Euro / British Pound'),
  fx('EUR', 'JPY', 'Euro / Japanese Yen'),
  fx('EUR', 'AUD', 'Euro / Australian Dollar'),
  fx('EUR', 'CAD', 'Euro / Canadian Dollar'),
  fx('EUR', 'CHF', 'Euro / Swiss Franc'),
  fx('EUR', 'NZD', 'Euro / New Zealand Dollar'),
  fx('GBP', 'JPY', 'British Pound / Japanese Yen'),
  fx('GBP', 'AUD', 'British Pound / Australian Dollar'),
  fx('GBP', 'CAD', 'British Pound / Canadian Dollar'),
  fx('GBP', 'CHF', 'British Pound / Swiss Franc'),
  fx('GBP', 'NZD', 'British Pound / New Zealand Dollar'),
  fx('AUD', 'JPY', 'Australian Dollar / Japanese Yen'),
  fx('AUD', 'CAD', 'Australian Dollar / Canadian Dollar'),
  fx('AUD', 'CHF', 'Australian Dollar / Swiss Franc'),
  fx('AUD', 'NZD', 'Australian Dollar / New Zealand Dollar'),
  fx('NZD', 'JPY', 'New Zealand Dollar / Japanese Yen'),
  fx('NZD', 'CAD', 'New Zealand Dollar / Canadian Dollar'),
  fx('NZD', 'CHF', 'New Zealand Dollar / Swiss Franc'),
  fx('CAD', 'JPY', 'Canadian Dollar / Japanese Yen'),
  fx('CAD', 'CHF', 'Canadian Dollar / Swiss Franc'),
  fx('CHF', 'JPY', 'Swiss Franc / Japanese Yen'),
];

export const FUTURES_GROUPS: FuturesGroup[] = ['Equity index', 'Energy', 'Metals', 'Grains', 'Livestock', 'Interest rates', 'FX', 'Crypto', 'Forex'];

/** Currency codes accepted as either side of a forex pair (FOREX.com's majors and the common minors). */
const FOREX_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'NZD', 'CAD', 'CHF', 'SEK', 'NOK', 'DKK', 'SGD', 'HKD', 'MXN', 'ZAR', 'TRY', 'PLN', 'CZK', 'HUF', 'CNH']);

/**
 * The two currencies of a spot forex symbol ("EUR/USD", "eurusd"), or null if it isn't one: six letters, both halves
 * currency codes, and not the same currency twice. This is how contracts are told apart (futures roots are 1–4 letters).
 */
export function forexPair(symbol: string): { base: string; quote: string } | null {
  const sym = normaliseSymbol(symbol);
  if (!/^[A-Z]{6}$/.test(sym)) return null;
  const base = sym.slice(0, 3);
  const quote = sym.slice(3);
  return base !== quote && FOREX_CURRENCIES.has(base) && FOREX_CURRENCIES.has(quote) ? { base, quote } : null;
}

/** Smallest price step for a pair: a fifth of a pip, i.e. 0.00001, or 0.001 for yen pairs. */
export const forexTickSize = (symbol: string): number => (forexPair(symbol)?.quote === 'JPY' ? 0.001 : 0.00001);

/** "EUR/USD", "eur_usd" and "EURUSD" are the same instrument. */
export const normaliseSymbol = (symbol: string): string => symbol.trim().toUpperCase().replace(/[/_]/g, '');

const bySymbol = new Map(FUTURES_CATALOGUE.map((s) => [s.symbol, s]));
export const findFutures = (symbol: string): FuturesSpec | undefined => bySymbol.get(normaliseSymbol(symbol));

/**
 * USD per unit of a contract's P&L currency, for converting a trade's P&L to USD. USD contracts: 1. Pairs with USD
 * first (USD/JPY): 1 ÷ the average exit price, which is exact for a single exit. Other crosses (EUR/GBP): the day's
 * reference rate for the quote currency, which the caller looks up (`crossRate`). Null if that rate is missing.
 */
export function usdPerQuoteUnit(contract: { symbol: string; currency?: string | null }, avgExit: number, crossRate?: number | null): number | null {
  const currency = contract.currency || 'USD';
  if (currency === 'USD') return 1;
  if (normaliseSymbol(contract.symbol).startsWith('USD')) return 1 / avgExit;
  return crossRate ?? null;
}

/** Whether converting this contract's P&L needs a looked-up rate (a cross without USD). */
export const needsCrossRate = (contract: { symbol: string; currency?: string | null }): boolean =>
  !!contract.currency && contract.currency !== 'USD' && !normaliseSymbol(contract.symbol).startsWith('USD');

/** Catalogue entries matching a search ("gold", "gc", "nasdaq"), symbol matches first. */
export function searchFutures(query: string): FuturesSpec[] {
  const q = query.trim().toLowerCase().replace(/[/_]/g, '');
  if (!q) return FUTURES_CATALOGUE;
  const score = (s: FuturesSpec) => {
    const sym = s.symbol.toLowerCase();
    if (sym === q) return 0;
    if (sym.startsWith(q)) return 1;
    if (s.name.toLowerCase().split(/[\s(/-]+/).some((w) => w.startsWith(q))) return 2;
    if (s.name.toLowerCase().replace(/\//g, '').includes(q)) return 3;
    if (s.name.toLowerCase().includes(q) || s.group.toLowerCase().includes(q)) return 3;
    return 9;
  };
  return FUTURES_CATALOGUE.map((s) => [s, score(s)] as const)
    .filter(([, n]) => n < 9)
    .sort((a, b) => a[1] - b[1])
    .map(([s]) => s);
}
