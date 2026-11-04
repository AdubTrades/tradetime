import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { schema } from '@tc/db';
import { findInstrument, newId, newSimAccount, tradingDay, type SimAccount, type SimTrade, type Timeframe } from '@tc/domain';
import { createAccount } from './accounts';
import { linkAttachment } from './attachments';
import { ensureContract } from './contracts';
import { db } from './context';
import { AppError } from './errors';
import { getSettings, getState, setState } from './settings';
import { createTrade } from './trades';

/**
 * Backtesting sessions ("FVGC Practice"): each replays one instrument with its own practice account, replay time,
 * timeframe and drawings, and saves its closed trades to the journal's Backtesting account. Stored as
 * settings rows: the list under `backtest.sessions`, and per session `backtest.sim.<id>`, `backtest.drawings.<id>` and
 * `backtest.journaled.<id>` (the practice trades already saved to the journal, so each is saved once even if it's
 * later deleted there).
 */
export interface BacktestSession {
  id: string;
  name: string;
  /** What the session is for ("London open FVGs, A+ only"). */
  description?: string | null;
  /** The Playbook Play (strategy) being practised: every journaled trade from the session gets it. */
  playId?: string | null;
  instrument: string;
  /** The Backtesting account (every session's trades go there). */
  accountId: string;
  tf: Timeframe;
  cursor: number | null;
  createdAt: string;
  updatedAt: string;
  /** Closed trades and their net P&L (USD), for the session list. */
  trades: number;
  net: number;
}

const LIST = 'backtest.sessions';

export const listSessions = async (): Promise<BacktestSession[]> => (await getState<BacktestSession[]>(LIST)) ?? [];

export async function getSession(id: string): Promise<BacktestSession> {
  const s = (await listSessions()).find((x) => x.id === id);
  if (!s) throw new AppError(404, 'Unknown backtesting session');
  return s;
}

async function saveSession(s: BacktestSession): Promise<BacktestSession> {
  const list = await listSessions();
  await setState(LIST, [...list.filter((x) => x.id !== s.id), s]);
  return s;
}

/** The account backtest trades go to unless the session says otherwise: "Backtesting", created if needed. */
export async function backtestingAccountId(): Promise<string> {
  const [row] = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(isNull(schema.account.deletedAt), sql`lower(${schema.account.name}) = 'backtesting'`))
    .limit(1);
  if (row) return row.id;
  return (await createAccount({ name: 'Backtesting', type: 'sim' })).id;
}

async function assertPlay(id: string | null | undefined) {
  if (!id) return;
  const [row] = await db
    .select({ id: schema.play.id })
    .from(schema.play)
    .where(and(eq(schema.play.id, id), isNull(schema.play.deletedAt)));
  if (!row) throw new AppError(422, 'Unknown strategy');
}

export async function createSession(input: {
  name: string;
  description?: string | null;
  playId?: string | null;
  instrument: string;
  startBalance: number;
  cursor: number | null;
  tf: Timeframe;
}): Promise<BacktestSession> {
  if (!findInstrument(input.instrument)) throw new AppError(422, 'Unknown instrument');
  const list = await listSessions();
  if (list.some((s) => s.name.toLowerCase() === input.name.trim().toLowerCase())) throw new AppError(409, 'There’s already a session with that name');
  // Backtest trades always go to the Backtesting account, kept apart from live and prop stats.
  const accountId = await backtestingAccountId();
  await assertPlay(input.playId);
  const now = new Date().toISOString();
  const s: BacktestSession = {
    id: newId(),
    name: input.name.trim(),
    description: input.description?.trim() || null,
    playId: input.playId ?? null,
    instrument: input.instrument,
    accountId,
    tf: input.tf,
    cursor: input.cursor,
    createdAt: now,
    updatedAt: now,
    trades: 0,
    net: 0,
  };
  await setState(`backtest.sim.${s.id}`, newSimAccount(input.startBalance));
  return saveSession(s);
}

export async function updateSession(id: string, patch: Partial<Pick<BacktestSession, 'name' | 'description' | 'playId' | 'tf' | 'cursor'>>): Promise<BacktestSession> {
  const s = await getSession(id);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if ((await listSessions()).some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new AppError(409, 'There’s already a session with that name');
    patch = { ...patch, name };
  }
  await assertPlay(patch.playId);
  if (patch.description !== undefined) patch = { ...patch, description: patch.description?.trim() || null };
  return saveSession({ ...s, ...patch, updatedAt: new Date().toISOString() });
}

/** Remove a session and its practice account and drawings. Trades already in the journal stay there. */
export async function deleteSession(id: string): Promise<void> {
  await getSession(id);
  await setState(
    LIST,
    (await listSessions()).filter((s) => s.id !== id),
  );
  await db
    .delete(schema.setting)
    .where(
      sql`${schema.setting.key} in (${`state.backtest.sim.${id}`}, ${`state.backtest.drawings.${id}`}, ${`state.backtest.journaled.${id}`}, ${`state.backtest.journalIds.${id}`}, ${`state.backtest.snapshotsLinked.${id}`})`,
    );
}

const iso = (t: number) => new Date(t * 1000).toISOString().replace('.000Z', 'Z');

/** One practice trade as a journal trade: same fills, fees and first stop/target, marked for review. */
async function journalTrade(s: BacktestSession, t: SimTrade): Promise<string> {
  const contract = await ensureContract(t.symbol);
  if (!contract) throw new Error(`${t.symbol} isn’t a known contract`);
  const created = await createTrade({
    tradingDay: tradingDay(iso(t.openedAt), getSettings().rolloverTime),
    contractId: contract.id,
    fills: t.fills.map((f) => ({ at: iso(f.time), side: f.side, qty: f.qty, price: f.price })),
    accounts: [{ accountId: await backtestingAccountId(), multiplier: 1, feesCents: Math.round(t.fees * 100) }],
    playId: s.playId ?? null,
    stopPrice: t.initialStop,
    targetPrice: t.initialTarget ?? null,
    sessionId: null,
    notes: `Backtest: ${s.name}`,
    source: 'backtest',
    needsReview: true,
  });
  return created.id;
}

/** Which journal trade each of a session's practice trades became (trades deleted from the journal left out). */
export async function sessionJournalIds(id: string): Promise<Record<string, string>> {
  const s = await getSession(id);
  const ids = (await getState<Record<string, string>>(`backtest.journalIds.${s.id}`)) ?? {};
  const values = Object.values(ids);
  if (!values.length) return {};
  const live = new Set(
    (await db.select({ id: schema.trade.id }).from(schema.trade).where(and(inArray(schema.trade.id, values), isNull(schema.trade.deletedAt)))).map((r) => r.id),
  );
  return Object.fromEntries(Object.entries(ids).filter(([, tradeId]) => live.has(tradeId)));
}

/**
 * Save the practice account, then put any newly closed trades in the journal. Each trade is tried once; one that the
 * journal refuses is reported and not retried.
 */
export async function saveSim(id: string, account: SimAccount): Promise<{ account: SimAccount; journaled: number; failed: { id: string; message: string }[] }> {
  const s = await getSession(id);
  await setState(`backtest.sim.${id}`, account);
  const done = new Set((await getState<string[]>(`backtest.journaled.${id}`)) ?? []);
  const fresh = account.trades.filter((t) => !done.has(t.id));
  const failed: { id: string; message: string }[] = [];
  let journaled = 0;
  // Which journal trade each practice trade became, and which snapshots are already linked to one.
  const journalIds = (await getState<Record<string, string>>(`backtest.journalIds.${id}`)) ?? {};
  const linked = new Set((await getState<string[]>(`backtest.snapshotsLinked.${id}`)) ?? []);
  for (const t of fresh) {
    try {
      journalIds[t.id] = await db.transaction(() => journalTrade(s, t));
      journaled++;
    } catch (err) {
      failed.push({ id: t.id, message: (err as Error).message });
    }
    done.add(t.id);
  }
  if (fresh.length) await setState(`backtest.journaled.${id}`, [...done]);
  // Chart snapshots go to the journal trade's Screenshots, including ones taken after it was saved.
  let newlyLinked = 0;
  for (const t of account.trades) {
    const tradeId = journalIds[t.id];
    if (!tradeId) continue;
    for (const attachmentId of t.snapshots ?? []) {
      if (linked.has(attachmentId)) continue;
      try {
        await db.transaction(() => linkAttachment(attachmentId, 'trade', tradeId, 'chart'));
      } catch {
        // An attachment that no longer exists: skip it rather than retry forever.
      }
      linked.add(attachmentId);
      newlyLinked++;
    }
  }
  if (fresh.length) await setState(`backtest.journalIds.${id}`, journalIds);
  if (newlyLinked) await setState(`backtest.snapshotsLinked.${id}`, [...linked]);
  await saveSession({ ...s, trades: account.trades.length, net: account.trades.reduce((sum, t) => sum + t.net, 0), updatedAt: new Date().toISOString() });
  return { account, journaled, failed };
}
