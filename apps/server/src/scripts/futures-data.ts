/**
 * Futures price history from Databento (CME Globex MDP 3.0, 1-second OHLCV, continuous front month by volume), turned
 * into the 30-second day files the backtesting page reads. Run through `market-data futures`:
 *   pnpm --filter @tc/server market-data futures [NQ] [--months 12] [--buy] [--upload]
 *   pnpm --filter @tc/server market-data futures --daily [--buy] [--upload] [--max-cost 2]
 * - Databento charges for every download, so each month's raw file is kept under market-data/raw/ and never fetched
 *   twice. Without --buy it only prints what the missing months would cost (Databento's free cost check).
 * - --daily tops up: each CME session (18:00–17:00 New York) after the last stored one, as far as Databento has data,
 *   merged into the day files and the hourly and daily summaries. With --upload it reads what's stored from the bucket,
 *   so it runs anywhere (the GitHub Action `market-data.yml`). It stops if a run would cost more than --max-cost USD.
 * - Needs DATABENTO_API_KEY (apps/server/.env.local, or the Action's secrets).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import { aggregate, BACKTEST_INSTRUMENTS, mergeBars, sessionDate, sessionOpen, type Bar, type BacktestInstrument } from '@tc/domain';
import { backtest, storage } from '../config';
import { getObject, storeConfig } from '../fileStore';
import { dailyFile, dayFile, decodeBars, encodeBars, hourlyFile, localDates, localMarketFile, MARKET_BUCKET, readLocalBars, rebuildSummaries, uploadMarketFiles, writeLocal } from '../marketData';

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
const daily = args.includes('--daily');
const maxCost = Number(flag('max-cost') ?? 2);
const months = Math.max(1, Math.min(60, Number(flag('months') ?? 12)));
const wanted = args.filter((a, i) => !a.startsWith('--') && !['--months', '--max-cost'].includes(args[i - 1] ?? ''));
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
const clampEnd = (end: string) => (Date.parse(end.length === 10 ? `${end}T00:00:00Z` : end) > Date.parse(available) ? available : end);

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
const monthBars = (id: string, month: string) => rawBars(rawPath(id, month));

/** 1-second bars from a raw Databento CSV (zstd), combined into 30-second bars. */
function rawBars(file: string): Bar[] {
  const csv = zstdDecompressSync(readFileSync(file)).toString('utf8');
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

// ---------- What's already stored ----------

const remote = upload && storage.remote && !!storage.secretKey;
/** A stored price file: from the bucket when uploading (a GitHub runner has no local copy), else from disk. */
async function readStored(p: string): Promise<Bar[]> {
  if (!remote) return readLocalBars(p) ?? [];
  const data = await getObject({ ...storeConfig(), bucket: MARKET_BUCKET }, null, p);
  return data ? decodeBars(data) : [];
}
const labelDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const iso = (t: number) => new Date(t * 1000).toISOString();
/** A CME session ends 23 hours after it opens (17:00 New York). */
const sessionEnd = (date: string) => sessionOpen(date) + 23 * 3600;

// ---------- Daily top-up ----------

/** Weekday trading dates after `last` whose session has closed and that Databento already has. */
function newSessions(last: string): string[] {
  const out: string[] = [];
  for (let d = addDays(last, 1); sessionEnd(d) * 1000 <= Date.parse(available); d = addDays(d, 1)) {
    const weekday = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) out.push(d);
  }
  return out;
}

const sessionRaw = (id: string, date: string) => localMarketFile(`raw/${id}/${SCHEMA}/days/${date}.csv.zst`);

async function fetchSession(id: string, date: string): Promise<void> {
  const q = params(id, iso(sessionOpen(date)), iso(sessionEnd(date)));
  for (const [k, v] of Object.entries({ encoding: 'csv', compression: 'zstd', pretty_px: 'true', pretty_ts: 'false', map_symbols: 'true' })) q.set(k, v);
  const res = await fetch(`${API}/timeseries.get_range`, { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body: q });
  if (!res.ok) throw new Error(`Databento download failed for ${id} ${date} (${res.status}): ${await res.text()}`);
  const file = sessionRaw(id, date);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(`${file}.part`, new Uint8Array(await res.arrayBuffer()));
  renameSync(`${file}.part`, file);
}

async function topUp(inst: BacktestInstrument): Promise<void> {
  const stored = await readStored(dailyFile(inst.id));
  const last = stored.at(-1);
  if (!last) {
    console.log(`${inst.id}: nothing stored yet; run the monthly backfill first.`);
    return;
  }
  const dates = newSessions(labelDate(last.t));
  if (!dates.length) {
    console.log(`${inst.id}: up to date (last session ${labelDate(last.t)}; Databento has data to ${available}).`);
    return;
  }
  const toBuy = dates.filter((d) => !existsSync(sessionRaw(inst.id, d)));
  const quotes = await Promise.all(toBuy.map((d) => cost(inst.id, iso(sessionOpen(d)), iso(sessionEnd(d)))));
  const total = quotes.reduce((sum, q) => sum + q, 0);
  console.log(`${inst.id}: ${dates.length} new session(s) ${dates[0]} to ${dates.at(-1)}, US$${total.toFixed(2)}`);
  if (total > maxCost) throw new Error(`That’s more than the US$${maxCost} limit for one run; nothing downloaded. Re-run with a higher --max-cost if it’s expected.`);
  if (!buy) {
    console.log('Nothing downloaded. Re-run with --buy to download (and pay for) these sessions.');
    return;
  }
  const written: string[] = [];
  const fresh: Bar[] = [];
  let added = 0;
  for (const d of dates) {
    if (!existsSync(sessionRaw(inst.id, d))) await fetchSession(inst.id, d);
    const bars = rawBars(sessionRaw(inst.id, d)).filter((b) => sessionDate(b.t, inst.kind) === d);
    if (!bars.length) continue; // a holiday: no trading
    writeLocal(dayFile(inst.id, d), encodeBars(bars));
    written.push(dayFile(inst.id, d));
    fresh.push(...bars);
    added++;
  }
  if (!fresh.length) {
    console.log(`${inst.id}: no trading in those sessions (holidays).`);
    return;
  }
  // Merge the new sessions into the summaries.
  writeLocal(dailyFile(inst.id), encodeBars(mergeBars(stored, aggregate(fresh, '1D', inst.kind))));
  written.push(dailyFile(inst.id));
  for (const year of new Set(written.filter((p) => !p.endsWith('daily.json.gz')).map((p) => p.split('/')[1]!))) {
    const yearBars = fresh.filter((b) => sessionDate(b.t, inst.kind).startsWith(year));
    writeLocal(hourlyFile(inst.id, year), encodeBars(mergeBars(await readStored(hourlyFile(inst.id, year)), aggregate(yearBars, '1h', inst.kind))));
    written.push(hourlyFile(inst.id, year));
  }
  console.log(`${inst.id}: ${added} session(s) added, now to ${sessionDate(fresh.at(-1)!.t, inst.kind)}.`);
  if (upload) {
    await uploadMarketFiles(written);
    console.log(`Uploaded ${written.length} files.`);
  }
}

if (daily) {
  for (const inst of instruments) await topUp(inst);
  process.exit(0);
}

// ---------- Monthly backfill ----------

for (const inst of instruments) {
  // Months the daily top-up has already filled are never bought again as a whole month.
  const storedDates = new Set((await readStored(dailyFile(inst.id))).map((b) => labelDate(b.t)));
  const covered = (m: (typeof range)[number]) => [...storedDates].filter((d) => d.startsWith(m.month)).length >= 15;
  const missing = range.filter((m) => !existsSync(rawPath(inst.id, m.month)) && !covered(m));
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
  // Summaries rebuilt from this computer's day files, merged with what's stored (the daily top-up may have added
  // newer sessions there), so uploading never drops days.
  for (const p of rebuildSummaries(inst)) {
    if (remote) writeLocal(p, encodeBars(mergeBars(await readStored(p), readLocalBars(p) ?? [])));
    written.push(p);
  }
  const dates = localDates(inst.id);
  console.log(`${inst.id}: ${byDate.size} trading days written (${dates[0]} to ${dates.at(-1)})`);
  if (upload) {
    console.log(`Uploading ${written.length} files…`);
    await uploadMarketFiles(written);
    console.log('Uploaded.');
  }
}
