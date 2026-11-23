/**
 * Idempotency Key Generator & Concurrency Utility
 * Generates unique, cryptographic request tokens to guarantee zero duplicate transactions
 * across multiple devices, double clicks, and network retries.
 */

export function generateIdempotencyKey(prefix = 'req'): string {
  // Use Web Crypto API UUID if available, with timestamp fallback
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }

  // Cryptographically strong random fallback
  const array = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < 16; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }

  const hex = Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${prefix}_${Date.now()}_${hex.slice(0, 16)}`;
}

/**
 * Format human-friendly concurrency conflict error message
 */
export function formatConcurrencyError(error: any): string {
  if (!error) return 'An unexpected error occurred.';
  const msg = error.message || error.details || String(error);

  if (msg.includes('CONFLICT_DETECTED') || msg.includes('RECORD_MODIFIED_BY_ANOTHER_USER')) {
    return 'This record was modified on another device while you were editing. Please refresh to load the latest changes.';
  }

  if (msg.includes('INVOICE_ALREADY_CANCELLED')) {
    return 'This bill was already cancelled by another device or user.';
  }

  if (msg.includes('ALLOCATION_EXCEEDS_INVOICE_BALANCE')) {
    return 'The bill balance has changed on another device. Please refresh to view updated balance.';
  }

  if (msg.includes('INSUFFICIENT_ADVANCE')) {
    return 'Customer advance was utilized on another device. Please refresh.';
  }

  return msg;
}
