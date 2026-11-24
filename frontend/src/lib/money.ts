import Decimal from 'decimal.js';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

/**
 * Format an amount in INR with Indian grouping (e.g. ₹1,23,456).
 * Hides .00 when whole number. Allows paise when fractional.
 */
export function formatINR(val: number | string | Decimal | null | undefined): string {
  if (val === null || val === undefined || val === '') return '₹0';

  const d = new Decimal(String(val));
  const isNegative = d.isNegative();
  const abs = d.abs();

  // Split integer and fraction
  const fixed = abs.toFixed(2);
  const [intPart, decPart] = fixed.split('.');

  // Format integer part with Indian grouping (3 digits, then groups of 2)
  let lastThree = intPart.substring(intPart.length - 3);
  const otherNumbers = intPart.substring(0, intPart.length - 3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const formattedInt = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;

  // If decimal part is '00', hide it
  const formattedAmount = decPart === '00'
    ? formattedInt
    : `${formattedInt}.${decPart}`;

  return `${isNegative ? '-' : ''}₹${formattedAmount}`;
}

/**
 * Pure number string with up to 2 decimal places (without currency symbol)
 */
export function formatDecimal(val: number | string | Decimal | null | undefined): string {
  if (val === null || val === undefined || val === '') return '0';
  const d = new Decimal(String(val));
  const fixed = d.toFixed(2);
  return fixed.endsWith('.00') ? d.toFixed(0) : fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * Live bill calculations for instant client-side preview.
 * NOTE: The Postgres server always recomputes and is the authoritative source of truth.
 */
export interface BillLinePreview {
  quantity: number | string;
  rate: number | string;
}

export function computeLineAmount(quantity: number | string, rate: number | string): Decimal {
  const q = new Decimal(String(quantity || '0'));
  const r = new Decimal(String(rate || '0'));
  return q.times(r).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function computeBillTotals(
  items: BillLinePreview[],
  discountType: 'NONE' | 'FLAT' | 'PERCENT',
  discountValue: number | string,
  paidNow: number | string
) {
  let subtotal = new Decimal(0);
  for (const item of items) {
    subtotal = subtotal.plus(computeLineAmount(item.quantity, item.rate));
  }

  let discountAmount = new Decimal(0);
  const dVal = new Decimal(String(discountValue || '0'));

  if (discountType === 'FLAT') {
    discountAmount = Decimal.min(dVal, subtotal);
  } else if (discountType === 'PERCENT') {
    const cappedPercent = Decimal.min(Decimal.max(dVal, 0), 100);
    discountAmount = subtotal.times(cappedPercent).dividedBy(100).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }

  const total = Decimal.max(0, subtotal.minus(discountAmount)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const paid = Decimal.min(new Decimal(String(paidNow || '0')), total).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const balance = total.minus(paid).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  return {
    subtotal,
    discountAmount,
    total,
    paid,
    balance,
  };
}

/**
 * Validates whether a quantity is valid per SIMPLIFY rules:
 * - Positive number >= 0.01
 * - Maximum 2 decimal places (no 1.345, 1.34535, etc.)
 * - Valid integers and decimals: 1, 5, 1.5, 1.25, 0.01
 */
export function validateQuantityPrecision(qty: string | number | null | undefined): {
  valid: boolean;
  error?: 'REQUIRED' | 'INVALID_NUMBER' | 'MIN_VALUE' | 'MAX_DECIMALS';
  message?: string;
} {
  if (qty === null || qty === undefined || String(qty).trim() === '') {
    return { valid: false, error: 'REQUIRED', message: 'Quantity is required.' };
  }

  const str = String(qty).trim();
  const num = parseFloat(str);

  if (isNaN(num)) {
    return { valid: false, error: 'INVALID_NUMBER', message: 'Quantity must be a valid number.' };
  }

  if (num < 0.01) {
    return { valid: false, error: 'MIN_VALUE', message: 'Quantity must be at least 0.01.' };
  }

  // Check decimal places directly from string representation to avoid float rounding inaccuracies
  const parts = str.split('.');
  if (parts.length > 1 && parts[1].length > 2) {
    return {
      valid: false,
      error: 'MAX_DECIMALS',
      message: 'Quantity cannot have more than 2 decimal places (e.g. 1.25).',
    };
  }

  return { valid: true };
}
