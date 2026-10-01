import { DateTime } from 'luxon';

export const LOCAL_ZONE = 'Australia/Perth';
export const DEFAULT_ROLLOVER = '10:00';

/** Calendar date as YYYY-MM-DD. */
export type IsoDate = string;

function parseHhMm(hhmm: string): { hours: number; minutes: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Invalid time "${hhmm}", expected HH:MM`);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid time "${hhmm}"`);
  return { hours, minutes };
}

function toDateTime(instant: string | Date, zone: string): DateTime {
  const dt = typeof instant === 'string' ? DateTime.fromISO(instant, { zone: 'utc' }) : DateTime.fromJSDate(instant);
  if (!dt.isValid) throw new Error(`Invalid instant: ${String(instant)}`);
  return dt.setZone(zone);
}

/**
 * The trading day an instant belongs to. The day rolls over at `rollover`
 * local time, so a US session running 23:30–02:00 Perth stays on the day it started.
 */
export function tradingDay(instant: string | Date, rollover = DEFAULT_ROLLOVER, zone = LOCAL_ZONE): IsoDate {
  const { hours, minutes } = parseHhMm(rollover);
  return toDateTime(instant, zone).minus({ hours, minutes }).toISODate()!;
}

/** Plain local calendar date of an instant (used for expenses, payouts, FY). */
export function localDate(instant: string | Date, zone = LOCAL_ZONE): IsoDate {
  return toDateTime(instant, zone).toISODate()!;
}

export interface FinancialYear {
  /** Calendar year the FY starts in, e.g. 2026 for 1 Jul 2026 – 30 Jun 2027. */
  startYear: number;
  /** ATO-style label, e.g. "2026–27". */
  label: string;
  start: IsoDate;
  end: IsoDate;
}

/** Australian financial year (1 July – 30 June) starting in `startYear`. */
export function financialYear(startYear: number): FinancialYear {
  const endShort = String((startYear + 1) % 100).padStart(2, '0');
  return {
    startYear,
    label: `${startYear}–${endShort}`,
    start: `${startYear}-07-01`,
    end: `${startYear + 1}-06-30`,
  };
}

/** Financial year containing a local calendar date. */
export function financialYearOf(date: IsoDate): FinancialYear {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  return financialYear(month >= 7 ? year : year - 1);
}

/** Convert a wall-clock time in a given zone (e.g. a US release at 08:30 New York) to a UTC ISO instant. */
export function zonedToUtc(date: IsoDate, time: string, zone: string): string {
  const { hours, minutes } = parseHhMm(time);
  const dt = DateTime.fromISO(date, { zone }).set({ hour: hours, minute: minutes });
  if (!dt.isValid) throw new Error(`Invalid zoned time ${date} ${time} ${zone}`);
  return dt.toUTC().toISO({ suppressMilliseconds: true })!;
}

/** Format a UTC instant in the local zone. */
export function formatLocal(instant: string, format = 'ccc d LLL HH:mm', zone = LOCAL_ZONE): string {
  return toDateTime(instant, zone).toFormat(format);
}
