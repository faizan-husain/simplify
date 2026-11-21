import { normaliseMobile, isValidIndianMobile } from '../../lib/auth';
import { uploadAndSignDocumentPDF } from '../../lib/storage';

export interface MobileValidationResult {
  valid: boolean;
  normalized: string; // 10-digit clean mobile
  international: string; // e.g. "+91 98765 43210"
  whatsappNumber: string; // e.g. "919876543210"
  raw: string;
}

/**
 * Normalizes Indian mobile number and formats it for WhatsApp integration.
 */
export function normalizeCustomerMobile(mobile: string | null | undefined): MobileValidationResult {
  const raw = (mobile || '').trim();
  const normalized = normaliseMobile(raw);
  const valid = isValidIndianMobile(normalized);

  const formattedGroup =
    normalized.length === 10
      ? `${normalized.slice(0, 5)} ${normalized.slice(5)}`
      : normalized;

  return {
    valid,
    normalized,
    international: valid ? `+91 ${formattedGroup}` : raw,
    whatsappNumber: valid ? `91${normalized}` : normalized,
    raw,
  };
}

export interface InvoiceWhatsAppMessageParams {
  customerName: string;
  invoiceNumber: string;
  totalFormatted: string;
  balanceFormatted?: string;
  hasBalance?: boolean;
  dueDateFormatted?: string;
  businessName: string;
  signedUrl?: string;
}

/**
 * Builds professional WhatsApp message for Invoices.
 * Produces clean text message without download links as requested.
 */
export function buildInvoiceWhatsAppMessage(params: InvoiceWhatsAppMessageParams): string {
  const {
    customerName,
    invoiceNumber,
    totalFormatted,
    balanceFormatted,
    hasBalance,
    dueDateFormatted,
    businessName,
    signedUrl,
  } = params;

  const dueDetails =
    hasBalance && balanceFormatted
      ? `\nPending Balance: ${balanceFormatted}${dueDateFormatted ? ` (Due: ${dueDateFormatted})` : ''}`
      : '\nPayment Status: Fully Paid';

  const linkSection = signedUrl ? `\n\n📄 View / Download PDF:\n${signedUrl}` : '';

  return (
    `Hello ${customerName || 'Customer'},\n\n` +
    `Here is your invoice #${invoiceNumber} for ${totalFormatted}.${dueDetails}${linkSection}\n\n` +
    `Thank you for your business!\n— ${businessName}`
  );
}

export interface ReceiptWhatsAppMessageParams {
  customerName: string;
  receiptNumber: string;
  amountFormatted: string;
  paymentMode: string;
  receiptDateFormatted: string;
  businessName: string;
  signedUrl?: string;
}

/**
 * Builds professional WhatsApp message for Receipts.
 */
export function buildReceiptWhatsAppMessage(params: ReceiptWhatsAppMessageParams): string {
  const {
    customerName,
    receiptNumber,
    amountFormatted,
    paymentMode,
    receiptDateFormatted,
    businessName,
    signedUrl,
  } = params;

  const linkSection = signedUrl ? `\n\n📄 View / Download Receipt PDF:\n${signedUrl}` : '';

  return (
    `Hello ${customerName || 'Customer'},\n\n` +
    `Payment receipt #${receiptNumber} for ${amountFormatted} received on ${receiptDateFormatted} via ${paymentMode}.${linkSection}\n\n` +
    `Thank you!\n— ${businessName}`
  );
}

export interface ShareNativePdfOptions {
  pdfBlob: Blob;
  filename: string;
  title: string;
  text?: string;
}

export interface ShareNativePdfResult {
  supported: boolean;
  success: boolean;
  cancelled?: boolean;
  error?: string;
}

/**
 * Checks if device natively supports file sharing (Mobile Chrome/Safari/PWA)
 * and invokes navigator.share({ files: [pdfFile] }) with actual PDF file.
 */
export async function sharePdfViaNativeShare(
  options: ShareNativePdfOptions
): Promise<ShareNativePdfResult> {
  const { pdfBlob, filename, title, text = '' } = options;
  const file = new File([pdfBlob], filename, { type: 'application/pdf' });

  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] });

  if (!canShareFiles) {
    return { supported: false, success: false };
  }

  try {
    await navigator.share({
      files: [file],
      title,
      text: text || title,
    });
    return { supported: true, success: true };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      // User dismissed share dialog
      return { supported: true, success: false, cancelled: true };
    }
    return { supported: true, success: false, error: err.message };
  }
}

export interface ShareDirectWhatsAppParams {
  businessId: string;
  docType: 'invoices' | 'receipts';
  docId: string;
  pdfBlob: Blob;
  mobile: string;
  message: string;
}

/**
 * Direct WhatsApp flow with secure time-limited Supabase Storage signed URL link.
 */
export async function shareDirectToWhatsApp(
  params: ShareDirectWhatsAppParams
): Promise<{ success: boolean; signedUrl: string; waUrl: string }> {
  const { businessId, docType, docId, pdfBlob, mobile, message } = params;

  // 1. Upload & sign PDF in Supabase Storage
  const { signedUrl } = await uploadAndSignDocumentPDF({
    businessId,
    docType,
    docId,
    pdfBlob,
  });

  // 2. Normalize mobile number
  const mobileRes = normalizeCustomerMobile(mobile);
  if (!mobileRes.valid) {
    throw new Error('Please enter a valid 10-digit Indian WhatsApp mobile number.');
  }

  // 3. Open WhatsApp link with pre-filled message
  const waUrl = `https://wa.me/${mobileRes.whatsappNumber}?text=${encodeURIComponent(message)}`;
  window.open(waUrl, '_blank');

  return {
    success: true,
    signedUrl,
    waUrl,
  };
}
