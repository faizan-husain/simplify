import { describe, it, expect } from 'vitest';
import { formatINR, formatDecimal, computeLineAmount, computeBillTotals } from '../money';

describe('formatINR', () => {
  it('formats whole numbers without .00 with Indian grouping', () => {
    expect(formatINR(0)).toBe('₹0');
    expect(formatINR(100)).toBe('₹100');
    expect(formatINR(1000)).toBe('₹1,000');
    expect(formatINR(123456)).toBe('₹1,23,456');
    expect(formatINR(10000000)).toBe('₹1,00,00,000');
  });

  it('formats fractional numbers with paise', () => {
    expect(formatINR(1234.5)).toBe('₹1,234.50');
    expect(formatINR(1234.56)).toBe('₹1,234.56');
    expect(formatINR('99.99')).toBe('₹99.99');
  });

  it('handles negative amounts and null/undefined', () => {
    expect(formatINR(-500)).toBe('-₹500');
    expect(formatINR(null)).toBe('₹0');
    expect(formatINR(undefined)).toBe('₹0');
    expect(formatINR('')).toBe('₹0');
  });
});

describe('formatDecimal', () => {
  it('formats decimals cleanly', () => {
    expect(formatDecimal(100)).toBe('100');
    expect(formatDecimal('100.50')).toBe('100.5');
    expect(formatDecimal('100.55')).toBe('100.55');
  });
});

describe('computeLineAmount & computeBillTotals', () => {
  it('computes quantity * rate with half-up rounding', () => {
    expect(computeLineAmount(2, 50).toString()).toBe('100');
    expect(computeLineAmount(3, 33.33).toString()).toBe('99.99');
  });

  it('computes bill totals with flat discount', () => {
    const items = [
      { quantity: 2, rate: 100 },
      { quantity: 1, rate: 50 },
    ];
    const totals = computeBillTotals(items, 'FLAT', 30, 200);
    expect(totals.subtotal.toString()).toBe('250');
    expect(totals.discountAmount.toString()).toBe('30');
    expect(totals.total.toString()).toBe('220');
    expect(totals.paid.toString()).toBe('200');
    expect(totals.balance.toString()).toBe('20');
  });

  it('computes bill totals with percentage discount', () => {
    const items = [
      { quantity: 1, rate: 1000 },
    ];
    const totals = computeBillTotals(items, 'PERCENT', 10, 500);
    expect(totals.subtotal.toString()).toBe('1000');
    expect(totals.discountAmount.toString()).toBe('100');
    expect(totals.total.toString()).toBe('900');
    expect(totals.paid.toString()).toBe('500');
    expect(totals.balance.toString()).toBe('400');
  });
});
