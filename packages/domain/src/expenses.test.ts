import { describe, expect, it } from 'vitest';
import {
  claimable,
  nextOccurrence,
  parseExpenseRow,
  parseFlexibleDate,
  parseImportMoney,
  recurrenceDates,
  suggestExpenseMapping,
} from './expenses';

describe('claimable', () => {
  const e = { exGstCents: 10000, gstCents: 1000, businessUsePct: 50 };
  it('claims inc GST when not registered for GST', () => {
    expect(claimable(e, false)).toEqual({ deductibleCents: 5500, gstCreditCents: 0 });
  });
  it('claims ex GST plus a GST credit when registered', () => {
    expect(claimable(e, true)).toEqual({ deductibleCents: 5000, gstCreditCents: 500 });
  });
});

describe('recurrence', () => {
  it('steps monthly from the anchor, clamping month ends', () => {
    expect(recurrenceDates({ frequency: 'monthly', interval: 1, startDate: '2026-01-31' }, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });
  it('respects the window, interval and end date', () => {
    const r = { frequency: 'weekly' as const, interval: 2, startDate: '2026-09-01', endDate: '2026-10-10' };
    expect(recurrenceDates(r, '2026-09-10', '2026-12-31')).toEqual(['2026-09-15', '2026-09-29']);
    expect(nextOccurrence(r, '2026-09-30')).toBeNull();
  });
  it('handles quarterly and yearly', () => {
    expect(recurrenceDates({ frequency: 'quarterly', interval: 1, startDate: '2026-07-15' }, '2026-07-01', '2027-06-30')).toHaveLength(4);
    expect(nextOccurrence({ frequency: 'yearly', interval: 1, startDate: '2025-08-01' }, '2026-07-01')).toBe('2026-08-01');
  });
});

describe('import parsing', () => {
  it('reads Notion, Australian and ISO dates', () => {
    expect(parseFlexibleDate('September 3, 2026')).toBe('2026-09-03');
    expect(parseFlexibleDate('September 3, 2026 10:00 AM')).toBe('2026-09-03');
    expect(parseFlexibleDate('Sep 3, 2026')).toBe('2026-09-03');
    expect(parseFlexibleDate('03/09/2026')).toBe('2026-09-03');
    expect(parseFlexibleDate('3 September 2026')).toBe('2026-09-03');
    expect(parseFlexibleDate('2026-09-03')).toBe('2026-09-03');
    expect(parseFlexibleDate('September 3, 2026 → September 4, 2026')).toBe('2026-09-03');
    expect(parseFlexibleDate('soon')).toBeNull();
  });

  it('reads money formats', () => {
    expect(parseImportMoney('$59.95')).toBe(5995);
    expect(parseImportMoney('A$1,200.00')).toBe(120000);
    expect(parseImportMoney('59.95 AUD')).toBe(5995);
    expect(parseImportMoney('(12.50)')).toBe(-1250);
    expect(parseImportMoney('')).toBeNull();
    expect(parseImportMoney('n/a')).toBeNull();
  });

  const notionHeaders = ['Name', 'Amount ex GST', 'Amount inc GST', 'Category', 'Date', 'Description', 'GST', 'Payment Method', 'Type', 'Vendor'];

  it('maps the Notion export columns automatically', () => {
    expect(suggestExpenseMapping(notionHeaders)).toEqual({
      name: 'Name',
      vendor: 'Vendor',
      date: 'Date',
      description: 'Description',
      category: 'Category',
      type: 'Type',
      paymentMethod: 'Payment Method',
      exGst: 'Amount ex GST',
      gst: 'GST',
      incGst: 'Amount inc GST',
    });
  });

  it('parses a Notion row and recalculates inc GST', () => {
    const mapping = suggestExpenseMapping(notionHeaders);
    const row = {
      Name: 'TradingView — Premium subscription',
      'Amount ex GST': '$59.95',
      'Amount inc GST': '59.95',
      Category: 'Market Data / Feeds',
      Date: 'September 3, 2026',
      Description: 'Premium plan monthly subscription',
      GST: '$0.00',
      'Payment Method': 'Credit Card',
      Type: 'Digital',
      Vendor: 'TradingView',
    };
    const result = parseExpenseRow(row, mapping);
    expect(result).toEqual({
      ok: true,
      warnings: [],
      value: {
        name: 'TradingView — Premium subscription',
        vendor: 'TradingView',
        date: '2026-09-03',
        description: 'Premium plan monthly subscription',
        category: 'Market Data / Feeds',
        type: 'Digital',
        paymentMethod: 'Credit Card',
        exGstCents: 5995,
        gstCents: 0,
        incGstCents: 5995,
        businessUsePct: 100,
      },
    });
  });

  it('warns when the file inc GST disagrees, and errors on bad rows', () => {
    const mapping = suggestExpenseMapping(notionHeaders);
    const mismatch = parseExpenseRow({ Name: 'X', Date: '2026-09-01', 'Amount ex GST': '100', GST: '10', 'Amount inc GST': '100' }, mapping);
    expect(mismatch.ok && mismatch.value.incGstCents).toBe(11000);
    expect(mismatch.warnings[0]).toMatch(/differs/);
    const bad = parseExpenseRow({ Name: '', Date: 'whenever', 'Amount ex GST': 'abc' }, mapping);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.errors).toHaveLength(3);
  });
});
