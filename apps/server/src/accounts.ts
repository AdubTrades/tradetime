import { asc, eq, isNull } from 'drizzle-orm';
import { schema } from '@tc/db';
import { newId } from '@tc/domain';
import { db } from './context';
import { AppError } from './errors';

const { firm, account } = schema;
export type AccountInput = Omit<typeof account.$inferInsert, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export const listFirms = () => db.select().from(firm).where(isNull(firm.deletedAt)).orderBy(asc(firm.name)).all();

export function createFirm(input: { name: string; website?: string | null }) {
  return db.insert(firm).values({ id: newId(), name: input.name.trim(), website: input.website ?? null }).returning().get();
}

export function updateFirm(id: string, patch: Partial<{ name: string; website: string | null; archived: boolean }>) {
  const row = db.update(firm).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(firm.id, id)).returning().get();
  if (!row) throw new AppError(404, 'Firm not found');
  return row;
}

export const listAccounts = () => db.select().from(account).where(isNull(account.deletedAt)).orderBy(asc(account.status), asc(account.name)).all();

function assertFirm(firmId: string | null | undefined) {
  if (firmId && !db.select({ id: firm.id }).from(firm).where(eq(firm.id, firmId)).get()) throw new AppError(422, 'Unknown firm');
}

export function createAccount(input: AccountInput) {
  assertFirm(input.firmId);
  return db.insert(account).values({ ...input, id: newId(), name: input.name.trim() }).returning().get();
}

export function updateAccount(id: string, patch: Partial<AccountInput>) {
  assertFirm(patch.firmId);
  const row = db.update(account).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(account.id, id)).returning().get();
  if (!row) throw new AppError(404, 'Account not found');
  return row;
}

export function assertAccount(id: string | null | undefined): void {
  if (id && !db.select({ id: account.id }).from(account).where(eq(account.id, id)).get()) throw new AppError(422, 'Unknown account');
}
