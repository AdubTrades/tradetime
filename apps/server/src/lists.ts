import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { schema, type Db } from '@tc/db';
import { newId } from '@tc/domain';
import { db } from './context';
import { AppError } from './errors';

const { listItem } = schema;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;

export const listKinds = ['expense_category', 'expense_type', 'payment_method', 'mood', 'mistake'] as const;
export type ListKind = (typeof listKinds)[number];

export function listItems(kind: ListKind) {
  return db
    .select()
    .from(listItem)
    .where(and(eq(listItem.kind, kind), isNull(listItem.deletedAt)))
    .orderBy(asc(listItem.sortOrder), asc(listItem.name))
    .all();
}

/** Find an item by name (case-insensitive) or create it. Used by forms and the CSV import. */
export function findOrCreateListItem(kind: ListKind, name: string, tx: Tx = db): string {
  const trimmed = name.trim();
  if (!trimmed) throw new AppError(422, 'Name is required');
  const existing = tx
    .select({ id: listItem.id, archived: listItem.archived })
    .from(listItem)
    .where(and(eq(listItem.kind, kind), sql`lower(${listItem.name}) = lower(${trimmed})`))
    .get();
  if (existing) {
    if (existing.archived) tx.update(listItem).set({ archived: false }).where(eq(listItem.id, existing.id)).run();
    return existing.id;
  }
  const maxOrder =
    tx.select({ max: sql<number>`coalesce(max(${listItem.sortOrder}), -1)` }).from(listItem).where(eq(listItem.kind, kind)).get()?.max ?? -1;
  return tx
    .insert(listItem)
    .values({ id: newId(), kind, name: trimmed, sortOrder: maxOrder + 1 })
    .returning({ id: listItem.id })
    .get().id;
}

export function updateListItem(id: string, patch: Partial<{ name: string; color: string | null; archived: boolean; sortOrder: number }>) {
  try {
    const row = db
      .update(listItem)
      .set({ ...patch, ...(patch.name ? { name: patch.name.trim() } : {}), updatedAt: new Date().toISOString() })
      .where(eq(listItem.id, id))
      .returning()
      .get();
    if (!row) throw new AppError(404, 'Item not found');
    return row;
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError(409, 'An item with that name already exists');
    throw err;
  }
}

/** Throw if an id doesn't belong to the expected list. Null/undefined is allowed (field left blank). */
export function assertListItem(kind: ListKind, id: string | null | undefined): void {
  if (!id) return;
  const row = db.select({ kind: listItem.kind }).from(listItem).where(eq(listItem.id, id)).get();
  if (row?.kind !== kind) throw new AppError(422, `Unknown ${kind.replace('_', ' ')}`);
}
