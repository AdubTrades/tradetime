import { and, asc, eq, isNull } from 'drizzle-orm';
import { schema } from '@tc/db';
import { findFutures, forexPair, newId, normaliseSymbol } from '@tc/domain';
import { db } from './context';
import { AppError } from './errors';

const { contract, accountGroup, accountGroupMember, account } = schema;
export type ContractInput = { symbol: string; name: string; tickSize: number; pointValueCents: number; feePerSideCents?: number; archived?: boolean };

export const listContracts = async () => db.select().from(contract).where(isNull(contract.deletedAt)).orderBy(asc(contract.sortOrder), asc(contract.symbol));

export async function getContract(id: string) {
  const [row] = await db.select().from(contract).where(eq(contract.id, id));
  if (!row || row.deletedAt) throw new AppError(422, 'Unknown contract');
  return row;
}

/**
 * What the symbol decides about a contract. A forex pair is stored as "EURUSD", takes its P&L currency from the quote
 * side (converted to USD when a trade is saved), and has no per-contract fee because its size is in units. Anything
 * else is a USD futures contract.
 */
function instrumentFields(symbol: string) {
  const pair = forexPair(symbol);
  return pair ? { symbol: normaliseSymbol(symbol), currency: pair.quote, feePerSideCents: 0 } : { symbol: symbol.trim().toUpperCase(), currency: 'USD' };
}

export async function createContract(input: ContractInput) {
  const sortOrder = (await listContracts()).length;
  const [row] = await db.insert(contract).values({ ...input, ...instrumentFields(input.symbol), id: newId(), sortOrder }).returning();
  return row!;
}

export async function updateContract(id: string, patch: Partial<ContractInput>) {
  const [existing] = await db.select().from(contract).where(eq(contract.id, id));
  if (!existing) throw new AppError(404, 'Contract not found');
  const instrument = patch.symbol ? instrumentFields(patch.symbol) : forexPair(existing.symbol) ? { feePerSideCents: 0 } : {};
  const [row] = await db
    .update(contract)
    .set({ ...patch, ...instrument, updatedAt: new Date().toISOString() })
    .where(eq(contract.id, id))
    .returning();
  if (!row) throw new AppError(404, 'Contract not found');
  return row;
}

/** The id a catalogue contract gets in a user's list: the same scheme as the seeded defaults (ct_es, ct_mnq…). */
export const catalogueContractId = (symbol: string) => `ct_${normaliseSymbol(symbol).toLowerCase()}`;

/**
 * The user's contract for a symbol, adding it from the futures catalogue (packages/domain/src/futures.ts) if they don't
 * have it yet. A contract they'd archived or deleted comes back. Returns null for a symbol that isn't in the catalogue.
 */
export async function ensureContract(symbol: string) {
  const sym = normaliseSymbol(symbol);
  // "EUR/USD" and "EURUSD" are the same instrument.
  const mine = (await db.select().from(contract))
    .filter((c) => normaliseSymbol(c.symbol) === sym)
    .sort((a, b) => Number(!!a.deletedAt) - Number(!!b.deletedAt));
  const live = mine.find((c) => !c.deletedAt);
  if (live) return live.archived ? updateContract(live.id, { archived: false }) : live;
  const spec = findFutures(sym);
  if (!spec) return null;
  const now = new Date().toISOString();
  const values = { symbol: spec.symbol, name: spec.name, tickSize: spec.tickSize, pointValueCents: spec.pointValueCents, currency: spec.currency, archived: false };
  const [row] = await db
    .insert(contract)
    .values({ ...values, id: catalogueContractId(sym), sortOrder: (await listContracts()).length })
    .onConflictDoUpdate({ target: [contract.userId, contract.id], set: { ...values, deletedAt: null, updatedAt: now } })
    .returning();
  return row!;
}

// ---------- Account groups (copy trading) ----------

export interface GroupMemberInput {
  accountId: string;
  multiplier: number;
}

export async function listAccountGroups() {
  const groups = await db.select().from(accountGroup).where(isNull(accountGroup.deletedAt)).orderBy(asc(accountGroup.name));
  const members = await db.select().from(accountGroupMember).orderBy(asc(accountGroupMember.sortOrder));
  return groups.map((g) => ({ ...g, members: members.filter((m) => m.groupId === g.id).map(({ accountId, multiplier }) => ({ accountId, multiplier })) }));
}

async function validateMembers(members: GroupMemberInput[]) {
  if (members.length === 0) throw new AppError(422, 'A group needs at least one account');
  if (new Set(members.map((m) => m.accountId)).size !== members.length) throw new AppError(422, 'An account can only appear once in a group');
  for (const m of members) {
    if (!(await db.select({ id: account.id }).from(account).where(eq(account.id, m.accountId))).length) throw new AppError(422, 'Unknown account');
  }
}

export async function saveAccountGroup(id: string | null, input: { name: string; members: GroupMemberInput[] }) {
  await validateMembers(input.members);
  const groupId = id ?? newId();
  await db.transaction(async (tx) => {
    if (id) {
      const updated = await tx
        .update(accountGroup)
        .set({ name: input.name.trim(), updatedAt: new Date().toISOString() })
        .where(and(eq(accountGroup.id, id), isNull(accountGroup.deletedAt)))
        .returning({ id: accountGroup.id });
      if (updated.length === 0) throw new AppError(404, 'Group not found');
      await tx.delete(accountGroupMember).where(eq(accountGroupMember.groupId, id));
    } else {
      await tx.insert(accountGroup).values({ id: groupId, name: input.name.trim() });
    }
    for (const [i, m] of input.members.entries()) {
      await tx.insert(accountGroupMember).values({ groupId, accountId: m.accountId, multiplier: m.multiplier, sortOrder: i });
    }
  });
  return (await listAccountGroups()).find((g) => g.id === groupId)!;
}

export async function deleteAccountGroup(id: string) {
  await db.update(accountGroup).set({ deletedAt: new Date().toISOString() }).where(eq(accountGroup.id, id));
}
