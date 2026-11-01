/**
 * Futures price history from Databento (CME Globex MDP 3.0, 1-second OHLCV, continuous front month by volume), turned
 * into the 30-second day files the backtesting page reads. Run through `market-data futures`:
 *   pnpm --filter @tc/server market-data futures [NQ] [--months 12] [--buy] [--upload]
 * - Databento charges for every download, so each month's raw file is kept under market-data/raw/ and never fetched
 *   twice. Without --buy it only prints what the missing months would cost (Databento's free cost check).
 * - Needs DATABENTO_API_KEY in apps/server/.env.local.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { aggregate, BACKTEST_INSTRUMENTS, sessionDate, type Bar } from '@tc/domain';
import { backtest } from '../config';
import { dayFile, encodeBars, localDates, localMarketFile, rebuildSummaries, uploadMarketFiles, writeLocal } from '../marketData';

const API = 'https://hist.databento.com/v0';
const DATASET = 'GLBX.MDP3';
const SCHEMA = 'ohlcv-1s';

const args = process.argv.slice(3);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};
const buy = args.includes('--buy');
const upload = args.includes('--upload');
const months = Math.max(1, Math.min(60, Number(flag('months') ?? 12)));
const wanted = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--months'));
const instruments = BACKTEST_INSTRUMENTS.filter((i) => i.kind === 'futures' && (wanted.length === 0 || wanted.includes(i.id)));

const key = backtest.databentoKey;
if (!key) {
  console.error('Add DATABENTO_API_KEY to apps/server/.env.local first.');
  process.exit(1);
}
const auth = `Basic ${Buffer.from(`${key}:`).toString('base64')}`;

/** Whole months ending with the last complete one, as [YYYY-MM, start, end) in UTC. */
const range = (() => {
  const now = new Date();
  const out: { month: string; start: string; end: string }[] = [];
  for (let k = months; k >= 1; k--) {
    const s = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k, 1));
    const e = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - k + 1, 1));
    out.push({ month: s.toISOString().slice(0, 7), start: s.toISOString().slice(0, 10), end: e.toISOString().slice(0, 10) });
  }
  return out;
})();

const rawPath = (id: string, month: string) => localMarketFile(`raw/${id}/${SCHEMA}/${month}.csv.zst`);
const params = (id: string, start: string, end: string) => new URLSearchParams({ dataset: DATASET, symbols: `${id}.v.0`, stype_in: 'continuous', schema: SCHEMA, start, end: clampEnd(end) });

/** The latest moment Databento has (the last day or so needs a live licence), so a request never runs past it. */
async function availableEnd(): Promise<string> {
  const res = await fetch(`${API}/metadata.get_dataset_range?dataset=${DATASET}`, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`Databento range check failed (${res.status}): ${await res.text()}`);
  const body = (await res.json()) as { end?: string; end_date?: string; schema?: Record<string, { end: string }> };
  return body.schema?.[SCHEMA]?.end ?? body.end ?? `${body.end_date}T00:00:00Z`;
}
const available = await availableEnd();
const clampEnd = (end: string) => (new Date(`${end}T00:00:00Z`).getTime() > Date.parse(available) ? available : end);

async function cost(id: string, start: string, end: string): Promise<number> {
  const res = await fetch(`${API}/metadata.get_cost?${params(id, start, end)}`, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`Databento cost check failed (${res.status}): ${await res.text()}`);
  return Number(await res.text());
}

async function fetchMonth(id: string, m: (typeof range)[number]): Promise<void> {
  const q = params(id, m.start, m.end);
  for (const [k, v] of Object.entries({ encoding: 'csv', compression: 'zstd', pretty_px: 'true', pretty_ts: 'false', map_symbols: 'true' })) q.set(k, v);
  const res = await fetch(`${API}/timeseries.get_range`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: q });
  if (!res.ok) throw new Error(`Databento download failed for ${id} ${m.month} (${res.status}): ${await res.text()}`);
  const file = rawPath(id, m.month);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.part`, new Uint8Array(await res.arrayBuffer()));
  renameSync(`${file}.part`, file);
}

/** A month's 1-second bars from its raw CSV, combined into 30-second bars. */
function monthBars(id: string, month: string): Bar[] {
  const csv = zstdDecompressSync(readFileSync(rawPath(id, month))).toString('utf8');
  const lines = csv.split('\n');
  const head = lines[0]!.split(',');
  const col = (name: string) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`No ${name} column in the Databento file`);
    return i;
  };
  const [ts, o, h, l, c, v] = ['ts_event', 'open', 'high', 'low', 'close', 'volume'].map(col) as [number, number, number, number, number, number];
  const secs: Bar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i]!.split(',');
    if (f.length < head.length) continue;
    secs.push({ t: Math.floor(Number(f[ts]) / 1e9), o: +f[o]!, h: +f[h]!, l: +f[l]!, c: +f[c]!, v: +f[v]! });
  }
  secs.sort((a, b) => a.t - b.t);
  return aggregate(secs, '30s', 'futures');
}

for (const inst of instruments) {
  const missing = range.filter((m) => !existsSync(rawPath(inst.id, m.month)));
  if (missing.length) {
    const quotes = await Promise.all(missing.map((m) => cost(inst.id, m.start, m.end)));
    const total = quotes.reduce((s, q) => s + q, 0);
    console.log(`${inst.id}: ${missing.length} month(s) to download (${missing[0]!.month} to ${missing.at(-1)!.month}), US$${total.toFixed(2)}`);
    if (!buy) {
      console.log('Nothing downloaded. Re-run with --buy to download (and pay for) these months.');
      continue;
    }
    for (const m of missing) {
      process.stdout.write(`  downloading ${m.month}… `);
      await fetchMonth(inst.id, m);
      console.log('done');
    }
  }
  // Rebuild the day files from every raw month on disk (no charge).
  const bars: Bar[] = [];
  for (const m of range) if (existsSync(rawPath(inst.id, m.month))) bars.push(...monthBars(inst.id, m.month));
  if (!bars.length) continue;
  bars.sort((a, b) => a.t - b.t);
  const byDate = new Map<string, Bar[]>();
  for (const b of bars) {
    const d = sessionDate(b.t, 'futures');
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(b);
  }
  const written: string[] = [];
  for (const [d, list] of byDate) {
    writeLocal(dayFile(inst.id, d), encodeBars(list));
    written.push(dayFile(inst.id, d));
  }
  written.push(...rebuildSummaries(inst));
  const dates = localDates(inst.id);
  console.log(`${inst.id}: ${byDate.size} trading days written (${dates[0]} to ${dates.at(-1)})`);
  if (upload) {
    console.log(`Uploading ${written.length} files…`);
    await uploadMarketFiles(written);
    console.log('Uploaded.');
  }
}
