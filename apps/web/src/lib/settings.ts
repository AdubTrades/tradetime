import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Settings } from './api';

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api.get<Settings>('/settings') });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.patch<Settings>('/settings', patch),
    onSuccess: (data) => qc.setQueryData(['settings'], data),
  });
}
