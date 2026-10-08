import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { schema } from '@tc/db';
import { durationMinutes, financialYear, findOverlaps, newId, tradingDay } from '@tc/domain';
import { auditEvent, auditUpdate } from './audit';
import { db } from './context';
import { AppError } from './errors';
import { getSettings } from './settings';

const { session, sessionType, auditLog, stateReading } = schema;
type SessionRow = typeof session.$inferSelect;

const MAX_SESSION_HOURS = 24;
const nowIso = () => new Date().toISOString();
const notDeleted = isNull(session.deletedAt);

// ---------- Session types ----------

export async function listSessionTypes() {
  return db.select().from(sessionType).where(isNull(sessionType.deletedAt)).orderBy(asc(sessionType.sortOrder), asc(sessionType.name));
}

export async function createSessionType(input: { name: string; isTrading?: boolean; color?: string }) {
  const [max] = await db.select({ max: sql<number>`coalesce(max(${sessionType.sortOrder}), -1)` }).from(sessionType);
  const [row] = await db
    .insert(sessionType)
    .values({ id: newId(), name: input.name.trim(), isTrading: input.isTrading ?? false, color: input.color ?? '#9a958c', sortOrder: (max?.max ?? -1) + 1 })
    .returning();
  return row!;
}

export async function updateSessionType(id: string, patch: Partial<{ name: string; isTrading: boolean; color: string; archived: boolean; sortOrder: number }>) {
  const [row] = await db
    .update(sessionType)
    .set({ ...patch, ...(patch.name ? { name: patch.name.trim() } : {}), updatedAt: nowIso() })
    .where(eq(sessionType.id, id))
    .returning();
  if (!row) throw new AppError(404, 'Session type not found');
  return row;
}

async function requireActiveType(typeId: string) {
  const [type] = await db.select().from(sessionType).where(eq(sessionType.id, typeId));
  if (!type || type.deletedAt) throw new AppError(422, 'Unknown session type');
  if (type.archived) throw new AppError(422, `"${type.name}" is archived`);
  return type;
}

// ---------- Queries ----------

const sessionColumns = {
  id: session.id,
  typeId: session.typeId,
  start: session.start,
  end: session.end,
  tradingDay: session.tradingDay,
  source: session.source,
  notes: session.notes,
  editedAt: session.editedAt,
  createdAt: session.createdAt,
};

export type SessionView = Awaited<ReturnType<typeof listSessions>>[number];

/** Sessions whose trading day falls in [from, to], newest first. */
export async function listSessions(range: { from: string; to: string }) {
  return db
    .select(sessionColumns)
    .from(session)
    .where(and(notDeleted, gte(session.tradingDay, range.from), lte(session.tradingDay, range.to)))
    .orderBy(desc(session.start));
}

/** Financial years (start year, newest first) that have sessions, always including the current one. */
export async function sessionFinancialYears(currentStartYear: number): Promise<number[]> {
  const months = await db
    .selectDistinct({ month: sql<string>`substr(${session.tradingDay}, 1, 7)` })
    .from(session)
    .where(notDeleted);
  const years = new Set([currentStartYear]);
  for (const { month } of months) {
    const [y, m] = month.split('-').map(Number) as [number, number];
    years.add(m >= 7 ? y : y - 1);
  }
  return [...years].sort((a, b) => b - a);
}

export async function getRunningSession() {
  const [row] = await db.select(sessionColumns).from(session).where(and(notDeleted, isNull(session.end)));
  return row ?? null;
}

async function getSessionRow(id: string): Promise<SessionRow> {
  const [row] = await db.select().from(session).where(eq(session.id, id));
  if (!row || row.deletedAt) throw new AppError(404, 'Session not found');
  return row;
}

export async function sessionHistory(id: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, 'session'), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.at), asc(auditLog.id));
}

// ---------- Validation ----------

function validateTimes(start: string, end: string | null) {
  const s = Date.parse(start);
  if (Number.isNaN(s)) throw new AppError(422, 'Invalid start time');
  if (s > Date.now() + 5 * 60_000) throw new AppError(422, 'Start time is in the future');
  if (end === null) return;
  const e = Date.parse(end);
  if (Number.isNaN(e)) throw new AppError(422, 'Invalid end time');
  if (e <= s) throw new AppError(422, 'End time must be after the start time');
  if (e > Date.now() + 5 * 60_000) throw new AppError(422, 'End time is in the future');
  if (e - s > MAX_SESSION_HOURS * 3_600_000) throw new AppError(422, `A session can't be longer than ${MAX_SESSION_HOURS} hours`);
}

/** Throw 409 with the overlapping sessions unless the caller chose to save anyway. */
async function checkOverlaps(candidate: { id?: string; start: string; end: string | null }, force: boolean) {
  if (force) return;
  const windowStart = new Date(Date.parse(candidate.start) - MAX_SESSION_HOURS * 3_600_000).toISOString();
  const windowEnd = candidate.end ?? nowIso();
  const nearby = await db
    .select(sessionColumns)
    .from(session)
    .where(and(notDeleted, lte(session.start, windowEnd), gte(sql`coalesce(${session.end}, ${nowIso()})`, windowStart)));
  const overlaps = findOverlaps(candidate, nearby);
  if (overlaps.length) throw new AppError(409, 'This session overlaps an existing session', { overlaps });
}

// ---------- Timer ----------

export async function startTimer(typeId: string, startedAt = nowIso()) {
  await requireActiveType(typeId);
  if (await getRunningSession()) throw new AppError(409, 'A session is already running');
  const { rolloverTime } = getSettings();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(session)
      .values({ id: newId(), typeId, start: startedAt, end: null, tradingDay: tradingDay(startedAt, rolloverTime), source: 'timer' })
      .returning();
    await auditEvent(tx, 'session', row!.id, 'create', { typeId, start: row!.start, source: 'timer' });
    return row!;
  });
}

/** Stop the running timer, optionally at an earlier time (e.g. "I actually finished at 01:30"). */
export async function stopTimer(id: string, endAt?: string) {
  const row = await getSessionRow(id);
  if (row.end) throw new AppError(409, 'Session is already stopped');
  const now = nowIso();
  const end = endAt ?? now;
  validateTimes(row.start, end);
  const adjusted = endAt !== undefined && Math.abs(Date.parse(endAt) - Date.parse(now)) > 60_000;
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(session)
      .set({ end, updatedAt: now, ...(adjusted ? { editedAt: now } : {}) })
      .where(eq(session.id, id))
      .returning();
    if (adjusted) await auditUpdate(tx, 'session', id, { end: now }, { end }, 'Stopped with an adjusted end time');
    return updated!;
  });
}

// ---------- Manual entry and edits ----------

export interface ManualSessionInput {
  typeId: string;
  start: string;
  end: string;
  notes?: string | null;
}

export async function createManualSession(input: ManualSessionInput, force = false) {
  await requireActiveType(input.typeId);
  validateTimes(input.start, input.end);
  await checkOverlaps({ start: input.start, end: input.end }, force);
  const { rolloverTime } = getSettings();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(session)
      .values({
        id: newId(),
        typeId: input.typeId,
        start: input.start,
        end: input.end,
        tradingDay: tradingDay(input.start, rolloverTime),
        source: 'manual',
        notes: input.notes?.trim() || null,
      })
      .returning();
    await auditEvent(tx, 'session', row!.id, 'create', { typeId: row!.typeId, start: row!.start, end: row!.end, source: 'manual' });
    return row!;
  });
}

export interface SessionPatch {
  typeId?: string;
  start?: string;
  end?: string;
  notes?: string | null;
}

/** Edit a session. Every changed field is kept in the audit log with its old value. */
export async function updateSession(id: string, patch: SessionPatch, reason: string | null, force = false) {
  const before = await getSessionRow(id);
  if (patch.typeId && patch.typeId !== before.typeId) await requireActiveType(patch.typeId);
  if (before.end === null && patch.end !== undefined) throw new AppError(422, 'Stop the timer before editing its end time');

  const next = {
    typeId: patch.typeId ?? before.typeId,
    start: patch.start ?? before.start,
    end: patch.end ?? before.end,
    notes: patch.notes === undefined ? before.notes : patch.notes?.trim() || null,
  };
  validateTimes(next.start, next.end);
  if (next.start !== before.start || next.end !== before.end) await checkOverlaps({ id, start: next.start, end: next.end }, force);

  const timesOrTypeChanged = next.typeId !== before.typeId || next.start !== before.start || next.end !== before.end;
  const now = nowIso();
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(session)
      .set({
        ...next,
        tradingDay: tradingDay(next.start, getSettings().rolloverTime),
        updatedAt: now,
        ...(timesOrTypeChanged ? { editedAt: now } : {}),
      })
      .where(eq(session.id, id))
      .returning();
    await auditUpdate(tx, 'session', id, before, next, reason ?? undefined);
    // The session-start checklist is "at the start", so it moves with the start time.
    if (next.start !== before.start) {
      await tx.update(stateReading).set({ at: next.start }).where(and(eq(stateReading.sessionId, id), eq(stateReading.kind, 'start')));
    }
    return updated!;
  });
}

export async function deleteSession(id: string) {
  const row = await getSessionRow(id);
  await db.transaction(async (tx) => {
    await tx.update(session).set({ deletedAt: nowIso() }).where(eq(session.id, id));
    await auditEvent(tx, 'session', id, 'delete', row);
  });
}

export async function restoreSession(id: string) {
  const [row] = await db.select().from(session).where(eq(session.id, id));
  if (!row?.deletedAt) throw new AppError(404, 'No deleted session with that id');
  if (row.end === null && (await getRunningSession())) throw new AppError(409, 'Another session is running');
  await db.transaction(async (tx) => {
    await tx.update(session).set({ deletedAt: null, updatedAt: nowIso() }).where(eq(session.id, id));
    await auditEvent(tx, 'session', id, 'restore');
  });
}

/** Re-derive every session's trading day, e.g. after the rollover time changes. */
export async function recomputeTradingDays(rolloverTime: string): Promise<number> {
  const rows = await db.select({ id: session.id, start: session.start, tradingDay: session.tradingDay }).from(session);
  let changed = 0;
  for (const r of rows) {
    const day = tradingDay(r.start, rolloverTime);
    if (day === r.tradingDay) continue;
    await db.update(session).set({ tradingDay: day }).where(eq(session.id, r.id));
    changed++;
  }
  return changed;
}

// ---------- Reports ----------

export async function sessionsForFinancialYear(startYear: number) {
  const fy = financialYear(startYear);
  return { fy, sessions: (await listSessions({ from: fy.start, to: fy.end })).filter((s) => s.end !== null).reverse() };
}

export async function runningMinutes(now = new Date()): Promise<number | null> {
  const running = await getRunningSession();
  return running ? durationMinutes(running, now) : null;
}
