import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import Database from 'better-sqlite3';
import { DateTime } from 'luxon';
import { knownMigrationCount } from '@tc/db';
import { LOCAL_ZONE } from '@tc/domain';
import { createArchive } from './backup';
import { paths } from './config';
import { sqlite } from './context';
import { AppError } from './errors';
import { getSettings } from './settings';

const run = promisify(execFile);
const BACKUP_RE = /^trading-companion-(backup|pre-restore)-\d{8}-\d{6}\.zip$/;
export const uploadsDir = () => path.join(paths.tmp, 'uploads');

export interface BackupFile {
  name: string;
  path: string;
  folder: 'backup' | 'local' | 'upload';
  bytes: number;
  modifiedAt: string;
}

/** Backups in the chosen backup folder and the local fallback folder, newest first. */
export function listBackups(): BackupFile[] {
  const folders: { dir: string; folder: BackupFile['folder'] }[] = [{ dir: paths.localBackups, folder: 'local' }];
  const chosen = getSettings().backupFolder;
  if (chosen && chosen !== paths.localBackups) folders.unshift({ dir: chosen, folder: 'backup' });
  const out: BackupFile[] = [];
  for (const { dir, folder } of folders) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!BACKUP_RE.test(name)) continue;
      const st = statSync(path.join(dir, name));
      out.push({ name, path: path.join(dir, name), folder, bytes: st.size, modifiedAt: st.mtime.toISOString() });
    }
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** Only files we listed or that were uploaded through the app may be inspected or restored. */
function allowedPath(p: string): string {
  const resolved = path.resolve(p);
  const ok = listBackups().some((b) => b.path === resolved) || (path.dirname(resolved) === uploadsDir() && existsSync(resolved));
  if (!ok) throw new AppError(404, 'Backup not found');
  return resolved;
}

export async function saveUpload(file: File): Promise<string> {
  if (!file.name.endsWith('.zip')) throw new AppError(422, 'Choose a .zip backup file');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(uploadsDir(), { recursive: true });
  const target = path.join(uploadsDir(), `upload-${Date.now()}.zip`);
  await pipeline(file.stream() as unknown as NodeJS.ReadableStream, createWriteStream(target));
  return target;
}

export interface BackupInspection {
  path: string;
  createdAt: string | null;
  formatVersion: number;
  integrity: string;
  counts: { trades: number; sessions: number; expenses: number; payouts: number; attachments: number };
  latestActivity: string | null;
}

/** Extract into a temp folder, refusing unsafe paths (zip slip) and anything that isn't one of our backups. */
async function extract(zipPath: string): Promise<string> {
  const { stdout } = await run('/usr/bin/unzip', ['-Z1', zipPath]).catch(() => {
    throw new AppError(422, "That file isn't a readable zip");
  });
  const entries = stdout.split('\n').filter(Boolean);
  if (entries.some((e) => e.startsWith('/') || e.split('/').includes('..'))) throw new AppError(422, 'The zip contains unsafe paths');
  if (!entries.includes('manifest.json') || !entries.includes('app.db')) throw new AppError(422, "This doesn't look like a Trading Companion backup");
  const dir = mkdtempSync(path.join(paths.tmp, 'restore-'));
  await run('/usr/bin/unzip', ['-q', '-o', zipPath, '-d', dir]);
  return dir;
}

function inspectExtracted(dir: string, zipPath: string): BackupInspection {
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as { app?: string; formatVersion?: number; createdAt?: string };
  if (manifest.app !== 'trading-companion') throw new AppError(422, "This doesn't look like a Trading Companion backup");
  if ((manifest.formatVersion ?? 0) > 1) throw new AppError(422, 'This backup was made by a newer version of the app. Update the app first.');
  const db = new Database(path.join(dir, 'app.db'), { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma('integrity_check', { simple: true }) as string;
    if (integrity !== 'ok') throw new AppError(422, `The backup's database failed its integrity check: ${integrity}`);
    const migrations = (db.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as { n: number }).n;
    if (migrations > knownMigrationCount()) throw new AppError(422, 'This backup was made by a newer version of the app. Update the app first.');
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name));
    const count = (table: string) => (tables.has(table) ? (db.prepare(`SELECT count(*) AS n FROM "${table}" WHERE deleted_at IS NULL`).get() as { n: number }).n : 0);
    const latest = (sql: string) => (db.prepare(sql).get() as { v: string | null } | undefined)?.v ?? null;
    const activity = [
      tables.has('trade') ? latest('SELECT max(trading_day) AS v FROM trade WHERE deleted_at IS NULL') : null,
      tables.has('session') ? latest('SELECT max(trading_day) AS v FROM session WHERE deleted_at IS NULL') : null,
      tables.has('expense') ? latest('SELECT max(date) AS v FROM expense WHERE deleted_at IS NULL') : null,
    ].filter((x): x is string => !!x);
    return {
      path: zipPath,
      createdAt: manifest.createdAt ?? null,
      formatVersion: manifest.formatVersion ?? 1,
      integrity,
      counts: { trades: count('trade'), sessions: count('session'), expenses: count('expense'), payouts: count('payout'), attachments: count('attachment') },
      latestActivity: activity.sort().at(-1) ?? null,
    };
  } finally {
    db.close();
  }
}

/** Open a backup and report what's in it, without changing anything. */
export async function inspectBackup(zipPath: string): Promise<BackupInspection> {
  const resolved = allowedPath(zipPath);
  const dir = await extract(resolved);
  try {
    return inspectExtracted(dir, resolved);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write a zipped copy of the current data before it's replaced. */
async function safetyBackup(): Promise<string> {
  const stamp = DateTime.now().setZone(LOCAL_ZONE).toFormat('yyyyLLdd-HHmmss');
  const target = path.join(paths.localBackups, `trading-companion-pre-restore-${stamp}.zip`);
  const { archive, cleanup } = await createArchive();
  try {
    await pipeline(archive, createWriteStream(`${target}.part`));
    renameSync(`${target}.part`, target);
  } finally {
    cleanup();
    rmSync(`${target}.part`, { force: true });
  }
  return target;
}

/**
 * Validate the backup, save a safety copy of the current data, stage the backup, then exit so the
 * app restarts (launchd) and swaps it in before opening the database.
 */
export async function stageRestore(zipPath: string): Promise<{ safetyBackup: string; inspection: BackupInspection }> {
  const resolved = allowedPath(zipPath);
  const dir = await extract(resolved);
  try {
    const inspection = inspectExtracted(dir, resolved);
    const safety = await safetyBackup();
    rmSync(paths.restorePending, { recursive: true, force: true });
    renameSync(dir, paths.restorePending);
    setTimeout(() => {
      sqlite.close();
      process.exit(0);
    }, 300);
    return { safetyBackup: safety, inspection };
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

export function lastRestore(): { restoredAt: string } | null {
  const f = path.join(paths.logs, 'last-restore.json');
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as { restoredAt: string }) : null;
}
