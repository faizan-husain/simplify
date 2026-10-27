import { format, parseISO, isValid } from 'date-fns';

/**
 * Format date for display: 27 Oct 2026
 */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '';
  const d = typeof date === 'string' ? parseISO(date) : date;
  if (!isValid(d)) return '';
  return format(d, 'dd MMM yyyy');
}

/**
 * Format ISO date string for input: YYYY-MM-DD
 */
export function formatInputDate(date: Date = new Date()): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Calculate Indian Financial Year label (e.g. 2026-27)
 * India FY: 1 Apr to 31 Mar
 */
export function getFYLabel(dateInput: string | Date = new Date()): string {
  const d = typeof dateInput === 'string' ? parseISO(dateInput) : dateInput;
  const year = d.getFullYear();
  const month = d.getMonth() + 1; // 1-12

  if (month >= 4) {
    const nextYearShort = String((year + 1) % 100).padStart(2, '0');
    return `${year}-${nextYearShort}`;
  } else {
    const currYearShort = String(year % 100).padStart(2, '0');
    return `${year - 1}-${currYearShort}`;
  }
}
