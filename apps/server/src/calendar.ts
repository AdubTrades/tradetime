import { and, asc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { schema, type Recurrence } from '@tc/db';
import { durationMinutes, expandOccurrences, localInstant, newId, tradingDay, type Occurrence } from '@tc/domain';
import { db } from './context';
import { AppError } from './errors';
import { listExpenses, renewalsBetween } from './expenses';
import { listMarketEvents } from './marketEvents';
import { listSessions } from './sessions';
import { getSettings } from './settings';
import { listDailyReviewDays, listTrades } from './trades';

const { calendarEventType, calendarEvent, calendarEventException, sessionType } = schema;
const nowIso = () => new Date().toISOString();

// ---------- Types ----------

export const listEventTypes = () =>
  db.select().from(calendarEventType).where(isNull(calendarEventType.deletedAt)).orderBy(asc(calendarEventType.sortOrder)).all();

export function createEventType(input: { name: string; color: string; sessionTypeId?: string | null; isNoTrade?: boolean }) {
  const max = db.select({ max: sql<number>`coalesce(max(${calendarEventType.sortOrder}), -1)` }).from(calendarEventType).get()?.max ?? -1;
  return db.insert(calendarEventType).values({ id: newId(), ...input, name: input.name.trim(), sortOrder: max + 1 }).returning().get();
}

export function updateEventType(id: string, patch: Partial<{ name: string; color: string; sessionTypeId: string | null; isNoTrade: boolean; archived: boolean; sortOrder: number }>) {
  const row = db.update(calendarEventType).set({ ...patch, updatedAt: nowIso() }).where(eq(calendarEventType.id, id)).returning().get();
  if (!row) throw new AppError(404, 'Event type not found');
  return row;
}

// ---------- Events ----------

export interface EventInput {
  typeId: string;
  title: string;
  notes?: string | null;
  link?: string | null;
  date: string;
  allDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  recurrence?: Recurrence | null;
  reminderMinutes?: number | null;
  isTask?: boolean;
}

function validate(input: Partial<EventInput>) {
  if (input.typeId && !db.select({ id: calendarEventType.id }).from(calendarEventType).where(eq(calendarEventType.id, input.typeId)).get()) {
    throw new AppError(422, 'Unknown event type');
  }
  if (input.link && !/^https?:\/\//i.test(input.link)) throw new AppError(422, 'Links must start with http:// or https://');
  if (input.recurrence?.until && input.date && input.recurrence.until < input.date) throw new AppError(422, 'The repeat end is before the first date');
}

const normalise = (input: Partial<EventInput>) => ({
  ...input,
  ...(input.title !== undefined ? { title: input.title.trim() } : {}),
  ...(input.allDay ? { startTime: null, endTime: null } : {}),
});

export function createEvent(input: EventInput) {
  validate(input);
  return db
    .insert(calendarEvent)
    .values({ id: newId(), ...input, title: input.title.trim(), ...(input.allDay ? { startTime: null, endTime: null } : {}) })
    .returning()
    .get();
}

export function updateEvent(id: string, patch: Partial<EventInput>) {
  validate(patch);
  const row = db.update(calendarEvent).set({ ...normalise(patch), updatedAt: nowIso() }).where(eq(calendarEvent.id, id)).returning().get();
  if (!row) throw new AppError(404, 'Event not found');
  return row;
}

export function deleteEvent(id: string) {
  db.update(calendarEvent).set({ deletedAt: nowIso() }).where(eq(calendarEvent.id, id)).run();
}

/** Change one occurrence of a recurring event: skip it, move/rename it, or mark a recurring task done. */
export function upsertException(
  eventId: string,
  occurrenceDate: string,
  change: { skipped?: boolean; override?: { title?: string; date?: string; startTime?: string | null; endTime?: string | null; notes?: string | null } | null; done?: boolean },
) {
  const e = db.select().from(calendarEvent).where(eq(calendarEvent.id, eventId)).get();
  if (!e || e.deletedAt) throw new AppError(404, 'Event not found');
  if (!e.recurrence) throw new AppError(422, 'Only repeating events have single occurrences; edit the event instead');
  const existing = db
    .select()
    .from(calendarEventException)
    .where(and(eq(calendarEventException.eventId, eventId), eq(calendarEventException.occurrenceDate, occurrenceDate)))
    .get();
  const next = {
    eventId,
    occurrenceDate,
    skipped: change.skipped ?? existing?.skipped ?? false,
    override: change.override !== undefined ? change.override : (existing?.override ?? null),
    doneAt: change.done === undefined ? (existing?.doneAt ?? null) : change.done ? nowIso() : null,
  };
  db.insert(calendarEventException)
    .values(next)
    .onConflictDoUpdate({ target: [calendarEventException.eventId, calendarEventException.occurrenceDate], set: next })
    .run();
}

export function setTaskDone(id: string, done: boolean) {
  const e = db.select().from(calendarEvent).where(eq(calendarEvent.id, id)).get();
  if (!e || e.deletedAt) throw new AppError(404, 'Event not found');
  if (e.recurrence) throw new AppError(422, 'Mark a single occurrence of a repeating task as done');
  db.update(calendarEvent).set({ doneAt: done ? nowIso() : null, updatedAt: nowIso() }).where(eq(calendarEvent.id, id)).run();
}

type EventRow = typeof calendarEvent.$inferSelect;

/** Occurrences in [from, to], plus any unfinished one-off tasks dated before `from` (tasks stay visible until done). */
export function listOccurrences(from: string, to: string, includeOverdueTasks = false) {
  const events = db
    .select()
    .from(calendarEvent)
    .where(
      and(
        isNull(calendarEvent.deletedAt),
        or(sql`${calendarEvent.recurrence} IS NOT NULL`, and(gte(calendarEvent.date, DateTime.fromISO(from).minus({ days: 31 }).toISODate()!), lte(calendarEvent.date, to)), includeOverdueTasks ? and(eq(calendarEvent.isTask, true), isNull(calendarEvent.doneAt)) : sql`0`),
      ),
    )
    .all();
  const exceptions = db.select().from(calendarEventException).all();
  const occ = expandOccurrences<EventRow>(events, exceptions, from, to);
  if (includeOverdueTasks) {
    const overdue = events.filter((e) => e.isTask && !e.recurrence && !e.doneAt && e.date < from);
    for (const e of overdue) occ.unshift(toOccurrence(e));
  }
  return occ.map(serialise);
}

const toOccurrence = (e: EventRow): Occurrence<EventRow> => ({
  event: e,
  occurrenceDate: e.date,
  date: e.date,
  title: e.title,
  startTime: e.startTime,
  endTime: e.endTime,
  notes: e.notes,
  doneAt: e.doneAt,
  recurring: false,
});

function serialise(o: Occurrence<EventRow>) {
  const { event: e } = o;
  return {
    key: `${e.id}:${o.occurrenceDate}`,
    eventId: e.id,
    occurrenceDate: o.occurrenceDate,
    date: o.date,
    title: o.title,
    startTime: o.startTime,
    endTime: o.endTime,
    notes: o.notes,
    allDay: e.allDay,
    typeId: e.typeId,
    link: e.link,
    isTask: e.isTask,
    done: !!o.doneAt,
    recurring: o.recurring,
    recurrence: e.recurrence,
    reminderMinutes: e.reminderMinutes,
    /** Start/end as instants for timed events (end past midnight rolls to the next day). */
    startAt: o.startTime ? localInstant(o.date, o.startTime) : null,
  };
}

export type OccurrenceView = ReturnType<typeof serialise>;

// ---------- Calendar month data ----------

/** Per-day figures for the calendar grid plus events in range. Trades and sessions use trading days. */
export function calendarRange(from: string, to: string) {
  const trades = listTrades({ from, to });
  const sessions = listSessions({ from, to });
  const expenses = listExpenses({ from, to });
  const reviewDays = new Set(listDailyReviewDays({ from, to }));
  const tradingTypes = new Set(
    db
      .select({ id: sessionType.id })
      .from(sessionType)
      .where(eq(sessionType.isTrading, true))
      .all()
      .map((t) => t.id),
  );
  const days: Record<string, { netCents: number; trades: number; wins: number; tradingMinutes: number; otherMinutes: number; expensesCents: number; hasReview: boolean }> = {};
  const day = (d: string) => (days[d] ??= { netCents: 0, trades: 0, wins: 0, tradingMinutes: 0, otherMinutes: 0, expensesCents: 0, hasReview: false });
  for (const t of trades) {
    const d = day(t.tradingDay);
    d.netCents += t.netCents;
    d.trades++;
    if (t.netCents > 0) d.wins++;
  }
  for (const s of sessions) {
    const m = durationMinutes(s);
    if (tradingTypes.has(s.typeId)) day(s.tradingDay).tradingMinutes += m;
    else day(s.tradingDay).otherMinutes += m;
  }
  for (const e of expenses) day(e.date).expensesCents += e.incGstCents;
  for (const d of reviewDays) day(d).hasReview = true;

  // Market events are bucketed by the trading day they fall on (Perth time, after rollover).
  const { rolloverTime } = getSettings();
  const fromInstant = localInstant(from, rolloverTime);
  const toInstant = localInstant(DateTime.fromISO(to).plus({ days: 1 }).toISODate()!, rolloverTime);
  const market = listMarketEvents(fromInstant, toInstant).map((m) => ({ ...m, tradingDay: tradingDay(m.at, rolloverTime) }));

  return { days, market, occurrences: listOccurrences(from, to) };
}

/** The next `days` days of market events and your own events, plus any open overdue tasks. */
export function upcoming(days = 7) {
  const { rolloverTime } = getSettings();
  const today = tradingDay(new Date(), rolloverTime);
  const end = DateTime.fromISO(today).plus({ days: days - 1 }).toISODate()!;
  return {
    today,
    market: listMarketEvents(new Date(Date.now() - 2 * 3_600_000).toISOString(), localInstant(DateTime.fromISO(end).plus({ days: 1 }).toISODate()!, rolloverTime)).map((m) => ({
      ...m,
      tradingDay: tradingDay(m.at, rolloverTime),
    })),
    occurrences: listOccurrences(today, end, true),
    // Subscription renewals in the window, so the Next 7 days panel can flag them.
    renewals: renewalsBetween(today, today, end),
  };
}

// ---------- Reminders ----------

/** Occurrences whose reminder time fell in (since, now]. */
export function dueReminders(since: number, now = Date.now()) {
  const from = DateTime.fromMillis(since).setZone('Australia/Perth').minus({ days: 1 }).toISODate()!;
  const to = DateTime.fromMillis(now).setZone('Australia/Perth').plus({ days: 2 }).toISODate()!;
  return listOccurrences(from, to).filter((o) => {
    if (o.reminderMinutes == null || o.done) return false;
    const base = o.startAt ?? localInstant(o.date, '09:00');
    const remindAt = Date.parse(base) - o.reminderMinutes * 60_000;
    return remindAt > since && remindAt <= now;
  });
}
