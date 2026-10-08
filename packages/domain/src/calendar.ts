import { DateTime } from 'luxon';
import { currentZone, zonedToUtc, type IsoDate } from './time';

// ---------- Recurring events ----------

export interface EventRecurrence {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  /** Weekly: ISO weekdays 1 (Mon) – 7 (Sun). Defaults to the start date's weekday. */
  byWeekday?: number[];
  until?: IsoDate | null;
}

export interface EventLike {
  id: string;
  date: IsoDate;
  title: string;
  startTime: string | null;
  endTime: string | null;
  notes?: string | null;
  recurrence: EventRecurrence | null;
}

export interface ExceptionLike {
  eventId: string;
  occurrenceDate: IsoDate;
  skipped: boolean;
  override?: { title?: string; date?: string; startTime?: string | null; endTime?: string | null; notes?: string | null } | null;
  doneAt?: string | null;
}

export interface Occurrence<E extends EventLike> {
  event: E;
  /** The scheduled date in the series (identifies the occurrence even if moved). */
  occurrenceDate: IsoDate;
  date: IsoDate;
  title: string;
  startTime: string | null;
  endTime: string | null;
  notes: string | null;
  doneAt: string | null;
  recurring: boolean;
}

/** Dates a recurrence produces in [from, to]. */
export function recurrenceDatesBetween(start: IsoDate, r: EventRecurrence, from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  const s = DateTime.fromISO(start);
  const last = r.until && r.until < to ? r.until : to;
  const interval = Math.max(1, r.interval);
  if (r.freq === 'daily') {
    for (let d = s, i = 0; d.toISODate()! <= last && i < 20000; d = d.plus({ days: interval }), i++) if (d.toISODate()! >= from) out.push(d.toISODate()!);
  } else if (r.freq === 'weekly') {
    const days = r.byWeekday?.length ? [...r.byWeekday].sort() : [s.weekday];
    const weekStart = s.minus({ days: s.weekday - 1 });
    for (let w = weekStart, i = 0; w.toISODate()! <= last && i < 5000; w = w.plus({ weeks: interval }), i++) {
      for (const wd of days) {
        const d = w.plus({ days: wd - 1 }).toISODate()!;
        if (d >= start && d >= from && d <= last) out.push(d);
      }
    }
  } else {
    for (let n = 0; n < 2000; n++) {
      const d = s.plus({ months: n * interval });
      if (d.day !== s.day) continue; // skip months without that day (e.g. 31st)
      const iso = d.toISODate()!;
      if (iso > last) break;
      if (iso >= from) out.push(iso);
    }
  }
  return out;
}

/** Expand events (one-off and recurring) into occurrences in [from, to], applying skips and overrides. */
export function expandOccurrences<E extends EventLike>(events: readonly E[], exceptions: readonly ExceptionLike[], from: IsoDate, to: IsoDate): Occurrence<E>[] {
  const byEvent = new Map<string, Map<string, ExceptionLike>>();
  for (const x of exceptions) {
    if (!byEvent.has(x.eventId)) byEvent.set(x.eventId, new Map());
    byEvent.get(x.eventId)!.set(x.occurrenceDate, x);
  }
  const out: Occurrence<E>[] = [];
  // Look a little outside the window so occurrences moved into it are found.
  const pad = (d: IsoDate, days: number) => DateTime.fromISO(d).plus({ days }).toISODate()!;
  for (const e of events) {
    const dates = e.recurrence ? recurrenceDatesBetween(e.date, e.recurrence, pad(from, -31), pad(to, 31)) : [e.date];
    for (const occurrenceDate of dates) {
      const x = byEvent.get(e.id)?.get(occurrenceDate);
      if (x?.skipped) continue;
      const o = x?.override ?? {};
      const date = o.date ?? occurrenceDate;
      if (date < from || date > to) continue;
      out.push({
        event: e,
        occurrenceDate,
        date,
        title: o.title ?? e.title,
        startTime: o.startTime !== undefined ? o.startTime : e.startTime,
        endTime: o.endTime !== undefined ? o.endTime : e.endTime,
        notes: o.notes !== undefined ? o.notes : (e.notes ?? null),
        doneAt: e.recurrence ? (x?.doneAt ?? null) : ((e as unknown as { doneAt?: string | null }).doneAt ?? null),
        recurring: !!e.recurrence,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? '').localeCompare(b.startTime ?? ''));
}

/** Minutes between two HH:mm times on the same day (end before start wraps past midnight). */
export function blockMinutes(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const diff = toMin(end) - toMin(start);
  return diff > 0 ? diff : diff + 24 * 60;
}

/** Instant of a local wall time on a date (the user's time zone unless given). */
export const localInstant = (date: IsoDate, time: string, zone = currentZone()): string => zonedToUtc(date, time, zone);

// ---------- Month grid ----------

/** Weeks (Mon–Sun) covering a month, as arrays of 7 ISO dates. */
export function monthWeeks(month: string): IsoDate[][] {
  const first = DateTime.fromISO(`${month}-01`);
  const start = first.minus({ days: first.weekday - 1 });
  const end = first.endOf('month');
  const weeks: IsoDate[][] = [];
  for (let w = start; w <= end; w = w.plus({ weeks: 1 })) weeks.push(Array.from({ length: 7 }, (_, i) => w.plus({ days: i }).toISODate()!));
  return weeks;
}

// ---------- Economic releases (FRED) ----------

export interface ReleaseSpec {
  title: string;
  /** New York wall time of the release. */
  timeNY: string;
  impact: 'high' | 'medium' | 'low';
}

/**
 * FRED release ids for major US releases that move index futures, with their fixed release times.
 * Ids verified against fred.stlouisfed.org/release?rid=N.
 *
 * Not FOMC: FRED's "FOMC Press Release" (rid 101) is a data series updated every day, so its
 * dates aren't meeting dates. FOMC comes from FOMC_MEETINGS below instead.
 */
export const FRED_RELEASES: Record<number, ReleaseSpec> = {
  10: { title: 'CPI', timeNY: '08:30', impact: 'high' },
  50: { title: 'Non-Farm Payrolls (Employment Situation)', timeNY: '08:30', impact: 'high' },
  46: { title: 'PPI', timeNY: '08:30', impact: 'high' },
  53: { title: 'GDP', timeNY: '08:30', impact: 'high' },
  54: { title: 'PCE (Personal Income and Outlays)', timeNY: '08:30', impact: 'high' },
  9: { title: 'Retail Sales', timeNY: '08:30', impact: 'high' },
  180: { title: 'Unemployment Claims', timeNY: '08:30', impact: 'medium' },
  192: { title: 'JOLTS Job Openings', timeNY: '10:00', impact: 'medium' },
};

export interface MarketEventInput {
  provider: string;
  providerId: string;
  title: string;
  at: string;
  impact: 'high' | 'medium' | 'low';
  country: string;
  currency: string;
}

/** Turn FRED release dates into timed US events, ignoring releases not in the curated list. */
export function fredToEvents(releaseDates: readonly { release_id: number; date: string }[]): MarketEventInput[] {
  const out: MarketEventInput[] = [];
  for (const r of releaseDates) {
    const spec = FRED_RELEASES[r.release_id];
    if (!spec) continue;
    out.push({
      provider: 'fred',
      providerId: `${r.release_id}:${r.date}`,
      title: spec.title,
      at: zonedToUtc(r.date, spec.timeNY, 'America/New_York'),
      impact: spec.impact,
      country: 'US',
      currency: 'USD',
    });
  }
  return out;
}

// ---------- FOMC (Federal Reserve schedule) ----------

/**
 * Second (statement) day of each scheduled FOMC meeting, from federalreserve.gov/monetarypolicy/fomccalendars.htm.
 * `sep` marks meetings with a Summary of Economic Projections. Dates are tentative until confirmed at the
 * preceding meeting — update this list when the Fed publishes a new year.
 */
export const FOMC_MEETINGS: { date: IsoDate; sep: boolean }[] = [
  { date: '2026-01-28', sep: false },
  { date: '2026-03-18', sep: true },
  { date: '2026-04-29', sep: false },
  { date: '2026-06-17', sep: true },
  { date: '2026-07-29', sep: false },
  { date: '2026-09-16', sep: true },
  { date: '2026-10-28', sep: false },
  { date: '2026-12-09', sep: true },
  { date: '2027-01-27', sep: false },
  { date: '2027-03-17', sep: true },
  { date: '2027-04-28', sep: false },
  { date: '2027-06-09', sep: true },
  { date: '2027-07-28', sep: false },
  { date: '2027-09-15', sep: true },
  { date: '2027-10-27', sep: false },
  { date: '2027-12-08', sep: true },
];

/** FOMC statements (14:00 New York) between two New York dates. */
export function fomcEvents(from: IsoDate, to: IsoDate): MarketEventInput[] {
  return FOMC_MEETINGS.filter((m) => m.date >= from && m.date <= to).map((m) => ({
    provider: 'fomc',
    providerId: m.date,
    title: m.sep ? 'FOMC Statement + projections' : 'FOMC Statement',
    at: zonedToUtc(m.date, '14:00', 'America/New_York'),
    impact: 'high',
    country: 'US',
    currency: 'USD',
  }));
}

/** The last FOMC date in the built-in schedule, so the app can warn when it needs updating. */
export const FOMC_SCHEDULE_ENDS = FOMC_MEETINGS[FOMC_MEETINGS.length - 1]!.date;
