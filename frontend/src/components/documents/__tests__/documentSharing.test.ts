import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  normalizeCustomerMobile,
  buildInvoiceWhatsAppMessage,
  buildReceiptWhatsAppMessage,
  sharePdfViaNativeShare,
} from '../documentSharing';

describe('documentSharing - Customer WhatsApp & Mobile Normalization', () => {
  it('correctly validates and normalizes 10-digit Indian mobile numbers', () => {
    const res = normalizeCustomerMobile('9876543210');
    expect(res.valid).toBe(true);
    expect(res.normalized).toBe('9876543210');
    expect(res.international).toBe('+91 98765 43210');
    expect(res.whatsappNumber).toBe('919876543210');
  });

  it('normalizes mobile numbers with +91 country code and spaces', () => {
    const res = normalizeCustomerMobile('+91 98765 43210');
    expect(res.valid).toBe(true);
    expect(res.normalized).toBe('9876543210');
    expect(res.whatsappNumber).toBe('919876543210');
  });

  it('normalizes mobile numbers with leading 0 prefix', () => {
    const res = normalizeCustomerMobile('09876543210');
    expect(res.valid).toBe(true);
    expect(res.normalized).toBe('9876543210');
  });

  it('normalizes mobile numbers with 91 prefix without plus', () => {
    const res = normalizeCustomerMobile('919876543210');
    expect(res.valid).toBe(true);
    expect(res.normalized).toBe('9876543210');
  });

  it('rejects invalid mobile numbers (too short, invalid prefixes, empty)', () => {
    expect(normalizeCustomerMobile('').valid).toBe(false);
    expect(normalizeCustomerMobile(null).valid).toBe(false);
    expect(normalizeCustomerMobile(undefined).valid).toBe(false);
    expect(normalizeCustomerMobile('12345').valid).toBe(false);
    expect(normalizeCustomerMobile('5123456789').valid).toBe(false); // starts with 5
    expect(normalizeCustomerMobile('abcdefghij').valid).toBe(false);
  });
});

describe('documentSharing - Professional WhatsApp Messages with Secure Link', () => {
  it('builds an invoice WhatsApp message with balance and secure link', () => {
    const msg = buildInvoiceWhatsAppMessage({
      customerName: 'Rahul Sharma',
      invoiceNumber: 'INV-1001',
      totalFormatted: '₹1,500',
      balanceFormatted: '₹500',
      hasBalance: true,
      dueDateFormatted: '28 Nov 2026',
      businessName: 'Sharma Stationery',
      signedUrl: 'https://demo.supabase.co/storage/v1/object/sign/documents/inv.pdf?token=abc',
    });

    expect(msg).toContain('Hello Rahul Sharma,');
    expect(msg).toContain('invoice #INV-1001 for ₹1,500.');
    expect(msg).toContain('Pending Balance: ₹500 (Due: 28 Nov 2026)');
    expect(msg).toContain('📄 View / Download PDF:');
    expect(msg).toContain('https://demo.supabase.co/storage/v1/object/sign/documents/inv.pdf?token=abc');
    expect(msg).toContain('— Sharma Stationery');
  });

  it('builds an invoice WhatsApp message for fully paid bills', () => {
    const msg = buildInvoiceWhatsAppMessage({
      customerName: 'Priya Verma',
      invoiceNumber: 'INV-1002',
      totalFormatted: '₹2,000',
      hasBalance: false,
      businessName: 'Apex Services',
      signedUrl: 'https://demo.supabase.co/storage/v1/object/sign/documents/inv2.pdf?token=xyz',
    });

    expect(msg).toContain('Payment Status: Fully Paid');
    expect(msg).toContain('invoice #INV-1002 for ₹2,000.');
    expect(msg).toContain('https://demo.supabase.co/storage/v1/object/sign/documents/inv2.pdf?token=xyz');
  });

  it('builds a receipt WhatsApp message with payment details and secure link', () => {
    const msg = buildReceiptWhatsAppMessage({
      customerName: 'Amit Patel',
      receiptNumber: 'RC-101',
      amountFormatted: '₹5,000',
      paymentMode: 'UPI',
      receiptDateFormatted: '21 Nov 2026',
      businessName: 'Quick Bill Store',
      signedUrl: 'https://demo.supabase.co/storage/v1/object/sign/documents/rc.pdf?token=123',
    });

    expect(msg).toContain('Hello Amit Patel,');
    expect(msg).toContain('Payment receipt #RC-101 for ₹5,000 received on 21 Nov 2026 via UPI.');
    expect(msg).toContain('📄 View / Download Receipt PDF:');
    expect(msg).toContain('https://demo.supabase.co/storage/v1/object/sign/documents/rc.pdf?token=123');
    expect(msg).toContain('— Quick Bill Store');
  });
});

describe('documentSharing - Web Share API Native PDF Sharing & Desktop Fallback', () => {
  const dummyBlob = new Blob(['%PDF-1.4 dummy content'], { type: 'application/pdf' });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns supported: false when navigator.canShare is unavailable (Desktop)', async () => {
    // Simulate desktop environment where canShare is undefined or returns false
    const originalNavigator = global.navigator;
    // @ts-ignore
    global.navigator = { canShare: undefined, share: undefined };

    const res = await sharePdfViaNativeShare({
      pdfBlob: dummyBlob,
      filename: 'invoice.pdf',
      title: 'Invoice #101',
    });

    expect(res.supported).toBe(false);
    expect(res.success).toBe(false);

    global.navigator = originalNavigator;
  });

  it('invokes navigator.share with PDF file when supported (Mobile / PWA)', async () => {
    const mockShare = vi.fn().mockResolvedValue(undefined);
    const mockCanShare = vi.fn().mockReturnValue(true);

    const originalNavigator = global.navigator;
    // @ts-ignore
    global.navigator = {
      canShare: mockCanShare,
      share: mockShare,
    };

    const res = await sharePdfViaNativeShare({
      pdfBlob: dummyBlob,
      filename: 'bill-INV-1001.pdf',
      title: 'Bill #INV-1001',
      text: 'Bill #INV-1001 - SIMPLIFY',
    });

    expect(res.supported).toBe(true);
    expect(res.success).toBe(true);
    expect(mockCanShare).toHaveBeenCalled();
    expect(mockShare).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Bill #INV-1001',
        text: 'Bill #INV-1001 - SIMPLIFY',
        files: expect.any(Array),
      })
    );

    global.navigator = originalNavigator;
  });

  it('handles user cancellation gracefully without error', async () => {
    const abortErr = new Error('User dismissed share dialog');
    abortErr.name = 'AbortError';

    const mockShare = vi.fn().mockRejectedValue(abortErr);
    const mockCanShare = vi.fn().mockReturnValue(true);

    const originalNavigator = global.navigator;
    // @ts-ignore
    global.navigator = {
      canShare: mockCanShare,
      share: mockShare,
    };

    const res = await sharePdfViaNativeShare({
      pdfBlob: dummyBlob,
      filename: 'bill-INV-1001.pdf',
      title: 'Bill #INV-1001',
    });

    expect(res.supported).toBe(true);
    expect(res.success).toBe(false);
    expect(res.cancelled).toBe(true);

    global.navigator = originalNavigator;
  });
});
