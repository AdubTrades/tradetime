import { and, asc, eq, isNull } from 'drizzle-orm';
import { schema } from '@tc/db';
import { newId } from '@tc/domain';
import { db } from './context';
import { AppError } from './errors';

const { contract, accountGroup, accountGroupMember, account } = schema;
export type ContractInput = { symbol: string; name: string; tickSize: number; pointValueCents: number; feePerSideCents?: number; archived?: boolean };

export const listContracts = () => db.select().from(contract).where(isNull(contract.deletedAt)).orderBy(asc(contract.sortOrder), asc(contract.symbol)).all();

export function getContract(id: string) {
  const row = db.select().from(contract).where(eq(contract.id, id)).get();
  if (!row || row.deletedAt) throw new AppError(422, 'Unknown contract');
  return row;
}

export function createContract(input: ContractInput) {
  const sortOrder = listContracts().length;
  return db.insert(contract).values({ ...input, id: newId(), symbol: input.symbol.trim().toUpperCase(), sortOrder }).returning().get();
}

export function updateContract(id: string, patch: Partial<ContractInput>) {
  const row = db
    .update(contract)
    .set({ ...patch, ...(patch.symbol ? { symbol: patch.symbol.trim().toUpperCase() } : {}), updatedAt: new Date().toISOString() })
    .where(eq(contract.id, id))
    .returning()
    .get();
  if (!row) throw new AppError(404, 'Contract not found');
  return row;
}

// ---------- Account groups (copy trading) ----------

export interface GroupMemberInput {
  accountId: string;
  multiplier: number;
}

export function listAccountGroups() {
  const groups = db.select().from(accountGroup).where(isNull(accountGroup.deletedAt)).orderBy(asc(accountGroup.name)).all();
  const members = db.select().from(accountGroupMember).orderBy(asc(accountGroupMember.sortOrder)).all();
  return groups.map((g) => ({ ...g, members: members.filter((m) => m.groupId === g.id).map(({ accountId, multiplier }) => ({ accountId, multiplier })) }));
}

function validateMembers(members: GroupMemberInput[]) {
  if (members.length === 0) throw new AppError(422, 'A group needs at least one account');
  if (new Set(members.map((m) => m.accountId)).size !== members.length) throw new AppError(422, 'An account can only appear once in a group');
  for (const m of members) {
    if (!db.select({ id: account.id }).from(account).where(eq(account.id, m.accountId)).get()) throw new AppError(422, 'Unknown account');
  }
}

export function saveAccountGroup(id: string | null, input: { name: string; members: GroupMemberInput[] }) {
  validateMembers(input.members);
  const groupId = id ?? newId();
  db.transaction((tx) => {
    if (id) {
      const res = tx.update(accountGroup).set({ name: input.name.trim(), updatedAt: new Date().toISOString() }).where(and(eq(accountGroup.id, id), isNull(accountGroup.deletedAt))).run();
      if (res.changes === 0) throw new AppError(404, 'Group not found');
      tx.delete(accountGroupMember).where(eq(accountGroupMember.groupId, id)).run();
    } else {
      tx.insert(accountGroup).values({ id: groupId, name: input.name.trim() }).run();
    }
    input.members.forEach((m, i) => tx.insert(accountGroupMember).values({ groupId, accountId: m.accountId, multiplier: m.multiplier, sortOrder: i }).run());
  });
  return listAccountGroups().find((g) => g.id === groupId)!;
}

export function deleteAccountGroup(id: string) {
  db.update(accountGroup).set({ deletedAt: new Date().toISOString() }).where(eq(accountGroup.id, id)).run();
}
