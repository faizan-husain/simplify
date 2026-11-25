import { supabase } from '../../lib/supabase';
import { sharePdfViaNativeShare } from './documentSharing';
import { getWhatsAppUrl } from '../../lib/auth';

export interface ExportPdfOptions {
  element: HTMLElement;
  page?: 'A4' | 'A5' | 'thermal58' | 'thermal80';
  filename?: string;
  docType?: string;
}

/**
 * Dynamically injects or updates standard @page print CSS rules in the document head.
 * Ensures the browser print dialog respects the exact paper size (A4 vs A5 vs Thermal) and margins.
 */
export function setPrintPageSize(
  format: 'a4' | 'a5' | 'A4' | 'A5' | 'thermal58' | 'thermal80',
  marginMm?: number
): void {
  if (typeof document === 'undefined') return;

  let styleEl = document.getElementById('print-page-size-style') as HTMLStyleElement;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'print-page-size-style';
    document.head.appendChild(styleEl);
  }

  const normalized = format.toLowerCase();
  let sizeRule = 'A4 portrait';
  let defaultMargin = 8;

  if (normalized === 'a5') {
    sizeRule = 'A5 portrait';
    defaultMargin = 0;
  } else if (normalized === 'thermal58') {
    sizeRule = '58mm auto';
    defaultMargin = 0;
  } else if (normalized === 'thermal80') {
    sizeRule = '80mm auto';
    defaultMargin = 0;
  }

  const finalMargin = marginMm !== undefined ? marginMm : defaultMargin;
  styleEl.textContent = `@media print { @page { size: ${sizeRule} !important; margin: ${finalMargin}mm !important; } }`;
}

/**
 * Invokes the browser's native print preview dialog with the calibrated page size.
 */
export function printDocument(
  _element?: HTMLElement | null,
  page: 'A4' | 'A5' | 'thermal58' | 'thermal80' = 'A5',
  marginMm?: number
): void {
  setPrintPageSize(page, marginMm);
  window.print();
}

/**
 * Downloads a Blob directly to the client's device.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    if (a.parentNode) {
      document.body.removeChild(a);
    }
    URL.revokeObjectURL(url);
  }, 1000);
}

let cachedCompiledCss = '';

/**
 * Gathers all compiled Tailwind styles and print CSS from the document.
 */
export async function collectPrintCss(): Promise<string> {
  if (cachedCompiledCss) return cachedCompiledCss;

  let cssText = '';

  if (typeof document !== 'undefined') {
    // 1. Gather rules from styleSheets
    for (let i = 0; i < document.styleSheets.length; i++) {
      const sheet = document.styleSheets[i];
      try {
        if (sheet.cssRules) {
          for (let j = 0; j < sheet.cssRules.length; j++) {
            cssText += sheet.cssRules[j].cssText + '\n';
          }
        }
      } catch {
        // Cross-origin restriction
      }
    }

    // 2. Fetch external link stylesheets if rules were restricted
    if (cssText.length < 5000) {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      for (const link of links) {
        const href = link.getAttribute('href');
        if (href) {
          try {
            const res = await fetch(href);
            if (res.ok) {
              cssText += (await res.text()) + '\n';
            }
          } catch {
            // Ignore fetch errors
          }
        }
      }
    }

    // 3. Gather inline style tags
    document.querySelectorAll('style').forEach((st) => {
      cssText += (st.textContent || '') + '\n';
    });
  }

  if (cssText.length > 5000) {
    cachedCompiledCss = cssText;
  }

  return cssText;
}

/**
 * Universal Vector PDF Exporter powered by Headless Chromium (Plan A).
 * Serializes the canonical visible DOM element + print CSS and posts to /pdf-service/render.
 * If the service is unreachable, automatically opens the native print preview dialog as a safe fallback.
 */
export async function exportPdf(options: ExportPdfOptions): Promise<Blob> {
  const {
    element,
    page = 'A5',
    filename = 'document.pdf',
    docType,
  } = options;

  if (!element) {
    throw new Error('exportPdf requires a valid DOM element');
  }

  // 1. Prepare canonical DOM clone without print-hidden / interactive elements
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.no-print, .print\\:hidden, [data-print-hidden], [data-pdf-hidden]').forEach((el) => {
    el.remove();
  });
  const html = clone.outerHTML;

  // 2. Collect print CSS
  const css = await collectPrintCss();

  // 3. Resolve service URL and Supabase JWT
  const serviceUrl = (import.meta.env.VITE_PDF_SERVICE_URL || 'http://localhost:3001').replace(/\/$/, '');
  let token = '';
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || '';
  } catch {
    // Session token retrieval is non-blocking
  }

  const payload = {
    html,
    css,
    page,
    filename,
    docType,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // 4. Request with 20s timeout and 1 automatic retry
  let attempt = 0;
  let lastError: any = null;

  while (attempt < 2) {
    attempt++;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch(`${serviceUrl}/render`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const blob = await res.blob();
        return blob;
      } else {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.message || `PDF service responded with HTTP ${res.status}`);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      lastError = err;
      if (attempt < 2) {
        // Wait 500ms before retry
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  // 5. Fallback: If service is unreachable or offline, open native browser print dialog
  console.warn('[PDF Export] PDF microservice unreachable. Triggering native print fallback:', lastError);
  printDocument(element, page);

  const fallbackNotice = 'PDF service is currently unavailable. The print dialog has been opened — please select "Save as PDF" to download your document.';
  if (typeof window !== 'undefined' && (window as any).showToast) {
    (window as any).showToast(fallbackNotice, 'info');
  } else {
    console.info(fallbackNotice);
  }

  throw new Error(fallbackNotice);
}

/**
 * Universal document sharing with seamless WhatsApp integration:
 * - On Mobile / PWA: Uses Web Share API to attach the vector PDF file directly into WhatsApp / native share.
 * - On Desktop / WhatsApp Web: Triggers instant PDF download, copies image if supported, and opens WhatsApp Web.
 */
export async function sharePdf(
  blob: Blob,
  filename: string,
  title: string,
  text = '',
  mobile?: string | null
): Promise<boolean> {
  // 1. Attempt native Web Share API with actual vector PDF file
  const nativeRes = await sharePdfViaNativeShare({
    pdfBlob: blob,
    filename,
    title,
    text,
  });

  if (nativeRes.supported) {
    return nativeRes.success;
  }

  // 2. Desktop Fallback: Download file & open WhatsApp link
  downloadBlob(blob, filename);

  if (mobile) {
    const waUrl = getWhatsAppUrl(mobile, text || title);
    window.open(waUrl, '_blank');
  }

  return true;
}

// ============================================================================
// Backward-Compatible Document Helpers for All 19 Documents
// ============================================================================

export async function generateDocumentPdfBlob(element: HTMLElement, filename = 'document.pdf'): Promise<Blob> {
  return exportPdf({
    element,
    page: 'A5',
    filename,
    docType: 'document_a5',
  });
}

export async function generateReportPdfBlob(element: HTMLElement, filename = 'document.pdf'): Promise<Blob> {
  return exportPdf({
    element,
    page: 'A4',
    filename,
    docType: 'report_a4',
  });
}

export async function exportInvoicePDF(element: HTMLElement, filename = 'invoice.pdf'): Promise<void> {
  const blob = await exportPdf({
    element,
    page: 'A5',
    filename,
    docType: 'invoice',
  });
  downloadBlob(blob, filename);
}

export async function exportReceiptPDF(element: HTMLElement, filename = 'receipt.pdf'): Promise<void> {
  const blob = await exportPdf({
    element,
    page: 'A5',
    filename,
    docType: 'receipt',
  });
  downloadBlob(blob, filename);
}

export async function exportDocumentPDF(element: HTMLElement, filename = 'document.pdf'): Promise<void> {
  const blob = await exportPdf({
    element,
    page: 'A4',
    filename,
    docType: 'report_statement',
  });
  downloadBlob(blob, filename);
}

export interface ShareDocumentOptions {
  element: HTMLElement;
  filename: string;
  title: string;
  text?: string;
  mobile?: string | null;
}

export interface ShareDocumentResult {
  success: boolean;
  method: 'native_share' | 'whatsapp_web' | 'download_fallback';
  copiedImage: boolean;
}

export async function shareDocumentWithWhatsApp(
  options: ShareDocumentOptions
): Promise<ShareDocumentResult> {
  const { element, filename, title, text = '', mobile } = options;
  const blob = await exportPdf({
    element,
    page: 'A5',
    filename,
  });

  const success = await sharePdf(blob, filename, title, text, mobile);
  return {
    success,
    method: 'native_share',
    copiedImage: false,
  };
}

export async function shareInvoicePDF(
  element: HTMLElement,
  filename = 'invoice.pdf',
  title = 'Invoice',
  options?: { text?: string; mobile?: string | null }
): Promise<boolean> {
  const result = await shareDocumentWithWhatsApp({
    element,
    filename,
    title,
    text: options?.text,
    mobile: options?.mobile,
  });
  return result.success;
}

export async function shareReceiptPDF(
  element: HTMLElement,
  filename = 'receipt.pdf',
  title = 'Receipt',
  options?: { text?: string; mobile?: string | null }
): Promise<boolean> {
  const result = await shareDocumentWithWhatsApp({
    element,
    filename,
    title,
    text: options?.text,
    mobile: options?.mobile,
  });
  return result.success;
}

export async function copyCanvasToClipboard(canvas: HTMLCanvasElement): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof window.ClipboardItem === 'undefined') {
      return false;
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png');
    });
    if (!blob) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch (err) {
    console.warn('Clipboard image copy not supported or denied:', err);
    return false;
  }
}
