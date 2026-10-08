import { beforeEach, describe, expect, it } from 'vitest';
import * as svc from './expenses';
import * as lists from './lists';
import * as settings from './settings';
import { asUser, useTestDb } from './testing';

useTestDb();
beforeEach(() => asUser(() => settings.updateSettings({ gstRegistered: false })));

// Shape of a Notion database export, including Notion's trailing empty row with a 0 formula.
const notionCsv = [
  '﻿Name,Amount ex GST,Amount inc GST,Category,Date,Description,GST,Payment Method,Type,Vendor',
  'TradingView — Premium subscription,$59.95,59.95,Market Data / Feeds,"September 3, 2026",Premium plan monthly subscription,$0.00,Credit Card,Digital,TradingView',
  'Lucid evaluation 50K,$90.91,100,Prop Firm Fees,"August 12, 2026",Eval reset,$9.09,Credit Card,Digital,Lucid Trading',
  'Desk lamp,$45.00,49.50,Office,"July 20, 2026",,$4.50,Debit Card,Physical,Officeworks',
  ',,0,,,,,,,',
].join('\n');

describe('CSV import', () => {
  it('previews a Notion export with auto mapping and skips the blank row', () =>
    asUser(async () => {
      const p = await svc.previewImport(notionCsv);
      expect(p.counts).toEqual({ ok: 3, duplicate: 0, error: 0, blank: 1 });
      expect(p.mapping.exGst).toBe('Amount ex GST');
    }));

  it('imports, creates categories from the file and recalculates inc GST', () =>
    asUser(async () => {
      const p = await svc.previewImport(notionCsv);
      const result = await svc.commitImport(notionCsv, p.mapping);
      expect(result).toMatchObject({ imported: 3, skippedDuplicates: 0, skippedErrors: 0, newCategories: 3 });
      expect((await lists.listItems('expense_category')).map((c) => c.name).sort()).toEqual(['Market Data / Feeds', 'Office', 'Prop Firm Fees']);
      const rows = await svc.listExpenses({ from: '2026-07-01', to: '2027-06-30' });
      expect(rows.find((r) => r.name === 'Lucid evaluation 50K')).toMatchObject({ exGstCents: 9091, gstCents: 909, incGstCents: 10000, date: '2026-08-12' });
      // Existing payment methods and types are matched case-insensitively, not duplicated.
      expect((await lists.listItems('payment_method')).filter((m) => m.name === 'Credit Card')).toHaveLength(1);
    }));

  it('flags duplicates on a second import and skips them', () =>
    asUser(async () => {
      const p = await svc.previewImport(notionCsv);
      await svc.commitImport(notionCsv, p.mapping);
      expect((await svc.previewImport(notionCsv)).counts.duplicate).toBe(3);
      expect((await svc.commitImport(notionCsv, p.mapping)).imported).toBe(0);
    }));

  it('reports row errors without importing them', () =>
    asUser(async () => {
      const csv = 'Name,Date,Amount ex GST\nGood,2026-09-01,10\nBad,someday,abc';
      const p = await svc.previewImport(csv);
      expect(p.counts).toMatchObject({ ok: 1, error: 1 });
      expect(await svc.commitImport(csv, p.mapping)).toMatchObject({ imported: 1, skippedErrors: 1 });
    }));
});

describe('expenses', () => {
  it('derives inc GST and audits edits', () =>
    asUser(async () => {
      const e = await svc.createExpense({ name: 'Data feed', date: '2026-09-01', exGstCents: 10000, gstCents: 1000 });
      expect(e.incGstCents).toBe(11000);
      const updated = await svc.updateExpense(e.id, { gstCents: 0, businessUsePct: 50 }, 'No GST on invoice');
      expect(updated.incGstCents).toBe(10000);
      const fields = (await svc.entityHistory('expense', e.id)).filter((h) => h.action === 'update').map((h) => h.field);
      expect(fields).toEqual(expect.arrayContaining(['gstCents', 'businessUsePct', 'incGstCents']));
    }));

  it('rejects ids from the wrong list', () =>
    asUser(async () => {
      await expect(svc.createExpense({ name: 'X', date: '2026-09-01', exGstCents: 1, gstCents: 0, categoryId: 'li_pm_credit_card' })).rejects.toThrow(/Unknown/);
    }));
});

describe('recurring expenses', () => {
  it('generates occurrences up to today, idempotently, without resurrecting deleted ones', () =>
    asUser(async () => {
      await svc.createRecurring({ name: 'TradingView', exGstCents: 5995, gstCents: 0, frequency: 'monthly', interval: 1, startDate: '2026-07-03' });
      expect(await svc.generateRecurringExpenses('2026-09-30')).toBe(3);
      expect(await svc.generateRecurringExpenses('2026-09-30')).toBe(0);
      const aug = (await svc.listExpenses({ from: '2026-08-01', to: '2026-08-31' }))[0]!;
      await svc.deleteExpense(aug.id);
      expect(await svc.generateRecurringExpenses('2026-10-05')).toBe(1); // only October's
      expect((await svc.listExpenses({ from: '2026-07-01', to: '2026-10-31' })).map((e) => e.date)).toEqual(['2026-10-03', '2026-09-03', '2026-07-03']);
    }));

  it('skips dates already covered by an imported or manual expense', () =>
    asUser(async () => {
      await svc.createExpense({ name: 'TradingView', date: '2026-08-03', exGstCents: 5995, gstCents: 0 });
      await svc.createRecurring({ name: 'TradingView', exGstCents: 5995, gstCents: 0, frequency: 'monthly', interval: 1, startDate: '2026-07-03' });
      expect(await svc.generateRecurringExpenses('2026-09-30')).toBe(2);
      expect((await svc.listExpenses({ from: '2026-07-01', to: '2026-09-30' })).map((e) => [e.date, !!e.recurringId])).toEqual([
        ['2026-09-03', true],
        ['2026-08-03', false],
        ['2026-07-03', true],
      ]);
    }));

  it('shows the next date and stops when paused', () =>
    asUser(async () => {
      const r = await svc.createRecurring({ name: 'Rithmic', exGstCents: 2500, gstCents: 0, frequency: 'monthly', interval: 1, startDate: '2026-07-15' });
      expect((await svc.listRecurring('2026-10-01'))[0]!.nextDate).toBe('2026-10-15');
      await svc.updateRecurring(r.id, { active: false });
      expect(await svc.generateRecurringExpenses('2026-12-31')).toBe(0);
    }));
});

describe('financial-year summary', () => {
  it('totals by category with claimable amounts and payouts', () =>
    asUser(async () => {
      const office = await lists.findOrCreateListItem('expense_category', 'Office');
      await svc.createExpense({ name: 'Lamp', date: '2026-07-20', exGstCents: 4500, gstCents: 450, businessUsePct: 50, categoryId: office });
      await svc.createExpense({ name: 'Feed', date: '2026-08-01', exGstCents: 10000, gstCents: 0 });
      await svc.createExpense({ name: 'Last FY', date: '2026-06-30', exGstCents: 99900, gstCents: 0 });
      await svc.createPayout({ receivedDate: '2026-09-10', audReceivedCents: 150000, grossUsdCents: 100000 });

      const s = await svc.financialYearSummary(2026);
      expect(s.expenses.total).toMatchObject({ count: 2, incGstCents: 14950, deductibleCents: 2475 + 10000, gstCreditCents: 0 });
      expect(s.expenses.byCategory.map((c) => c.name)).toEqual(['Uncategorised', 'Office']);
      expect(s.payouts).toEqual({ count: 1, audReceivedCents: 150000, grossUsdCents: 100000 });

      await settings.updateSettings({ gstRegistered: true });
      expect((await svc.financialYearSummary(2026)).expenses.total).toMatchObject({ deductibleCents: 2250 + 10000, gstCreditCents: 225 });
    }));
});

describe('expenseFinancialYears', () => {
  it('lists years with expenses or payouts, newest first, always including the current one', () =>
    asUser(async () => {
      expect(await svc.expenseFinancialYears(2026)).toEqual([2026]);
      await svc.createExpense({ name: 'Old course', date: '2025-06-30', exGstCents: 10000, gstCents: 0 }); // FY 2024–25
      await svc.createPayout({ receivedDate: '2025-07-01', audReceivedCents: 150000 }); // FY 2025–26
      expect(await svc.expenseFinancialYears(2026)).toEqual([2026, 2025, 2024]);
    }));
});

describe('renewal reminders', () => {
  it('flags renewals within 7 days, once per renewal date, and skips weekly items', () =>
    asUser(async () => {
      await svc.createRecurring({ name: 'TradingView', exGstCents: 5995, gstCents: 0, frequency: 'monthly', interval: 1, startDate: '2026-07-12' });
      await svc.createRecurring({ name: 'Yearly journal', exGstCents: 20000, gstCents: 2000, frequency: 'yearly', interval: 1, startDate: '2026-10-30' });
      await svc.createRecurring({ name: 'Weekly data', exGstCents: 1000, gstCents: 0, frequency: 'weekly', interval: 1, startDate: '2026-07-01' });

      // 12 Oct is 8 days after 4 Oct: not yet.
      expect(await svc.renewalsToNotify('2026-10-04')).toEqual([]);
      // 5 Oct: TradingView renews in 7 days. The yearly one (30 Oct) and the weekly one stay quiet.
      const due = await svc.renewalsToNotify('2026-10-05');
      expect(due.map((r) => [r.name, r.nextDate, r.incGstCents])).toEqual([['TradingView', '2026-10-12', 5995]]);

      await svc.markRenewalNotified(due[0]!);
      expect(await svc.renewalsToNotify('2026-10-06')).toEqual([]);
      // The next month's renewal gets its own reminder.
      expect((await svc.renewalsToNotify('2026-11-05')).map((r) => r.nextDate)).toEqual(['2026-11-12']);
    }));
});
