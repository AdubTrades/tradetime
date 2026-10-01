import { DateTime } from 'luxon';
import { businessPortion, incGst, parseMoney, type Cents } from './money';
import type { IsoDate } from './time';

export interface ExpenseAmounts {
  exGstCents: Cents;
  gstCents: Cents;
  businessUsePct: number;
}

/**
 * Claimable portion of an expense. If you're registered for GST you claim the GST back as a credit,
 * so the deduction is the ex-GST amount; otherwise the deduction is the full inc-GST amount.
 * Both are scaled by business-use %.
 */
export function claimable(e: ExpenseAmounts, gstRegistered: boolean): { deductibleCents: Cents; gstCreditCents: Cents } {
  if (gstRegistered) {
    return { deductibleCents: businessPortion(e.exGstCents, e.businessUsePct), gstCreditCents: businessPortion(e.gstCents, e.businessUsePct) };
  }
  return { deductibleCents: businessPortion(incGst(e.exGstCents, e.gstCents), e.businessUsePct), gstCreditCents: 0 };
}

// ---------- Recurrence ----------

export type Frequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export interface Recurrence {
  frequency: Frequency;
  interval: number;
  startDate: IsoDate;
  endDate?: IsoDate | null;
}

/** Occurrence n (0-based), stepping from the anchor each time so 31 Jan → 28 Feb → 31 Mar. */
function occurrence(r: Recurrence, n: number): IsoDate {
  const start = DateTime.fromISO(r.startDate);
  const step = n * r.interval;
  const dt =
    r.frequency === 'weekly'
      ? start.plus({ weeks: step })
      : r.frequency === 'monthly'
        ? start.plus({ months: step })
        : r.frequency === 'quarterly'
          ? start.plus({ months: step * 3 })
          : start.plus({ years: step });
  return dt.toISODate()!;
}

/** All occurrence dates in [from, to] (inclusive), respecting the template's own start and end. */
export function recurrenceDates(r: Recurrence, from: IsoDate, to: IsoDate): IsoDate[] {
  if (r.interval < 1) throw new Error('Interval must be at least 1');
  const last = r.endDate && r.endDate < to ? r.endDate : to;
  const dates: IsoDate[] = [];
  for (let n = 0; n < 10_000; n++) {
    const d = occurrence(r, n);
    if (d > last) break;
    if (d >= from) dates.push(d);
  }
  return dates;
}

/** Next occurrence on or after a date, or null if the series has ended. */
export function nextOccurrence(r: Recurrence, onOrAfter: IsoDate): IsoDate | null {
  for (let n = 0; n < 10_000; n++) {
    const d = occurrence(r, n);
    if (r.endDate && d > r.endDate) return null;
    if (d >= onOrAfter) return d;
  }
  return null;
}

// ---------- CSV import ----------

const dateFormats = [
  'yyyy-MM-dd',
  'd/M/yyyy',
  'd/M/yy',
  'd-M-yyyy',
  'LLLL d, yyyy',
  'LLL d, yyyy',
  'd LLLL yyyy',
  'd LLL yyyy',
  'ccc d LLL yyyy',
  'cccc, LLLL d, yyyy',
];

/**
 * Parse dates as exported by Notion, Excel or banks. Slash dates are read day-first (Australian).
 * A trailing time (e.g. "September 3, 2026 10:00 AM" or "→" ranges) is ignored.
 */
export function parseFlexibleDate(input: string): IsoDate | null {
  const raw = input.split('→')[0]!.trim();
  if (!raw) return null;
  const candidates = [raw, raw.replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*(AM|PM)?(\s*\(.*\))?$/i, ''), raw.replace(/T.*$/, '')];
  for (const c of candidates) {
    for (const f of dateFormats) {
      // en-AU abbreviates September as "Sept"; en-US accepts "Sep". Numeric formats are locale-independent.
      for (const locale of ['en-AU', 'en-US']) {
        const dt = DateTime.fromFormat(c, f, { locale });
        if (dt.isValid) return dt.toISODate();
      }
    }
  }
  return null;
}

/** Money as exported by spreadsheets: "$59.95", "A$1,200.00", "59.95 AUD", "(12.50)" for negatives. */
export function parseImportMoney(input: string): Cents | null {
  let s = input.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^(AUD|A\$|AU\$)\s*/i, '').replace(/\s*(AUD)$/i, '');
  try {
    const cents = parseMoney(s);
    return negative ? -cents : cents;
  } catch {
    return null;
  }
}

export const expenseImportFields = [
  'name',
  'vendor',
  'date',
  'description',
  'category',
  'type',
  'paymentMethod',
  'exGst',
  'gst',
  'incGst',
  'businessUsePct',
] as const;
export type ExpenseImportField = (typeof expenseImportFields)[number];
export type ExpenseImportMapping = Partial<Record<ExpenseImportField, string>>;

const headerHints: Record<ExpenseImportField, RegExp> = {
  name: /^(name|item|title|expense)$/i,
  vendor: /^(vendor|supplier|merchant|payee)$/i,
  date: /^(date|purchase date|transaction date)$/i,
  description: /^(description|details|notes?|memo)$/i,
  category: /^category$/i,
  type: /^type$/i,
  paymentMethod: /^(payment method|payment|paid with|method)$/i,
  exGst: /(ex\.?|excl\.?|excluding|before)\s*gst|^net( amount)?$/i,
  gst: /^gst( amount)?$|^tax$/i,
  incGst: /(inc\.?|incl\.?|including)\s*gst|^total$|^amount$/i,
  businessUsePct: /business.*(%|percent|use)/i,
};

/** Guess which CSV column feeds each field from the header names. */
export function suggestExpenseMapping(headers: string[]): ExpenseImportMapping {
  const mapping: ExpenseImportMapping = {};
  const used = new Set<string>();
  for (const field of expenseImportFields) {
    const header = headers.find((h) => !used.has(h) && headerHints[field].test(h.replace(/^﻿/, '').trim()));
    if (header) {
      mapping[field] = header;
      used.add(header);
    }
  }
  return mapping;
}

export interface ParsedExpenseRow {
  name: string;
  vendor: string | null;
  date: IsoDate;
  description: string | null;
  category: string | null;
  type: string | null;
  paymentMethod: string | null;
  exGstCents: Cents;
  gstCents: Cents;
  incGstCents: Cents;
  businessUsePct: number;
}

export type RowResult = { ok: true; value: ParsedExpenseRow; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };

/** Turn one CSV row into an expense. inc GST is always recalculated; the file's own inc value is only cross-checked. */
export function parseExpenseRow(row: Record<string, string>, mapping: ExpenseImportMapping): RowResult {
  const get = (f: ExpenseImportField) => (mapping[f] ? (row[mapping[f]!] ?? '').trim() : '');
  const errors: string[] = [];
  const warnings: string[] = [];

  const vendor = get('vendor') || null;
  const name = get('name') || vendor || '';
  if (!name) errors.push('Missing name');

  const date = parseFlexibleDate(get('date'));
  if (!date) errors.push(get('date') ? `Unrecognised date "${get('date')}"` : 'Missing date');

  const money = (f: ExpenseImportField) => {
    const raw = get(f);
    if (!raw) return null;
    const v = parseImportMoney(raw);
    if (v === null) errors.push(`Unrecognised amount "${raw}" in ${mapping[f]}`);
    return v;
  };
  let exGst = money('exGst');
  let gst = money('gst');
  const fileInc = money('incGst');

  if (gst === null) gst = 0;
  if (exGst === null && fileInc !== null) {
    exGst = fileInc - gst;
    warnings.push('ex GST calculated from inc GST − GST');
  }
  if (exGst === null && !errors.some((e) => e.includes('amount'))) errors.push('Missing amount ex GST');

  let businessUsePct = 100;
  const pctRaw = get('businessUsePct').replace('%', '');
  if (pctRaw) {
    const n = Number(pctRaw);
    if (Number.isFinite(n) && n >= 0 && n <= 100) businessUsePct = Math.round(n <= 1 && pctRaw.includes('.') ? n * 100 : n);
    else errors.push(`Business use % "${get('businessUsePct')}" must be 0–100`);
  }

  if (errors.length || exGst === null || !date) return { ok: false, errors, warnings };
  const inc = incGst(exGst, gst);
  if (fileInc !== null && fileInc !== 0 && fileInc !== inc) {
    warnings.push(`File's inc GST (${(fileInc / 100).toFixed(2)}) differs from ex + GST (${(inc / 100).toFixed(2)}); using ex + GST`);
  }
  return {
    ok: true,
    warnings,
    value: {
      name,
      vendor,
      date,
      description: get('description') || null,
      category: get('category') || null,
      type: get('type') || null,
      paymentMethod: get('paymentMethod') || null,
      exGstCents: exGst,
      gstCents: gst,
      incGstCents: inc,
      businessUsePct,
    },
  };
}
