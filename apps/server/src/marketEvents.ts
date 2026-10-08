import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { schema } from '@tc/db';
import { FRED_RELEASES, fomcEvents, fredToEvents, newId, zonedToUtc, type MarketEventInput } from '@tc/domain';
import { fredApiKey as serverFredKey } from './config';
import { db } from './context';
import { AppError } from './errors';
import { getAppState, getSettings, setAppState, trySettings } from './settings';

const { marketEvent } = schema;

export interface MarketFetchStatus {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  count: number;
}

export const getMarketStatus = async (): Promise<MarketFetchStatus> => ({
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastError: null,
  count: 0,
  ...(await getAppState<MarketFetchStatus>('market')),
});

/** The server's FRED key; locally, the signed-in user's own key from Settings if the server has none. */
const fredKey = (): string | null => serverFredKey ?? trySettings()?.fredApiKey ?? null;

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

/**
 * Store events, and soft-delete stored events from the same providers within the window that the source
 * no longer lists (rescheduled or withdrawn releases), so nothing doubles up.
 */
export async function upsertMarketEvents(events: MarketEventInput[], window?: { fromInstant: string; toInstant: string; providers: string[] }): Promise<number> {
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    if (window) {
      const keep = new Set(events.map((e) => `${e.provider}|${e.providerId}`));
      const stored = await tx
        .select({ id: marketEvent.id, provider: marketEvent.provider, providerId: marketEvent.providerId })
        .from(marketEvent)
        .where(and(isNull(marketEvent.deletedAt), inArray(marketEvent.provider, window.providers), gte(marketEvent.at, window.fromInstant), lte(marketEvent.at, window.toInstant)));
      const gone = stored.filter((r) => !keep.has(`${r.provider}|${r.providerId}`)).map((r) => r.id);
      if (gone.length) await tx.update(marketEvent).set({ deletedAt: now }).where(inArray(marketEvent.id, gone));
    }
    for (const e of events) {
      await tx
        .insert(marketEvent)
        .values({ id: newId(), ...e, fetchedAt: now })
        .onConflictDoUpdate({ target: [marketEvent.provider, marketEvent.providerId], set: { title: e.title, at: e.at, impact: e.impact, fetchedAt: now, deletedAt: null } });
    }
  });
  return events.length;
}

let running: Promise<MarketFetchStatus> | null = null;

/** Fetch the last 30 and next 120 days of releases and store them locally. */
export function refreshMarketEvents(fetcher?: Fetcher): Promise<MarketFetchStatus> {
  running ??= (async () => {
    const attemptAt = new Date().toISOString();
    const prev = await getMarketStatus();
    const fredApiKey = fredKey();
    try {
      if (!fredApiKey) throw new Error('No FRED API key is set, so economic events can’t be fetched');
      const today = DateTime.now().setZone('America/New_York');
      const from = today.minus({ days: 30 }).toISODate()!;
      const to = today.plus({ days: 120 }).toISODate()!;
      const events = [...(await fetchFredEvents(fredApiKey, from, to, fetcher)), ...fomcEvents(from, to)];
      // Window covers the whole New York days fetched, so everything stored in it is re-checked.
      const window = {
        fromInstant: zonedToUtc(from, '00:00', 'America/New_York'),
        toInstant: zonedToUtc(DateTime.fromISO(to).plus({ days: 1 }).toISODate()!, '00:00', 'America/New_York'),
        providers: ['fred', 'fomc'],
      };
      const count = await upsertMarketEvents(events, window);
      const status = { lastSuccessAt: new Date().toISOString(), lastAttemptAt: attemptAt, lastError: null, count };
      await setAppState('market', status);
      return status;
    } catch (err) {
      const status = { ...prev, lastAttemptAt: attemptAt, lastError: (err as Error).message };
      await setAppState('market', status);
      return status;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Due if a key is set and the last success is more than 12 hours old (retry failures hourly). */
export async function isMarketRefreshDue(now = Date.now()): Promise<boolean> {
  if (!fredKey()) return false;
  const s = await getMarketStatus();
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
    .orderBy(asc(marketEvent.at));
}
