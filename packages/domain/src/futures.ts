/**
 * Popular CME Group futures (CME, CBOT, NYMEX, COMEX), by root symbol only: TradeTime tracks NQ, ES, GC… rather
 * than individual contract months. Picking one in the app copies it into the user's own contract list (where fees can
 * be set), so these specs are only the starting point.
 *
 * Each entry has CME's minimum tick and its dollar value as published in the contract specs, kept separately so
 * futures.test.ts can check that tickSize × point value = tick value for every contract. Prices are in the units CME
 * quotes: grains and livestock in cents, Treasuries in decimal points (110'16 = 110.5), FX futures in USD per unit.
 */
export type FuturesGroup = 'Equity index' | 'Energy' | 'Metals' | 'Grains' | 'Livestock' | 'Interest rates' | 'FX' | 'Crypto';

export interface FuturesSpec {
  symbol: string;
  name: string;
  exchange: 'CME' | 'CBOT' | 'NYMEX' | 'COMEX';
  group: FuturesGroup;
  tickSize: number;
  /** Dollars (in cents) for a 1.0 move in the quoted price. */
  pointValueCents: number;
  /** Dollars (in cents) for one tick, from the contract specs; a cross-check on the two numbers above. */
  tickValueCents: number;
}

const f = (symbol: string, name: string, exchange: FuturesSpec['exchange'], group: FuturesGroup, tickSize: number, pointValueDollars: number, tickValueDollars: number): FuturesSpec => ({
  symbol,
  name,
  exchange,
  group,
  tickSize,
  pointValueCents: Math.round(pointValueDollars * 100),
  tickValueCents: tickValueDollars * 100,
});

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
];

export const FUTURES_GROUPS: FuturesGroup[] = ['Equity index', 'Energy', 'Metals', 'Grains', 'Livestock', 'Interest rates', 'FX', 'Crypto'];

const bySymbol = new Map(FUTURES_CATALOGUE.map((s) => [s.symbol, s]));
export const findFutures = (symbol: string): FuturesSpec | undefined => bySymbol.get(symbol.trim().toUpperCase());

/** Catalogue entries matching a search ("gold", "gc", "nasdaq"), symbol matches first. */
export function searchFutures(query: string): FuturesSpec[] {
  const q = query.trim().toLowerCase();
  if (!q) return FUTURES_CATALOGUE;
  const score = (s: FuturesSpec) => {
    const sym = s.symbol.toLowerCase();
    if (sym === q) return 0;
    if (sym.startsWith(q)) return 1;
    if (s.name.toLowerCase().split(/[\s(/-]+/).some((w) => w.startsWith(q))) return 2;
    if (s.name.toLowerCase().includes(q) || s.group.toLowerCase().includes(q)) return 3;
    return 9;
  };
  return FUTURES_CATALOGUE.map((s) => [s, score(s)] as const)
    .filter(([, n]) => n < 9)
    .sort((a, b) => a[1] - b[1])
    .map(([s]) => s);
}
