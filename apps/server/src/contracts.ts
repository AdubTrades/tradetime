import { and, asc, eq, isNull } from 'drizzle-orm';
import { schema } from '@tc/db';
import { newId } from '@tc/domain';
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

export async function createContract(input: ContractInput) {
  const sortOrder = (await listContracts()).length;
  const [row] = await db.insert(contract).values({ ...input, id: newId(), symbol: input.symbol.trim().toUpperCase(), sortOrder }).returning();
  return row!;
}

export async function updateContract(id: string, patch: Partial<ContractInput>) {
  const [row] = await db
    .update(contract)
    .set({ ...patch, ...(patch.symbol ? { symbol: patch.symbol.trim().toUpperCase() } : {}), updatedAt: new Date().toISOString() })
    .where(eq(contract.id, id))
    .returning();
  if (!row) throw new AppError(404, 'Contract not found');
  return row;
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
