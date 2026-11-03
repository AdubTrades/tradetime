/**
 * Download price history for the backtesting page and write the files it reads (see `marketData.ts`).
 * Usage: pnpm --filter @tc/server market-data crypto [BTCUSDT ETHUSDT SOLUSDT] [--from 2021-11] [--upload]
 *        pnpm --filter @tc/server market-data crypto --daily [--upload]   (top-up, also run by market-data.yml)
 *        pnpm --filter @tc/server market-data futures [NQ] [--months 12] [--buy] [--upload]   (see futures-data.ts)
 * - crypto: Binance's public archive (data.binance.vision), spot 1-minute klines, free and without a key. Whole months
 *   come from the monthly files, the current month from the daily ones. Each file's SHA-256 is checked.
 * - Days already on disk are skipped, so it can be re-run any time to top up. Days older than 5 years are removed.
 * - --upload sends new and changed files to the Supabase `market-data` bucket (needs SUPABASE_SECRET_KEY).
 * - --daily adds each UTC day after the last stored one (read from the bucket when uploading, so it runs anywhere) and
 *   drops days older than 5 years from the summaries and the bucket.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { aggregate, BACKTEST_INSTRUMENTS, mergeBars, sessionDate, type Bar, type BacktestInstrument } from '@tc/domain';
import { paths, storage } from '../config';
import { deleteObjects, getObject, storeConfig } from '../fileStore';
import {
  dailyFile,
  dayFile,
  decodeBars,
  encodeBars,
  HISTORY_YEARS,
  hourlyFile,
  localDates,
  localMarketFile,
  MARKET_BUCKET,
  pool,
  readLocalBars,
  rebuildSummaries,
  removeLocal,
  uploadMarketFiles,
  writeLocal,
} from '../marketData';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : null;
};
const kind = args[0];
const upload = args.includes('--upload');
const symbols = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !all[i - 1]?.startsWith('--from'));

const today = new Date().toISOString().slice(0, 10);
const cutoff = (() => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() - HISTORY_YEARS);
  return d.toISOString().slice(0, 10);
})();

if (kind === 'futures') {
  await import('./futures-data');
  process.exit(0);
}
if (kind !== 'crypto') {
  console.error('Usage: market-data crypto [SYMBOL…] [--from YYYY-MM] [--upload]\n       market-data futures [NQ] [--months 12] [--buy] [--upload]');
  process.exit(1);
}

const instruments = BACKTEST_INSTRUMENTS.filter((i) => i.kind === 'crypto' && (symbols.length === 0 || symbols.includes(i.id)));
const fromMonth = flag('from') ?? cutoff.slice(0, 7);
console.log(`Market data → ${paths.marketData}\nFrom ${fromMonth} (keeping ${HISTORY_YEARS} years, since ${cutoff})`);

// ---------- Binance ----------

const BINANCE = 'https://data.binance.vision/data/spot';

async function download(url: string): Promise<Uint8Array | null> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch((err: Error) => err);
    if (!(res instanceof Error) && res.status === 404) return null;
    if (!(res instanceof Error) && res.ok) return new Uint8Array(await res.arrayBuffer());
    if (attempt === 3) throw new Error(`${url}: ${res instanceof Error ? res.message : res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

/** One archive file's klines, checked against its published SHA-256. Null if Binance doesn't have it (yet). */
async function binanceKlines(url: string): Promise<Bar[] | null> {
  const [zip, checksum] = await Promise.all([download(url), download(`${url}.CHECKSUM`)]);
  if (!zip) return null;
  const expected = checksum ? new TextDecoder().decode(checksum).trim().split(/\s+/)[0] : null;
  if (expected && createHash('sha256').update(zip).digest('hex') !== expected) throw new Error(`${url}: checksum mismatch`);
  const csv = new TextDecoder().decode(Object.values(unzipSync(zip))[0]!);
  const bars: Bar[] = [];
  for (const line of csv.split('\n')) {
    const c = line.split(',');
    if (c.length < 6 || !/^\d+$/.test(c[0]!)) continue; // blank lines and any header
    const raw = Number(c[0]);
    // Open times are milliseconds in older files and microseconds from 2025.
    const t = Math.round(raw > 1e14 ? raw / 1e6 : raw / 1e3);
    bars.push({
      t,
      o: +c[1]!,
      h: +c[2]!,
      l: +c[3]!,
      c: +c[4]!,
      v: Math.round(+c[5]! * 1e4) / 1e4,
    });
  }
  return bars.sort((a, b) => a.t - b.t);
}

/** Write one file per trading date. Returns the paths written. */
function writeDays(inst: BacktestInstrument, bars: Bar[]): string[] {
  const byDate = new Map<string, Bar[]>();
  for (const b of bars) {
    const d = sessionDate(b.t, inst.kind);
    if (d < cutoff || d >= today) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(b);
  }
  for (const [d, list] of byDate) writeLocal(dayFile(inst.id, d), encodeBars(list));
  return [...byDate.keys()].map((d) => dayFile(inst.id, d));
}

const months = (from: string, to: string) => {
  const out: string[] = [];
  for (let [y, m] = from.split('-').map(Number) as [number, number]; `${y}-${String(m).padStart(2, '0')}` <= to; m === 12 ? (y++, (m = 1)) : m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
  return out;
};
const daysIn = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`).filter((d) => d >= cutoff && d < today);
};

// ---------- Daily top-up ----------

if (args.includes('--daily')) {
  const remote = upload && storage.remote && !!storage.secretKey;
  const store = () => ({ ...storeConfig(), bucket: MARKET_BUCKET });
  /** A stored file: from the bucket when uploading (a GitHub runner has no local copy), else from disk. */
  const readStored = async (p: string): Promise<Bar[]> => {
    if (!remote) return readLocalBars(p) ?? [];
    const data = await getObject(store(), null, p);
    return data ? decodeBars(data) : [];
  };
  const dateOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  for (const inst of instruments) {
    const stored = await readStored(dailyFile(inst.id));
    const last = stored.at(-1);
    if (!last) {
      console.log(`${inst.id}: nothing stored yet; run the full download first.`);
      continue;
    }
    const written: string[] = [];
    const fresh: Bar[] = [];
    for (let d = nextDay(dateOf(last.t)); d < today; d = nextDay(d)) {
      const bars = await binanceKlines(`${BINANCE}/daily/klines/${inst.id}/1m/${inst.id}-1m-${d}.zip`);
      if (!bars) break; // not published yet: try again next run
      written.push(...writeDays(inst, bars));
      fresh.push(...bars.filter((b) => sessionDate(b.t, inst.kind) === d));
    }
    // Keep 5 years: drop older days from the summaries, and their day files from the bucket.
    const old = stored.filter((b) => dateOf(b.t) < cutoff).map((b) => dateOf(b.t));
    if (!fresh.length && !old.length) {
      console.log(`${inst.id}: up to date (last day ${dateOf(last.t)}).`);
      continue;
    }
    const keep = (bars: Bar[]) => bars.filter((b) => sessionDate(b.t, inst.kind) >= cutoff);
    writeLocal(dailyFile(inst.id), encodeBars(keep(mergeBars(stored, aggregate(fresh, '1D', inst.kind)))));
    written.push(dailyFile(inst.id));
    const years = new Set([...fresh.map((b) => sessionDate(b.t, inst.kind).slice(0, 4)), ...old.map((d) => d.slice(0, 4))]);
    const goneYears: string[] = [];
    for (const year of years) {
      const merged = keep(
        mergeBars(
          await readStored(hourlyFile(inst.id, year)),
          aggregate(
            fresh.filter((b) => sessionDate(b.t, inst.kind).startsWith(year)),
            '1h',
            inst.kind,
          ),
        ),
      );
      if (!merged.length) {
        goneYears.push(hourlyFile(inst.id, year));
        continue;
      }
      writeLocal(hourlyFile(inst.id, year), encodeBars(merged));
      written.push(hourlyFile(inst.id, year));
    }
    const newDays = written.filter((p) => !p.includes('/hourly/') && !p.endsWith('daily.json.gz')).length;
    console.log(
      `${inst.id}: ${newDays} day(s) added${old.length ? `, ${old.length} older than ${HISTORY_YEARS} years removed` : ''}${fresh.length ? `, now to ${sessionDate(fresh.at(-1)!.t, inst.kind)}` : ''}.`,
    );
    if (upload) {
      await uploadMarketFiles(written);
      const gone = [...old.map((d) => dayFile(inst.id, d)), ...goneYears];
      if (gone.length && remote) await deleteObjects(store(), null, gone);
      console.log(`Uploaded ${written.length} files${gone.length ? `, removed ${gone.length}` : ''}.`);
    }
  }
  process.exit(0);
}

// ---------- Run ----------

const uploadedLog = localMarketFile('uploaded.json');
const uploaded = new Set<string>(existsSync(uploadedLog) ? (JSON.parse(readFileSync(uploadedLog, 'utf8')) as string[]) : []);
const changed: string[] = [];
const removed: string[] = [];

for (const inst of instruments) {
  const have = new Set(localDates(inst.id));
  const thisMonth = today.slice(0, 7);
  const todo = months(fromMonth, thisMonth).filter((m) => daysIn(m).some((d) => !have.has(d)));
  let written = 0;
  await pool(todo, 4, async (month) => {
    const missing = daysIn(month).filter((d) => !have.has(d));
    // The monthly file appears a day or so after the month ends; until then (and for the current month) use daily files.
    const monthly = month < thisMonth ? await binanceKlines(`${BINANCE}/monthly/klines/${inst.id}/1m/${inst.id}-1m-${month}.zip`) : null;
    if (monthly) {
      const files = writeDays(inst, monthly);
      changed.push(...files);
      written += files.length;
      return;
    }
    for (const d of missing) {
      const bars = await binanceKlines(`${BINANCE}/daily/klines/${inst.id}/1m/${inst.id}-1m-${d}.zip`);
      if (!bars) continue;
      const files = writeDays(inst, bars);
      changed.push(...files);
      written += files.length;
    }
  });
  const old = localDates(inst.id).filter((d) => d < cutoff);
  for (const d of old) removeLocal(dayFile(inst.id, d));
  removed.push(...old.map((d) => dayFile(inst.id, d)));
  const summaries = rebuildSummaries(inst);
  changed.push(...summaries);
  const dates = localDates(inst.id);
  console.log(`${inst.id}: ${written} days downloaded, ${old.length} removed, ${dates.length} days on disk (${dates[0] ?? '–'} to ${dates.at(-1) ?? '–'})`);
}

if (upload) {
  const files = [...new Set([...changed, ...instruments.flatMap((i) => localDates(i.id).map((d) => dayFile(i.id, d))).filter((p) => !uploaded.has(p))])];
  console.log(`Uploading ${files.length} files to the market-data bucket…`);
  await uploadMarketFiles(files, (n) => n % 100 === 0 && console.log(`  ${n}/${files.length}`));
  for (const f of files) if (!/\/(hourly|daily)/.test(f)) uploaded.add(f);
  const gone = removed.filter((p) => uploaded.has(p));
  if (gone.length) {
    await deleteObjects({ ...storeConfig(), bucket: MARKET_BUCKET }, null, gone);
    for (const p of gone) uploaded.delete(p);
    console.log(`Removed ${gone.length} old days from the bucket.`);
  }
  writeFileSync(uploadedLog, JSON.stringify([...uploaded].sort()));
  console.log('Uploaded.');
}
