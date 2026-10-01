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
