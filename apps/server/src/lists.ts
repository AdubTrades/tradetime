import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@tc/db';
import { newId } from '@tc/domain';
import { db } from './context';
import { AppError, isUniqueViolation } from './errors';

const { listItem } = schema;

export const listKinds = ['expense_category', 'expense_type', 'payment_method', 'mood', 'mistake'] as const;
export type ListKind = (typeof listKinds)[number];

export async function listItems(kind: ListKind) {
  return db
    .select()
    .from(listItem)
    .where(and(eq(listItem.kind, kind), isNull(listItem.deletedAt)))
    .orderBy(asc(listItem.sortOrder), asc(listItem.name));
}

/** Find an item by name (case-insensitive) or create it. Used by forms and the CSV import. */
export async function findOrCreateListItem(kind: ListKind, name: string, tx: Db = db): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed) throw new AppError(422, 'Name is required');
  const [existing] = await tx
    .select({ id: listItem.id, archived: listItem.archived })
    .from(listItem)
    .where(and(eq(listItem.kind, kind), sql`lower(${listItem.name}) = lower(${trimmed})`));
  if (existing) {
    if (existing.archived) await tx.update(listItem).set({ archived: false }).where(eq(listItem.id, existing.id));
    return existing.id;
  }
  const [max] = await tx.select({ max: sql<number>`coalesce(max(${listItem.sortOrder}), -1)` }).from(listItem).where(eq(listItem.kind, kind));
  const [row] = await tx
    .insert(listItem)
    .values({ id: newId(), kind, name: trimmed, sortOrder: (max?.max ?? -1) + 1 })
    .returning({ id: listItem.id });
  return row!.id;
}

export async function updateListItem(id: string, patch: Partial<{ name: string; color: string | null; archived: boolean; sortOrder: number }>) {
  try {
    // Savepoint, so a duplicate name doesn't abort the whole request's transaction.
    const [row] = await db.transaction((tx) =>
      tx
        .update(listItem)
        .set({ ...patch, ...(patch.name ? { name: patch.name.trim() } : {}), updatedAt: new Date().toISOString() })
        .where(eq(listItem.id, id))
        .returning(),
    );
    if (!row) throw new AppError(404, 'Item not found');
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError(409, 'An item with that name already exists');
    throw err;
  }
}

/** Throw if an id doesn't belong to the expected list. Null/undefined is allowed (field left blank). */
export async function assertListItem(kind: ListKind, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const [row] = await db.select({ kind: listItem.kind }).from(listItem).where(eq(listItem.id, id));
  if (row?.kind !== kind) throw new AppError(422, `Unknown ${kind.replace('_', ' ')}`);
}
