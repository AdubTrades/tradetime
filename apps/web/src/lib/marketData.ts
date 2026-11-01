import { useQuery } from '@tanstack/react-query';
import { gunzipSync } from 'fflate';
import { unpackBar, type Bar, type PackedBar } from '@tc/domain';
import { api, apiFetch } from './api';

/** Who's signed in, and whether they may use the backtesting page (owner only). */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<{ userId: string; demo: boolean; backtest: boolean }>('/me'),
    staleTime: Infinity,
  });
}

// Paths match apps/server/src/marketData.ts.
export const dayFile = (id: string, date: string) => `${id}/${date.slice(0, 4)}/${date}.json.gz`;
export const hourlyFile = (id: string, year: string | number) => `${id}/hourly/${year}.json.gz`;
export const dailyFile = (id: string) => `${id}/daily.json.gz`;

const cache = new Map<string, Promise<Bar[] | null>>();

/** One price file, kept for the page's lifetime. Null when there's no data (e.g. a holiday). */
export function loadBars(path: string): Promise<Bar[] | null> {
  let p = cache.get(path);
  if (!p) {
    p = (async () => {
      const res = await apiFetch(`/backtest/data/${path}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Couldn’t load price data (${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      // Files are gzipped; a server or CDN may already have unpacked them.
      const text = new TextDecoder().decode(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes);
      return (JSON.parse(text) as PackedBar[]).map(unpackBar);
    })();
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

/** Already loaded (or known missing): the bars, null, or undefined while still loading. */
const settled = new Map<string, Bar[] | null>();
export function peekBars(path: string): Bar[] | null | undefined {
  return settled.get(path);
}
export async function loadAll(paths: string[]): Promise<void> {
  await Promise.all(paths.map(async (p) => settled.set(p, await loadBars(p))));
}
