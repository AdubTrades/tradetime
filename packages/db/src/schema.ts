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

/** Editable list of session types. All count as business hours; `isTrading` ones get the check-in flow. */
export const sessionType = sqliteTable('session_type', {
  ...recordColumns,
  name: text('name').notNull(),
  isTrading: integer('is_trading', { mode: 'boolean' }).notNull().default(false),
  color: text('color').notNull().default('#64748b'),
  sortOrder: integer('sort_order').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});

/** A block of business time. A running timer is a session with `end` = null (at most one). */
export const session = sqliteTable(
  'session',
  {
    ...recordColumns,
    typeId: text('type_id')
      .notNull()
      .references(() => sessionType.id),
    start: text('start').notNull(),
    end: text('end'),
    /** Derived from `start` and the rollover setting; recomputed if the rollover changes. */
    tradingDay: text('trading_day').notNull(),
    source: text('source', { enum: ['timer', 'manual'] }).notNull(),
    notes: text('notes'),
    /** Set whenever start/end/type are changed after recording; full detail is in audit_log. */
    editedAt: text('edited_at'),
  },
  (t) => [index('session_trading_day_idx').on(t.tradingDay), index('session_start_idx').on(t.start)],
);

/** Generic editable pick-lists (expense categories, expense types, payment methods; later tags and moods). */
export const listItem = sqliteTable(
  'list_item',
  {
    ...recordColumns,
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [uniqueIndex('list_item_kind_name_idx').on(t.kind, t.name)],
);

export const firm = sqliteTable('firm', {
  ...recordColumns,
  name: text('name').notNull(),
  website: text('website'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});

/** A trading account (usually a prop firm evaluation or funded account). P&L currency is USD. */
export const account = sqliteTable('account', {
  ...recordColumns,
  firmId: text('firm_id').references(() => firm.id),
  name: text('name').notNull(),
  type: text('type', { enum: ['evaluation', 'funded', 'live', 'sim'] }).notNull(),
  status: text('status', { enum: ['active', 'passed', 'failed', 'closed'] }).notNull().default('active'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  startingBalanceCents: integer('starting_balance_cents'),
  currency: text('currency').notNull().default('USD'),
  notes: text('notes'),
});

/** Template that generates real Expense rows on a schedule (subscriptions, platform fees). */
export const recurringExpense = sqliteTable('recurring_expense', {
  ...recordColumns,
  name: text('name').notNull(),
  vendor: text('vendor'),
  description: text('description'),
  categoryId: text('category_id').references(() => listItem.id),
  typeId: text('type_id').references(() => listItem.id),
  paymentMethodId: text('payment_method_id').references(() => listItem.id),
  accountId: text('account_id').references(() => account.id),
  exGstCents: integer('ex_gst_cents').notNull(),
  gstCents: integer('gst_cents').notNull(),
  businessUsePct: integer('business_use_pct').notNull().default(100),
  frequency: text('frequency', { enum: ['weekly', 'monthly', 'quarterly', 'yearly'] }).notNull(),
  interval: integer('interval').notNull().default(1),
  /** First occurrence; later ones repeat from this anchor (month-end dates clamp). */
  startDate: text('start_date').notNull(),
  endDate: text('end_date'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
});

/** A business expense in AUD as charged by the bank. inc GST is always ex GST + entered GST. */
export const expense = sqliteTable(
  'expense',
  {
    ...recordColumns,
    name: text('name').notNull(),
    vendor: text('vendor'),
    date: text('date').notNull(),
    description: text('description'),
    categoryId: text('category_id').references(() => listItem.id),
    typeId: text('type_id').references(() => listItem.id),
    paymentMethodId: text('payment_method_id').references(() => listItem.id),
    accountId: text('account_id').references(() => account.id),
    exGstCents: integer('ex_gst_cents').notNull(),
    gstCents: integer('gst_cents').notNull(),
    incGstCents: integer('inc_gst_cents').notNull(),
    businessUsePct: integer('business_use_pct').notNull().default(100),
    recurringId: text('recurring_id').references(() => recurringExpense.id),
    importBatchId: text('import_batch_id'),
  },
  (t) => [
    index('expense_date_idx').on(t.date),
    // One generated row per template per date, including soft-deleted ones, so a deleted occurrence isn't regenerated.
    uniqueIndex('expense_recurring_date_idx').on(t.recurringId, t.date),
  ],
);

/** Money received from a prop firm. Income is recorded in AUD as it arrived in the bank. */
export const payout = sqliteTable(
  'payout',
  {
    ...recordColumns,
    accountId: text('account_id').references(() => account.id),
    requestedDate: text('requested_date'),
    receivedDate: text('received_date').notNull(),
    grossUsdCents: integer('gross_usd_cents'),
    audReceivedCents: integer('aud_received_cents').notNull(),
    notes: text('notes'),
  },
  (t) => [index('payout_received_idx').on(t.receivedDate)],
);
