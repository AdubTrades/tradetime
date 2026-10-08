import { asc, eq, isNull } from 'drizzle-orm';
import { schema } from '@tc/db';
import { newId } from '@tc/domain';
import { db } from './context';
import { AppError } from './errors';

const { firm, account } = schema;
export type AccountInput = Omit<typeof account.$inferInsert, 'userId' | 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export const listFirms = async () => db.select().from(firm).where(isNull(firm.deletedAt)).orderBy(asc(firm.name));

export async function createFirm(input: { name: string; website?: string | null }) {
  const [row] = await db.insert(firm).values({ id: newId(), name: input.name.trim(), website: input.website ?? null }).returning();
  return row!;
}

export async function updateFirm(id: string, patch: Partial<{ name: string; website: string | null; archived: boolean }>) {
  const [row] = await db.update(firm).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(firm.id, id)).returning();
  if (!row) throw new AppError(404, 'Firm not found');
  return row;
}

export const listAccounts = async () => db.select().from(account).where(isNull(account.deletedAt)).orderBy(asc(account.status), asc(account.name));

async function assertFirm(firmId: string | null | undefined) {
  if (firmId && !(await db.select({ id: firm.id }).from(firm).where(eq(firm.id, firmId))).length) throw new AppError(422, 'Unknown firm');
}

export async function createAccount(input: AccountInput) {
  await assertFirm(input.firmId);
  const [row] = await db.insert(account).values({ ...input, id: newId(), name: input.name.trim() }).returning();
  return row!;
}

export async function updateAccount(id: string, patch: Partial<AccountInput>) {
  await assertFirm(patch.firmId);
  const [row] = await db.update(account).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(account.id, id)).returning();
  if (!row) throw new AppError(404, 'Account not found');
  return row;
}

export async function assertAccount(id: string | null | undefined): Promise<void> {
  if (id && !(await db.select({ id: account.id }).from(account).where(eq(account.id, id))).length) throw new AppError(422, 'Unknown account');
}
