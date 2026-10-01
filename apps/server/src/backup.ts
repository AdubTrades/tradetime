import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { ZipArchive } from 'archiver';
import { DateTime } from 'luxon';
import { LOCAL_ZONE } from '@tc/domain';
import { paths } from './config';
import { sqlite } from './context';
import { getSettings, getState, setState } from './settings';

const BACKUP_PREFIX = 'trading-companion-backup-';
const FORMAT_VERSION = 1;

export interface BackupStatus {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  lastFile: string | null;
  lastBytes: number | null;
}

const emptyStatus: BackupStatus = { lastSuccessAt: null, lastAttemptAt: null, lastError: null, lastFile: null, lastBytes: null };
export const getBackupStatus = (): BackupStatus => ({ ...emptyStatus, ...getState<BackupStatus>('backup') });

const timestamp = () => DateTime.now().setZone(LOCAL_ZONE).toFormat('yyyyLLdd-HHmmss');

/**
 * Build a zip stream of a consistent database snapshot plus all attachments.
 * Uses SQLite's online backup API, so it is safe while the app is in use.
 */
export async function createArchive(): Promise<{ archive: Readable; cleanup: () => void; fileName: string }> {
  const stamp = timestamp();
  const snapshot = path.join(paths.tmp, `snapshot-${stamp}-${process.pid}.db`);
  await sqlite.backup(snapshot);

  const archive = new ZipArchive({ zlib: { level: 6 } });
  archive.append(
    JSON.stringify({ app: 'trading-companion', formatVersion: FORMAT_VERSION, createdAt: new Date().toISOString() }, null, 2),
    { name: 'manifest.json' },
  );
  archive.file(snapshot, { name: 'app.db' });
  archive.directory(paths.attachments, 'attachments');
  void archive.finalize();

  return {
    archive,
    fileName: `${BACKUP_PREFIX}${stamp}.zip`,
    cleanup: () => rmSync(snapshot, { force: true }),
  };
}

export async function checkWritableFolder(folder: string): Promise<string | null> {
  if (!path.isAbsolute(folder)) return 'Folder must be an absolute path';
  if (!existsSync(folder)) return 'Folder does not exist';
  if (!statSync(folder).isDirectory()) return 'Path is not a folder';
  try {
    await access(folder, constants.W_OK);
    return null;
  } catch {
    return 'Folder is not writable';
  }
}

function pruneOldBackups(folder: string, keep: number): void {
  const files = readdirSync(folder)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith('.zip'))
    .sort()
    .reverse();
  for (const f of files.slice(keep)) rmSync(path.join(folder, f), { force: true });
}

let running: Promise<BackupStatus> | null = null;

/** Write a backup zip to the configured folder (or the local fallback) and prune old ones. */
export function runBackup(): Promise<BackupStatus> {
  running ??= (async () => {
    const settings = getSettings();
    const folder = settings.backupFolder ?? paths.localBackups;
    const attemptAt = new Date().toISOString();
    const previous = getBackupStatus();
    try {
      const problem = await checkWritableFolder(folder);
      if (problem) throw new Error(`${problem}: ${folder}`);
      mkdirSync(folder, { recursive: true });

      const { archive, cleanup, fileName } = await createArchive();
      const target = path.join(folder, fileName);
      const partial = `${target}.part`;
      try {
        await pipeline(archive, createWriteStream(partial));
        renameSync(partial, target);
      } finally {
        cleanup();
        rmSync(partial, { force: true });
      }
      pruneOldBackups(folder, settings.backupRetention);

      const status: BackupStatus = {
        lastSuccessAt: new Date().toISOString(),
        lastAttemptAt: attemptAt,
        lastError: null,
        lastFile: target,
        lastBytes: statSync(target).size,
      };
      setState('backup', status);
      return status;
    } catch (err) {
      const status: BackupStatus = { ...previous, lastAttemptAt: attemptAt, lastError: (err as Error).message };
      setState('backup', status);
      return status;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Backup is due if enabled and the last success is older than the interval. Robust to the Mac sleeping. */
export function isBackupDue(now = Date.now()): boolean {
  const { backupIntervalHours } = getSettings();
  if (backupIntervalHours === 0) return false;
  const { lastSuccessAt, lastAttemptAt, lastError } = getBackupStatus();
  // After a failure, retry at most hourly rather than on every check.
  if (lastError && lastAttemptAt && now - Date.parse(lastAttemptAt) < 60 * 60 * 1000) return false;
  if (!lastSuccessAt) return true;
  return now - Date.parse(lastSuccessAt) >= backupIntervalHours * 60 * 60 * 1000;
}

/** Cloud-synced folders detected on this Mac, offered as backup destinations. */
export function detectCloudFolders(): { label: string; path: string }[] {
  const home = homedir();
  const found: { label: string; path: string }[] = [];
  const icloud = path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs');
  if (existsSync(icloud)) found.push({ label: 'iCloud Drive', path: icloud });
  const cloudStorage = path.join(home, 'Library/CloudStorage');
  if (existsSync(cloudStorage)) {
    for (const entry of readdirSync(cloudStorage)) {
      if (!entry.startsWith('GoogleDrive-')) continue;
      const myDrive = path.join(cloudStorage, entry, 'My Drive');
      if (existsSync(myDrive)) found.push({ label: `Google Drive (${entry.slice('GoogleDrive-'.length)})`, path: myDrive });
    }
  }
  return found;
}
