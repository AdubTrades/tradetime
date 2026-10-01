import { DateTime } from 'luxon';
import { LOCAL_ZONE } from '@tc/domain';

/** Perth date + time inputs → UTC instant. */
export function localToInstant(date: string, time: string): string {
  return DateTime.fromISO(`${date}T${time}`, { zone: LOCAL_ZONE }).toUTC().toISO({ suppressMilliseconds: true })!;
}

export function instantToLocalParts(instant: string): { date: string; time: string } {
  const dt = DateTime.fromISO(instant, { zone: 'utc' }).setZone(LOCAL_ZONE);
  return { date: dt.toISODate()!, time: dt.toFormat('HH:mm') };
}

/** End time on the start date, or the next day if it's not after the start (sessions crossing midnight). */
export function endInstant(startDate: string, startTime: string, endTime: string): { instant: string; nextDay: boolean } {
  const nextDay = endTime <= startTime;
  const date = nextDay ? DateTime.fromISO(startDate).plus({ days: 1 }).toISODate()! : startDate;
  return { instant: localToInstant(date, endTime), nextDay };
}

/** Most recent instant at the given Perth wall time that is after `after` and not after now. */
export function latestInstantAt(time: string, after: string, now = new Date()): string | null {
  let dt = DateTime.fromJSDate(now).setZone(LOCAL_ZONE);
  const [h, m] = time.split(':').map(Number);
  dt = dt.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  if (dt.toMillis() > now.getTime()) dt = dt.minus({ days: 1 });
  return dt.toMillis() > Date.parse(after) ? dt.toUTC().toISO({ suppressMilliseconds: true }) : null;
}

export const todayLocal = (): string => DateTime.now().setZone(LOCAL_ZONE).toISODate()!;

/**
 * A Perth wall time on a trading day → UTC instant. Times before the rollover belong to the
 * next calendar day (e.g. 01:30 on trading day 6 Oct is 7 Oct 01:30).
 */
export function tradingDayTimeToInstant(tradingDay: string, time: string, rollover: string): string {
  const t = time.length === 5 ? `${time}:00` : time;
  const date = t < `${rollover}:00` ? DateTime.fromISO(tradingDay).plus({ days: 1 }).toISODate()! : tradingDay;
  return DateTime.fromISO(`${date}T${t}`, { zone: LOCAL_ZONE }).toUTC().toISO({ suppressMilliseconds: true })!;
}

/** UTC instant → Perth "HH:mm:ss". */
export const instantToLocalTime = (instant: string): string => DateTime.fromISO(instant, { zone: 'utc' }).setZone(LOCAL_ZONE).toFormat('HH:mm:ss');
