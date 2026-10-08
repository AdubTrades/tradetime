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
  /** Fills at base size (multiplier 1). Each account gets them × its multiplier unless it has its own. */
  fills: InputFill[];
  /** `fills` on an account: its actual fills (imported copy trades can fill at slightly different prices). */
  accounts: { accountId: string; multiplier: number; feesCents?: number | null; fills?: InputFill[] }[];
  source?: 'manual' | 'import';
  needsReview?: boolean;
  /** On update: keep each account's existing fills (used when reviewing an imported trade). */
  keepFills?: boolean;
}

type InputFill = Fill & { externalId?: string | null };

/** Everything derived from the input, ready to write. Throws AppError on invalid input. */
async function build(input: TradeInput, tradeId: string) {
  const c = await getContract(input.contractId);
  if (input.accounts.length === 0) throw new AppError(422, 'Choose at least one account');
  if (new Set(input.accounts.map((a) => a.accountId)).size !== input.accounts.length) throw new AppError(422, 'An account is listed twice');
  for (const a of input.accounts) {
    if (!Number.isInteger(a.multiplier) || a.multiplier < 1) throw new AppError(422, 'Size multipliers must be whole numbers of 1 or more');
    if (!(await db.select({ id: account.id }).from(account).where(eq(account.id, a.accountId))).length) throw new AppError(422, 'Unknown account');
  }
  for (const f of [...input.fills, ...input.accounts.flatMap((a) => a.fills ?? [])]) {
    if (Date.parse(f.at) > Date.now() + 5 * 60_000) throw new AppError(422, 'A fill time is in the future');
    if (!isOnTick(f.price, c.tickSize)) throw new AppError(422, `${f.price} isn't a valid ${c.symbol} price (tick size ${c.tickSize})`);
  }
  for (const p of [input.stopPrice, input.targetPrice]) {
    if (p != null && !isOnTick(p, c.tickSize)) throw new AppError(422, `${p} isn't a valid ${c.symbol} price (tick size ${c.tickSize})`);
  }
  await assertListItem('mood', input.emotionId);
  for (const id of input.mistakeIds ?? []) await assertListItem('mistake', id);
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
    const [p] = await db.select().from(play).where(eq(play.id, input.playId));
    if (!p || p.deletedAt) throw new AppError(422, 'Unknown Play');
    const criteria = await db
      .select()
      .from(playCriterion)
      .where(and(eq(playCriterion.playId, p.id), isNull(playCriterion.deletedAt), eq(playCriterion.archived, false)))
      .orderBy(asc(playCriterion.sortOrder));
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
    const fills: InputFill[] = a.fills ?? replicateFills(input.fills, a.multiplier);
    let r;
    try {
      r = pnlFromFills(fills, c.pointValueCents);
    } catch (err) {
      if (err instanceof FillError) throw new AppError(422, err.message);
      throw err;
    }
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

  const sessionId = input.sessionId === undefined ? await findSessionAt(base.openedAt) : input.sessionId;
  const overridden = input.stateReadingId !== undefined;
  if (overridden && input.stateReadingId) {
    const [r] = await db.select({ id: stateReading.id }).from(stateReading).where(and(eq(stateReading.id, input.stateReadingId), isNull(stateReading.deletedAt)));
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
    stateReadingId: overridden ? (input.stateReadingId ?? null) : await autoReadingFor(sessionId, base.openedAt),
    stateOverridden: overridden,
    source: input.source ?? 'manual',
    needsReview: input.needsReview ?? false,
    openedAt: base.openedAt,
    closedAt: base.closedAt,
  };
  return { tradeRow, checks, accounts, mistakeIds: [...new Set(input.mistakeIds ?? [])] };
}

/** The trading-type session that was running when the trade opened, if any. */
async function findSessionAt(at: string): Promise<string | null> {
  const [row] = await db
    .select({ id: session.id })
    .from(session)
    .innerJoin(sessionType, eq(sessionType.id, session.typeId))
    .where(and(isNull(session.deletedAt), eq(sessionType.isTrading, true), lte(session.start, at), gte(sql`coalesce(${session.end}, ${nowIso()})`, at)))
    .limit(1);
  return row?.id ?? null;
}

type Built = Awaited<ReturnType<typeof build>>;
type Tx = typeof db;

async function writeChildren(tx: Tx, b: Built) {
  if (b.checks.length) await tx.insert(tradeCriterionCheck).values(b.checks);
  if (b.mistakeIds.length) await tx.insert(tradeTag).values(b.mistakeIds.map((id) => ({ tradeId: b.tradeRow.id, listItemId: id })));
  if (b.accounts.length) await tx.insert(tradeAccount).values(b.accounts.map((a) => a.row));
  const fills = b.accounts.flatMap((a) => a.fills.map((f) => ({ id: newId(), tradeAccountId: a.row.id, ...f })));
  if (fills.length) await tx.insert(fill).values(fills);
}

async function deleteChildren(tx: Tx, tradeId: string) {
  const taIds = (await tx.select({ id: tradeAccount.id }).from(tradeAccount).where(eq(tradeAccount.tradeId, tradeId))).map((r) => r.id);
  if (taIds.length) await tx.delete(fill).where(inArray(fill.tradeAccountId, taIds));
  await tx.delete(tradeAccount).where(eq(tradeAccount.tradeId, tradeId));
  await tx.delete(tradeCriterionCheck).where(eq(tradeCriterionCheck.tradeId, tradeId));
  await tx.delete(tradeTag).where(eq(tradeTag.tradeId, tradeId));
}

async function accountNames(): Promise<Map<string, string>> {
  return new Map((await db.select({ id: account.id, name: account.name }).from(account)).map((a) => [a.id, a.name]));
}

/** A flat view of a trade for the audit log, so edits record what changed in plain values. */
async function auditView(id: string) {
  const d = await getTrade(id);
  const names = await accountNames();
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
    accounts: d.accounts.map((a) => `${names.get(a.accountId) ?? a.accountId} ×${a.multiplier} net $${(a.netCents / 100).toFixed(2)}`),
  };
}

export async function createTrade(input: TradeInput) {
  const id = input.id ?? newId();
  const b = await build(input, id);
  await db.transaction(async (tx) => {
    await tx.insert(trade).values(b.tradeRow);
    await writeChildren(tx, b);
    await auditEvent(tx, 'trade', id, 'create', { netCents: b.accounts.reduce((s, a) => s + a.row.netCents, 0) });
  });
  return getTrade(id);
}

export async function updateTrade(id: string, input: TradeInput, reason: string | null) {
  const existing = await getTradeRow(id);
  const before = await auditView(id);
  if (input.keepFills) {
    // Reviewing an imported trade: keep its broker fills, fees and accounts exactly as imported.
    const current = await getTrade(id);
    const strip = (fs: (typeof current.accounts)[number]['fills']) => fs.map(({ at, side, qty, price, externalId }) => ({ at, side, qty, price, externalId }));
    input = {
      ...input,
      contractId: current.contractId,
      tradingDay: current.tradingDay,
      fills: strip(current.accounts[0]!.fills),
      accounts: current.accounts.map((a) => ({ accountId: a.accountId, multiplier: a.multiplier, feesCents: a.feesCents, fills: strip(a.fills) })),
    };
  }
  input = { ...input, source: input.source ?? existing.source, needsReview: input.needsReview ?? false };
  const b = await build(input, id);
  await db.transaction(async (tx) => {
    await deleteChildren(tx, id);
    await tx.update(trade).set({ ...b.tradeRow, updatedAt: nowIso() }).where(eq(trade.id, id));
    await writeChildren(tx, b);
  });
  await auditUpdate(db, 'trade', id, before, await auditView(id), reason ?? undefined);
  return getTrade(id);
}

export async function deleteTrade(id: string) {
  await getTradeRow(id);
  await db.transaction(async (tx) => {
    await tx.update(trade).set({ deletedAt: nowIso() }).where(eq(trade.id, id));
    await auditEvent(tx, 'trade', id, 'delete');
  });
}

async function getTradeRow(id: string) {
  const [row] = await db.select().from(trade).where(eq(trade.id, id));
  if (!row || row.deletedAt) throw new AppError(404, 'Trade not found');
  return row;
}

function summarise(rows: (typeof tradeAccount.$inferSelect)[]) {
  const netCents = rows.reduce((s, a) => s + a.netCents, 0);
  const riskCents = rows.reduce((s, a) => s + (a.plannedRiskCents ?? 0), 0);
  return { netCents, grossCents: rows.reduce((s, a) => s + a.grossCents, 0), feesCents: rows.reduce((s, a) => s + a.feesCents, 0), r: rMultiple(netCents, riskCents || null) };
}

export async function getTrade(id: string) {
  const t = await getTradeRow(id);
  const accounts = await db.select().from(tradeAccount).where(eq(tradeAccount.tradeId, id));
  const fills = accounts.length ? await db.select().from(fill).where(inArray(fill.tradeAccountId, accounts.map((a) => a.id))).orderBy(asc(fill.at)) : [];
  const checks = await db.select().from(tradeCriterionCheck).where(eq(tradeCriterionCheck.tradeId, id)).orderBy(asc(tradeCriterionCheck.sortOrder));
  const mistakeIds = (await db.select({ id: tradeTag.listItemId }).from(tradeTag).where(eq(tradeTag.tradeId, id))).map((r) => r.id);
  const [state] = t.stateReadingId ? await db.select().from(stateReading).where(eq(stateReading.id, t.stateReadingId)) : [];
  return {
    ...t,
    ...summarise(accounts),
    state: state ?? null,
    accounts: accounts.map((a) => ({ ...a, fills: fills.filter((f) => f.tradeAccountId === a.id) })),
    checks,
    mistakeIds,
  };
}

export type TradeListRow = Awaited<ReturnType<typeof listTrades>>[number];

/** Trades in a trading-day range with per-account results, newest first. */
export async function listTrades(range: { from: string; to: string }) {
  const trades = await db
    .select()
    .from(trade)
    .where(and(isNull(trade.deletedAt), gte(trade.tradingDay, range.from), lte(trade.tradingDay, range.to)))
    .orderBy(desc(trade.openedAt));
  if (trades.length === 0) return [];
  const ids = trades.map((t) => t.id);
  const accounts = await db.select().from(tradeAccount).where(inArray(tradeAccount.tradeId, ids));
  const tags = await db.select().from(tradeTag).where(inArray(tradeTag.tradeId, ids));
  const readingIds = [...new Set(trades.map((t) => t.stateReadingId).filter((x): x is string => !!x))];
  const readings = readingIds.length ? await db.select().from(stateReading).where(inArray(stateReading.id, readingIds)) : [];
  const sessionIds = [...new Set(trades.map((t) => t.sessionId).filter((x): x is string => !!x))];
  const sessionStarts = new Map(
    sessionIds.length ? (await db.select({ id: session.id, start: session.start }).from(session).where(inArray(session.id, sessionIds))).map((x) => [x.id, x.start]) : [],
  );
  const firstEntry = new Map<string, number>();
  if (accounts.length) {
    const firstFills = await db
      .select({ tradeAccountId: fill.tradeAccountId, at: fill.at, price: fill.price })
      .from(fill)
      .where(inArray(fill.tradeAccountId, accounts.map((a) => a.id)))
      .orderBy(asc(fill.at));
    const accountTrade = new Map(accounts.map((a) => [a.id, a.tradeId]));
    for (const f of firstFills) {
      const tid = accountTrade.get(f.tradeAccountId)!;
      if (!firstEntry.has(tid)) firstEntry.set(tid, f.price);
    }
  }
  return trades.map((t) => {
    const mine = accounts.filter((a) => a.tradeId === t.id);
    const r = readings.find((x) => x.id === t.stateReadingId);
    return {
      ...t,
      ...summarise(mine),
      state: r ? { id: r.id, kind: r.kind, at: r.at, answers: r.answers, decision: r.decision } : null,
      sessionStart: t.sessionId ? (sessionStarts.get(t.sessionId) ?? null) : null,
      /** Planned reward:risk from the first entry, when both a target and a planned risk were set. */
      plannedRR:
        t.targetPrice != null && t.plannedRiskPoints && firstEntry.has(t.id)
          ? Math.round((Math.abs(t.targetPrice - firstEntry.get(t.id)!) / t.plannedRiskPoints) * 100) / 100
          : null,
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

export async function tradeHistory(id: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, 'trade'), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.at), asc(auditLog.id));
}

/** Label like "Win +1.8R" for gallery examples. */
export function resultLabel(t: { netCents: number; r: number | null }): string {
  const outcome = t.netCents > 0 ? 'Win' : t.netCents < 0 ? 'Loss' : 'Breakeven';
  return t.r === null ? outcome : `${outcome} ${t.r > 0 ? '+' : ''}${t.r}R`;
}

// ---------- Daily reviews ----------

export async function getDailyReview(day: string) {
  const [row] = await db.select().from(dailyReview).where(eq(dailyReview.tradingDay, day));
  return row ?? null;
}

export async function saveDailyReview(day: string, notes: string) {
  const now = nowIso();
  const [row] = await db
    .insert(dailyReview)
    .values({ id: newId(), tradingDay: day, notes })
    .onConflictDoUpdate({ target: [dailyReview.userId, dailyReview.tradingDay], set: { notes, updatedAt: now } })
    .returning();
  return row!;
}

export async function listDailyReviewDays(range: { from: string; to: string }) {
  const rows = await db
    .select({ tradingDay: dailyReview.tradingDay })
    .from(dailyReview)
    .where(and(gte(dailyReview.tradingDay, range.from), lte(dailyReview.tradingDay, range.to), sql`trim(${dailyReview.notes}) <> ''`));
  return rows.map((r) => r.tradingDay);
}

