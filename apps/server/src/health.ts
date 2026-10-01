import { existsSync, statSync } from 'node:fs';
import { isNull } from 'drizzle-orm';
import { schema } from '@tc/db';
import { durationMinutes } from '@tc/domain';
import { attachmentPath } from './attachments';
import { getBackupStatus } from './backup';
import { paths } from './config';
import { db, sqlite } from './context';
import { getRunningSession } from './sessions';

export interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

/** A quick look for problems: database integrity, broken links, missing attachment files, stale timers, old backups. */
export function dataHealth(): { checks: HealthCheck[]; dbBytes: number } {
  const checks: HealthCheck[] = [];

  const integrity = sqlite.pragma('quick_check', { simple: true }) as string;
  checks.push({ id: 'integrity', label: 'Database integrity', status: integrity === 'ok' ? 'ok' : 'fail', detail: integrity === 'ok' ? 'No problems found' : integrity });

  const fk = sqlite.pragma('foreign_key_check') as unknown[];
  checks.push({
    id: 'links',
    label: 'Links between records',
    status: fk.length ? 'fail' : 'ok',
    detail: fk.length ? `${fk.length} record(s) point to something that doesn't exist` : 'All references are valid',
  });

  const atts = db.select().from(schema.attachment).where(isNull(schema.attachment.deletedAt)).all();
  const missing = atts.filter((a) => !existsSync(attachmentPath(a.sha256, a.mime)));
  checks.push({
    id: 'attachments',
    label: 'Screenshots and receipts',
    status: missing.length ? 'fail' : 'ok',
    detail: missing.length ? `${missing.length} of ${atts.length} files are missing from the attachments folder` : `${atts.length} files, all present`,
  });

  const running = getRunningSession();
  const runningHours = running ? durationMinutes(running) / 60 : 0;
  checks.push({
    id: 'timer',
    label: 'Session timer',
    status: runningHours > 12 ? 'warn' : 'ok',
    detail: running ? `Running for ${runningHours.toFixed(1)} hours${runningHours > 12 ? ' — did you forget to stop it?' : ''}` : 'Not running',
  });

  const backup = getBackupStatus();
  const ageHours = backup.lastSuccessAt ? (Date.now() - Date.parse(backup.lastSuccessAt)) / 3_600_000 : null;
  checks.push({
    id: 'backup',
    label: 'Backups',
    status: ageHours === null || ageHours > 72 ? 'warn' : backup.lastError ? 'warn' : 'ok',
    detail:
      ageHours === null
        ? 'No backup has been made yet'
        : `Last backup ${ageHours < 1 ? 'under an hour' : `${Math.round(ageHours)} hours`} ago${backup.lastError ? `; latest attempt failed: ${backup.lastError}` : ''}`,
  });

  return { checks, dbBytes: existsSync(paths.db) ? statSync(paths.db).size : 0 };
}
