import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getTableColumns } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { knownMigrationCount, schema } from '@tc/db';
import { durationMinutes, financialYearOf } from '@tc/domain';
import { EXPORT_FORMAT, exportAccount, exportTables, importAccount, type AccountExport } from './accountData';
import { closeDb, initDb, withUser } from './context';
import { listExpenses, listPayouts } from './expenses';
import { listSessions } from './sessions';
import { listTrades } from './trades';

/**
 * Bring data across from the Mac app (the `main` branch: SQLite in ~/TradingCompanion). Reads a backup zip
 * (`tradetime-backup-*.zip`, from Settings → Backups → Back up now) and turns it into an account export that
 * Settings → Your data → Import accepts, files included.
 *
 * The two schemas have the same tables and columns (the cloud adds user_id), so conversion is generic: each cloud
 * column is read from the SQLite column of the same name, with JSON text parsed and 0/1 turned into booleans.
 */

/** Settings the cloud version doesn't have (folder backups, the local demo copy). */
const droppedSettings = new Set(['backupFolder', 'backupIntervalHours', 'backupRetention', 'state.backup', 'state.demo']);
/** The Mac app was always on Perth time. */
const MAC_ZONE = 'Australia/Perth';

const tableByName = new Map<string, PgTable>();
for (const value of Object.values(schema)) if (value instanceof PgTable) tableByName.set(getTableConfig(value).name, value);

const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'application/pdf': 'pdf' };
const fileName = (a: { sha256: string; mime: string }) => `attachments/${a.sha256}.${extensions[a.mime] ?? 'bin'}`;

export interface MacSource {
  /** Path to a SQLite database file (opened read-only). */
  dbPath: string;
  /** sha256 → file contents. */
  files: Map<string, Uint8Array>;
  cleanup: () => void;
}

/**
 * Open a backup zip, or a copy of a data folder (app.db + attachments/). The live ~/TradingCompanion folder is
 * refused: the running Mac app may be writing to it, so use a backup.
 */
export function openMacSource(source: string): MacSource {
  const abs = path.resolve(source);
  if (!existsSync(abs)) throw new Error(`Not found: ${abs}`);
  const files = new Map<string, Uint8Array>();
  const shaOf = (name: string) => /([0-9a-f]{64})\.[a-z0-9]+$/.exec(name)?.[1];

  if (statSync(abs).isDirectory()) {
    if (abs === path.join(homedir(), 'TradingCompanion')) throw new Error('That’s the live data folder the Mac app is using. Make a backup (Settings → Backups → Back up now) and convert the zip instead.');
    const db = path.join(abs, 'app.db');
    if (!existsSync(db)) throw new Error(`No app.db in ${abs}`);
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (shaOf(entry.name)) files.set(shaOf(entry.name)!, readFileSync(p));
      }
    };
    if (existsSync(path.join(abs, 'attachments'))) walk(path.join(abs, 'attachments'));
    return { dbPath: db, files, cleanup: () => undefined };
  }

  const entries = unzipSync(readFileSync(abs));
  if (!entries['app.db']) throw new Error('That zip isn’t a Mac app backup: it has no app.db.');
  for (const [name, bytes] of Object.entries(entries)) {
    if (name.startsWith('attachments/') && shaOf(name)) files.set(shaOf(name)!, bytes);
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'tradetime-mac-'));
  const dbPath = path.join(dir, 'app.db');
  writeFileSync(dbPath, entries['app.db']);
  return { dbPath, files, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Convert one SQLite value to what the cloud column holds. */
function convertValue(value: unknown, columnType: string): unknown {
  if (value === null || value === undefined) return null;
  if (columnType === 'PgJsonb') return typeof value === 'string' ? JSON.parse(value) : value;
  if (columnType === 'PgBoolean') return value === 1 || value === 1n || value === true || value === '1';
  if (typeof value === 'bigint') return Number(value);
  return value;
}

/** Read every table from the Mac database into the cloud export format. Also reports SQLite columns left behind. */
export function readMacDatabase(dbPath: string): { data: AccountExport; dropped: string[] } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const present = new Set((db.prepare(`select name from sqlite_master where type = 'table'`).all() as { name: string }[]).map((r) => r.name));
    const tables: AccountExport['tables'] = {};
    const dropped = new Set<string>();
    for (const name of exportTables) {
      if (!present.has(name)) {
        tables[name] = [];
        continue;
      }
      const columns = Object.entries(getTableColumns(tableByName.get(name)!)).filter(([key]) => key !== 'userId');
      const known = new Set(columns.map(([, c]) => c.name));
      const rows = db.prepare(`select * from "${name}"`).all() as Record<string, unknown>[];
      for (const k of Object.keys(rows[0] ?? {})) if (!known.has(k)) dropped.add(`${name}.${k}`);
      tables[name] = rows.map((row) => Object.fromEntries(columns.filter(([, c]) => c.name in row).map(([key, c]) => [key, convertValue(row[c.name], c.columnType)])));
    }
    tables.setting = (tables.setting ?? []).filter((s) => !droppedSettings.has(String(s.key)));
    if (!tables.setting.some((s) => s.key === 'timeZone')) tables.setting.push({ key: 'timeZone', value: MAC_ZONE, updatedAt: new Date().toISOString() });
    return {
      data: { app: 'tradetime', kind: 'account-export', formatVersion: EXPORT_FORMAT, schemaVersion: knownMigrationCount(), exportedAt: new Date().toISOString(), tables },
      dropped: [...dropped],
    };
  } finally {
    db.close();
  }
}

/** The export as a zip, the same layout the web app's "Download my data" makes. Returns attachments with no file. */
export function buildZip(data: AccountExport, files: Map<string, Uint8Array>): { zip: Uint8Array; missing: string[] } {
  const zip: Zippable = {};
  const missing: string[] = [];
  for (const a of (data.tables.attachment ?? []) as { sha256: string; mime: string }[]) {
    const bytes = files.get(a.sha256);
    if (bytes) zip[fileName(a)] = [bytes, { level: 0 }];
    else missing.push(a.sha256);
  }
  zip['manifest.json'] = strToU8(JSON.stringify({ app: 'tradetime', kind: 'account-export', formatVersion: data.formatVersion, exportedAt: data.exportedAt, source: 'mac-app', missingFiles: missing }, null, 2));
  zip['data.json'] = strToU8(JSON.stringify(data));
  return { zip: zipSync(zip, { level: 6 }), missing };
}

// ---------- Checks ----------

/** JSON with object keys sorted, so jsonb round-trips (which reorder keys) compare equal. */
const stable = (v: unknown): string =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? `{${Object.keys(v as object)
        .sort()
        .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
        .join(',')}}`
    : Array.isArray(v)
      ? `[${v.map(stable).join(',')}]`
      : JSON.stringify(v);
const rowKey = (r: Record<string, unknown>) => String(r.id ?? r.key);

export interface Headline {
  trades: number;
  netCents: number;
  tradingDays: number;
  sessions: number;
  hours: number;
  expensesByFy: Record<string, number>;
  payouts: number;
  payoutsAudCents: number;
  files: number;
}

/** Headline figures straight from the converted rows (what the Mac app holds). */
export function headlineFromRows(data: AccountExport): Headline {
  const live = (name: string) => (data.tables[name] ?? []).filter((r) => !r.deletedAt);
  const trades = live('trade');
  const tradeIds = new Set(trades.map((t) => t.id));
  const expensesByFy: Record<string, number> = {};
  for (const e of live('expense')) {
    const fy = financialYearOf(String(e.date)).label;
    expensesByFy[fy] = (expensesByFy[fy] ?? 0) + Number(e.incGstCents);
  }
  const sessions = live('session').filter((s) => s.end);
  return {
    trades: trades.length,
    netCents: (data.tables.trade_account ?? []).filter((a) => tradeIds.has(a.tradeId)).reduce((s, a) => s + Number(a.netCents), 0),
    tradingDays: new Set(trades.map((t) => t.tradingDay)).size,
    sessions: sessions.length,
    hours: Math.round((sessions.reduce((s, x) => s + durationMinutes({ start: String(x.start), end: String(x.end) }), 0) / 60) * 10) / 10,
    expensesByFy,
    payouts: live('payout').length,
    payoutsAudCents: live('payout').reduce((s, p) => s + Number(p.audReceivedCents), 0),
    files: (data.tables.attachment ?? []).length,
  };
}

/** The same figures as the app itself calculates them, inside the current user scope. */
async function headlineFromApp(): Promise<Headline> {
  const all = { from: '1900-01-01', to: '2999-12-31' };
  const trades = await listTrades(all);
  const sessions = (await listSessions(all)).filter((s) => s.end);
  const expensesByFy: Record<string, number> = {};
  for (const e of await listExpenses(all)) {
    const fy = financialYearOf(e.date).label;
    expensesByFy[fy] = (expensesByFy[fy] ?? 0) + e.incGstCents;
  }
  const payouts = await listPayouts(all);
  const exported = await exportAccount();
  return {
    trades: trades.length,
    netCents: trades.reduce((s, t) => s + t.netCents, 0),
    tradingDays: new Set(trades.map((t) => t.tradingDay)).size,
    sessions: sessions.length,
    hours: Math.round((sessions.reduce((s, x) => s + durationMinutes({ start: x.start, end: x.end! }), 0) / 60) * 10) / 10,
    expensesByFy,
    payouts: payouts.length,
    payoutsAudCents: payouts.reduce((s, p) => s + p.audReceivedCents, 0),
    files: (exported.tables.attachment ?? []).length,
  };
}

export interface Rehearsal {
  /** Tables whose rows didn't come back exactly as sent (should be empty). */
  mismatches: { table: string; sent: number; back: number; differing: number }[];
  mac: Headline;
  cloud: Headline;
}

/**
 * Import the converted data into a throwaway in-memory database, exactly as the app would, then check every row comes
 * back unchanged and the app's own totals match the Mac data. Nothing is written anywhere.
 */
export async function rehearse(data: AccountExport, opts: { ownDb?: boolean } = {}): Promise<Rehearsal> {
  // Scripts open (and close) their own in-memory database; tests pass ownDb: false and use theirs.
  const ownDb = opts.ownDb !== false;
  if (ownDb) await initDb({ memory: true });
  try {
    const user = 'rehearsal';
    await withUser(user, () => importAccount(data));
    const back = await withUser(user, () => exportAccount());
    const mismatches: Rehearsal['mismatches'] = [];
    for (const name of exportTables) {
      const sent = new Map((data.tables[name] ?? []).map((r) => [rowKey(r), stable(r)]));
      const got = new Map((back.tables[name] ?? []).map((r) => [rowKey(r), stable(r)]));
      // Columns the export fills in (defaults) can only add keys, so compare on the keys that were sent.
      let differing = 0;
      for (const [key, json] of sent) {
        const original = JSON.parse(json) as Record<string, unknown>;
        const returned = got.get(key) ? (JSON.parse(got.get(key)!) as Record<string, unknown>) : null;
        if (!returned || Object.keys(original).some((k) => stable(original[k]) !== stable(returned[k]))) differing++;
      }
      if (differing || sent.size !== got.size) mismatches.push({ table: name, sent: sent.size, back: got.size, differing });
    }
    const cloud = await withUser(user, () => headlineFromApp());
    return { mismatches, mac: headlineFromRows(data), cloud };
  } finally {
    if (ownDb) await closeDb();
  }
}
