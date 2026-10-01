import { and, asc, gte, inArray, isNull, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { schema } from '@tc/db';
import { FRED_RELEASES, fredToEvents, newId, type MarketEventInput } from '@tc/domain';
import { db } from './context';
import { AppError } from './errors';
import { getSettings, getState, setState } from './settings';

const { marketEvent } = schema;

export interface MarketFetchStatus {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  count: number;
}

export const getMarketStatus = (): MarketFetchStatus => ({ lastSuccessAt: null, lastAttemptAt: null, lastError: null, count: 0, ...getState<MarketFetchStatus>('market') });

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Release dates for each curated FRED release between two dates (future dates included). */
export async function fetchFredEvents(apiKey: string, from: string, to: string, fetcher: Fetcher = fetch): Promise<MarketEventInput[]> {
  const dates: { release_id: number; date: string }[] = [];
  for (const rid of Object.keys(FRED_RELEASES).map(Number)) {
    const url = new URL('https://api.stlouisfed.org/fred/release/dates');
    url.search = new URLSearchParams({
      release_id: String(rid),
      api_key: apiKey,
      file_type: 'json',
      realtime_start: from,
      realtime_end: to,
      include_release_dates_with_no_data: 'true',
      sort_order: 'asc',
      limit: '1000',
    }).toString();
    const res = await fetcher(url.toString());
    const body = (await res.json().catch(() => ({}))) as { release_dates?: { release_id: number; date: string }[]; error_message?: string };
    if (!res.ok) throw new Error(body.error_message ?? `FRED returned ${res.status}`);
    for (const d of body.release_dates ?? []) dates.push({ release_id: rid, date: d.date });
  }
  return fredToEvents(dates);
}

export function upsertMarketEvents(events: MarketEventInput[]): number {
  const now = new Date().toISOString();
  db.transaction((tx) => {
    for (const e of events) {
      tx.insert(marketEvent)
        .values({ id: newId(), ...e, fetchedAt: now })
        .onConflictDoUpdate({ target: [marketEvent.provider, marketEvent.providerId], set: { title: e.title, at: e.at, impact: e.impact, fetchedAt: now, deletedAt: null } })
        .run();
    }
  });
  return events.length;
}

let running: Promise<MarketFetchStatus> | null = null;

/** Fetch the last 30 and next 120 days of releases and store them locally. */
export function refreshMarketEvents(fetcher?: Fetcher): Promise<MarketFetchStatus> {
  running ??= (async () => {
    const attemptAt = new Date().toISOString();
    const prev = getMarketStatus();
    const { fredApiKey } = getSettings();
    try {
      if (!fredApiKey) throw new Error('Add your FRED API key in Settings to fetch economic events');
      const today = DateTime.now().setZone('America/New_York');
      const events = await fetchFredEvents(fredApiKey, today.minus({ days: 30 }).toISODate()!, today.plus({ days: 120 }).toISODate()!, fetcher);
      const count = upsertMarketEvents(events);
      const status = { lastSuccessAt: new Date().toISOString(), lastAttemptAt: attemptAt, lastError: null, count };
      setState('market', status);
      return status;
    } catch (err) {
      const status = { ...prev, lastAttemptAt: attemptAt, lastError: (err as Error).message };
      setState('market', status);
      return status;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Due if a key is set and the last success is more than 12 hours old (retry failures hourly). */
export function isMarketRefreshDue(now = Date.now()): boolean {
  if (!getSettings().fredApiKey) return false;
  const s = getMarketStatus();
  if (s.lastError && s.lastAttemptAt && now - Date.parse(s.lastAttemptAt) < 3_600_000) return false;
  return !s.lastSuccessAt || now - Date.parse(s.lastSuccessAt) > 12 * 3_600_000;
}

/** Stored events between two instants, filtered by the impact setting unless `impacts` is given. */
export function listMarketEvents(fromInstant: string, toInstant: string, impacts?: ('high' | 'medium' | 'low')[]) {
  const wanted = impacts ?? (getSettings().includeMediumEvents ? ['high', 'medium'] : ['high']);
  if (fromInstant > toInstant) throw new AppError(400, 'Invalid range');
  return db
    .select()
    .from(marketEvent)
    .where(and(isNull(marketEvent.deletedAt), gte(marketEvent.at, fromInstant), lte(marketEvent.at, toInstant), inArray(marketEvent.impact, wanted)))
    .orderBy(asc(marketEvent.at))
    .all();
}
