import { describe, it, expect } from 'vitest';
import { normaliseMobile, isValidIndianMobile, mobileToEmail, getWhatsAppUrl } from '../auth';

describe('auth & mobile helpers', () => {
  it('normalises mobile numbers correctly', () => {
    expect(normaliseMobile('9876543210')).toBe('9876543210');
    expect(normaliseMobile('+91 98765 43210')).toBe('9876543210');
    expect(normaliseMobile('09876543210')).toBe('9876543210');
    expect(normaliseMobile('919876543210')).toBe('9876543210');
  });

  it('validates 10-digit Indian mobile numbers (starting 6-9)', () => {
    expect(isValidIndianMobile('9876543210')).toBe(true);
    expect(isValidIndianMobile('+918888888888')).toBe(true);
    expect(isValidIndianMobile('7000000000')).toBe(true);
    expect(isValidIndianMobile('6123456789')).toBe(true);
    expect(isValidIndianMobile('5123456789')).toBe(false); // starts with 5
    expect(isValidIndianMobile('12345')).toBe(false);
  });

  it('generates synthetic email with mobileToEmail', () => {
    expect(mobileToEmail('9876543210', 'simplify.local')).toBe('919876543210@simplify.local');
    expect(mobileToEmail('+91 98765 43210', 'custom.domain')).toBe('919876543210@custom.domain');
  });

  it('generates wa.me URL with 91 prefix and encoded message', () => {
    expect(getWhatsAppUrl('9876543210')).toBe('https://wa.me/919876543210');
    expect(getWhatsAppUrl('9876543210', 'Hello world & thanks')).toBe(
      'https://wa.me/919876543210?text=Hello%20world%20%26%20thanks'
    );
  });
});
