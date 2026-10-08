import { parse } from 'csv-parse/sync';
import { DateTime } from 'luxon';
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
import { getSettings, getState, setState } from './settings';

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

async function validateRefs(input: Partial<ExpenseInput>) {
  await assertListItem('expense_category', input.categoryId);
  await assertListItem('expense_type', input.typeId);
  await assertListItem('payment_method', input.paymentMethodId);
  await assertAccount(input.accountId);
  if (input.businessUsePct !== undefined && (input.businessUsePct < 0 || input.businessUsePct > 100)) {
    throw new AppError(422, 'Business use must be between 0 and 100%');
  }
  if (input.gstCents !== undefined && input.gstCents < 0) throw new AppError(422, 'GST cannot be negative');
}

const clean = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

/** Financial years (start year, newest first) with expenses or payouts, always including the current one. */
export async function expenseFinancialYears(currentStartYear: number): Promise<number[]> {
  const months = [
    ...(await db.selectDistinct({ month: sql<string>`substr(${expense.date}, 1, 7)` }).from(expense).where(isNull(expense.deletedAt))),
    ...(await db.selectDistinct({ month: sql<string>`substr(${payout.receivedDate}, 1, 7)` }).from(payout).where(isNull(payout.deletedAt))),
  ];
  const years = new Set([currentStartYear]);
  for (const { month } of months) {
    const [y, m] = month.split('-').map(Number) as [number, number];
    years.add(m >= 7 ? y : y - 1);
  }
  return [...years].sort((a, b) => b - a);
}

export async function listExpenses(range: { from: string; to: string }) {
  return db
    .select()
    .from(expense)
    .where(and(isNull(expense.deletedAt), gte(expense.date, range.from), lte(expense.date, range.to)))
    .orderBy(desc(expense.date), desc(expense.createdAt));
}

async function getExpenseRow(id: string) {
  const [row] = await db.select().from(expense).where(eq(expense.id, id));
  if (!row || row.deletedAt) throw new AppError(404, 'Expense not found');
  return row;
}

/** Create an expense. The client may supply the id so receipts can be attached before the first save. */
export async function createExpense(input: ExpenseInput & { id?: string }) {
  await validateRefs(input);
  return db.transaction(async (tx) => {
    const [row] = await tx
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
      .returning();
    await auditEvent(tx, 'expense', row!.id, 'create', row);
    return row!;
  });
}

export async function updateExpense(id: string, patch: Partial<ExpenseInput>, reason: string | null) {
  const before = await getExpenseRow(id);
  await validateRefs(patch);
  const next = {
    ...patch,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.vendor !== undefined ? { vendor: clean(patch.vendor) } : {}),
    ...(patch.description !== undefined ? { description: clean(patch.description) } : {}),
  };
  const exGstCents = patch.exGstCents ?? before.exGstCents;
  const gstCents = patch.gstCents ?? before.gstCents;
  const changes = { ...next, incGstCents: incGst(exGstCents, gstCents) };
  return db.transaction(async (tx) => {
    const [row] = await tx.update(expense).set({ ...changes, updatedAt: nowIso() }).where(eq(expense.id, id)).returning();
    await auditUpdate(tx, 'expense', id, before, changes, reason ?? undefined);
    return row!;
  });
}

export async function deleteExpense(id: string) {
  const row = await getExpenseRow(id);
  await db.transaction(async (tx) => {
    await tx.update(expense).set({ deletedAt: nowIso() }).where(eq(expense.id, id));
    await auditEvent(tx, 'expense', id, 'delete', row);
  });
}

export async function restoreExpense(id: string) {
  const [row] = await db.select().from(expense).where(eq(expense.id, id));
  if (!row?.deletedAt) throw new AppError(404, 'No deleted expense with that id');
  await db.transaction(async (tx) => {
    await tx.update(expense).set({ deletedAt: null, updatedAt: nowIso() }).where(eq(expense.id, id));
    await auditEvent(tx, 'expense', id, 'restore');
  });
}

export async function entityHistory(entity: 'expense' | 'payout', id: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entity, entity), eq(auditLog.entityId, id)))
    .orderBy(asc(auditLog.at), asc(auditLog.id));
}

/** Two expenses on the same date with the same name and inc-GST amount are treated as the same charge. */
const duplicateKey = (e: { date: string; name: string; incGstCents: number }) => `${e.date}|${e.name.trim().toLowerCase()}|${e.incGstCents}`;

// ---------- Recurring ----------

export type RecurringInput = Omit<typeof recurringExpense.$inferInsert, 'userId' | 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>;

export async function listRecurring(today: string) {
  const rows = await db.select().from(recurringExpense).where(isNull(recurringExpense.deletedAt)).orderBy(asc(recurringExpense.name));
  return rows.map((r) => ({ ...r, nextDate: r.active ? nextOccurrence(r, today) : null }));
}

/** How many days before a renewal the reminder goes out. */
export const RENEWAL_LEAD_DAYS = 7;

/**
 * Active recurring expenses renewing between `from` and `to` (inclusive). Weekly items are left out:
 * a week's notice would land on the day of the previous charge.
 */
export async function renewalsBetween(today: string, from: string, to: string) {
  return (await listRecurring(today))
    .filter((r) => r.nextDate && r.nextDate >= from && r.nextDate <= to && !(r.frequency === 'weekly' && r.interval === 1))
    .map((r) => ({ id: r.id, name: r.name, vendor: r.vendor, nextDate: r.nextDate!, incGstCents: incGst(r.exGstCents, r.gstCents), frequency: r.frequency, interval: r.interval }))
    .sort((a, b) => a.nextDate.localeCompare(b.nextDate));
}

type Renewal = Awaited<ReturnType<typeof renewalsBetween>>[number];
const RENEWAL_STATE = 'renewalNotified';

/** Renewals coming up within the lead time that haven't been notified yet (once per renewal date). */
export async function renewalsToNotify(today: string): Promise<Renewal[]> {
  const sent = (await getState<Record<string, string>>(RENEWAL_STATE)) ?? {};
  const from = DateTime.fromISO(today).plus({ days: 1 }).toISODate()!;
  const to = DateTime.fromISO(today).plus({ days: RENEWAL_LEAD_DAYS }).toISODate()!;
  return (await renewalsBetween(today, from, to)).filter((r) => sent[r.id] !== r.nextDate);
}

export async function markRenewalNotified(r: Pick<Renewal, 'id' | 'nextDate'>): Promise<void> {
  await setState(RENEWAL_STATE, { ...((await getState<Record<string, string>>(RENEWAL_STATE)) ?? {}), [r.id]: r.nextDate });
}

export async function createRecurring(input: RecurringInput) {
  await validateRefs(input);
  const [row] = await db.insert(recurringExpense).values({ ...input, id: newId(), name: input.name.trim() }).returning();
  return row!;
}

export async function updateRecurring(id: string, patch: Partial<RecurringInput>) {
  await validateRefs(patch);
  const [row] = await db.update(recurringExpense).set({ ...patch, updatedAt: nowIso() }).where(eq(recurringExpense.id, id)).returning();
  if (!row) throw new AppError(404, 'Recurring expense not found');
  return row;
}

export async function deleteRecurring(id: string) {
  await db.update(recurringExpense).set({ deletedAt: nowIso(), active: false }).where(eq(recurringExpense.id, id));
}

/**
 * Create the real expense rows for every occurrence up to `today` that doesn't exist yet.
 * A unique (recurring_id, date) index makes this idempotent and stops deleted occurrences coming back.
 */
export async function generateRecurringExpenses(today: string): Promise<number> {
  const templates = await db
    .select()
    .from(recurringExpense)
    .where(and(isNull(recurringExpense.deletedAt), eq(recurringExpense.active, true)));
  if (templates.length === 0) return 0;
  let created = 0;
  await db.transaction(async (tx) => {
    // Skip dates already covered by an identical expense entered by hand or imported (same date, name, amount).
    const existing = new Set(
      (await tx.select({ date: expense.date, name: expense.name, incGstCents: expense.incGstCents }).from(expense).where(isNull(expense.deletedAt))).map(duplicateKey),
    );
    for (const t of templates) {
      const inc = incGst(t.exGstCents, t.gstCents);
      for (const date of recurrenceDates(t, t.startDate, today)) {
        if (existing.has(duplicateKey({ date, name: t.name, incGstCents: inc }))) continue;
        const inserted = await tx
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
          .returning({ id: expense.id });
        created += inserted.length;
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
export async function previewImport(text: string, mapping?: ExpenseImportMapping) {
  const { headers, rows } = parseCsv(text);
  const map = mapping ?? suggestExpenseMapping(headers);
  for (const [field, header] of Object.entries(map)) {
    if (header && !headers.includes(header)) throw new AppError(422, `Column "${header}" (for ${field}) isn't in the file`);
  }
  const existing = new Set(
    (await db.select({ date: expense.date, name: expense.name, incGstCents: expense.incGstCents }).from(expense).where(isNull(expense.deletedAt))).map(duplicateKey),
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
export async function commitImport(text: string, mapping: ExpenseImportMapping, options: { includeDuplicates?: boolean } = {}) {
  const preview = await previewImport(text, mapping);
  const toImport = preview.rows.filter(
    (r): r is Extract<PreviewRow, { value: ParsedExpenseRow }> => r.status === 'ok' || (r.status === 'duplicate' && !!options.includeDuplicates),
  );
  const batchId = newId();
  const counts = async () => ({
    category: (await listItems('expense_category')).length,
    type: (await listItems('expense_type')).length,
    payment: (await listItems('payment_method')).length,
  });
  const before = await counts();
  await db.transaction(async (tx) => {
    for (const { value: v } of toImport) {
      const [row] = await tx
        .insert(expense)
        .values({
          id: newId(),
          name: v.name,
          vendor: v.vendor,
          date: v.date,
          description: v.description,
          categoryId: v.category ? await findOrCreateListItem('expense_category', v.category, tx) : null,
          typeId: v.type ? await findOrCreateListItem('expense_type', v.type, tx) : null,
          paymentMethodId: v.paymentMethod ? await findOrCreateListItem('payment_method', v.paymentMethod, tx) : null,
          exGstCents: v.exGstCents,
          gstCents: v.gstCents,
          incGstCents: v.incGstCents,
          businessUsePct: v.businessUsePct,
          importBatchId: batchId,
        })
        .returning();
      await auditEvent(tx, 'expense', row!.id, 'create', { ...row, source: 'csv-import' });
    }
  });
  const after = await counts();
  return {
    batchId,
    imported: toImport.length,
    skippedDuplicates: preview.counts.duplicate - (options.includeDuplicates ? preview.counts.duplicate : 0),
    skippedErrors: preview.counts.error,
    newCategories: after.category - before.category,
    newTypes: after.type - before.type,
    newPaymentMethods: after.payment - before.payment,
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

export async function listPayouts(range: { from: string; to: string }) {
  return db
    .select()
    .from(payout)
    .where(and(isNull(payout.deletedAt), gte(payout.receivedDate, range.from), lte(payout.receivedDate, range.to)))
    .orderBy(desc(payout.receivedDate));
}

export async function createPayout(input: PayoutInput & { id?: string }) {
  await assertAccount(input.accountId);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(payout)
      .values({ ...input, id: input.id ?? newId(), notes: clean(input.notes) })
      .returning();
    await auditEvent(tx, 'payout', row!.id, 'create', row);
    return row!;
  });
}

export async function updatePayout(id: string, patch: Partial<PayoutInput>, reason: string | null) {
  const [before] = await db.select().from(payout).where(eq(payout.id, id));
  if (!before || before.deletedAt) throw new AppError(404, 'Payout not found');
  await assertAccount(patch.accountId);
  const changes = { ...patch, ...(patch.notes !== undefined ? { notes: clean(patch.notes) } : {}) };
  return db.transaction(async (tx) => {
    const [row] = await tx.update(payout).set({ ...changes, updatedAt: nowIso() }).where(eq(payout.id, id)).returning();
    await auditUpdate(tx, 'payout', id, before, changes, reason ?? undefined);
    return row!;
  });
}

export async function deletePayout(id: string) {
  const [row] = await db.select().from(payout).where(eq(payout.id, id));
  if (!row || row.deletedAt) throw new AppError(404, 'Payout not found');
  await db.transaction(async (tx) => {
    await tx.update(payout).set({ deletedAt: nowIso() }).where(eq(payout.id, id));
    await auditEvent(tx, 'payout', id, 'delete', row);
  });
}

// ---------- Financial-year summary ----------

export async function financialYearSummary(startYear: number) {
  const fy = financialYear(startYear);
  const { gstRegistered } = getSettings();
  const expenses = await listExpenses({ from: fy.start, to: fy.end });
  const payouts = await listPayouts({ from: fy.start, to: fy.end });
  const categoryNames = new Map((await listItems('expense_category')).map((c) => [c.id, c.name]));

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
