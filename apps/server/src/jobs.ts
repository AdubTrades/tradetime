import { Cron } from 'croner';
import { formatDuration, localDate } from '@tc/domain';
import { isBackupDue, runBackup } from './backup';
import { generateRecurringExpenses } from './expenses';
import { notify } from './notify';
import { getRunningSession, runningMinutes } from './sessions';
import { getSettings, getState, setState } from './settings';

/** Background jobs. Each one checks "is it due?" so missed runs (e.g. Mac asleep) catch up on wake. */
export function startJobs(): Cron[] {
  const backupCheck = new Cron('*/10 * * * *', { protect: true }, async () => {
    if (!isBackupDue()) return;
    const status = await runBackup();
    if (status.lastError) console.error(`[backup] failed: ${status.lastError}`);
    else console.log(`[backup] wrote ${status.lastFile}`);
  });
  setTimeout(() => void backupCheck.trigger(), 15_000);

  // "Still going?" — notify once per session when it passes the long-session cap.
  const longSessionCheck = new Cron('* * * * *', { protect: true }, () => {
    const running = getRunningSession();
    const minutes = runningMinutes();
    if (!running || minutes === null) return;
    if (minutes < getSettings().longSessionHours * 60) return;
    if (getState<string>('longSessionNotified') === running.id) return;
    setState('longSessionNotified', running.id);
    notify('Still going?', `Your session has been running for ${formatDuration(minutes)}. Stop the timer if you've finished.`);
  });

  // Recurring expenses: create any occurrences due up to today (catches up after downtime).
  const recurring = new Cron('5 * * * *', { protect: true }, () => {
    const created = generateRecurringExpenses(localDate(new Date()));
    if (created) console.log(`[recurring] created ${created} expense(s)`);
  });
  void recurring.trigger();

  return [backupCheck, longSessionCheck, recurring];
}
