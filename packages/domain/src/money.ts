/** Money is stored as integer cents alongside a currency code. */
export type Cents = number;
export type Currency = 'AUD' | 'USD';

/** Parse a user-entered amount like "1,234.5" or "$12" into cents. */
export function parseMoney(input: string): Cents {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^-?\d*(\.\d{0,2})?$/.test(cleaned) || cleaned === '' || cleaned === '-') {
    throw new Error(`Invalid amount "${input}"`);
  }
  const negative = cleaned.startsWith('-');
  const [whole = '0', frac = ''] = cleaned.replace('-', '').split('.');
  const cents = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0'));
  return negative ? -cents : cents;
}

const audFormat = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', currencyDisplay: 'narrowSymbol' });

/** "$1,234.50" for AUD; "US$1,234.50" for USD so the two are never confused. */
export function formatMoney(cents: Cents, currency: Currency = 'AUD'): string {
  const formatted = audFormat.format(cents / 100);
  return currency === 'USD' ? formatted.replace('$', 'US$') : formatted;
}

/** Inc-GST is always derived from ex-GST + entered GST (GST is not assumed to be 10%). */
export const incGst = (exGst: Cents, gst: Cents): Cents => exGst + gst;

/** Business-use portion of an amount, rounded half away from zero to the cent. */
export function businessPortion(amount: Cents, businessUsePct: number): Cents {
  if (businessUsePct < 0 || businessUsePct > 100) throw new Error('Business-use % must be between 0 and 100');
  const raw = (amount * businessUsePct) / 100;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}
