import { sql } from 'drizzle-orm';
import { boolean, doublePrecision, foreignKey, index, integer, jsonb, pgSchema, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Everything lives in its own schema so Supabase's auto-generated public API never exposes it.
 *
 * Multi-user model: every per-user table has `user_id`, filled from the `app.user_id` setting of the current
 * transaction, and a composite key (user_id, id). Row-level security (migration 0001) limits the app role to
 * the current user's rows, so queries don't filter by user themselves. Seeded defaults keep fixed ids
 * (st_trading, cet_admin, ct_mnq…) per user, and foreign keys include user_id so rows can't point across users.
 */
export const app = pgSchema('tradetime');

const nowIso = sql`to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const currentUser = sql`current_setting('app.user_id')`;

const userId = () => text('user_id').notNull().default(currentUser);

/** Columns shared by every per-user record table. Records are soft-deleted only. */
const recordColumns = {
  userId: userId(),
  id: text('id').notNull(),
  createdAt: text('created_at').notNull().default(nowIso),
  updatedAt: text('updated_at').notNull().default(nowIso),
  deletedAt: text('deleted_at'),
};

/** One row per account; created (and the account's default lists seeded) on first use. */
export const userProfile = app.table('user_profile', {
  userId: text('user_id').primaryKey(),
  createdAt: text('created_at').notNull().default(nowIso),
});

/** Per-user settings and per-user job state (`state.*` keys). */
export const setting = app.table(
  'setting',
  {
    userId: userId(),
    key: text('key').notNull(),
    value: jsonb('value').$type<unknown>().notNull(),
    updatedAt: text('updated_at').notNull().default(nowIso),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

/** App-wide state that isn't anyone's (economic-events fetch status). */
export const appState = app.table('app_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: text('updated_at').notNull().default(nowIso),
});

/** A stored file, deduplicated by content per user. */
export const attachment = app.table(
  'attachment',
  {
    ...recordColumns,
    sha256: text('sha256').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    originalName: text('original_name'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), uniqueIndex('attachment_sha256_idx').on(t.userId, t.sha256)],
);

/** Links one attachment to any owner record (trade, expense, play example...). */
export const attachmentLink = app.table(
  'attachment_link',
  {
    ...recordColumns,
    attachmentId: text('attachment_id').notNull(),
    ownerType: text('owner_type').notNull(),
    ownerId: text('owner_id').notNull(),
    role: text('role'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.attachmentId], foreignColumns: [attachment.userId, attachment.id] }),
    index('attachment_link_owner_idx').on(t.userId, t.ownerType, t.ownerId),
  ],
);

/** Field-level edit history for records that double as tax evidence. */
export const auditLog = app.table(
  'audit_log',
  {
    userId: userId(),
    id: text('id').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    action: text('action', { enum: ['create', 'update', 'delete', 'restore'] }).notNull(),
    field: text('field'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    reason: text('reason'),
    at: text('at').notNull().default(nowIso),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), index('audit_log_entity_idx').on(t.userId, t.entity, t.entityId)],
);

/** Editable list of session types. All count as business hours; `isTrading` ones get the check-in flow. */
export const sessionType = app.table(
  'session_type',
  {
    ...recordColumns,
    name: text('name').notNull(),
    isTrading: boolean('is_trading').notNull().default(false),
    color: text('color').notNull().default('#64748b'),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

/** A block of business time. A running timer is a session with `end` = null (at most one per user). */
export const session = app.table(
  'session',
  {
    ...recordColumns,
    typeId: text('type_id').notNull(),
    start: text('start').notNull(),
    end: text('end'),
    /** Derived from `start` and the rollover setting; recomputed if the rollover changes. */
    tradingDay: text('trading_day').notNull(),
    source: text('source', { enum: ['timer', 'manual'] }).notNull(),
    notes: text('notes'),
    /** Set whenever start/end/type are changed after recording; full detail is in audit_log. */
    editedAt: text('edited_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.typeId], foreignColumns: [sessionType.userId, sessionType.id] }),
    index('session_trading_day_idx').on(t.userId, t.tradingDay),
    index('session_start_idx').on(t.userId, t.start),
    uniqueIndex('session_one_running_idx').on(t.userId).where(sql`${t.end} IS NULL AND ${t.deletedAt} IS NULL`),
  ],
);

/** Generic editable pick-lists (expense categories, expense types, payment methods, moods, mistakes). */
export const listItem = app.table(
  'list_item',
  {
    ...recordColumns,
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), uniqueIndex('list_item_kind_name_idx').on(t.userId, t.kind, t.name)],
);

export const firm = app.table(
  'firm',
  {
    ...recordColumns,
    name: text('name').notNull(),
    website: text('website'),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

/** A trading account (usually a prop firm evaluation or funded account). P&L currency is USD. */
export const account = app.table(
  'account',
  {
    ...recordColumns,
    firmId: text('firm_id'),
    name: text('name').notNull(),
    type: text('type', { enum: ['evaluation', 'funded', 'live', 'sim'] }).notNull(),
    status: text('status', { enum: ['active', 'passed', 'failed', 'closed'] }).notNull().default('active'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    startingBalanceCents: integer('starting_balance_cents'),
    currency: text('currency').notNull().default('USD'),
    notes: text('notes'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), foreignKey({ columns: [t.userId, t.firmId], foreignColumns: [firm.userId, firm.id] })],
);

/** Template that generates real Expense rows on a schedule (subscriptions, platform fees). */
export const recurringExpense = app.table(
  'recurring_expense',
  {
    ...recordColumns,
    name: text('name').notNull(),
    vendor: text('vendor'),
    description: text('description'),
    categoryId: text('category_id'),
    typeId: text('type_id'),
    paymentMethodId: text('payment_method_id'),
    accountId: text('account_id'),
    exGstCents: integer('ex_gst_cents').notNull(),
    gstCents: integer('gst_cents').notNull(),
    businessUsePct: integer('business_use_pct').notNull().default(100),
    frequency: text('frequency', { enum: ['weekly', 'monthly', 'quarterly', 'yearly'] }).notNull(),
    interval: integer('interval').notNull().default(1),
    /** First occurrence; later ones repeat from this anchor (month-end dates clamp). */
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.categoryId], foreignColumns: [listItem.userId, listItem.id] }),
    foreignKey({ columns: [t.userId, t.typeId], foreignColumns: [listItem.userId, listItem.id] }),
    foreignKey({ columns: [t.userId, t.paymentMethodId], foreignColumns: [listItem.userId, listItem.id] }),
    foreignKey({ columns: [t.userId, t.accountId], foreignColumns: [account.userId, account.id] }),
  ],
);

/** A business expense in AUD as charged by the bank. inc GST is always ex GST + entered GST. */
export const expense = app.table(
  'expense',
  {
    ...recordColumns,
    name: text('name').notNull(),
    vendor: text('vendor'),
    date: text('date').notNull(),
    description: text('description'),
    categoryId: text('category_id'),
    typeId: text('type_id'),
    paymentMethodId: text('payment_method_id'),
    accountId: text('account_id'),
    exGstCents: integer('ex_gst_cents').notNull(),
    gstCents: integer('gst_cents').notNull(),
    incGstCents: integer('inc_gst_cents').notNull(),
    businessUsePct: integer('business_use_pct').notNull().default(100),
    recurringId: text('recurring_id'),
    importBatchId: text('import_batch_id'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.categoryId], foreignColumns: [listItem.userId, listItem.id] }),
    foreignKey({ columns: [t.userId, t.typeId], foreignColumns: [listItem.userId, listItem.id] }),
    foreignKey({ columns: [t.userId, t.paymentMethodId], foreignColumns: [listItem.userId, listItem.id] }),
    foreignKey({ columns: [t.userId, t.accountId], foreignColumns: [account.userId, account.id] }),
    foreignKey({ columns: [t.userId, t.recurringId], foreignColumns: [recurringExpense.userId, recurringExpense.id] }),
    index('expense_date_idx').on(t.userId, t.date),
    // One generated row per template per date, including soft-deleted ones, so a deleted occurrence isn't regenerated.
    uniqueIndex('expense_recurring_date_idx').on(t.userId, t.recurringId, t.date),
  ],
);

/** Money received from a prop firm. Income is recorded in AUD as it arrived in the bank. */
export const payout = app.table(
  'payout',
  {
    ...recordColumns,
    accountId: text('account_id'),
    requestedDate: text('requested_date'),
    receivedDate: text('received_date').notNull(),
    grossUsdCents: integer('gross_usd_cents'),
    audReceivedCents: integer('aud_received_cents').notNull(),
    notes: text('notes'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.accountId], foreignColumns: [account.userId, account.id] }),
    index('payout_received_idx').on(t.userId, t.receivedDate),
  ],
);

// ---------- Journal ----------

/** Futures contract spec. P&L = price points × point value; prices snap to tick size. Per user (fees differ). */
export const contract = app.table(
  'contract',
  {
    ...recordColumns,
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    tickSize: doublePrecision('tick_size').notNull(),
    pointValueCents: integer('point_value_cents').notNull(),
    /** Default commission + exchange fees per contract per side, used to prefill trade fees. */
    feePerSideCents: integer('fee_per_side_cents').notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

/** A saved set of accounts that copy the same trades, each with a size multiplier. */
export const accountGroup = app.table(
  'account_group',
  {
    ...recordColumns,
    name: text('name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

export const accountGroupMember = app.table(
  'account_group_member',
  {
    userId: userId(),
    groupId: text('group_id').notNull(),
    accountId: text('account_id').notNull(),
    multiplier: integer('multiplier').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.groupId, t.accountId] }),
    foreignKey({ columns: [t.userId, t.groupId], foreignColumns: [accountGroup.userId, accountGroup.id] }),
    foreignKey({ columns: [t.userId, t.accountId], foreignColumns: [account.userId, account.id] }),
  ],
);

export const play = app.table(
  'play',
  {
    ...recordColumns,
    title: text('title').notNull(),
    description: text('description'),
    /**
     * Grade rules, best first: [{ grade: 'A+', maxMissed: 0, riskNote }, …]. A trade gets the first grade whose
     * maxMissed ≥ its missed standard criteria; anything beyond the last rule is 'C'.
     */
    gradeRules: jsonb('grade_rules').$type<{ grade: string; maxMissed: number; riskNote?: string | null }[]>().notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

export const playCriterion = app.table(
  'play_criterion',
  {
    ...recordColumns,
    playId: text('play_id').notNull(),
    label: text('label').notNull(),
    mustHave: boolean('must_have').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.playId], foreignColumns: [play.userId, play.id] }),
    index('play_criterion_play_idx').on(t.userId, t.playId),
  ],
);

/** A screenshot on a Play's gallery shelf for one grade. */
export const playExample = app.table(
  'play_example',
  {
    ...recordColumns,
    playId: text('play_id').notNull(),
    grade: text('grade').notNull(),
    attachmentId: text('attachment_id').notNull(),
    caption: text('caption'),
    date: text('date'),
    resultLabel: text('result_label'),
    sourceTradeId: text('source_trade_id'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.playId], foreignColumns: [play.userId, play.id] }),
    foreignKey({ columns: [t.userId, t.attachmentId], foreignColumns: [attachment.userId, attachment.id] }),
    index('play_example_play_idx').on(t.userId, t.playId),
  ],
);

/** One trade idea. Copy trades share it; each account's result is a TradeAccount with its own fills. */
export const trade = app.table(
  'trade',
  {
    ...recordColumns,
    tradingDay: text('trading_day').notNull(),
    contractId: text('contract_id').notNull(),
    direction: text('direction', { enum: ['long', 'short'] }).notNull(),
    playId: text('play_id'),
    /** Null when there's no Play or the trade is outside the plan. */
    grade: text('grade'),
    outsidePlan: boolean('outside_plan').notNull().default(false),
    stopPrice: doublePrecision('stop_price'),
    targetPrice: doublePrecision('target_price'),
    /** Planned risk in points (entry to stop). Derived from the stop when given. */
    plannedRiskPoints: doublePrecision('planned_risk_points'),
    followedPlan: text('followed_plan', { enum: ['yes', 'partly', 'no'] }),
    emotionId: text('emotion_id'),
    confidence: integer('confidence'),
    notes: text('notes'),
    sessionId: text('session_id'),
    /** The state reading in effect at entry: latest before entry in the same session, unless overridden. */
    stateReadingId: text('state_reading_id'),
    stateOverridden: boolean('state_overridden').notNull().default(false),
    /** How the trade's fills got here: typed in, or imported from a broker export. */
    source: text('source', { enum: ['manual', 'import'] }).notNull().default('manual'),
    /** Imported trades start here until you add the Play, checklist and notes. */
    needsReview: boolean('needs_review').notNull().default(false),
    /** Cached from fills across accounts. */
    openedAt: text('opened_at').notNull(),
    closedAt: text('closed_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.contractId], foreignColumns: [contract.userId, contract.id] }),
    foreignKey({ columns: [t.userId, t.playId], foreignColumns: [play.userId, play.id] }),
    foreignKey({ columns: [t.userId, t.emotionId], foreignColumns: [listItem.userId, listItem.id] }),
    foreignKey({ columns: [t.userId, t.sessionId], foreignColumns: [session.userId, session.id] }),
    index('trade_day_idx').on(t.userId, t.tradingDay),
    index('trade_opened_idx').on(t.userId, t.openedAt),
  ],
);

export const tradeCriterionCheck = app.table(
  'trade_criterion_check',
  {
    userId: userId(),
    tradeId: text('trade_id').notNull(),
    criterionId: text('criterion_id').notNull(),
    /** Snapshots, so later edits to the Play don't rewrite history. */
    label: text('label').notNull(),
    mustHave: boolean('must_have').notNull(),
    checked: boolean('checked').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.tradeId, t.criterionId] }),
    foreignKey({ columns: [t.userId, t.tradeId], foreignColumns: [trade.userId, trade.id] }),
  ],
);

export const tradeTag = app.table(
  'trade_tag',
  {
    userId: userId(),
    tradeId: text('trade_id').notNull(),
    listItemId: text('list_item_id').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.tradeId, t.listItemId] }),
    foreignKey({ columns: [t.userId, t.tradeId], foreignColumns: [trade.userId, trade.id] }),
    foreignKey({ columns: [t.userId, t.listItemId], foreignColumns: [listItem.userId, listItem.id] }),
  ],
);

export const tradeAccount = app.table(
  'trade_account',
  {
    userId: userId(),
    id: text('id').notNull(),
    tradeId: text('trade_id').notNull(),
    accountId: text('account_id').notNull(),
    multiplier: integer('multiplier').notNull().default(1),
    feesCents: integer('fees_cents').notNull().default(0),
    /** Contract spec at the time of the trade. */
    pointValueCents: integer('point_value_cents').notNull(),
    tickSize: doublePrecision('tick_size').notNull(),
    // Cached results, recalculated from fills on every save.
    maxQty: integer('max_qty').notNull(),
    avgEntry: doublePrecision('avg_entry').notNull(),
    avgExit: doublePrecision('avg_exit').notNull(),
    grossCents: integer('gross_cents').notNull(),
    netCents: integer('net_cents').notNull(),
    plannedRiskCents: integer('planned_risk_cents'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.tradeId], foreignColumns: [trade.userId, trade.id] }),
    foreignKey({ columns: [t.userId, t.accountId], foreignColumns: [account.userId, account.id] }),
    index('trade_account_trade_idx').on(t.userId, t.tradeId),
    index('trade_account_account_idx').on(t.userId, t.accountId),
  ],
);

export const fill = app.table(
  'fill',
  {
    userId: userId(),
    id: text('id').notNull(),
    tradeAccountId: text('trade_account_id').notNull(),
    at: text('at').notNull(),
    side: text('side', { enum: ['buy', 'sell'] }).notNull(),
    qty: integer('qty').notNull(),
    price: doublePrecision('price').notNull(),
    /** Broker's execution id for imported fills, so re-importing the same export skips them. */
    externalId: text('external_id'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.tradeAccountId], foreignColumns: [tradeAccount.userId, tradeAccount.id] }),
    index('fill_trade_account_idx').on(t.userId, t.tradeAccountId),
    uniqueIndex('fill_external_unique_idx').on(t.userId, t.externalId).where(sql`${t.externalId} IS NOT NULL`),
  ],
);

export const dailyReview = app.table(
  'daily_review',
  {
    ...recordColumns,
    tradingDay: text('trading_day').notNull(),
    notes: text('notes').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), uniqueIndex('daily_review_trading_day_idx').on(t.userId, t.tradingDay)],
);

// ---------- Check-ins ----------

/** A question asked at session start, at check-ins, or both (so start and check-in readings line up). */
export const question = app.table(
  'question',
  {
    ...recordColumns,
    prompt: text('prompt').notNull(),
    kind: text('kind', { enum: ['mood', 'scale', 'yesPartlyNo', 'text'] }).notNull(),
    appliesTo: text('applies_to', { enum: ['both', 'start', 'checkin'] }).notNull().default('both'),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

export interface ReadingAnswer {
  questionId: string;
  /** Snapshots so later edits to the question list don't change history. */
  prompt: string;
  kind: 'mood' | 'scale' | 'yesPartlyNo' | 'text';
  value: string | number | null;
  /** Display label for mood answers. */
  label?: string | null;
}

/** Answers given at session start or at a mid-session check-in, timestamped against the session. */
export const stateReading = app.table(
  'state_reading',
  {
    ...recordColumns,
    sessionId: text('session_id').notNull(),
    kind: text('kind', { enum: ['start', 'checkin'] }).notNull(),
    at: text('at').notNull(),
    answers: jsonb('answers').$type<ReadingAnswer[]>().notNull(),
    decision: text('decision', { enum: ['keep_trading', 'take_break', 'stop'] }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.sessionId], foreignColumns: [session.userId, session.id] }),
    index('state_reading_session_idx').on(t.userId, t.sessionId),
    index('state_reading_at_idx').on(t.userId, t.at),
  ],
);

// ---------- Calendar ----------

/** Scheduled economic release, fetched once from a provider for everyone (not per user). */
export const marketEvent = app.table(
  'market_event',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull().default(nowIso),
    updatedAt: text('updated_at').notNull().default(nowIso),
    deletedAt: text('deleted_at'),
    provider: text('provider').notNull(),
    providerId: text('provider_id').notNull(),
    title: text('title').notNull(),
    at: text('at').notNull(),
    impact: text('impact', { enum: ['high', 'medium', 'low'] }).notNull(),
    country: text('country').notNull(),
    currency: text('currency').notNull(),
    fetchedAt: text('fetched_at').notNull(),
  },
  (t) => [uniqueIndex('market_event_provider_idx').on(t.provider, t.providerId), index('market_event_at_idx').on(t.at)],
);

/** Your own event types, each a colour-coded calendar layer. */
export const calendarEventType = app.table(
  'calendar_event_type',
  {
    ...recordColumns,
    name: text('name').notNull(),
    color: text('color').notNull(),
    /** Session type preselected when starting a session from an event of this type. */
    sessionTypeId: text('session_type_id'),
    /** Days with an event of this type don't count as "not traded". */
    isNoTrade: boolean('is_no_trade').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archived: boolean('archived').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.sessionTypeId], foreignColumns: [sessionType.userId, sessionType.id] }),
  ],
);

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly';
  interval: number;
  /** Weekly: ISO weekdays 1 (Mon) – 7 (Sun). */
  byWeekday?: number[];
  /** Last date (inclusive) an occurrence may fall on. */
  until?: string | null;
}

/** An event or task you create. Times are wall-clock times in the user's zone. */
export const calendarEvent = app.table(
  'calendar_event',
  {
    ...recordColumns,
    typeId: text('type_id').notNull(),
    title: text('title').notNull(),
    notes: text('notes'),
    link: text('link'),
    date: text('date').notNull(),
    allDay: boolean('all_day').notNull().default(false),
    startTime: text('start_time'),
    endTime: text('end_time'),
    recurrence: jsonb('recurrence').$type<Recurrence | null>(),
    reminderMinutes: integer('reminder_minutes'),
    isTask: boolean('is_task').notNull().default(false),
    /** For one-off tasks. Recurring tasks track completion per occurrence in exceptions. */
    doneAt: text('done_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    foreignKey({ columns: [t.userId, t.typeId], foreignColumns: [calendarEventType.userId, calendarEventType.id] }),
    index('calendar_event_date_idx').on(t.userId, t.date),
  ],
);

/** A change to one occurrence of a recurring event: skipped, moved/renamed, or (for tasks) done. */
export const calendarEventException = app.table(
  'calendar_event_exception',
  {
    userId: userId(),
    eventId: text('event_id').notNull(),
    occurrenceDate: text('occurrence_date').notNull(),
    skipped: boolean('skipped').notNull().default(false),
    override: jsonb('override').$type<{ title?: string; date?: string; startTime?: string | null; endTime?: string | null; notes?: string | null }>(),
    doneAt: text('done_at'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.eventId, t.occurrenceDate] }),
    foreignKey({ columns: [t.userId, t.eventId], foreignColumns: [calendarEvent.userId, calendarEvent.id] }),
  ],
);

/** Broker account name as it appears in exports (e.g. a NinjaTrader account id) → TradeTime account. */
export const accountAlias = app.table(
  'account_alias',
  {
    userId: userId(),
    alias: text('alias').notNull(),
    accountId: text('account_id').notNull(),
    createdAt: text('created_at').notNull().default(nowIso),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.alias] }),
    foreignKey({ columns: [t.userId, t.accountId], foreignColumns: [account.userId, account.id] }),
  ],
);

/** A browser or phone that asked for push notifications (Web Push). One row per device. */
export const pushSubscription = app.table(
  'push_subscription',
  {
    userId: userId(),
    id: text('id').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: text('created_at').notNull().default(nowIso),
    lastUsedAt: text('last_used_at'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] }), uniqueIndex('push_subscription_endpoint_idx').on(t.userId, t.endpoint)],
);

/** Every per-user table, for row-level security and per-user deletes/exports. */
/** Feedback sent from the app (Send feedback). The admin reads it in the Supabase dashboard. */
export const feedback = app.table(
  'feedback',
  {
    userId: userId(),
    id: text('id').notNull(),
    createdAt: text('created_at').notNull().default(nowIso),
    kind: text('kind').notNull().default('general'),
    message: text('message').notNull(),
    /** The page it was sent from, and the browser, to help reproduce problems. */
    page: text('page'),
    userAgent: text('user_agent'),
    appVersion: text('app_version'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);

export const userTables = [
  'user_profile',
  'setting',
  'attachment',
  'attachment_link',
  'audit_log',
  'session_type',
  'session',
  'list_item',
  'firm',
  'account',
  'recurring_expense',
  'expense',
  'payout',
  'contract',
  'account_group',
  'account_group_member',
  'play',
  'play_criterion',
  'play_example',
  'trade',
  'trade_criterion_check',
  'trade_tag',
  'trade_account',
  'fill',
  'daily_review',
  'question',
  'state_reading',
  'calendar_event_type',
  'calendar_event',
  'calendar_event_exception',
  'account_alias',
  'push_subscription',
  'feedback',
] as const;
