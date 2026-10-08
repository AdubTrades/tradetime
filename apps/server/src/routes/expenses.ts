import { Hono } from 'hono';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { claimable, expenseImportFields, financialYear, financialYearOf, localDate } from '@tc/domain';
import { listAccounts } from '../accounts';
import { toCsv } from '../csv';
import { body, cents, fyParam, isoDate } from '../http';
import { listItems } from '../lists';
import { getSettings } from '../settings';
import {
  expenseFinancialYears,
  commitImport,
  createExpense,
  createPayout,
  createRecurring,
  deleteExpense,
  deletePayout,
  deleteRecurring,
  entityHistory,
  financialYearSummary,
  generateRecurringExpenses,
  listExpenses,
  listPayouts,
  listRecurring,
  previewImport,
  restoreExpense,
  updateExpense,
  updatePayout,
  updateRecurring,
} from '../expenses';

const ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Invalid id');
const optionalRef = z.string().min(1).nullable().optional();

const expenseFields = {
  name: z.string().trim().min(1).max(200),
  vendor: z.string().max(200).nullable().optional(),
  date: isoDate,
  description: z.string().max(2000).nullable().optional(),
  categoryId: optionalRef,
  typeId: optionalRef,
  paymentMethodId: optionalRef,
  accountId: optionalRef,
  exGstCents: cents,
  gstCents: cents,
  businessUsePct: z.number().int().min(0).max(100).optional(),
};

const mappingSchema = z.partialRecord(z.enum(expenseImportFields), z.string());
const money = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));

const rangeQuery = (q: { from?: string; to?: string; fy?: string }) => {
  if (q.from && q.to) return { from: isoDate.parse(q.from), to: isoDate.parse(q.to) };
  const fy = financialYear(fyParam(q.fy));
  return { from: fy.start, to: fy.end };
};

export const expenseRoutes = new Hono()
  .get('/', async (c) => c.json(await listExpenses(rangeQuery(c.req.query()))))
  .get('/years', async (c) => c.json(await expenseFinancialYears(financialYearOf(today()).startYear)))
  .post('/', async (c) => c.json(await createExpense(await body(c.req, z.object({ id: ulid.optional(), ...expenseFields }))), 201))
  .patch('/:id', async (c) => {
    const { reason, ...patch } = await body(c.req, z.object({ ...expenseFields, reason: z.string().max(500).nullable() }).partial().strict());
    return c.json(await updateExpense(c.req.param('id'), patch, reason ?? null));
  })
  .delete('/:id', async (c) => {
    await deleteExpense(c.req.param('id'));
    return c.body(null, 204);
  })
  .post('/:id/restore', async (c) => {
    await restoreExpense(c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/:id/history', async (c) => c.json(await entityHistory('expense', c.req.param('id'))))
  .get('/summary', async (c) => c.json(await financialYearSummary(fyParam(c.req.query('fy')))))
  .post('/import/preview', async (c) => {
    const { csv, mapping } = await body(c.req, z.object({ csv: z.string().min(1), mapping: mappingSchema.optional() }));
    return c.json(await previewImport(csv, mapping));
  })
  .post('/import', async (c) => {
    const { csv, mapping, includeDuplicates } = await body(c.req, z.object({ csv: z.string().min(1), mapping: mappingSchema, includeDuplicates: z.boolean().optional() }));
    return c.json(await commitImport(csv, mapping, { includeDuplicates }), 201);
  })
  .get('/export.csv', async (c) => {
    const startYear = fyParam(c.req.query('fy'));
    const fy = financialYear(startYear);
    const { gstRegistered } = getSettings();
    const names = new Map(
      [...(await listItems('expense_category')), ...(await listItems('expense_type')), ...(await listItems('payment_method'))].map((i) => [i.id, i.name]),
    );
    const accounts = new Map((await listAccounts()).map((a) => [a.id, a.name]));
    const rows = (await listExpenses({ from: fy.start, to: fy.end }))
      .reverse()
      .map((e) => {
        const cl = claimable(e, gstRegistered);
        return [
          e.date,
          e.name,
          e.vendor,
          e.description,
          e.categoryId ? names.get(e.categoryId) : '',
          e.typeId ? names.get(e.typeId) : '',
          e.paymentMethodId ? names.get(e.paymentMethodId) : '',
          e.accountId ? accounts.get(e.accountId) : '',
          money(e.exGstCents),
          money(e.gstCents),
          money(e.incGstCents),
          e.businessUsePct,
          money(cl.deductibleCents),
          ...(gstRegistered ? [money(cl.gstCreditCents)] : []),
          e.recurringId ? 'Recurring' : e.importBatchId ? 'Imported' : 'Manual',
        ];
      });
    const header = [
      'Date',
      'Name',
      'Vendor',
      'Description',
      'Category',
      'Type',
      'Payment method',
      'Account',
      'Amount ex GST',
      'GST',
      'Amount inc GST',
      'Business use %',
      'Claimable',
      ...(gstRegistered ? ['GST credit'] : []),
      'Source',
    ];
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="expenses-FY${fy.label.replace('–', '-')}.csv"`);
    return c.body(toCsv(header, rows));
  });

const recurringFields = {
  name: z.string().trim().min(1).max(200),
  vendor: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  categoryId: optionalRef,
  typeId: optionalRef,
  paymentMethodId: optionalRef,
  accountId: optionalRef,
  exGstCents: cents,
  gstCents: cents,
  businessUsePct: z.number().int().min(0).max(100).optional(),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']),
  interval: z.number().int().min(1).max(52).optional(),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
  active: z.boolean().optional(),
};

const today = () => localDate(new Date());

export const recurringRoutes = new Hono()
  .get('/', async (c) => c.json(await listRecurring(today())))
  .post('/', async (c) => {
    const row = await createRecurring(await body(c.req, z.object(recurringFields)));
    const generated = await generateRecurringExpenses(today());
    return c.json({ ...row, generated }, 201);
  })
  .patch('/:id', async (c) => {
    const row = await updateRecurring(c.req.param('id'), await body(c.req, z.object(recurringFields).partial().strict()));
    const generated = await generateRecurringExpenses(today());
    return c.json({ ...row, generated });
  })
  .delete('/:id', async (c) => {
    await deleteRecurring(c.req.param('id'));
    return c.body(null, 204);
  });

const payoutFields = {
  accountId: optionalRef,
  requestedDate: isoDate.nullable().optional(),
  receivedDate: isoDate,
  grossUsdCents: cents.nullable().optional(),
  audReceivedCents: cents.positive(),
  notes: z.string().max(2000).nullable().optional(),
};

export const payoutRoutes = new Hono()
  .get('/', async (c) => c.json(await listPayouts(rangeQuery(c.req.query()))))
  .post('/', async (c) => c.json(await createPayout(await body(c.req, z.object({ id: ulid.optional(), ...payoutFields }))), 201))
  .patch('/:id', async (c) => {
    const { reason, ...patch } = await body(c.req, z.object({ ...payoutFields, reason: z.string().max(500).nullable() }).partial().strict());
    return c.json(await updatePayout(c.req.param('id'), patch, reason ?? null));
  })
  .delete('/:id', async (c) => {
    await deletePayout(c.req.param('id'));
    return c.body(null, 204);
  })
  .get('/:id/history', async (c) => c.json(await entityHistory('payout', c.req.param('id'))))
  .get('/export.csv', async (c) => {
    const fy = financialYear(fyParam(c.req.query('fy')));
    const accounts = new Map((await listAccounts()).map((a) => [a.id, a.name]));
    const list = (await listPayouts({ from: fy.start, to: fy.end })).reverse();
    const rows = list.map((p) => [
      p.receivedDate,
      p.requestedDate ? DateTime.fromISO(p.requestedDate).toISODate() : '',
      p.accountId ? accounts.get(p.accountId) : '',
      money(p.grossUsdCents),
      money(p.audReceivedCents),
      p.notes,
    ]);
    rows.push([], ['Total', '', '', money(list.reduce((s, p) => s + (p.grossUsdCents ?? 0), 0)), money(list.reduce((s, p) => s + p.audReceivedCents, 0))]);
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="payouts-FY${fy.label.replace('–', '-')}.csv"`);
    return c.body(toCsv(['Received', 'Requested', 'Account', 'Gross (USD)', 'Received (AUD)', 'Notes'], rows));
  });
