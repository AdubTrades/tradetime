import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AccountGroup, type Contract, type Play, type PlayDetail, type TradeDetail, type TradeRow } from './api';

export const useContracts = () => useQuery({ queryKey: ['contracts'], queryFn: () => api.get<Contract[]>('/contracts') });
export const useAccountGroups = () => useQuery({ queryKey: ['account-groups'], queryFn: () => api.get<AccountGroup[]>('/account-groups') });
export const usePlays = () => useQuery({ queryKey: ['plays'], queryFn: () => api.get<Play[]>('/plays') });
export const usePlay = (id: string) => useQuery({ queryKey: ['plays', id], queryFn: () => api.get<PlayDetail>(`/plays/${id}`) });
export const useTrades = (from: string, to: string) =>
  useQuery({ queryKey: ['trades', from, to], queryFn: () => api.get<TradeRow[]>(`/trades?from=${from}&to=${to}`) });
export const useTrade = (id: string) => useQuery({ queryKey: ['trade', id], queryFn: () => api.get<TradeDetail>(`/trades/${id}`) });

/** Mutations that change trades or plays refresh both. */
export function useJournalMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['trades', 'trade', 'plays', 'history', 'daily-review']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const gradeTone: Record<string, string> = {
  'A+': 'bg-profit/15 text-profit',
  A: 'bg-profit/10 text-profit',
  'B+': 'bg-accent/10 text-accent',
  B: 'bg-accent/10 text-accent',
  'C+': 'bg-warn/15 text-warn',
  C: 'bg-warn/15 text-warn',
};
