import { describe, it, expect } from 'vitest';
import { formatDate, getFYLabel } from '../dates';

describe('date utilities', () => {
  it('formats dates in 27 Oct 2026 format', () => {
    expect(formatDate('2026-10-27')).toBe('27 Oct 2026');
    expect(formatDate('2026-04-01')).toBe('01 Apr 2026');
  });

  it('computes Indian Financial Year (FY) correctly', () => {
    // April 2026 to March 2027 is 2026-27
    expect(getFYLabel('2026-04-01')).toBe('2026-27');
    expect(getFYLabel('2026-10-27')).toBe('2026-27');
    expect(getFYLabel('2027-03-31')).toBe('2026-27');

    // January to March 2026 belongs to 2025-26
    expect(getFYLabel('2026-01-15')).toBe('2025-26');
    expect(getFYLabel('2026-03-31')).toBe('2025-26');
  });
});
