import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AccountGroup, type Contract, type Play, type PlayDetail, type TradeDetail, type TradeRow } from './api';

export const useContracts = () => useQuery({ queryKey: ['contracts'], queryFn: () => api.get<Contract[]>('/contracts') });
export const useAccountGroups = () => useQuery({ queryKey: ['account-groups'], queryFn: () => api.get<AccountGroup[]>('/account-groups') });
export const usePlays = () => useQuery({ queryKey: ['plays'], queryFn: () => api.get<Play[]>('/plays') });
export const usePlay = (id: string) => useQuery({ queryKey: ['plays', id], queryFn: () => api.get<PlayDetail>(`/plays/${id}`) });
export const useTrades = (from: string, to: string) =>
  useQuery({ queryKey: ['trades', from, to], queryFn: () => api.get<TradeRow[]>(`/trades?from=${from}&to=${to}`) });
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
      for (const key of ['trades', 'trade', 'plays', 'history', 'daily-review']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

export const gradeTone: Record<string, string> = {
  // Monochrome scale: graphite for the best grades, warm ivory for the middle, plain grey below.
  'A+': 'bg-text text-bg',
  A: 'bg-text/75 text-bg',
  'B+': 'bg-ivory text-text',
  B: 'bg-ivory text-text/75',
  'C+': 'bg-surface text-muted ring-1 ring-inset ring-text/10',
  C: 'bg-surface text-muted ring-1 ring-inset ring-text/10',
};
