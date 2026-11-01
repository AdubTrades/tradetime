import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { aggregate, findInstrument, packBar, unpackBar, type Bar, type BacktestInstrument, type PackedBar } from '@tc/domain';
import { authEnabled, backtest, paths, storage } from './config';
import { currentScope } from './context';
import { putObject, signedUrl, storeConfig, type StoreConfig } from './fileStore';

/**
 * Price history for the backtesting page. Files are gzipped JSON arrays of [t, o, h, l, c, v] (see `bars.ts`):
 * - `<id>/<yyyy>/<yyyy-mm-dd>.json.gz`: base bars (30s futures, 1m crypto) of one trading date
 * - `<id>/hourly/<yyyy>.json.gz`: 1h bars of the trading dates in that year
 * - `<id>/daily.json.gz`: one bar per trading date, labelled midnight UTC of the date
 * They live in the private `market-data` bucket in the cloud (readable only by the owner, see
 * `packages/db/supabase/market-data.sql`) and under TC_DATA_DIR/market-data locally. The backfill script
 * (`scripts/market-data.ts`) writes them.
 */
export const MARKET_BUCKET = 'market-data';
export const HISTORY_YEARS = 5;

export const dayFile = (id: string, date: string) => `${id}/${date.slice(0, 4)}/${date}.json.gz`;
export const hourlyFile = (id: string, year: string | number) => `${id}/hourly/${year}.json.gz`;
export const dailyFile = (id: string) => `${id}/daily.json.gz`;

/** Only the paths above, for known instruments. */
export function isMarketPath(p: string): boolean {
  const m = /^([A-Z]+)\/(?:(\d{4})\/(\d{4})-\d{2}-\d{2}\.json\.gz|hourly\/\d{4}\.json\.gz|daily\.json\.gz)$/.exec(p);
  return !!m && !!findInstrument(m[1]!) && m[2] === m[3];
}

/** Whether the signed-in user may use the backtesting page: the owner(s) listed in BACKTEST_OWNER_IDS, or anyone locally. */
export function canBacktest(userId: string, isDemo: boolean): boolean {
  if (isDemo) return false;
  return !authEnabled || backtest.ownerIds.includes(userId);
}

const marketStore = (): StoreConfig => ({
  ...storeConfig(),
  bucket: MARKET_BUCKET,
});

/** Where the browser gets a file: a short-lived link to cloud storage, or null locally (the API sends it from disk). */
export async function marketFileLink(p: string): Promise<string | null> {
  if (!storage.remote) return null;
  return signedUrl(marketStore(), currentScope().token, p, 3600);
}

export function localMarketFile(p: string): string {
  return path.join(paths.marketData, ...p.split('/'));
}

// ---------- Writing (backfill script) ----------

export const encodeBars = (bars: readonly Bar[]): Buffer => gzipSync(JSON.stringify(bars.map(packBar)), { level: 9 });
export const decodeBars = (data: Uint8Array): Bar[] => (JSON.parse(gunzipSync(data).toString('utf8')) as PackedBar[]).map(unpackBar);

export function writeLocal(p: string, data: Buffer): void {
  const file = localMarketFile(p);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, data);
}

export function readLocalBars(p: string): Bar[] | null {
  const file = localMarketFile(p);
  return existsSync(file) ? decodeBars(readFileSync(file)) : null;
}

/** Trading dates with a local day file, oldest first. */
export function localDates(id: string): string[] {
  const dir = localMarketFile(id);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((y) => /^\d{4}$/.test(y))
    .flatMap((y) =>
      readdirSync(path.join(dir, y))
        .filter((f) => f.endsWith('.json.gz'))
        .map((f) => f.slice(0, 10)),
    )
    .sort();
}

export function removeLocal(p: string): void {
  rmSync(localMarketFile(p), { force: true });
}

/**
 * Rebuild the hourly and daily files from the local day files. Returns the paths written.
 */
export function rebuildSummaries(inst: BacktestInstrument): string[] {
  const byYear = new Map<string, Bar[]>();
  const daily: Bar[] = [];
  for (const date of localDates(inst.id)) {
    const bars = readLocalBars(dayFile(inst.id, date))!;
    if (!bars.length) continue;
    const year = date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(...aggregate(bars, '1h', inst.kind));
    daily.push(...aggregate(bars, '1D', inst.kind));
  }
  const written: string[] = [];
  for (const [year, bars] of byYear) {
    writeLocal(hourlyFile(inst.id, year), encodeBars(bars));
    written.push(hourlyFile(inst.id, year));
  }
  writeLocal(dailyFile(inst.id), encodeBars(daily));
  written.push(dailyFile(inst.id));
  return written;
}

/** Upload local files to the market-data bucket (needs SUPABASE_SECRET_KEY: the script runs without a user). */
export async function uploadMarketFiles(files: string[], onProgress?: (done: number) => void): Promise<void> {
  if (!storage.remote || !storage.secretKey) throw new Error('Uploading needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY in apps/server/.env.local');
  const cfg = marketStore();
  let done = 0;
  await pool(files, 6, async (p) => {
    await putObject(cfg, null, p, readFileSync(localMarketFile(p)), 'application/gzip');
    onProgress?.(++done);
  });
}

/** Run `fn` over `items`, `n` at a time. */
export async function pool<T>(items: readonly T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}
