import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

let svc: typeof import('./expenses');
let ctx: typeof import('./context');
let lists: typeof import('./lists');
let settings: typeof import('./settings');

beforeAll(async () => {
  process.env.TC_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'tc-expenses-'));
  ctx = await import('./context');
  svc = await import('./expenses');
  lists = await import('./lists');
  settings = await import('./settings');
});

beforeEach(() => {
  ctx.sqlite.exec(`DELETE FROM expense; DELETE FROM recurring_expense; DELETE FROM payout; DELETE FROM audit_log; DELETE FROM list_item WHERE kind = 'expense_category';`);
  settings.updateSettings({ gstRegistered: false });
});

// Shape of a Notion database export, including Notion's trailing empty row with a 0 formula.
const notionCsv = [
  '﻿Name,Amount ex GST,Amount inc GST,Category,Date,Description,GST,Payment Method,Type,Vendor',
  'TradingView — Premium subscription,$59.95,59.95,Market Data / Feeds,"September 3, 2026",Premium plan monthly subscription,$0.00,Credit Card,Digital,TradingView',
  'Lucid evaluation 50K,$90.91,100,Prop Firm Fees,"August 12, 2026",Eval reset,$9.09,Credit Card,Digital,Lucid Trading',
  'Desk lamp,$45.00,49.50,Office,"July 20, 2026",,$4.50,Debit Card,Physical,Officeworks',
  ',,0,,,,,,,',
].join('\n');

describe('CSV import', () => {
  it('previews a Notion export with auto mapping and skips the blank row', () => {
    const p = svc.previewImport(notionCsv);
    expect(p.counts).toEqual({ ok: 3, duplicate: 0, error: 0, blank: 1 });
    expect(p.mapping.exGst).toBe('Amount ex GST');
  });

  it('imports, creates categories from the file and recalculates inc GST', () => {
    const p = svc.previewImport(notionCsv);
    const result = svc.commitImport(notionCsv, p.mapping);
    expect(result).toMatchObject({ imported: 3, skippedDuplicates: 0, skippedErrors: 0, newCategories: 3 });
    expect(lists.listItems('expense_category').map((c) => c.name).sort()).toEqual(['Market Data / Feeds', 'Office', 'Prop Firm Fees']);
    const rows = svc.listExpenses({ from: '2026-07-01', to: '2027-06-30' });
    expect(rows.find((r) => r.name === 'Lucid evaluation 50K')).toMatchObject({ exGstCents: 9091, gstCents: 909, incGstCents: 10000, date: '2026-08-12' });
    // Existing payment methods and types are matched case-insensitively, not duplicated.
    expect(lists.listItems('payment_method').filter((m) => m.name === 'Credit Card')).toHaveLength(1);
  });

  it('flags duplicates on a second import and skips them', () => {
    const p = svc.previewImport(notionCsv);
    svc.commitImport(notionCsv, p.mapping);
    expect(svc.previewImport(notionCsv).counts.duplicate).toBe(3);
    expect(svc.commitImport(notionCsv, p.mapping).imported).toBe(0);
  });

  it('reports row errors without importing them', () => {
    const csv = 'Name,Date,Amount ex GST\nGood,2026-09-01,10\nBad,someday,abc';
    const p = svc.previewImport(csv);
    expect(p.counts).toMatchObject({ ok: 1, error: 1 });
    expect(svc.commitImport(csv, p.mapping)).toMatchObject({ imported: 1, skippedErrors: 1 });
  });
});

describe('expenses', () => {
  it('derives inc GST and audits edits', () => {
    const e = svc.createExpense({ name: 'Data feed', date: '2026-09-01', exGstCents: 10000, gstCents: 1000 });
    expect(e.incGstCents).toBe(11000);
    const updated = svc.updateExpense(e.id, { gstCents: 0, businessUsePct: 50 }, 'No GST on invoice');
    expect(updated.incGstCents).toBe(10000);
    const fields = svc.entityHistory('expense', e.id).filter((h) => h.action === 'update').map((h) => h.field);
    expect(fields).toEqual(expect.arrayContaining(['gstCents', 'businessUsePct', 'incGstCents']));
  });

  it('rejects ids from the wrong list', () => {
    expect(() => svc.createExpense({ name: 'X', date: '2026-09-01', exGstCents: 1, gstCents: 0, categoryId: 'li_pm_credit_card' })).toThrow(/Unknown/);
  });
});

describe('recurring expenses', () => {
  it('generates occurrences up to today, idempotently, without resurrecting deleted ones', () => {
    svc.createRecurring({ name: 'TradingView', exGstCents: 5995, gstCents: 0, frequency: 'monthly', interval: 1, startDate: '2026-07-03' });
    expect(svc.generateRecurringExpenses('2026-09-30')).toBe(3);
    expect(svc.generateRecurringExpenses('2026-09-30')).toBe(0);
    const aug = svc.listExpenses({ from: '2026-08-01', to: '2026-08-31' })[0]!;
    svc.deleteExpense(aug.id);
    expect(svc.generateRecurringExpenses('2026-10-05')).toBe(1); // only October's
    expect(svc.listExpenses({ from: '2026-07-01', to: '2026-10-31' }).map((e) => e.date)).toEqual(['2026-10-03', '2026-09-03', '2026-07-03']);
  });

  it('skips dates already covered by an imported or manual expense', () => {
    svc.createExpense({ name: 'TradingView', date: '2026-08-03', exGstCents: 5995, gstCents: 0 });
    svc.createRecurring({ name: 'TradingView', exGstCents: 5995, gstCents: 0, frequency: 'monthly', interval: 1, startDate: '2026-07-03' });
    expect(svc.generateRecurringExpenses('2026-09-30')).toBe(2);
    expect(svc.listExpenses({ from: '2026-07-01', to: '2026-09-30' }).map((e) => [e.date, !!e.recurringId])).toEqual([
      ['2026-09-03', true],
      ['2026-08-03', false],
      ['2026-07-03', true],
    ]);
  });

  it('shows the next date and stops when paused', () => {
    const r = svc.createRecurring({ name: 'Rithmic', exGstCents: 2500, gstCents: 0, frequency: 'monthly', interval: 1, startDate: '2026-07-15' });
    expect(svc.listRecurring('2026-10-01')[0]!.nextDate).toBe('2026-10-15');
    svc.updateRecurring(r.id, { active: false });
    expect(svc.generateRecurringExpenses('2026-12-31')).toBe(0);
  });
});

describe('financial-year summary', () => {
  it('totals by category with claimable amounts and payouts', () => {
    const office = lists.findOrCreateListItem('expense_category', 'Office');
    svc.createExpense({ name: 'Lamp', date: '2026-07-20', exGstCents: 4500, gstCents: 450, businessUsePct: 50, categoryId: office });
    svc.createExpense({ name: 'Feed', date: '2026-08-01', exGstCents: 10000, gstCents: 0 });
    svc.createExpense({ name: 'Last FY', date: '2026-06-30', exGstCents: 99900, gstCents: 0 });
    svc.createPayout({ receivedDate: '2026-09-10', audReceivedCents: 150000, grossUsdCents: 100000 });

    const s = svc.financialYearSummary(2026);
    expect(s.expenses.total).toMatchObject({ count: 2, incGstCents: 14950, deductibleCents: 2475 + 10000, gstCreditCents: 0 });
    expect(s.expenses.byCategory.map((c) => c.name)).toEqual(['Uncategorised', 'Office']);
    expect(s.payouts).toEqual({ count: 1, audReceivedCents: 150000, grossUsdCents: 100000 });

    settings.updateSettings({ gstRegistered: true });
    expect(svc.financialYearSummary(2026).expenses.total).toMatchObject({ deductibleCents: 2250 + 10000, gstCreditCents: 225 });
  });
});
