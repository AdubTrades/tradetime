import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export interface Health {
  ok: boolean;
  startedAt: string;
  demo: boolean;
  realAppUrl: string | null;
}

/** Whether this window is the demo copy, and where the real app lives. */
export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => api.get<Health>('/health'), staleTime: Infinity });
