import { Cron } from 'croner';
import { isBackupDue, runBackup } from './backup';

/** Background jobs. Each one checks "is it due?" so missed runs (e.g. Mac asleep) catch up on wake. */
export function startJobs(): Cron[] {
  const backupCheck = new Cron('*/10 * * * *', { protect: true }, async () => {
    if (!isBackupDue()) return;
    const status = await runBackup();
    if (status.lastError) console.error(`[backup] failed: ${status.lastError}`);
    else console.log(`[backup] wrote ${status.lastFile}`);
  });
  setTimeout(() => void backupCheck.trigger(), 15_000);
  return [backupCheck];
}
