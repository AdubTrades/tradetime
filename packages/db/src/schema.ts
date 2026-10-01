import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

// ---------- Journal ----------

/** Futures contract spec. P&L = price points × point value; prices snap to tick size. */
export const contract = sqliteTable('contract', {
  ...recordColumns,
  symbol: text('symbol').notNull(),
  name: text('name').notNull(),
  tickSize: real('tick_size').notNull(),
  pointValueCents: integer('point_value_cents').notNull(),
  /** Default commission + exchange fees per contract per side, used to prefill trade fees. */
  feePerSideCents: integer('fee_per_side_cents').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  sortOrder: integer('sort_order').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});

/** A saved set of accounts that copy the same trades, each with a size multiplier. */
export const accountGroup = sqliteTable('account_group', {
  ...recordColumns,
  name: text('name').notNull(),
});

export const accountGroupMember = sqliteTable(
  'account_group_member',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => accountGroup.id),
    accountId: text('account_id')
      .notNull()
      .references(() => account.id),
    multiplier: integer('multiplier').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('account_group_member_idx').on(t.groupId, t.accountId)],
);

export const play = sqliteTable('play', {
  ...recordColumns,
  title: text('title').notNull(),
  description: text('description'),
  /**
   * Grade rules, best first: [{ grade: 'A+', maxMissed: 0, riskNote }, …]. A trade gets the first grade whose
   * maxMissed ≥ its missed standard criteria; anything beyond the last rule is 'C'.
   */
  gradeRules: text('grade_rules', { mode: 'json' }).$type<{ grade: string; maxMissed: number; riskNote?: string | null }[]>().notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
});

export const playCriterion = sqliteTable(
  'play_criterion',
  {
    ...recordColumns,
    playId: text('play_id')
      .notNull()
      .references(() => play.id),
    label: text('label').notNull(),
    mustHave: integer('must_have', { mode: 'boolean' }).notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('play_criterion_play_idx').on(t.playId)],
);

/** A screenshot on a Play's gallery shelf for one grade. */
export const playExample = sqliteTable(
  'play_example',
  {
    ...recordColumns,
    playId: text('play_id')
      .notNull()
      .references(() => play.id),
    grade: text('grade').notNull(),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachment.id),
    caption: text('caption'),
    date: text('date'),
    resultLabel: text('result_label'),
    sourceTradeId: text('source_trade_id'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('play_example_play_idx').on(t.playId)],
);

/** One trade idea. Copy trades share it; each account's result is a TradeAccount with its own fills. */
export const trade = sqliteTable(
  'trade',
  {
    ...recordColumns,
    tradingDay: text('trading_day').notNull(),
    contractId: text('contract_id')
      .notNull()
      .references(() => contract.id),
    direction: text('direction', { enum: ['long', 'short'] }).notNull(),
    playId: text('play_id').references(() => play.id),
    /** Null when there's no Play or the trade is outside the plan. */
    grade: text('grade'),
    outsidePlan: integer('outside_plan', { mode: 'boolean' }).notNull().default(false),
    stopPrice: real('stop_price'),
    targetPrice: real('target_price'),
    /** Planned risk in points (entry to stop). Derived from the stop when given. */
    plannedRiskPoints: real('planned_risk_points'),
    followedPlan: text('followed_plan', { enum: ['yes', 'partly', 'no'] }),
    emotionId: text('emotion_id').references(() => listItem.id),
    confidence: integer('confidence'),
    notes: text('notes'),
    sessionId: text('session_id').references(() => session.id),
    /** Cached from fills across accounts. */
    openedAt: text('opened_at').notNull(),
    closedAt: text('closed_at').notNull(),
  },
  (t) => [index('trade_day_idx').on(t.tradingDay), index('trade_opened_idx').on(t.openedAt)],
);

export const tradeCriterionCheck = sqliteTable(
  'trade_criterion_check',
  {
    tradeId: text('trade_id')
      .notNull()
      .references(() => trade.id),
    criterionId: text('criterion_id').notNull(),
    /** Snapshots, so later edits to the Play don't rewrite history. */
    label: text('label').notNull(),
    mustHave: integer('must_have', { mode: 'boolean' }).notNull(),
    checked: integer('checked', { mode: 'boolean' }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [uniqueIndex('trade_criterion_check_idx').on(t.tradeId, t.criterionId)],
);

export const tradeTag = sqliteTable(
  'trade_tag',
  {
    tradeId: text('trade_id')
      .notNull()
      .references(() => trade.id),
    listItemId: text('list_item_id')
      .notNull()
      .references(() => listItem.id),
  },
  (t) => [uniqueIndex('trade_tag_idx').on(t.tradeId, t.listItemId)],
);

export const tradeAccount = sqliteTable(
  'trade_account',
  {
    id: text('id').primaryKey(),
    tradeId: text('trade_id')
      .notNull()
      .references(() => trade.id),
    accountId: text('account_id')
      .notNull()
      .references(() => account.id),
    multiplier: integer('multiplier').notNull().default(1),
    feesCents: integer('fees_cents').notNull().default(0),
    /** Contract spec at the time of the trade. */
    pointValueCents: integer('point_value_cents').notNull(),
    tickSize: real('tick_size').notNull(),
    // Cached results, recalculated from fills on every save.
    maxQty: integer('max_qty').notNull(),
    avgEntry: real('avg_entry').notNull(),
    avgExit: real('avg_exit').notNull(),
    grossCents: integer('gross_cents').notNull(),
    netCents: integer('net_cents').notNull(),
    plannedRiskCents: integer('planned_risk_cents'),
  },
  (t) => [index('trade_account_trade_idx').on(t.tradeId), index('trade_account_account_idx').on(t.accountId)],
);

export const fill = sqliteTable(
  'fill',
  {
    id: text('id').primaryKey(),
    tradeAccountId: text('trade_account_id')
      .notNull()
      .references(() => tradeAccount.id),
    at: text('at').notNull(),
    side: text('side', { enum: ['buy', 'sell'] }).notNull(),
    qty: integer('qty').notNull(),
    price: real('price').notNull(),
  },
  (t) => [index('fill_trade_account_idx').on(t.tradeAccountId)],
);

export const dailyReview = sqliteTable('daily_review', {
  ...recordColumns,
  tradingDay: text('trading_day').notNull().unique(),
  notes: text('notes').notNull().default(''),
});
