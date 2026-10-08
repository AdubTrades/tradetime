import { Cron } from 'croner';
import { DateTime } from 'luxon';
import { sql } from 'drizzle-orm';
import { listUserIds, schema } from '@tc/db';
import { currentZone, formatDuration, formatMoney, localDate } from '@tc/domain';
import { dueReminders } from './calendar';
import { checkInToNotify } from './checkins';
import { rootDb, withUser } from './context';
import { generateRecurringExpenses, markRenewalNotified, renewalsToNotify } from './expenses';
import { isMarketRefreshDue, refreshMarketEvents } from './marketEvents';
import { notify } from './notify';
import { getRunningSession, runningMinutes } from './sessions';
import { getAppState, getSettings, getState, setAppState, setState } from './settings';

/** Run `fn` for every account, each in its own user scope. One user's failure doesn't stop the others. */
async function forEachUser(label: string, fn: (userId: string) => Promise<void>): Promise<number> {
  const users = await listUserIds(rootDb());
  for (const userId of users) {
    try {
      await withUser(userId, () => fn(userId));
    } catch (err) {
      console.error(`[${label}] ${userId}: ${(err as Error).message}`);
    }
  }
  return users.length;
}

/** "Still going?": once per session when it passes the long-session cap. */
async function longSessionCheck() {
  const running = await getRunningSession();
  const minutes = await runningMinutes();
  if (!running || minutes === null) return;
  if (minutes < getSettings().longSessionHours * 60) return;
  if ((await getState<string>('longSessionNotified')) === running.id) return;
  await setState('longSessionNotified', running.id);
  await notify('Still going?', `Your session has been running for ${formatDuration(minutes)}. Stop the timer if you've finished.`, { url: '/time-log', tag: 'long-session' });
}

/** Mid-session check-in: one notification per threshold; the in-app card does the rest. */
async function checkInCheck() {
  const due = await checkInToNotify();
  if (due) await notify('Time to check in', `${formatDuration(due.elapsedMinutes)} on screen. How are you doing — keep trading, take a break, or stop?`, { url: '/time-log', tag: 'check-in' });
}

/** Reminders for the user's own events whose reminder time passed since the last check. */
async function reminderCheck(since: number, now: number) {
  for (const o of await dueReminders(since, now)) {
    await notify(o.title, o.allDay || !o.startTime ? `Today${o.isTask ? ' (task)' : ''}` : `Starts at ${o.startTime}${o.link ? ' · link in the calendar' : ''}`, {
      url: '/calendar',
      tag: `reminder-${o.key}`,
    });
  }
}

/** Recurring expenses up to today, and renewal reminders a week ahead (not before 9am in the user's zone). */
async function recurringCheck() {
  const today = localDate(new Date());
  const created = await generateRecurringExpenses(today);
  if (created) console.log(`[recurring] created ${created} expense(s)`);
  if (DateTime.now().setZone(currentZone()).hour < 9) return;
  for (const r of await renewalsToNotify(today)) {
    const days = Math.round(DateTime.fromISO(r.nextDate).diff(DateTime.fromISO(today), 'days').days);
    await notify(
      `${r.name} renews ${days === 1 ? 'tomorrow' : `in ${days} days`}`,
      `${formatMoney(r.incGstCents)} on ${DateTime.fromISO(r.nextDate).toFormat('cccc d LLLL')}. Cancel or change it before then if you need to.`,
      { url: '/expenses', tag: `renewal-${r.id}` },
    );
    await markRenewalNotified(r);
  }
}

/**
 * Claim a job for `ttlMs`, so overlapping ticks (a slow tick and the next minute's, or the local timer plus the
 * cloud scheduler) never run it twice. Atomic: only one caller gets the row.
 */
export async function claimLease(key: string, ttlMs: number, now = Date.now()): Promise<boolean> {
  const { appState } = schema;
  const rows = await rootDb()
    .insert(appState)
    .values({ key, value: { until: now + ttlMs }, updatedAt: new Date(now).toISOString() })
    .onConflictDoUpdate({
      target: appState.key,
      set: { value: { until: now + ttlMs }, updatedAt: new Date(now).toISOString() },
      setWhere: sql`coalesce((${appState.value}->>'until')::bigint, 0) <= ${now}`,
    })
    .returning({ key: appState.key });
  return rows.length > 0;
}

/** Longest gap of missed reminders to catch up after downtime; older ones are skipped rather than sent late. */
const MAX_CATCH_UP_MS = 15 * 60_000;
const HOUR_MS = 60 * 60_000;

export interface TickReport {
  ran: boolean;
  users?: number;
  hourly?: boolean;
  market?: 'refreshed' | 'failed' | 'not due';
  ms?: number;
}

/**
 * One round of background work for everyone: long-session and check-in alerts and calendar reminders every
 * minute; recurring expenses and renewal reminders hourly; economic events every 12 hours. Safe to call as often
 * as you like: overlapping calls skip, and each alert is sent once.
 */
export async function runTick(now = Date.now()): Promise<TickReport> {
  if (!(await claimLease('jobs.tick', 55_000, now))) return { ran: false };
  const started = Date.now();
  const lastTick = (await getAppState<number>('jobs.lastTickAt')) ?? now - 60_000;
  const since = Math.max(lastTick, now - MAX_CATCH_UP_MS);
  await setAppState('jobs.lastTickAt', now);
  const lastHourly = (await getAppState<number>('jobs.lastHourlyAt')) ?? 0;
  const hourly = now - lastHourly >= HOUR_MS - 60_000;
  if (hourly) await setAppState('jobs.lastHourlyAt', now);

  const users = await forEachUser('tick', async () => {
    await longSessionCheck();
    await checkInCheck();
    await reminderCheck(since, now);
    if (hourly) await recurringCheck();
  });

  let market: TickReport['market'] = 'not due';
  if ((await isMarketRefreshDue()) && (await claimLease('jobs.market', 10 * 60_000, now))) {
    const s = await refreshMarketEvents();
    market = s.lastError ? 'failed' : 'refreshed';
    if (s.lastError) console.error(`[market] ${s.lastError}`);
  }
  return { ran: true, users, hourly, market, ms: Date.now() - started };
}

/** Local mode: run the tick every minute in this process. (In the cloud, pg_cron calls /api/jobs/tick.) */
export function startJobs(): Cron[] {
  const tick = new Cron('* * * * *', { protect: true }, async () => {
    try {
      await runTick();
    } catch (err) {
      console.error(`[jobs] ${(err as Error).message}`);
    }
  });
  setTimeout(() => void tick.trigger(), 10_000);
  return [tick];
}
