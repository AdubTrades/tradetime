import { schema, type Db } from '@tc/db';
import { newId } from '@tc/domain';

type AuditEntity = 'session' | 'expense' | 'payout' | 'trade' | 'settings';
type Tx = Db;

const ignoredFields = new Set(['updatedAt', 'createdAt']);

/** Write one audit row per changed field. Call inside the same transaction as the update. */
export async function auditUpdate(
  tx: Tx,
  entity: AuditEntity,
  entityId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  reason?: string,
): Promise<number> {
  let written = 0;
  for (const field of Object.keys(after)) {
    if (ignoredFields.has(field)) continue;
    const oldValue = before[field] ?? null;
    const newValue = after[field] ?? null;
    if (JSON.stringify(oldValue) === JSON.stringify(newValue)) continue;
    await tx.insert(schema.auditLog).values({ id: newId(), entity, entityId, action: 'update', field, oldValue, newValue, reason });
    written++;
  }
  return written;
}

export async function auditEvent(tx: Tx, entity: AuditEntity, entityId: string, action: 'create' | 'delete' | 'restore', snapshot?: unknown): Promise<void> {
  await tx.insert(schema.auditLog).values({ id: newId(), entity, entityId, action, newValue: snapshot ?? null });
}
