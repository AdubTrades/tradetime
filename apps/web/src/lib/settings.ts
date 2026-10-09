import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_ZONE, isValidZone, setZoneResolver } from '@tc/domain';
import { api, type Settings } from './api';

let zone = DEFAULT_ZONE;
// Date maths in the browser (today, trading days, times in forms) follows the signed-in user's time zone.
setZoneResolver(() => zone);

export const browserZone = (): string | null => {
  const z = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return z && isValidZone(z) ? z : null;
};

/** Every IANA zone the browser knows (with `current` guaranteed), sorted by name. */
export function zoneList(current: string): string[] {
  const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return [...new Set([...all, current])].sort();
}

let adopting = false;

async function fetchSettings(): Promise<Settings> {
  let s = await api.get<Settings>('/settings');
  // A new account hasn't chosen a zone yet: start with the browser's (changeable in Settings).
  const detected = browserZone();
  if (s.timeZone === null && detected && !adopting) {
    adopting = true;
    s = await api.patch<Settings>('/settings', { timeZone: detected }).finally(() => (adopting = false));
  }
  zone = s.timeZone ?? DEFAULT_ZONE;
  return s;
}

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: fetchSettings });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Settings>) => api.patch<Settings>('/settings', patch),
    onSuccess: (data, patch) => {
      zone = data.timeZone ?? DEFAULT_ZONE;
      qc.setQueryData(['settings'], data);
      // Everything dated by trading day or local time needs reloading in the new zone.
      if ('timeZone' in patch || 'rolloverTime' in patch) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'settings' });
    },
  });
}
