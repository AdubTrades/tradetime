import { DateTime } from 'luxon';
import { financialYearOf, type IsoDate } from './time';

export interface Interval {
  start: string;
  end: string | null;
}

/** Minutes between two instants (a running session is measured to `now`). Never negative. */
export function durationMinutes({ start, end }: Interval, now: Date = new Date()): number {
  const endMs = end ? Date.parse(end) : now.getTime();
  return Math.max(0, (endMs - Date.parse(start)) / 60_000);
}

/** Existing intervals that overlap the candidate. Touching end-to-start is not an overlap. */
export function findOverlaps<T extends Interval & { id: string }>(
  candidate: Interval & { id?: string },
  existing: readonly T[],
  now: Date = new Date(),
): T[] {
  const cStart = Date.parse(candidate.start);
  const cEnd = candidate.end ? Date.parse(candidate.end) : now.getTime();
  return existing.filter((s) => {
    if (candidate.id && s.id === candidate.id) return false;
    const sStart = Date.parse(s.start);
    const sEnd = s.end ? Date.parse(s.end) : now.getTime();
    return sStart < cEnd && cStart < sEnd;
  });
}

/** "3h 05m" style. */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Decimal hours to 2 places, as accountants usually want them. */
export const decimalHours = (minutes: number): number => Math.round((minutes / 60) * 100) / 100;

/** Monday of the week containing a date. */
export function weekStart(date: IsoDate): IsoDate {
  const dt = DateTime.fromISO(date);
  return dt.minus({ days: dt.weekday - 1 }).toISODate()!;
}

export type Period = 'day' | 'week' | 'month' | 'fy';

export function periodKey(date: IsoDate, period: Period): string {
  switch (period) {
    case 'day':
      return date;
    case 'week':
      return weekStart(date);
    case 'month':
      return date.slice(0, 7);
    case 'fy':
      return financialYearOf(date).label;
  }
}

export interface PeriodTotal {
  key: string;
  minutes: number;
  sessions: number;
  byType: Record<string, number>;
}

/** Total minutes per period (keyed by trading day), split by session type. Sorted by key. */
export function summarise(
  sessions: readonly (Interval & { tradingDay: IsoDate; typeId: string })[],
  period: Period,
  now: Date = new Date(),
): PeriodTotal[] {
  const totals = new Map<string, PeriodTotal>();
  for (const s of sessions) {
    const key = periodKey(s.tradingDay, period);
    const minutes = durationMinutes(s, now);
    const t = totals.get(key) ?? { key, minutes: 0, sessions: 0, byType: {} };
    t.minutes += minutes;
    t.sessions += 1;
    t.byType[s.typeId] = (t.byType[s.typeId] ?? 0) + minutes;
    totals.set(key, t);
  }
  return [...totals.values()].sort((a, b) => a.key.localeCompare(b.key));
}
