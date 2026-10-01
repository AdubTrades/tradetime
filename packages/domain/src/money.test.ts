import { describe, expect, it } from 'vitest';
import { businessPortion, formatMoney, incGst, parseMoney } from './money';

describe('money', () => {
  it('parses user input into cents', () => {
    expect(parseMoney('1,234.5')).toBe(123450);
    expect(parseMoney('$12')).toBe(1200);
    expect(parseMoney('0.07')).toBe(7);
    expect(parseMoney('-3.10')).toBe(-310);
    expect(() => parseMoney('12.345')).toThrow();
    expect(() => parseMoney('abc')).toThrow();
  });

  it('derives inc-GST from entered GST, including zero GST', () => {
    expect(incGst(10000, 1000)).toBe(11000);
    expect(incGst(4999, 0)).toBe(4999);
  });

  it('calculates the business-use portion', () => {
    expect(businessPortion(11000, 100)).toBe(11000);
    expect(businessPortion(11000, 60)).toBe(6600);
    expect(businessPortion(333, 50)).toBe(167);
    expect(() => businessPortion(100, 120)).toThrow();
  });

  it('formats AUD and USD distinctly', () => {
    expect(formatMoney(123450)).toBe('$1,234.50');
    expect(formatMoney(-500, 'USD')).toBe('-US$5.00');
    expect(formatMoney(150000, 'USD')).toBe('US$1,500.00');
  });
});
