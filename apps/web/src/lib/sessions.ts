import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type Session, type SessionType } from './api';

export function useSessionTypes() {
  return useQuery({ queryKey: ['session-types'], queryFn: () => api.get<SessionType[]>('/session-types') });
}

export function useSessions(from: string, to: string) {
  return useQuery({ queryKey: ['sessions', from, to], queryFn: () => api.get<Session[]>(`/sessions?from=${from}&to=${to}`) });
}

export function useRunningSession() {
  return useQuery({ queryKey: ['sessions', 'running'], queryFn: () => api.get<Session | null>('/sessions/running'), refetchInterval: 60_000 });
}

/** Any mutation that changes sessions refreshes every session query. */
export function useSessionMutation<TVars, TResult = Session>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sessions'] });
      void qc.invalidateQueries({ queryKey: ['history'] });
    },
  });
}

/** Current time, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
