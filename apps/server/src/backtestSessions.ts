import { and, eq, isNull, sql } from 'drizzle-orm';
import { schema } from '@tc/db';
import { findInstrument, newId, newSimAccount, tradingDay, type SimAccount, type SimTrade, type Timeframe } from '@tc/domain';
import { createAccount } from './accounts';
import { ensureContract } from './contracts';
import { db } from './context';
import { AppError } from './errors';
import { getSettings, getState, setState } from './settings';
import { createTrade } from './trades';

/**
 * Backtesting sessions ("FVGC Practice"): each replays one instrument with its own practice account, replay time,
 * timeframe and drawings, and saves its closed trades to a journal account (Backtesting by default). Stored as
 * settings rows: the list under `backtest.sessions`, and per session `backtest.sim.<id>`, `backtest.drawings.<id>` and
 * `backtest.journaled.<id>` (the practice trades already saved to the journal, so each is saved once even if it's
 * later deleted there).
 */
export interface BacktestSession {
  id: string;
  name: string;
  instrument: string;
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

async function assertAccount(id: string) {
  const [row] = await db
    .select({ id: schema.account.id })
    .from(schema.account)
    .where(and(eq(schema.account.id, id), isNull(schema.account.deletedAt)));
  if (!row) throw new AppError(422, 'Unknown account');
}

export async function createSession(input: { name: string; instrument: string; accountId?: string | null; startBalance: number; cursor: number | null; tf: Timeframe }): Promise<BacktestSession> {
  if (!findInstrument(input.instrument)) throw new AppError(422, 'Unknown instrument');
  const list = await listSessions();
  if (list.some((s) => s.name.toLowerCase() === input.name.trim().toLowerCase())) throw new AppError(409, 'There’s already a session with that name');
  const accountId = input.accountId ?? (await backtestingAccountId());
  await assertAccount(accountId);
  const now = new Date().toISOString();
  const s: BacktestSession = { id: newId(), name: input.name.trim(), instrument: input.instrument, accountId, tf: input.tf, cursor: input.cursor, createdAt: now, updatedAt: now, trades: 0, net: 0 };
  await setState(`backtest.sim.${s.id}`, newSimAccount(input.startBalance));
  return saveSession(s);
}

export async function updateSession(id: string, patch: Partial<Pick<BacktestSession, 'name' | 'tf' | 'cursor' | 'accountId'>>): Promise<BacktestSession> {
  const s = await getSession(id);
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if ((await listSessions()).some((x) => x.id !== id && x.name.toLowerCase() === name.toLowerCase())) throw new AppError(409, 'There’s already a session with that name');
    patch = { ...patch, name };
  }
  if (patch.accountId) await assertAccount(patch.accountId);
  return saveSession({ ...s, ...patch, updatedAt: new Date().toISOString() });
}

/** Remove a session and its practice account and drawings. Trades already in the journal stay there. */
export async function deleteSession(id: string): Promise<void> {
  await getSession(id);
  await setState(
    LIST,
    (await listSessions()).filter((s) => s.id !== id),
  );
  await db.delete(schema.setting).where(sql`${schema.setting.key} in (${`state.backtest.sim.${id}`}, ${`state.backtest.drawings.${id}`}, ${`state.backtest.journaled.${id}`})`);
}

const iso = (t: number) => new Date(t * 1000).toISOString().replace('.000Z', 'Z');

/** One practice trade as a journal trade: same fills, fees and first stop/target, marked for review. */
async function journalTrade(s: BacktestSession, t: SimTrade): Promise<void> {
  const contract = await ensureContract(t.symbol);
  if (!contract) throw new Error(`${t.symbol} isn’t a known contract`);
  await createTrade({
    tradingDay: tradingDay(iso(t.openedAt), getSettings().rolloverTime),
    contractId: contract.id,
    fills: t.fills.map((f) => ({ at: iso(f.time), side: f.side, qty: f.qty, price: f.price })),
    accounts: [{ accountId: s.accountId, multiplier: 1, feesCents: Math.round(t.fees * 100) }],
    stopPrice: t.initialStop,
    targetPrice: t.initialTarget ?? null,
    sessionId: null,
    notes: `Backtest: ${s.name}`,
    source: 'backtest',
    needsReview: true,
  });
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
  for (const t of fresh) {
    try {
      await db.transaction(() => journalTrade(s, t));
      journaled++;
    } catch (err) {
      failed.push({ id: t.id, message: (err as Error).message });
    }
    done.add(t.id);
  }
  if (fresh.length) await setState(`backtest.journaled.${id}`, [...done]);
  await saveSession({ ...s, trades: account.trades.length, net: account.trades.reduce((sum, t) => sum + t.net, 0), updatedAt: new Date().toISOString() });
  return { account, journaled, failed };
}
