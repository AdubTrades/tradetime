import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type AccountGroup, type Contract, type Play, type PlayDetail, type TradeDetail, type TradeRow } from './api';
import { usePnlCurrency } from './pnlCurrency';

export const useContracts = () => useQuery({ queryKey: ['contracts'], queryFn: () => api.get<Contract[]>('/contracts') });
export const useAccountGroups = () => useQuery({ queryKey: ['account-groups'], queryFn: () => api.get<AccountGroup[]>('/account-groups') });
export const usePlays = () => useQuery({ queryKey: ['plays'], queryFn: () => api.get<Play[]>('/plays') });
export const usePlay = (id: string) => useQuery({ queryKey: ['plays', id], queryFn: () => api.get<PlayDetail>(`/plays/${id}`) });
/** A trade with its money converted from stored USD to the shown currency, at its trading day's rate. */
function convertTrade(t: TradeRow, toDisplay: (usdCents: number, day: string) => number): TradeRow {
  const c = (n: number) => toDisplay(n, t.tradingDay);
  return {
    ...t,
    netCents: c(t.netCents),
    grossCents: c(t.grossCents),
    feesCents: c(t.feesCents),
    accounts: t.accounts.map((a) => ({ ...a, netCents: c(a.netCents), grossCents: c(a.grossCents), feesCents: c(a.feesCents), plannedRiskCents: a.plannedRiskCents === null ? null : c(a.plannedRiskCents) })),
  };
}

/**
 * Trades for a date range, with their money in the currency the app is showing (AUD converts each trade at its own
 * day's rate). Every list, total and chart is built from these, so they stay consistent. Anything that edits a trade
 * uses `useTrade`, which stays in stored USD.
 */
export function useTrades(from: string, to: string) {
  const query = useQuery({ queryKey: ['trades', from, to], queryFn: () => api.get<TradeRow[]>(`/trades?from=${from}&to=${to}`) });
  const { currency, toDisplay } = usePnlCurrency();
  const data = useMemo(() => (query.data && currency !== 'USD' ? query.data.map((t) => convertTrade(t, toDisplay)) : query.data), [query.data, currency, toDisplay]);
  return { ...query, data };
}
/** Imported trades still waiting for a Play, checklist and notes. */
export const useReviewCount = () =>
  useQuery({
    queryKey: ['trades', 'review-count'],
    queryFn: async () => (await api.get<TradeRow[]>('/trades?from=2000-01-01&to=2100-12-31')).filter((t) => t.needsReview).length,
  });
export const useTrade = (id: string) => useQuery({ queryKey: ['trade', id], queryFn: () => api.get<TradeDetail>(`/trades/${id}`) });

/** Mutations that change trades or plays refresh both. */
export function useJournalMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['trades', 'trade', 'plays', 'history', 'daily-review', 'pnl-rates']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}


