import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const nowIso = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Columns shared by every record table. Records are soft-deleted only. */
const recordColumns = {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
  deletedAt: text('deleted_at'),
};

export const setting = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

/** A stored file. Content lives at attachments/<sha256[0:2]>/<sha256>.<ext>, so duplicates are stored once. */
export const attachment = sqliteTable(
  'attachment',
  {
    ...recordColumns,
    sha256: text('sha256').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    originalName: text('original_name'),
  },
  (t) => [uniqueIndex('attachment_sha256_idx').on(t.sha256)],
);

/** Links one attachment to any owner record (trade, expense, play example...). */
export const attachmentLink = sqliteTable(
  'attachment_link',
  {
    ...recordColumns,
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachment.id),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    role: text('role'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('attachment_link_owner_idx').on(t.ownerType, t.ownerId)],
);

/** Field-level edit history for records that double as tax evidence. */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action', { enum: ['create', 'update', 'delete', 'restore'] }).notNull(),
    field: text('field'),
    oldValue: text('old_value', { mode: 'json' }),
    newValue: text('new_value', { mode: 'json' }),
    reason: text('reason'),
    at: text('at').notNull().default(nowIso),
  },
  (t) => [index('audit_log_entity_idx').on(t.entity, t.entityId)],
);
