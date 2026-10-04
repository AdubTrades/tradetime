import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Account, type Expense, type Firm, type FySummary, type ListItem, type ListKind, type Payout, type RecurringExpense } from './api';

export const useList = (kind: ListKind) => useQuery({ queryKey: ['lists', kind], queryFn: () => api.get<ListItem[]>(`/lists/${kind}`) });
export const useFirms = () => useQuery({ queryKey: ['firms'], queryFn: () => api.get<Firm[]>('/firms') });
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/accounts') });
export const useExpenses = (fy: number) => useQuery({ queryKey: ['expenses', fy], queryFn: () => api.get<Expense[]>(`/expenses?fy=${fy}`) });
export const useRecurring = () => useQuery({ queryKey: ['recurring'], queryFn: () => api.get<RecurringExpense[]>('/recurring-expenses') });
export const usePayouts = (fy: number) => useQuery({ queryKey: ['payouts', fy], queryFn: () => api.get<Payout[]>(`/payouts?fy=${fy}`) });
export const useFySummary = (fy: number) => useQuery({ queryKey: ['expense-summary', fy], queryFn: () => api.get<FySummary>(`/expenses/summary?fy=${fy}`) });

/** Mutations touching money records refresh every query that shows them. */
export function useMoneyMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of ['expenses', 'recurring', 'payouts', 'expense-summary', 'lists', 'history', 'calendar']) void qc.invalidateQueries({ queryKey: [key] });
    },
  });
}

/** Names for ids from the three expense pick-lists plus accounts. */
export function useExpenseLookups() {
  const categories = useList('expense_category').data ?? [];
  const types = useList('expense_type').data ?? [];
  const paymentMethods = useList('payment_method').data ?? [];
  const accounts = useAccounts().data ?? [];
  const names = new Map<string, string>([...categories, ...types, ...paymentMethods, ...accounts].map((i) => [i.id, i.name]));
  return { categories, types, paymentMethods, accounts, name: (id: string | null | undefined) => (id ? (names.get(id) ?? '') : '') };
}
