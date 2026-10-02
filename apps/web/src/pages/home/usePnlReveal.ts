import { useState } from 'react';

const KEY = 'tc-home-pnl-revealed';

/**
 * Whether P&L is revealed on Home. Hidden by default (when the setting is on); a reveal lasts for the
 * current trading day in this browser tab, so a fresh day starts hidden again.
 */
export function usePnlReveal(hideByDefault: boolean, tradingDay: string): [boolean, (revealed: boolean) => void] {
  const [revealedDay, setRevealedDay] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  });
  const set = (revealed: boolean) => {
    const value = revealed ? tradingDay : null;
    setRevealedDay(value);
    try {
      if (value) sessionStorage.setItem(KEY, value);
      else sessionStorage.removeItem(KEY);
    } catch {
      // Not critical: the reveal just won't survive a reload.
    }
  };
  return [!hideByDefault || revealedDay === tradingDay, set];
}
