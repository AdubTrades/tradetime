import { Cron } from 'croner';
import { DateTime } from 'luxon';
import { listUserIds } from '@tc/db';
import { formatDuration, formatMoney, localDate, LOCAL_ZONE } from '@tc/domain';
import { dueReminders } from './calendar';
import { checkInToNotify } from './checkins';
import { rootDb, withUser } from './context';
import { generateRecurringExpenses, markRenewalNotified, renewalsToNotify } from './expenses';
import { isMarketRefreshDue, refreshMarketEvents } from './marketEvents';
import { notify } from './notify';
import { getRunningSession, runningMinutes } from './sessions';
import { getSettings, getState, setState } from './settings';

/** Run `fn` for every account, each in its own user scope. One user's failure doesn't stop the others. */
async function forEachUser(label: string, fn: (userId: string) => Promise<void>): Promise<void> {
  for (const userId of await listUserIds(rootDb())) {
    try {
      await withUser(userId, () => fn(userId));
    } catch (err) {
      console.error(`[${label}] ${userId}: ${(err as Error).message}`);
    }
  }
}

/** "Still going?": once per session when it passes the long-session cap. */
async function longSessionCheck() {
  const running = await getRunningSession();
  const minutes = await runningMinutes();
  if (!running || minutes === null) return;
  if (minutes < getSettings().longSessionHours * 60) return;
  if ((await getState<string>('longSessionNotified')) === running.id) return;
  await setState('longSessionNotified', running.id);
  notify('Still going?', `Your session has been running for ${formatDuration(minutes)}. Stop the timer if you've finished.`);
}

/** Mid-session check-in: one notification per threshold; the in-app card does the rest. */
async function checkInCheck() {
  const due = await checkInToNotify();
  if (due) notify('Time to check in', `${formatDuration(due.elapsedMinutes)} on screen. How are you doing — keep trading, take a break, or stop?`);
}

/** Reminders for the user's own events whose reminder time passed since the last check. */
async function reminderCheck(since: number, now: number) {
  for (const o of await dueReminders(since, now)) {
    notify(o.title, o.allDay || !o.startTime ? `Today${o.isTask ? ' (task)' : ''}` : `Starts at ${o.startTime}${o.link ? ' · link in the calendar' : ''}`);
  }
}

/** Recurring expenses up to today, and renewal reminders a week ahead (not before 9am). */
async function recurringCheck() {
  const today = localDate(new Date());
  const created = await generateRecurringExpenses(today);
  if (created) console.log(`[recurring] created ${created} expense(s)`);
  if (DateTime.now().setZone(LOCAL_ZONE).hour < 9) return;
  for (const r of await renewalsToNotify(today)) {
    const days = Math.round(DateTime.fromISO(r.nextDate).diff(DateTime.fromISO(today), 'days').days);
    notify(`${r.name} renews ${days === 1 ? 'tomorrow' : `in ${days} days`}`, `${formatMoney(r.incGstCents)} on ${DateTime.fromISO(r.nextDate).toFormat('cccc d LLLL')}. Cancel or change it before then if you need to.`);
    await markRenewalNotified(r);
  }
}

/** Background jobs. Each one checks "is it due?" so missed runs catch up. (On Vercel these move to a scheduled tick.) */
export function startJobs(): Cron[] {
  let lastReminderCheck = Date.now();
  const everyMinute = new Cron('* * * * *', { protect: true }, async () => {
    const now = Date.now();
    const since = lastReminderCheck;
    lastReminderCheck = now;
    await forEachUser('minute', async () => {
      await longSessionCheck();
      await checkInCheck();
      await reminderCheck(since, now);
    });
  });

  // Economic events: refresh from FRED every 12 hours (shared by everyone).
  const market = new Cron('17 * * * *', { protect: true }, async () => {
    if (!(await isMarketRefreshDue())) return;
    const s = await refreshMarketEvents();
    if (s.lastError) console.error(`[market] ${s.lastError}`);
  });
  setTimeout(() => void market.trigger(), 20_000);

  const recurring = new Cron('5 * * * *', { protect: true }, () => forEachUser('recurring', recurringCheck));
  setTimeout(() => void recurring.trigger(), 10_000);

  return [everyMinute, market, recurring];
}
