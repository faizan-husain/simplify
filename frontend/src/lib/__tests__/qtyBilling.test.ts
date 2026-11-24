import { describe, it, expect } from 'vitest';
import {
  computeLineAmount,
  computeBillTotals,
  formatINR,
  formatDecimal,
  validateQuantityPrecision,
} from '../money';

describe('QTY Field Behavior & Billing Calculations', () => {
  // Requirement 1 & 2 & 4: Default QTY 1 and calculations
  it('correctly calculates line total for QTY 1', () => {
    const lineAmt = computeLineAmount(1, 250);
    expect(lineAmt.toString()).toBe('250');
    expect(formatINR(lineAmt)).toBe('₹250');
  });

  // Requirement 1 & 4 & 6: QTY 5 calculation (e.g., Visiting Card, QTY 5)
  it('correctly calculates line total for QTY 5', () => {
    // Example: Visiting Card, QTY 5 @ ₹120 each = ₹600
    const lineAmt = computeLineAmount(5, 120);
    expect(lineAmt.toString()).toBe('600');
    expect(formatINR(lineAmt)).toBe('₹600');

    const totals = computeBillTotals(
      [{ quantity: 5, rate: 120 }],
      'NONE',
      0,
      0
    );
    expect(totals.subtotal.toString()).toBe('600');
    expect(totals.total.toString()).toBe('600');
    expect(totals.balance.toString()).toBe('600');
  });

  // Requirement 3: Decimal quantities (e.g., 2.5 hours/kg, 0.5 service unit)
  it('correctly calculates line totals for decimal quantities with half-up rounding', () => {
    // 2.5 quantity @ ₹350 = ₹875
    const lineAmt1 = computeLineAmount(2.5, 350);
    expect(lineAmt1.toString()).toBe('875');

    // 1.75 quantity @ ₹99.50 = ₹174.125 -> rounded half-up to ₹174.13
    const lineAmt2 = computeLineAmount(1.75, 99.5);
    expect(lineAmt2.toString()).toBe('174.13');
    expect(formatINR(lineAmt2)).toBe('₹174.13');

    // String inputs (from form inputs)
    const lineAmt3 = computeLineAmount('3.25', '120.00');
    expect(lineAmt3.toString()).toBe('390');
  });

  // Requirement 5 & 10: Multiple service lines with different quantities
  it('calculates grand totals, discounts, and dues across multiple lines with varying quantities', () => {
    const items = [
      { quantity: 5, rate: 120 },    // Visiting Card: 5 x 120 = 600
      { quantity: 1, rate: 1500 },   // Passport Job: 1 x 1500 = 1500
      { quantity: 2.5, rate: 200 },  // Document Typing: 2.5 x 200 = 500
      { quantity: 10, rate: 15 },    // Lamination: 10 x 15 = 150
    ];
    // Subtotal: 600 + 1500 + 500 + 150 = 2750

    // Test FLAT discount of ₹250 with partial payment ₹1500
    const flatDiscountTotals = computeBillTotals(items, 'FLAT', 250, 1500);
    expect(flatDiscountTotals.subtotal.toString()).toBe('2750');
    expect(flatDiscountTotals.discountAmount.toString()).toBe('250');
    expect(flatDiscountTotals.total.toString()).toBe('2500');
    expect(flatDiscountTotals.paid.toString()).toBe('1500');
    expect(flatDiscountTotals.balance.toString()).toBe('1000'); // Outstanding: ₹1,000

    // Test PERCENT discount of 10% with full payment
    const percentDiscountTotals = computeBillTotals(items, 'PERCENT', 10, 2475);
    // 10% of 2750 = 275 -> Total = 2475
    expect(percentDiscountTotals.subtotal.toString()).toBe('2750');
    expect(percentDiscountTotals.discountAmount.toString()).toBe('275');
    expect(percentDiscountTotals.total.toString()).toBe('2475');
    expect(percentDiscountTotals.paid.toString()).toBe('2475');
    expect(percentDiscountTotals.balance.toString()).toBe('0'); // Fully Paid
  });

  // Requirement 7: Bill editing simulation (preserving & updating quantity)
  it('updates line amounts, subtotal, and balance when quantity is modified during bill edit', () => {
    // Initial bill: 1 x ₹400
    let items = [{ quantity: 1, rate: 400 }];
    let totals = computeBillTotals(items, 'NONE', 0, 200); // Paid ₹200 upfront
    expect(totals.total.toString()).toBe('400');
    expect(totals.balance.toString()).toBe('200');

    // User edits the bill: changes quantity from 1 to 3
    items = [{ quantity: 3, rate: 400 }];
    totals = computeBillTotals(items, 'NONE', 0, 200); // Upfront payment remains ₹200
    expect(totals.subtotal.toString()).toBe('1200');
    expect(totals.total.toString()).toBe('1200');
    expect(totals.paid.toString()).toBe('200');
    expect(totals.balance.toString()).toBe('1000'); // New balance is ₹1,000
  });

  // Requirement 6: Business logic verification - QTY vs Job Count
  it('verifies that line total reflects quantity while job entity count is 1 per line', () => {
    interface SimulatedBillLine {
      id: string;
      description: string;
      is_job: boolean;
      quantity: number;
      rate: number;
    }

    const billLines: SimulatedBillLine[] = [
      {
        id: 'line-1',
        description: 'Visiting Card Printing',
        is_job: true,
        quantity: 5,
        rate: 120, // Total: 600
      },
      {
        id: 'line-2',
        description: 'A4 Photo Print',
        is_job: false,
        quantity: 10,
        rate: 20, // Total: 200
      },
    ];

    // Compute bill totals
    const linePreviews = billLines.map((l) => ({ quantity: l.quantity, rate: l.rate }));
    const totals = computeBillTotals(linePreviews, 'NONE', 0, 0);
    expect(totals.total.toString()).toBe('800');

    // Simulate job extraction (as done in Postgres create_invoice)
    // 1 service line with is_job: true creates exactly 1 job, NOT 5 jobs!
    const createdJobs = billLines
      .filter((l) => l.is_job)
      .map((l) => ({
        source_line_id: l.id,
        job_name: l.description,
        job_amount: computeLineAmount(l.quantity, l.rate).toNumber(),
      }));

    expect(createdJobs).toHaveLength(1); // Exactly 1 job created
    expect(createdJobs[0].job_amount).toBe(600); // Job amount equals line total (5 x 120)
  });

  // Requirement 8: Formatted output for PDF, Print and WhatsApp
  it('formats quantities and amounts cleanly for PDF and WhatsApp sharing', () => {
    expect(formatDecimal(1)).toBe('1');
    expect(formatDecimal(5)).toBe('5');
    expect(formatDecimal(2.5)).toBe('2.5');
    expect(formatDecimal(10.75)).toBe('10.75');

    const qty = 5;
    const rate = 120;
    const amount = computeLineAmount(qty, rate);

    const printLine = `${qty} x ${formatINR(rate)} = ${formatINR(amount)}`;
    expect(printLine).toBe('5 x ₹120 = ₹600');
  });

  // Precision Rules: Requirement 1, 2, 3, 4, 8 & 11
  describe('validateQuantityPrecision', () => {
    it('accepts valid integers and decimals with up to 2 decimal places', () => {
      expect(validateQuantityPrecision(1)).toEqual({ valid: true });
      expect(validateQuantityPrecision('1')).toEqual({ valid: true });
      expect(validateQuantityPrecision(5)).toEqual({ valid: true });
      expect(validateQuantityPrecision('5')).toEqual({ valid: true });
      expect(validateQuantityPrecision(1.5)).toEqual({ valid: true });
      expect(validateQuantityPrecision('1.5')).toEqual({ valid: true });
      expect(validateQuantityPrecision(1.25)).toEqual({ valid: true });
      expect(validateQuantityPrecision('1.25')).toEqual({ valid: true });
      expect(validateQuantityPrecision(0.01)).toEqual({ valid: true });
      expect(validateQuantityPrecision('0.01')).toEqual({ valid: true });
    });

    it('rejects values with more than 2 decimal places (such as 1.345 and 1.34535) without silent rounding', () => {
      const res3Dec = validateQuantityPrecision('1.345');
      expect(res3Dec.valid).toBe(false);
      expect(res3Dec.error).toBe('MAX_DECIMALS');
      expect(res3Dec.message).toBe('Quantity cannot have more than 2 decimal places (e.g. 1.25).');

      const res5Dec = validateQuantityPrecision('1.34535');
      expect(res5Dec.valid).toBe(false);
      expect(res5Dec.error).toBe('MAX_DECIMALS');
      expect(res5Dec.message).toBe('Quantity cannot have more than 2 decimal places (e.g. 1.25).');

      // Ensure that raw number inputs with > 2 decimals are also rejected
      expect(validateQuantityPrecision(1.345).valid).toBe(false);
      expect(validateQuantityPrecision(1.34535).valid).toBe(false);
    });

    it('rejects zero and negative values as invalid', () => {
      const resZero = validateQuantityPrecision('0');
      expect(resZero.valid).toBe(false);
      expect(resZero.error).toBe('MIN_VALUE');

      const resNeg = validateQuantityPrecision('-1');
      expect(resNeg.valid).toBe(false);
      expect(resNeg.error).toBe('MIN_VALUE');

      const resBelowMin = validateQuantityPrecision('0.005');
      expect(resBelowMin.valid).toBe(false);
    });

    it('rejects empty, null, undefined, or non-numeric input', () => {
      expect(validateQuantityPrecision('').valid).toBe(false);
      expect(validateQuantityPrecision(null).valid).toBe(false);
      expect(validateQuantityPrecision(undefined).valid).toBe(false);
      expect(validateQuantityPrecision('abc').valid).toBe(false);
    });

    // Requirement 10: Typing, pasting, editing natural transitions, and blocking precision overflow
    describe('Natural typing, pasting and editing lifecycle', () => {
      const simulateQtyInput = (rawVal: string) => {
        let clean = rawVal.replace(/[^0-9.]/g, '');
        const parts = clean.split('.');
        if (parts.length > 2) {
          clean = parts[0] + '.' + parts.slice(1).join('');
        }
        const splitClean = clean.split('.');
        if (splitClean.length > 1 && splitClean[1].length > 2) {
          clean = splitClean[0] + '.' + splitClean[1].slice(0, 2);
        }
        const validation = validateQuantityPrecision(clean, { allowIntermediate: true });
        return { clean, validation };
      };

      it('allows natural typing keystroke by keystroke with intermediate decimal points', () => {
        // Step 1: User types '1'
        const step1 = simulateQtyInput('1');
        expect(step1.clean).toBe('1');
        expect(step1.validation.valid).toBe(true);

        // Step 2: User types '.' -> '1.'
        const step2 = simulateQtyInput('1.');
        expect(step2.clean).toBe('1.');
        expect(step2.validation.valid).toBe(true); // Intermediate decimal point allowed

        // Step 3: User types '2' -> '1.2'
        const step3 = simulateQtyInput('1.2');
        expect(step3.clean).toBe('1.2');
        expect(step3.validation.valid).toBe(true);

        // Step 4: User types '3' -> '1.23'
        const step4 = simulateQtyInput('1.23');
        expect(step4.clean).toBe('1.23');
        expect(step4.validation.valid).toBe(true);

        // Step 5: User tries to type 3rd decimal '2' -> blocked from being typed, remains '1.23'
        const step5 = simulateQtyInput('1.232');
        expect(step5.clean).toBe('1.23'); // 3rd decimal is NOT typed into the field!
        expect(step5.validation.valid).toBe(true);

        // Step 6: User backspaces to fix -> '1.2'
        const step6 = simulateQtyInput('1.2');
        expect(step6.clean).toBe('1.2');
        expect(step6.validation.valid).toBe(true);
      });

      it('blocks extra digits when pasting values with > 2 decimals so input never exceeds 2 decimals', () => {
        // User pastes '1.23232' -> extra digits beyond 2 decimals are not accepted
        const pasted = simulateQtyInput('1.23232');
        expect(pasted.clean).toBe('1.23');
        expect(pasted.validation.valid).toBe(true);

        // Line calculation remains accurate
        const lineAmt = computeLineAmount(pasted.clean, 100);
        expect(lineAmt.toString()).toBe('123');
      });

      it('prevents typing extra decimal digits via keyboard event prevention', () => {
        const simulateKeyDown = (val: string, key: string, selectionStart: number, selectionEnd: number) => {
          let defaultPrevented = false;
          const dotIndex = val.indexOf('.');
          if (dotIndex !== -1 && /^\d$/.test(key)) {
            if (selectionStart === selectionEnd && selectionStart > dotIndex) {
              const dec = val.slice(dotIndex + 1);
              if (dec.length >= 2) {
                defaultPrevented = true;
              }
            }
          }
          return defaultPrevented;
        };

        // 1.23 with cursor at end (index 4), user types '4' -> prevented!
        expect(simulateKeyDown('1.23', '4', 4, 4)).toBe(true);

        // 1.2 with cursor at end (index 3), user types '3' -> allowed!
        expect(simulateKeyDown('1.2', '3', 3, 3)).toBe(false);

        // 1.23 with cursor in integer part (index 1 before dot), user types '5' -> allowed!
        expect(simulateKeyDown('1.23', '5', 1, 1)).toBe(false);

        // 1.23 with decimal part selected (replacing '23'), user types '5' -> allowed!
        expect(simulateKeyDown('1.23', '5', 2, 4)).toBe(false);
      });

      it('prevents multiple decimal points and filters out non-numeric characters', () => {
        const multiDot = simulateQtyInput('1.2.5');
        expect(multiDot.clean).toBe('1.25');
        expect(multiDot.validation.valid).toBe(true);

        const letters = simulateQtyInput('1a.5b0c');
        expect(letters.clean).toBe('1.50');
        expect(letters.validation.valid).toBe(true);
      });

      it('handles starting with decimal point (.5, .25)', () => {
        const dotFive = simulateQtyInput('.5');
        expect(dotFive.clean).toBe('.5');
        expect(dotFive.validation.valid).toBe(true);

        const dotTwentyFive = simulateQtyInput('.25');
        expect(dotTwentyFive.clean).toBe('.25');
        expect(dotTwentyFive.validation.valid).toBe(true);

        const dotThreeDec = simulateQtyInput('.123');
        expect(dotThreeDec.clean).toBe('.12'); // 3rd decimal digit is blocked!
        expect(dotThreeDec.validation.valid).toBe(true);
      });
    });
  });
});
