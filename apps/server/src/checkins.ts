import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema, type ReadingAnswer } from '@tc/db';
import { dueCheckIn, durationMinutes, latestReadingBefore, newId, type CheckInState } from '@tc/domain';
import { db } from './context';
import { AppError } from './errors';
import { getRunningSession } from './sessions';
import { getSettings, getState, setState } from './settings';

const { question, stateReading, session, sessionType, trade, listItem } = schema;
const nowIso = () => new Date().toISOString();

// ---------- Questions ----------

export type QuestionKind = 'mood' | 'scale' | 'yesPartlyNo' | 'text';
export type AppliesTo = 'both' | 'start' | 'checkin';

export const listQuestions = async () => db.select().from(question).where(isNull(question.deletedAt)).orderBy(asc(question.sortOrder));

export async function createQuestion(input: { prompt: string; kind: QuestionKind; appliesTo: AppliesTo }) {
  const [max] = await db.select({ max: sql<number>`coalesce(max(${question.sortOrder}), -1)` }).from(question);
  const [row] = await db
    .insert(question)
    .values({ id: newId(), ...input, prompt: input.prompt.trim(), sortOrder: (max?.max ?? -1) + 1 })
    .returning();
  return row!;
}

export async function updateQuestion(id: string, patch: Partial<{ prompt: string; appliesTo: AppliesTo; archived: boolean; sortOrder: number }>) {
  const [row] = await db.update(question).set({ ...patch, updatedAt: nowIso() }).where(eq(question.id, id)).returning();
  if (!row) throw new AppError(404, 'Question not found');
  return row;
}

/** Validate answers against the active questions for this kind of reading and snapshot their wording. */
async function snapshotAnswers(kind: 'start' | 'checkin', input: { questionId: string; value: string | number | null }[]): Promise<ReadingAnswer[]> {
  const questions = (await listQuestions()).filter((q) => !q.archived && (q.appliesTo === 'both' || q.appliesTo === kind));
  const given = new Map(input.map((a) => [a.questionId, a.value]));
  for (const id of given.keys()) {
    if (!questions.some((q) => q.id === id)) throw new AppError(422, "An answer doesn't match a current question");
  }
  const moods = await db.select().from(listItem).where(eq(listItem.kind, 'mood'));
  return questions.map((q) => {
    let value = given.get(q.id) ?? null;
    let label: string | null = null;
    if (value !== null) {
      if (q.kind === 'scale' && !(Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5)) throw new AppError(422, `${q.prompt}: choose 1 to 5`);
      if (q.kind === 'yesPartlyNo' && !['yes', 'partly', 'no'].includes(String(value))) throw new AppError(422, `${q.prompt}: choose yes, partly or no`);
      if (q.kind === 'mood') {
        const mood = moods.find((m) => m.id === String(value));
        if (!mood) throw new AppError(422, 'Unknown mood');
        label = mood.name;
      }
      if (q.kind === 'text') value = String(value).trim() || null;
    }
    return { questionId: q.id, prompt: q.prompt, kind: q.kind, value, label };
  });
}

// ---------- Readings ----------

async function requireTradingSession(sessionId: string) {
  const [row] = await db
    .select({ id: session.id, start: session.start, isTrading: sessionType.isTrading, deletedAt: session.deletedAt })
    .from(session)
    .innerJoin(sessionType, eq(sessionType.id, session.typeId))
    .where(eq(session.id, sessionId));
  if (!row || row.deletedAt) throw new AppError(404, 'Session not found');
  if (!row.isTrading) throw new AppError(422, 'Check-ins are only for trading sessions');
  return row;
}

export interface ReadingInput {
  kind: 'start' | 'checkin';
  answers: { questionId: string; value: string | number | null }[];
  decision?: 'keep_trading' | 'take_break' | 'stop' | null;
  at?: string;
}

export async function createReading(sessionId: string, input: ReadingInput) {
  const s = await requireTradingSession(sessionId);
  if (input.kind === 'start' && (await listReadings([sessionId])).some((r) => r.kind === 'start')) throw new AppError(409, 'This session already has a start checklist');
  if (input.kind === 'checkin' && !input.decision) throw new AppError(422, 'Choose a decision: keep trading, take a break or stop');
  const at = input.kind === 'start' ? (input.at ?? s.start) : (input.at ?? nowIso());
  const [row] = await db
    .insert(stateReading)
    .values({
      id: newId(),
      sessionId,
      kind: input.kind,
      at,
      answers: await snapshotAnswers(input.kind, input.answers),
      decision: input.kind === 'checkin' ? input.decision : null,
    })
    .returning();
  if (input.kind === 'checkin') await markCheckInHandled(sessionId);
  await reattachTrades(sessionId);
  return row!;
}

export async function listReadings(sessionIds: string[]) {
  if (sessionIds.length === 0) return [];
  return db
    .select()
    .from(stateReading)
    .where(and(inArray(stateReading.sessionId, sessionIds), isNull(stateReading.deletedAt)))
    .orderBy(asc(stateReading.at));
}

/** Readings for every session on a trading day. */
export async function readingsForDay(day: string) {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .where(and(eq(session.tradingDay, day), isNull(session.deletedAt)));
  return listReadings(rows.map((r) => r.id));
}

export async function deleteReading(id: string) {
  const [row] = await db.select().from(stateReading).where(eq(stateReading.id, id));
  if (!row || row.deletedAt) throw new AppError(404, 'Reading not found');
  await db.update(stateReading).set({ deletedAt: nowIso() }).where(eq(stateReading.id, id));
  await reattachTrades(row.sessionId);
}

/** The reading a trade should carry automatically: latest before its entry, in its own session. */
export async function autoReadingFor(sessionId: string | null, openedAt: string): Promise<string | null> {
  if (!sessionId) return null;
  return latestReadingBefore(await listReadings([sessionId]), openedAt)?.id ?? null;
}

/**
 * After a trading session's times change, link trades whose entry now falls inside it (if unlinked)
 * and unlink ones that fall outside, then refresh their readings.
 */
export async function relinkSessionTrades(sessionId: string): Promise<void> {
  const [s] = await db
    .select({ start: session.start, end: session.end, deletedAt: session.deletedAt, isTrading: sessionType.isTrading })
    .from(session)
    .innerJoin(sessionType, eq(sessionType.id, session.typeId))
    .where(eq(session.id, sessionId));
  if (!s) return;
  const end = s.end ?? nowIso();
  const inside = (at: string) => !s.deletedAt && s.isTrading && at >= s.start && at <= end;
  const candidates = await db
    .select({ id: trade.id, openedAt: trade.openedAt, sessionId: trade.sessionId })
    .from(trade)
    .where(and(isNull(trade.deletedAt), sql`(${trade.sessionId} = ${sessionId} OR ${trade.sessionId} IS NULL)`));
  for (const t of candidates) {
    if (t.sessionId === sessionId && !inside(t.openedAt)) {
      await db.update(trade).set({ sessionId: null, stateReadingId: null }).where(and(eq(trade.id, t.id), eq(trade.stateOverridden, false)));
    }
    if (t.sessionId === null && inside(t.openedAt)) await db.update(trade).set({ sessionId }).where(eq(trade.id, t.id));
  }
  await reattachTrades(sessionId);
}

/** Re-point non-overridden trades in a session after its readings change. */
export async function reattachTrades(sessionId: string): Promise<void> {
  const trades = await db
    .select({ id: trade.id, openedAt: trade.openedAt, stateReadingId: trade.stateReadingId })
    .from(trade)
    .where(and(eq(trade.sessionId, sessionId), eq(trade.stateOverridden, false), isNull(trade.deletedAt)));
  const readings = await listReadings([sessionId]);
  for (const t of trades) {
    const id = latestReadingBefore(readings, t.openedAt)?.id ?? null;
    if (id !== t.stateReadingId) await db.update(trade).set({ stateReadingId: id }).where(eq(trade.id, t.id));
  }
}

// ---------- Check-in prompt state ----------

interface StoredPromptState extends CheckInState {
  sessionId: string;
  notifiedLevel: number;
}

async function promptState(sessionId: string): Promise<StoredPromptState> {
  const s = await getState<StoredPromptState>('checkin');
  return s?.sessionId === sessionId ? s : { sessionId, handled: 0, snoozedUntil: null, notifiedLevel: 0 };
}

const thresholds = () => {
  const { checkInMinutes, checkInSecondMinutes } = getSettings();
  return [checkInMinutes, ...(checkInSecondMinutes ? [checkInSecondMinutes] : [])];
};

/** The check-in that's due right now for the running trading session, if any. */
export async function getDueCheckIn(now = new Date()) {
  const settings = getSettings();
  if (!settings.checkInEnabled) return null;
  const running = await getRunningSession();
  if (!running) return null;
  const [type] = await db.select({ isTrading: sessionType.isTrading }).from(sessionType).where(eq(sessionType.id, running.typeId));
  if (!type?.isTrading) return null;
  const elapsed = durationMinutes(running, now);
  const due = dueCheckIn(elapsed, thresholds(), await promptState(running.id), now.getTime());
  return due ? { sessionId: running.id, elapsedMinutes: Math.floor(elapsed), ...due } : null;
}

async function reachedLevel(sessionId: string): Promise<number> {
  const running = await getRunningSession();
  if (!running || running.id !== sessionId) return thresholds().length;
  const elapsed = durationMinutes(running);
  return thresholds().filter((t) => elapsed >= t).length;
}

async function markCheckInHandled(sessionId: string) {
  const s = await promptState(sessionId);
  await setState('checkin', { ...s, handled: Math.max(s.handled, await reachedLevel(sessionId)), snoozedUntil: null });
}

export async function dismissCheckIn(sessionId: string) {
  await markCheckInHandled(sessionId);
}

export async function snoozeCheckIn(sessionId: string) {
  const s = await promptState(sessionId);
  await setState('checkin', { ...s, snoozedUntil: Date.now() + getSettings().checkInSnoozeMinutes * 60_000 });
}

/** For the notification job: the due check-in, once per threshold. The in-app card handles snoozes. */
export async function checkInToNotify() {
  const due = await getDueCheckIn();
  if (!due) return null;
  const s = await promptState(due.sessionId);
  if (s.notifiedLevel >= due.level) return null;
  await setState('checkin', { ...s, notifiedLevel: due.level });
  return due;
}
