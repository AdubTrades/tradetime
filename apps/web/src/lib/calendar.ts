import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type CalendarEventType, type CalendarRangeData, type MarketStatus, type UpcomingData } from './api';

export const useCalendarRange = (from: string, to: string) =>
  useQuery({ queryKey: ['calendar', 'range', from, to], queryFn: () => api.get<CalendarRangeData>(`/calendar/range?from=${from}&to=${to}`) });
export const useUpcoming = (days = 7) =>
  useQuery({ queryKey: ['calendar', 'upcoming', days], queryFn: () => api.get<UpcomingData>(`/calendar/upcoming?days=${days}`), refetchInterval: 5 * 60_000 });
export const useEventTypes = () => useQuery({ queryKey: ['calendar', 'types'], queryFn: () => api.get<CalendarEventType[]>('/calendar/types') });
export const useMarketStatus = () => useQuery({ queryKey: ['calendar', 'market-status'], queryFn: () => api.get<MarketStatus>('/calendar/market/status') });

/** Mutations on events refresh every calendar query. */
export function useCalendarMutation<TVars, TResult = unknown>(fn: (vars: TVars) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSuccess: () => void qc.invalidateQueries({ queryKey: ['calendar'] }) });
}

export const LAYERS = [
  { id: 'pnl', label: 'P&L' },
  { id: 'screen', label: 'Screen time' },
  { id: 'events', label: 'Market events' },
  { id: 'journal', label: 'Journal' },
  { id: 'mine', label: 'My events' },
  { id: 'expenses', label: 'Expenses' },
] as const;
export type LayerId = (typeof LAYERS)[number]['id'];
const DEFAULT_LAYERS: LayerId[] = ['pnl', 'screen', 'events', 'journal', 'mine'];
const LAYERS_KEY = 'tc-calendar-layers';

/** Which layers are visible, remembered per browser. */
export function useLayers(): [Set<LayerId>, (id: LayerId) => void] {
  const [layers, setLayers] = useState<Set<LayerId>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LAYERS_KEY) ?? 'null') as LayerId[] | null;
      return new Set(saved ?? DEFAULT_LAYERS);
    } catch {
      return new Set(DEFAULT_LAYERS);
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LAYERS_KEY, JSON.stringify([...layers]));
    } catch {
      // Not critical.
    }
  }, [layers]);
  const toggle = (id: LayerId) =>
    setLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return [layers, toggle];
}

export const hoursLabel = (minutes: number) => (minutes >= 60 ? `${(minutes / 60).toFixed(1)}h` : `${Math.round(minutes)}m`);
