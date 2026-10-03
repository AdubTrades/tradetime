import { parse } from 'csv-parse/sync';
import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { schema } from '@tc/db';
import {
  claimable,
  financialYear,
  incGst,
  newId,
  nextOccurrence,
  parseExpenseRow,
  recurrenceDates,
  suggestExpenseMapping,
  type ExpenseImportMapping,
  type ParsedExpenseRow,
} from '@tc/domain';
import { assertAccount } from './accounts';
import { auditEvent, auditUpdate } from './audit';
import { db } from './context';
import { AppError } from './errors';
import { assertListItem, findOrCreateListItem, listItems } from './lists';
import { getSettings } from './settings';

const { expense, recurringExpense, payout, auditLog } = schema;
const nowIso = () => new Date().toISOString();

// ---------- Expenses ----------

export interface ExpenseInput {
  name: string;
  vendor?: string | null;
  date: string;
  description?: string | null;
  categoryId?: string | null;
  typeId?: string | null;
  paymentMethodId?: string | null;
  accountId?: string | null;
  exGstCents: number;
  gstCents: number;
  businessUsePct?: number;
}

function validateRefs(input: Partial<ExpenseInput>) {
  assertListItem('expense_category', input.categoryId);
  assertListItem('expense_type', input.typeId);
  assertListItem('payment_method', input.paymentMethodId);
  assertAccount(input.accountId);
  if (input.businessUsePct !== undefined && (input.businessUsePct < 0 || input.businessUsePct > 100)) {
    throw new AppError(422, 'Business use must be between 0 and 100%');
  }
  if (input.gstCents !== undefined && input.gstCents < 0) throw new AppError(422, 'GST cannot be negative');
}

const clean = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

/** Financial years (start year, newest first) with expenses or payouts, always including the current one. */
export function expenseFinancialYears(currentStartYear: number): number[] {
  const months = [
    ...db.selectDistinct({ month: sql<string>`substr(${expense.date}, 1, 7)` }).from(expense).where(isNull(expense.deletedAt)).all(),
    ...db.selectDistinct({ month: sql<string>`substr(${payout.receivedDate}, 1, 7)` }).from(payout).where(isNull(payout.deletedAt)).all(),
  ];
  const years = new Set([currentStartYear]);
  for (const { month } of months) {
    const [y, m] = month.split('-').map(Number) as [number, number];
    years.add(m >= 7 ? y : y - 1);
  }
  return [...years].sort((a, b) => b - a);
}

export function listExpenses(range: { from: string; to: string }) {
  return db
    .select()
    .from(expense)
    .where(and(isNull(expense.deletedAt), gte(expense.date, range.from), lte(expense.date, range.to)))
    .orderBy(desc(expense.date), desc(expense.createdAt))
    .all();
}

function getExpenseRow(id: string) {
  const row = db.select().from(expense).where(eq(expense.id, id)).get();
  if (!row || row.deletedAt) throw new AppError(404, 'Expense not found');
  return row;
}

/** Create an expense. The client may supply the id so receipts can be attached before the first save. */
export function createExpense(input: ExpenseInput & { id?: string }) {
  validateRefs(input);
  return db.transaction((tx) => {
    const row = tx
      .insert(expense)
      .values({
        id: input.id ?? newId(),
        name: input.name.trim(),
        vendor: clean(input.vendor),
        date: input.date,
        description: clean(input.description),
        categoryId: input.categoryId ?? null,
        typeId: input.typeId ?? null,
        paymentMethodId: input.paymentMethodId ?? null,
        accountId: input.accountId ?? null,
        exGstCents: input.exGstCents,
        gstCents: input.gstCents,
        incGstCents: incGst(input.exGstCents, input.gstCents),
        businessUsePct: input.businessUsePct ?? 100,
      })
      .returning()
      .get();
    auditEvent(tx, 'expense', row.id, 'create', row);
    return row;
  });
}

export function updateExpense(id: string, patch: Partial<ExpenseInput>, reason: string | null) {
  const before = getExpenseRow(id);
  validateRefs(patch);
  const next = {
    ...patch,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.vendor !== undefined ? { vendor: clean(patch.vendor) } : {}),
    ...(patch.description !== undefined ? { description: clean(patch.description) } : {}),
  };
  const exGstCents = patch.exGstCents ?? before.exGstCents;
  const gstCents = patch.gstCents ?? before.gstCents;
  const changes = { ...next, incGstCents: incGst(exGstCents, gstCents) };
  return db.transaction((tx) => {
    const row = tx.update(expense).set({ ...changes, updatedAt: nowIso() }).where(eq(expense.id, id)).returning().get();
    auditUpdate(tx, 'expense', id, before, changes, reason ?? undefined);
    return row;
  });
}

export function deleteExpense(id: string) {
  const row = getExpenseRow(id);
  db.transaction((tx) => {
    tx.update(expense).set({ deletedAt: nowIso() }).where(eq(expense.id, id)).run();
    auditEvent(tx, 'expense', id, 'delete', row);
  });
}

export function restoreExpense(id: string) {
  const row = db.select().from(expense).where(eq(expense.id, id)).get();
  if (!row?.deletedAt) throw new AppError(404, 'No deleted expense with that id');
  db.transaction((tx) => {
    tx.update(expense).set({ deletedAt: null, updatedAt: nowIso() }).where(eq(expense.id, id)).run();
    auditEvent(tx, 'expense', id, 'restore');
  });
}

export function entityHistory(entity: 'expense' | 'payout', id: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, entity), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.at), asc(auditLog.id))
    .all();
}

/** Two expenses on the same date with the same name and inc-GST amount are treated as the same charge. */
const duplicateKey = (e: { date: string; name: string; incGstCents: number }) => `${e.date}|${e.name.trim().toLowerCase()}|${e.incGstCents}`;

// ---------- Recurring ----------

export type RecurringInput = Omit<typeof recurringExpense.$inferInsert, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export function listRecurring(today: string) {
  return db
    .select()
    .from(recurringExpense)
    .where(isNull(recurringExpense.deletedAt))
    .orderBy(asc(recurringExpense.name))
    .all()
    .map((r) => ({ ...r, nextDate: r.active ? nextOccurrence(r, today) : null }));
}

export function createRecurring(input: RecurringInput) {
  validateRefs(input);
  return db.insert(recurringExpense).values({ ...input, id: newId(), name: input.name.trim() }).returning().get();
}

export function updateRecurring(id: string, patch: Partial<RecurringInput>) {
  validateRefs(patch);
  const row = db.update(recurringExpense).set({ ...patch, updatedAt: nowIso() }).where(eq(recurringExpense.id, id)).returning().get();
  if (!row) throw new AppError(404, 'Recurring expense not found');
  return row;
}

export function deleteRecurring(id: string) {
  db.update(recurringExpense).set({ deletedAt: nowIso(), active: false }).where(eq(recurringExpense.id, id)).run();
}

/**
 * Create the real expense rows for every occurrence up to `today` that doesn't exist yet.
 * A unique (recurring_id, date) index makes this idempotent and stops deleted occurrences coming back.
 */
export function generateRecurringExpenses(today: string): number {
  const templates = db
    .select()
    .from(recurringExpense)
    .where(and(isNull(recurringExpense.deletedAt), eq(recurringExpense.active, true)))
    .all();
  let created = 0;
  db.transaction((tx) => {
    // Skip dates already covered by an identical expense entered by hand or imported (same date, name, amount).
    const existing = new Set(
      tx
        .select({ date: expense.date, name: expense.name, incGstCents: expense.incGstCents })
        .from(expense)
        .where(isNull(expense.deletedAt))
        .all()
        .map(duplicateKey),
    );
    for (const t of templates) {
      const inc = incGst(t.exGstCents, t.gstCents);
      for (const date of recurrenceDates(t, t.startDate, today)) {
        if (existing.has(duplicateKey({ date, name: t.name, incGstCents: inc }))) continue;
        const res = tx
          .insert(expense)
          .values({
            id: newId(),
            name: t.name,
            vendor: t.vendor,
            date,
            description: t.description,
            categoryId: t.categoryId,
            typeId: t.typeId,
            paymentMethodId: t.paymentMethodId,
            accountId: t.accountId,
            exGstCents: t.exGstCents,
            gstCents: t.gstCents,
            incGstCents: incGst(t.exGstCents, t.gstCents),
            businessUsePct: t.businessUsePct,
            recurringId: t.id,
          })
          .onConflictDoNothing()
          .run();
        created += res.changes;
      }
    }
  });
  return created;
}

// ---------- CSV import ----------

const MAX_CSV_BYTES = 5 * 1024 * 1024;

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  if (text.length > MAX_CSV_BYTES) throw new AppError(422, 'CSV is larger than 5 MB');
  let records: Record<string, string>[];
  try {
    records = parse(text, { columns: (h: string[]) => h.map((x) => x.trim()), bom: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  } catch (err) {
    throw new AppError(422, `Couldn't read the CSV: ${(err as Error).message}`);
  }
  const headers = records.length ? Object.keys(records[0]!) : (text.replace(/^﻿/, '').split(/\r?\n/)[0] ?? '').split(',').map((h) => h.trim());
  return { headers, rows: records };
}


export type PreviewRow =
  | { line: number; status: 'ok' | 'duplicate'; value: ParsedExpenseRow; warnings: string[] }
  | { line: number; status: 'error'; errors: string[]; warnings: string[] };

/** Parse the CSV with a mapping (suggested if omitted) and report what would be imported. */
export function previewImport(text: string, mapping?: ExpenseImportMapping) {
  const { headers, rows } = parseCsv(text);
  const map = mapping ?? suggestExpenseMapping(headers);
  for (const [field, header] of Object.entries(map)) {
    if (header && !headers.includes(header)) throw new AppError(422, `Column "${header}" (for ${field}) isn't in the file`);
  }
  const existing = new Set(
    db
      .select({ date: expense.date, name: expense.name, incGstCents: expense.incGstCents })
      .from(expense)
      .where(isNull(expense.deletedAt))
      .all()
      .map(duplicateKey),
  );
  const seen = new Set<string>();
  const result: PreviewRow[] = [];
  let blank = 0;
  rows.forEach((row, i) => {
    const line = i + 2; // header is line 1
    const keyFields = (['name', 'date', 'exGst', 'vendor'] as const).map((f) => (map[f] ? (row[map[f]!] ?? '').trim() : ''));
    if (keyFields.every((v) => !v)) {
      blank++;
      return;
    }
    const parsed = parseExpenseRow(row, map);
    if (!parsed.ok) {
      result.push({ line, status: 'error', errors: parsed.errors, warnings: parsed.warnings });
      return;
    }
    const key = duplicateKey(parsed.value);
    const status = existing.has(key) || seen.has(key) ? 'duplicate' : 'ok';
    seen.add(key);
    result.push({ line, status, value: parsed.value, warnings: parsed.warnings });
  });

  return {
    headers,
    mapping: map,
    rows: result,
    counts: {
      ok: result.filter((r) => r.status === 'ok').length,
      duplicate: result.filter((r) => r.status === 'duplicate').length,
      error: result.filter((r) => r.status === 'error').length,
      blank,
    },
  };
}

/** Import all valid, non-duplicate rows in one transaction. New categories/types/payment methods are created. */
export function commitImport(text: string, mapping: ExpenseImportMapping, options: { includeDuplicates?: boolean } = {}) {
  const preview = previewImport(text, mapping);
  const toImport = preview.rows.filter(
    (r): r is Extract<PreviewRow, { value: ParsedExpenseRow }> => r.status === 'ok' || (r.status === 'duplicate' && !!options.includeDuplicates),
  );
  const batchId = newId();
  const before = {
    category: listItems('expense_category').length,
    type: listItems('expense_type').length,
    payment: listItems('payment_method').length,
  };
  db.transaction((tx) => {
    for (const { value: v } of toImport) {
      const row = tx
        .insert(expense)
        .values({
          id: newId(),
          name: v.name,
          vendor: v.vendor,
          date: v.date,
          description: v.description,
          categoryId: v.category ? findOrCreateListItem('expense_category', v.category, tx) : null,
          typeId: v.type ? findOrCreateListItem('expense_type', v.type, tx) : null,
          paymentMethodId: v.paymentMethod ? findOrCreateListItem('payment_method', v.paymentMethod, tx) : null,
          exGstCents: v.exGstCents,
          gstCents: v.gstCents,
          incGstCents: v.incGstCents,
          businessUsePct: v.businessUsePct,
          importBatchId: batchId,
        })
        .returning()
        .get();
      auditEvent(tx, 'expense', row.id, 'create', { ...row, source: 'csv-import' });
    }
  });
  return {
    batchId,
    imported: toImport.length,
    skippedDuplicates: preview.counts.duplicate - (options.includeDuplicates ? preview.counts.duplicate : 0),
    skippedErrors: preview.counts.error,
    newCategories: listItems('expense_category').length - before.category,
    newTypes: listItems('expense_type').length - before.type,
    newPaymentMethods: listItems('payment_method').length - before.payment,
  };
}

// ---------- Payouts ----------

export interface PayoutInput {
  accountId?: string | null;
  requestedDate?: string | null;
  receivedDate: string;
  grossUsdCents?: number | null;
  audReceivedCents: number;
  notes?: string | null;
}

export function listPayouts(range: { from: string; to: string }) {
  return db
    .select()
    .from(payout)
    .where(and(isNull(payout.deletedAt), gte(payout.receivedDate, range.from), lte(payout.receivedDate, range.to)))
    .orderBy(desc(payout.receivedDate))
    .all();
}

export function createPayout(input: PayoutInput & { id?: string }) {
  assertAccount(input.accountId);
  return db.transaction((tx) => {
    const row = tx
      .insert(payout)
      .values({ ...input, id: input.id ?? newId(), notes: clean(input.notes) })
      .returning()
      .get();
    auditEvent(tx, 'payout', row.id, 'create', row);
    return row;
  });
}

export function updatePayout(id: string, patch: Partial<PayoutInput>, reason: string | null) {
  const before = db.select().from(payout).where(eq(payout.id, id)).get();
  if (!before || before.deletedAt) throw new AppError(404, 'Payout not found');
  assertAccount(patch.accountId);
  const changes = { ...patch, ...(patch.notes !== undefined ? { notes: clean(patch.notes) } : {}) };
  return db.transaction((tx) => {
    const row = tx.update(payout).set({ ...changes, updatedAt: nowIso() }).where(eq(payout.id, id)).returning().get();
    auditUpdate(tx, 'payout', id, before, changes, reason ?? undefined);
    return row;
  });
}

export function deletePayout(id: string) {
  const row = db.select().from(payout).where(eq(payout.id, id)).get();
  if (!row || row.deletedAt) throw new AppError(404, 'Payout not found');
  db.transaction((tx) => {
    tx.update(payout).set({ deletedAt: nowIso() }).where(eq(payout.id, id)).run();
    auditEvent(tx, 'payout', id, 'delete', row);
  });
}

// ---------- Financial-year summary ----------

export function financialYearSummary(startYear: number) {
  const fy = financialYear(startYear);
  const { gstRegistered } = getSettings();
  const expenses = listExpenses({ from: fy.start, to: fy.end });
  const payouts = listPayouts({ from: fy.start, to: fy.end });
  const categoryNames = new Map(listItems('expense_category').map((c) => [c.id, c.name]));

  type Totals = { count: number; exGstCents: number; gstCents: number; incGstCents: number; deductibleCents: number; gstCreditCents: number };
  const zero = (): Totals => ({ count: 0, exGstCents: 0, gstCents: 0, incGstCents: 0, deductibleCents: 0, gstCreditCents: 0 });
  const add = (t: Totals, e: (typeof expenses)[number]) => {
    const c = claimable(e, gstRegistered);
    t.count++;
    t.exGstCents += e.exGstCents;
    t.gstCents += e.gstCents;
    t.incGstCents += e.incGstCents;
    t.deductibleCents += c.deductibleCents;
    t.gstCreditCents += c.gstCreditCents;
  };

  const total = zero();
  const byCategory = new Map<string, Totals & { categoryId: string | null; name: string }>();
  for (const e of expenses) {
    add(total, e);
    const key = e.categoryId ?? 'none';
    const bucket = byCategory.get(key) ?? { ...zero(), categoryId: e.categoryId, name: e.categoryId ? (categoryNames.get(e.categoryId) ?? 'Unknown') : 'Uncategorised' };
    add(bucket, e);
    byCategory.set(key, bucket);
  }

  return {
    fy,
    gstRegistered,
    expenses: { total, byCategory: [...byCategory.values()].sort((a, b) => b.incGstCents - a.incGstCents) },
    payouts: {
      count: payouts.length,
      audReceivedCents: payouts.reduce((s, p) => s + p.audReceivedCents, 0),
      grossUsdCents: payouts.reduce((s, p) => s + (p.grossUsdCents ?? 0), 0),
    },
  };
}
