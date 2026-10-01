import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DateTime } from 'luxon';
import { paths } from './config';

/**
 * Swap in a staged restore before the database is opened. The current database is kept beside the
 * local backups (the zipped safety backup was already written when the restore was staged).
 * Attachments are merged: files are named by their content hash, so copying never overwrites anything different.
 */
export function applyPendingRestore(): void {
  const staged = path.join(paths.restorePending, 'app.db');
  if (!existsSync(staged)) return;
  const stamp = DateTime.now().toFormat('yyyyLLdd-HHmmss');
  mkdirSync(paths.localBackups, { recursive: true });
  if (existsSync(paths.db)) renameSync(paths.db, path.join(paths.localBackups, `replaced-by-restore-${stamp}.db`));
  for (const suffix of ['-wal', '-shm']) rmSync(paths.db + suffix, { force: true });
  renameSync(staged, paths.db);
  const stagedAttachments = path.join(paths.restorePending, 'attachments');
  if (existsSync(stagedAttachments)) cpSync(stagedAttachments, paths.attachments, { recursive: true, force: false, errorOnExist: false });
  writeFileSync(path.join(paths.logs, 'last-restore.json'), JSON.stringify({ restoredAt: new Date().toISOString() }, null, 2));
  rmSync(paths.restorePending, { recursive: true, force: true });
  console.log(`[restore] restored backup; previous database kept as replaced-by-restore-${stamp}.db`);
}
