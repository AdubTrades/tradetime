import { DateTime } from 'luxon';

/** Time zone used when a user hasn't chosen one (TradeTime started in Perth). */
export const DEFAULT_ZONE = 'Australia/Perth';
/** @deprecated Use `currentZone()`: the zone now comes from the signed-in user's settings. */
export const LOCAL_ZONE = DEFAULT_ZONE;
export const DEFAULT_ROLLOVER = '10:00';

let zoneResolver: () => string = () => DEFAULT_ZONE;

/**
 * Tell the date helpers where "local" is. The server points this at the signed-in user's time zone for each
 * request; the web app at the user's setting once it loads. Everything that works in local time (trading days,
 * calendar dates, formatting) uses `currentZone()` unless given a zone explicitly.
 */
export function setZoneResolver(resolver: () => string): void {
  zoneResolver = resolver;
}

export const currentZone = (): string => zoneResolver();

/** True for an IANA time zone name Luxon understands, e.g. "Australia/Perth" or "America/New_York". */
export function isValidZone(zone: string): boolean {
  return /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(zone) && DateTime.now().setZone(zone).isValid;
}

/** Friendly name for labels like "Perth time": the city part of the zone, e.g. "New York" for America/New_York. */
export function zoneLabel(zone = currentZone()): string {
  return (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
}

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
 * local time, so a US session running 23:30–02:00 (Perth) stays on the day it started.
 */
export function tradingDay(instant: string | Date, rollover = DEFAULT_ROLLOVER, zone = currentZone()): IsoDate {
  const { hours, minutes } = parseHhMm(rollover);
  return toDateTime(instant, zone).minus({ hours, minutes }).toISODate()!;
}

/** Plain local calendar date of an instant (used for expenses, payouts, FY). */
export function localDate(instant: string | Date, zone = currentZone()): IsoDate {
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
export function formatLocal(instant: string, format = 'ccc d LLL HH:mm', zone = currentZone()): string {
  return toDateTime(instant, zone).toFormat(format);
}
