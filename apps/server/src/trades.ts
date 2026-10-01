import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { schema } from '@tc/db';
import {
  FillError,
  formatLocal,
  gradeTrade,
  isOnTick,
  newId,
  pnlFromFills,
  replicateFills,
  riskPlan,
  rMultiple,
  type Fill,
  type GradeRule,
} from '@tc/domain';
import { auditEvent, auditUpdate } from './audit';
import { autoReadingFor } from './checkins';
import { db } from './context';
import { getContract } from './contracts';
import { AppError } from './errors';
import { assertListItem } from './lists';

const { trade, tradeAccount, fill, tradeCriterionCheck, tradeTag, play, playCriterion, account, session, sessionType, dailyReview, auditLog, stateReading } = schema;
const nowIso = () => new Date().toISOString();

export interface TradeInput {
  id?: string;
  tradingDay: string;
  contractId: string;
  playId?: string | null;
  checks?: { criterionId: string; checked: boolean }[];
  stopPrice?: number | null;
  targetPrice?: number | null;
  riskPoints?: number | null;
  followedPlan?: 'yes' | 'partly' | 'no' | null;
  emotionId?: string | null;
  confidence?: number | null;
  notes?: string | null;
  mistakeIds?: string[];
  /** Explicit session, null for none, or omit to link automatically by time. */
  sessionId?: string | null;
  /** Override the state reading (null = none). Omit to use the latest reading before entry. */
  stateReadingId?: string | null;
  /** Fills at base size (multiplier 1). Each account gets them × its multiplier. */
  fills: Fill[];
  accounts: { accountId: string; multiplier: number; feesCents?: number | null }[];
}

/** Everything derived from the input, ready to write. Throws AppError on invalid input. */
function build(input: TradeInput, tradeId: string) {
  const c = getContract(input.contractId);
  if (input.accounts.length === 0) throw new AppError(422, 'Choose at least one account');
  if (new Set(input.accounts.map((a) => a.accountId)).size !== input.accounts.length) throw new AppError(422, 'An account is listed twice');
  for (const a of input.accounts) {
    if (!Number.isInteger(a.multiplier) || a.multiplier < 1) throw new AppError(422, 'Size multipliers must be whole numbers of 1 or more');
    if (!db.select({ id: account.id }).from(account).where(eq(account.id, a.accountId)).get()) throw new AppError(422, 'Unknown account');
  }
  for (const f of input.fills) {
    if (Date.parse(f.at) > Date.now() + 5 * 60_000) throw new AppError(422, 'A fill time is in the future');
    if (!isOnTick(f.price, c.tickSize)) throw new AppError(422, `${f.price} isn't a valid ${c.symbol} price (tick size ${c.tickSize})`);
  }
  for (const p of [input.stopPrice, input.targetPrice]) {
    if (p != null && !isOnTick(p, c.tickSize)) throw new AppError(422, `${p} isn't a valid ${c.symbol} price (tick size ${c.tickSize})`);
  }
  assertListItem('mood', input.emotionId);
  for (const id of input.mistakeIds ?? []) assertListItem('mistake', id);
  if (input.confidence != null && (input.confidence < 1 || input.confidence > 5)) throw new AppError(422, 'Confidence is 1 to 5');

  let base;
  try {
    base = pnlFromFills(input.fills, c.pointValueCents);
  } catch (err) {
    if (err instanceof FillError) throw new AppError(422, err.message);
    throw err;
  }
  const firstEntry = [...input.fills].sort((a, b) => a.at.localeCompare(b.at))[0]!.price;

  // Criteria snapshot and grade.
  let checks: (typeof tradeCriterionCheck.$inferInsert)[] = [];
  let grading = { outsidePlan: false, grade: null as string | null };
  if (input.playId) {
    const p = db.select().from(play).where(eq(play.id, input.playId)).get();
    if (!p || p.deletedAt) throw new AppError(422, 'Unknown Play');
    const criteria = db
      .select()
      .from(playCriterion)
      .where(and(eq(playCriterion.playId, p.id), isNull(playCriterion.deletedAt), eq(playCriterion.archived, false)))
      .orderBy(asc(playCriterion.sortOrder))
      .all();
    const ticked = new Map((input.checks ?? []).map((ch) => [ch.criterionId, ch.checked]));
    for (const id of ticked.keys()) {
      if (!criteria.some((cr) => cr.id === id)) throw new AppError(422, "A ticked criterion doesn't belong to this Play");
    }
    checks = criteria.map((cr, i) => ({ tradeId, criterionId: cr.id, label: cr.label, mustHave: cr.mustHave, checked: ticked.get(cr.id) ?? false, sortOrder: i }));
    const g = gradeTrade(checks, p.gradeRules as GradeRule[]);
    grading = { outsidePlan: g.outsidePlan, grade: g.grade };
  }

  const plan = riskPlan(firstEntry, 1, c.pointValueCents, { stopPrice: input.stopPrice, targetPrice: input.targetPrice, riskPoints: input.riskPoints });
  const accounts = input.accounts.map((a) => {
    const fills = replicateFills(input.fills, a.multiplier);
    const r = pnlFromFills(fills, c.pointValueCents);
    const feesCents = a.feesCents ?? r.totalQty * c.feePerSideCents;
    const risk = riskPlan(firstEntry, r.maxQty, c.pointValueCents, { stopPrice: input.stopPrice, riskPoints: input.riskPoints });
    return {
      row: {
        id: newId(),
        tradeId,
        accountId: a.accountId,
        multiplier: a.multiplier,
        feesCents,
        pointValueCents: c.pointValueCents,
        tickSize: c.tickSize,
        maxQty: r.maxQty,
        avgEntry: r.avgEntry,
        avgExit: r.avgExit,
        grossCents: r.grossCents,
        netCents: r.grossCents - feesCents,
        plannedRiskCents: risk.riskCents,
      },
      fills,
    };
  });

  const sessionId = input.sessionId === undefined ? findSessionAt(base.openedAt) : input.sessionId;
  const overridden = input.stateReadingId !== undefined;
  if (overridden && input.stateReadingId) {
    const r = db.select({ id: stateReading.id }).from(stateReading).where(and(eq(stateReading.id, input.stateReadingId), isNull(stateReading.deletedAt))).get();
    if (!r) throw new AppError(422, 'Unknown state reading');
  }
  const tradeRow = {
    id: tradeId,
    tradingDay: input.tradingDay,
    contractId: c.id,
    direction: base.direction,
    playId: input.playId ?? null,
    grade: grading.grade,
    outsidePlan: grading.outsidePlan,
    stopPrice: input.stopPrice ?? null,
    targetPrice: input.targetPrice ?? null,
    plannedRiskPoints: plan.riskPoints,
    followedPlan: input.followedPlan ?? null,
    emotionId: input.emotionId ?? null,
    confidence: input.confidence ?? null,
    notes: input.notes?.trim() || null,
    sessionId,
    stateReadingId: overridden ? (input.stateReadingId ?? null) : autoReadingFor(sessionId, base.openedAt),
    stateOverridden: overridden,
    openedAt: base.openedAt,
    closedAt: base.closedAt,
  };
  return { tradeRow, checks, accounts, mistakeIds: [...new Set(input.mistakeIds ?? [])] };
}

/** The trading-type session that was running when the trade opened, if any. */
function findSessionAt(at: string): string | null {
  return (
    db
      .select({ id: session.id })
      .from(session)
      .innerJoin(sessionType, eq(sessionType.id, session.typeId))
      .where(and(isNull(session.deletedAt), eq(sessionType.isTrading, true), lte(session.start, at), gte(sql`coalesce(${session.end}, ${nowIso()})`, at)))
      .get()?.id ?? null
  );
}

type Built = ReturnType<typeof build>;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function writeChildren(tx: Tx, b: Built) {
  for (const ch of b.checks) tx.insert(tradeCriterionCheck).values(ch).run();
  for (const id of b.mistakeIds) tx.insert(tradeTag).values({ tradeId: b.tradeRow.id, listItemId: id }).run();
  for (const a of b.accounts) {
    tx.insert(tradeAccount).values(a.row).run();
    for (const f of a.fills) tx.insert(fill).values({ id: newId(), tradeAccountId: a.row.id, ...f }).run();
  }
}

function deleteChildren(tx: Tx, tradeId: string) {
  const taIds = tx.select({ id: tradeAccount.id }).from(tradeAccount).where(eq(tradeAccount.tradeId, tradeId)).all().map((r) => r.id);
  if (taIds.length) tx.delete(fill).where(inArray(fill.tradeAccountId, taIds)).run();
  tx.delete(tradeAccount).where(eq(tradeAccount.tradeId, tradeId)).run();
  tx.delete(tradeCriterionCheck).where(eq(tradeCriterionCheck.tradeId, tradeId)).run();
  tx.delete(tradeTag).where(eq(tradeTag.tradeId, tradeId)).run();
}

const accountName = (id: string) => db.select({ name: account.name }).from(account).where(eq(account.id, id)).get()?.name ?? id;

/** A flat view of a trade for the audit log, so edits record what changed in plain values. */
function auditView(id: string) {
  const d = getTrade(id);
  return {
    tradingDay: d.tradingDay,
    contractId: d.contractId,
    direction: d.direction,
    playId: d.playId,
    grade: d.grade,
    outsidePlan: d.outsidePlan,
    stopPrice: d.stopPrice,
    targetPrice: d.targetPrice,
    plannedRiskPoints: d.plannedRiskPoints,
    followedPlan: d.followedPlan,
    notes: d.notes,
    ticked: d.checks.filter((c) => c.checked).map((c) => c.label),
    fills: d.accounts[0]?.fills.map((f) => `${f.side} ${f.qty / (d.accounts[0]?.multiplier ?? 1)} @ ${f.price} at ${formatLocal(f.at, 'HH:mm:ss')}`),
    accounts: d.accounts.map((a) => `${accountName(a.accountId)} ×${a.multiplier} net $${(a.netCents / 100).toFixed(2)}`),
  };
}

export function createTrade(input: TradeInput) {
  const id = input.id ?? newId();
  const b = build(input, id);
  db.transaction((tx) => {
    tx.insert(trade).values(b.tradeRow).run();
    writeChildren(tx, b);
    auditEvent(tx, 'trade', id, 'create', { netCents: b.accounts.reduce((s, a) => s + a.row.netCents, 0) });
  });
  return getTrade(id);
}

export function updateTrade(id: string, input: TradeInput, reason: string | null) {
  getTradeRow(id);
  const before = auditView(id);
  const b = build(input, id);
  db.transaction((tx) => {
    deleteChildren(tx, id);
    tx.update(trade).set({ ...b.tradeRow, updatedAt: nowIso() }).where(eq(trade.id, id)).run();
    writeChildren(tx, b);
  });
  db.transaction((tx) => auditUpdate(tx, 'trade', id, before, auditView(id), reason ?? undefined));
  return getTrade(id);
}

export function deleteTrade(id: string) {
  getTradeRow(id);
  db.transaction((tx) => {
    tx.update(trade).set({ deletedAt: nowIso() }).where(eq(trade.id, id)).run();
    auditEvent(tx, 'trade', id, 'delete');
  });
}

function getTradeRow(id: string) {
  const row = db.select().from(trade).where(eq(trade.id, id)).get();
  if (!row || row.deletedAt) throw new AppError(404, 'Trade not found');
  return row;
}

function summarise(rows: (typeof tradeAccount.$inferSelect)[]) {
  const netCents = rows.reduce((s, a) => s + a.netCents, 0);
  const riskCents = rows.reduce((s, a) => s + (a.plannedRiskCents ?? 0), 0);
  return { netCents, grossCents: rows.reduce((s, a) => s + a.grossCents, 0), feesCents: rows.reduce((s, a) => s + a.feesCents, 0), r: rMultiple(netCents, riskCents || null) };
}

export function getTrade(id: string) {
  const t = getTradeRow(id);
  const accounts = db.select().from(tradeAccount).where(eq(tradeAccount.tradeId, id)).all();
  const fills = accounts.length ? db.select().from(fill).where(inArray(fill.tradeAccountId, accounts.map((a) => a.id))).orderBy(asc(fill.at)).all() : [];
  const checks = db.select().from(tradeCriterionCheck).where(eq(tradeCriterionCheck.tradeId, id)).orderBy(asc(tradeCriterionCheck.sortOrder)).all();
  const mistakeIds = db.select({ id: tradeTag.listItemId }).from(tradeTag).where(eq(tradeTag.tradeId, id)).all().map((r) => r.id);
  return {
    ...t,
    ...summarise(accounts),
    state: t.stateReadingId ? (db.select().from(stateReading).where(eq(stateReading.id, t.stateReadingId)).get() ?? null) : null,
    accounts: accounts.map((a) => ({ ...a, fills: fills.filter((f) => f.tradeAccountId === a.id) })),
    checks,
    mistakeIds,
  };
}

export type TradeListRow = ReturnType<typeof listTrades>[number];

/** Trades in a trading-day range with per-account results, newest first. */
export function listTrades(range: { from: string; to: string }) {
  const trades = db
    .select()
    .from(trade)
    .where(and(isNull(trade.deletedAt), gte(trade.tradingDay, range.from), lte(trade.tradingDay, range.to)))
    .orderBy(desc(trade.openedAt))
    .all();
  if (trades.length === 0) return [];
  const ids = trades.map((t) => t.id);
  const accounts = db.select().from(tradeAccount).where(inArray(tradeAccount.tradeId, ids)).all();
  const tags = db.select().from(tradeTag).where(inArray(tradeTag.tradeId, ids)).all();
  const readingIds = [...new Set(trades.map((t) => t.stateReadingId).filter((x): x is string => !!x))];
  const readings = readingIds.length ? db.select().from(stateReading).where(inArray(stateReading.id, readingIds)).all() : [];
  return trades.map((t) => {
    const mine = accounts.filter((a) => a.tradeId === t.id);
    const r = readings.find((x) => x.id === t.stateReadingId);
    return {
      ...t,
      ...summarise(mine),
      state: r ? { id: r.id, kind: r.kind, at: r.at, answers: r.answers } : null,
      accounts: mine.map(({ id, accountId, multiplier, maxQty, avgEntry, avgExit, grossCents, feesCents, netCents, plannedRiskCents }) => ({
        id,
        accountId,
        multiplier,
        maxQty,
        avgEntry,
        avgExit,
        grossCents,
        feesCents,
        netCents,
        plannedRiskCents,
      })),
      mistakeIds: tags.filter((x) => x.tradeId === t.id).map((x) => x.listItemId),
    };
  });
}

export function tradeHistory(id: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, 'trade'), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.at), asc(auditLog.id))
    .all();
}

/** Label like "Win +1.8R" for gallery examples. */
export function resultLabel(t: { netCents: number; r: number | null }): string {
  const outcome = t.netCents > 0 ? 'Win' : t.netCents < 0 ? 'Loss' : 'Breakeven';
  return t.r === null ? outcome : `${outcome} ${t.r > 0 ? '+' : ''}${t.r}R`;
}

// ---------- Daily reviews ----------

export function getDailyReview(day: string) {
  return db.select().from(dailyReview).where(eq(dailyReview.tradingDay, day)).get() ?? null;
}

export function saveDailyReview(day: string, notes: string) {
  const now = nowIso();
  return db
    .insert(dailyReview)
    .values({ id: newId(), tradingDay: day, notes })
    .onConflictDoUpdate({ target: dailyReview.tradingDay, set: { notes, updatedAt: now } })
    .returning()
    .get();
}

export function listDailyReviewDays(range: { from: string; to: string }) {
  return db
    .select({ tradingDay: dailyReview.tradingDay })
    .from(dailyReview)
    .where(and(gte(dailyReview.tradingDay, range.from), lte(dailyReview.tradingDay, range.to), sql`trim(${dailyReview.notes}) <> ''`))
    .all()
    .map((r) => r.tradingDay);
}

