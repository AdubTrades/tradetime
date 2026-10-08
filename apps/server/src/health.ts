import { existsSync } from 'node:fs';
import { isNull } from 'drizzle-orm';
import { schema } from '@tc/db';
import { durationMinutes } from '@tc/domain';
import { attachmentPath } from './attachments';
import { db } from './context';
import { getRunningSession } from './sessions';

export interface HealthCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

/** A quick look for problems: missing attachment files and forgotten timers. (Postgres enforces links between records.) */
export async function dataHealth(): Promise<{ checks: HealthCheck[] }> {
  const checks: HealthCheck[] = [];

  const atts = await db.select().from(schema.attachment).where(isNull(schema.attachment.deletedAt));
  const missing = atts.filter((a) => !existsSync(attachmentPath(a.sha256, a.mime)));
  checks.push({
    id: 'attachments',
    label: 'Screenshots and receipts',
    status: missing.length ? 'fail' : 'ok',
    detail: missing.length ? `${missing.length} of ${atts.length} files are missing from storage` : `${atts.length} files, all present`,
  });

  const running = await getRunningSession();
  const runningHours = running ? durationMinutes(running) / 60 : 0;
  checks.push({
    id: 'timer',
    label: 'Session timer',
    status: runningHours > 12 ? 'warn' : 'ok',
    detail: running ? `Running for ${runningHours.toFixed(1)} hours${runningHours > 12 ? ' — did you forget to stop it?' : ''}` : 'Not running',
  });

  return { checks };
}
