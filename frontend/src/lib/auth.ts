const DEFAULT_DOMAIN = 'simplify.local';

/**
 * Normalise Indian mobile numbers:
 * Strips non-digits, strips leading +91 or 0, returns clean 10-digit string.
 */
export function normaliseMobile(input: string): string {
  if (!input) return '';
  const digits = input.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.substring(2);
  }
  if (digits.length === 11 && digits.startsWith('0')) {
    return digits.substring(1);
  }
  return digits;
}

/**
 * Validate standard email format
 */
export function isValidEmail(email: string): boolean {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Validate standard 10-digit Indian mobile number
 */
export function isValidIndianMobile(mobile: string): boolean {
  const norm = normaliseMobile(mobile);
  return /^[6-9]\d{9}$/.test(norm);
}

/**
 * Single source of truth helper mapping 10-digit mobile to synthetic Supabase Auth email.
 */
export function mobileToEmail(mobile: string, domain = import.meta.env.VITE_LOGIN_EMAIL_DOMAIN || DEFAULT_DOMAIN): string {
  const norm = normaliseMobile(mobile);
  return `91${norm}@${domain}`;
}

/**
 * Format mobile number for display: 98765 43210
 */
export function formatMobileDisplay(mobile: string): string {
  const norm = normaliseMobile(mobile);
  if (norm.length !== 10) return mobile;
  return `${norm.slice(0, 5)} ${norm.slice(5)}`;
}

/**
 * Get WhatsApp link with country code 91
 */
export function getWhatsAppUrl(mobile: string, text?: string): string {
  const norm = normaliseMobile(mobile);
  const encodedText = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/91${norm}${encodedText}`;
}
