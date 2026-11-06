/**
 * The list a trade was opened from (e.g. the backtester's filtered History), so the trade page can step to the
 * previous and next trade. Kept per browser tab; a tab opened from it starts with a copy.
 */
export interface TradeNav {
  /** Journal trade ids in the list's order. */
  ids: string[];
  /** What the list is, e.g. "Backtest history". */
  label: string;
  /** Where the back link goes. */
  back: string;
}

const KEY = 'tt.tradeNav';

export function setTradeNav(nav: TradeNav) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(nav));
  } catch {
    // No stepping between trades; fine.
  }
}

export function getTradeNav(): TradeNav | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? 'null');
    return v && Array.isArray(v.ids) && typeof v.label === 'string' && typeof v.back === 'string' ? v : null;
  } catch {
    return null;
  }
}
