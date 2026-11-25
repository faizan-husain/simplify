import html2pdf from 'html2pdf.js';
import { getWhatsAppUrl } from '../../lib/auth';

/**
 * Dynamically injects or updates standard @page print CSS rules in the document head.
 * Ensures the browser print dialog respects the exact paper size (A4 vs A5) and margins.
 */
export function setPrintPageSize(
  format: 'a4' | 'a5' | 'thermal58' | 'thermal80',
  marginMm?: number
) {
  let styleEl = document.getElementById('print-page-size-style') as HTMLStyleElement;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'print-page-size-style';
    document.head.appendChild(styleEl);
  }

  let sizeRule = 'A4 portrait';
  let defaultMargin = 8;

  if (format === 'a5') {
    sizeRule = 'A5 portrait';
    defaultMargin = 0;
  } else if (format === 'thermal58') {
    sizeRule = '58mm auto';
    defaultMargin = 0;
  } else if (format === 'thermal80') {
    sizeRule = '80mm auto';
    defaultMargin = 0;
  }

  const finalMargin = marginMm !== undefined ? marginMm : defaultMargin;
  styleEl.textContent = `@media print { @page { size: ${sizeRule} !important; margin: ${finalMargin}mm !important; } }`;
}

/**
 * Detects whether a vertical slice of a canvas contains any visible content.
 * Sub-millisecond execution using step sampling.
 */
function isCanvasSliceBlank(canvas: HTMLCanvasElement, startY: number, sliceHeight: number): boolean {
  if (sliceHeight <= 15) return true; // Micro-overflow / rounding artifact
  const ctx = canvas.getContext('2d');
  if (!ctx) return sliceHeight <= 25;

  const sampleHeight = Math.min(sliceHeight, canvas.height - startY);
  if (sampleHeight <= 0) return true;

  try {
    const imgData = ctx.getImageData(0, startY, canvas.width, sampleHeight);
    const data = imgData.data;
    const len = data.length;

    let nonWhitePixels = 0;
    // Sample every 8th pixel (step of 32 bytes) for maximum speed (<1ms)
    for (let i = 0; i < len; i += 32) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];

      // Pixel is visible if it has opacity and is not pure/near-white
      if (a > 20 && (r < 245 || g < 245 || b < 245)) {
        nonWhitePixels++;
        if (nonWhitePixels > 15) {
          return false; // Found real document content
        }
      }
    }
    return true; // Blank slice
  } catch {
    // If getImageData is blocked (CORS), fall back to height check
    return sliceHeight <= 25;
  }
}

/**
 * Inspects the jsPDF document and full canvas after PDF generation,
 * and deletes any trailing blank pages.
 */
function cleanPdfBlankPages(worker: any): void {
  try {
    const pdf = worker?.prop?.pdf;
    const canvas = worker?.prop?.canvas;
    const pageSize = worker?.prop?.pageSize;

    if (!pdf || !canvas || !pageSize) return;

    const pxFullHeight = canvas.height;
    const ratio =
      pageSize.inner?.ratio ||
      (pageSize.inner?.height && pageSize.inner?.width
        ? pageSize.inner.height / pageSize.inner.width
        : 1.414);
    const pxPageHeight = Math.floor(canvas.width * ratio);

    if (!pxPageHeight || pxPageHeight <= 0) return;

    let totalPages = pdf.internal.getNumberOfPages();

    while (totalPages > 1) {
      const startY = (totalPages - 1) * pxPageHeight;
      const sliceHeight = pxFullHeight - startY;

      if (isCanvasSliceBlank(canvas, startY, sliceHeight)) {
        pdf.deletePage(totalPages);
        totalPages = pdf.internal.getNumberOfPages();
      } else {
        break;
      }
    }
  } catch (err) {
    console.warn('cleanPdfBlankPages encountered an error:', err);
  }
}

/**
 * Prepares an invoice or receipt clone for PDF generation:
 * removes shadows and margins that cause accidental 2nd page overflow,
 * and clears truncate, line-clamp, and overflow-hidden to prevent html2canvas text clipping.
 */
function prepareDocumentClone(element: HTMLElement): HTMLElement {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.classList.remove('hidden');
  clone.style.boxShadow = 'none';
  clone.style.filter = 'none';
  clone.style.margin = '0';
  clone.style.backgroundColor = '#ffffff';
  clone.style.borderRadius = '0';
  clone.style.boxSizing = 'border-box';
  clone.style.width = '148mm';
  clone.style.maxWidth = '148mm';
  clone.style.minWidth = '148mm';

  // Preserve canonical document padding (8mm 8mm 10mm 8mm), never wipe to 0
  clone.style.padding = '8mm 8mm 10mm 8mm';

  // Strip print-hidden controls and buttons if any
  clone.querySelectorAll('.print\\:hidden, .no-print, [data-pdf-hidden], [data-print-hidden]').forEach((el) => {
    el.remove();
  });

  // Strip shadows on all descendants and remove multi-line clamp while preserving single-line truncate
  clone.querySelectorAll('*').forEach((node) => {
    const el = node as HTMLElement;
    if (el.style) {
      el.style.boxShadow = 'none';
      el.style.textShadow = 'none';
    }

    if (el.classList) {
      el.classList.remove('line-clamp-1', 'line-clamp-2', 'line-clamp-3', 'shadow-card', 'shadow-xs', 'shadow-2xs');
    }

    // Keep overflow-hidden for rounded card and table wrappers so borders remain clean,
    // only reset overflow on text nodes that could clip font ascenders
    const isContainer =
      el.tagName === 'TABLE' ||
      el.querySelector('table') !== null ||
      el.classList.contains('rounded-lg') ||
      el.classList.contains('rounded-xl') ||
      el.classList.contains('rounded-2xl');

    if (!isContainer && el.style) {
      if (el.style.overflow === 'hidden' || el.style.overflowX === 'hidden' || el.style.overflowY === 'hidden') {
        el.style.overflow = 'visible';
      }
    }

    if (el.style) {
      if (el.style.textOverflow === 'ellipsis') {
        el.style.textOverflow = 'clip';
      }
      if (el.style.webkitLineClamp) {
        el.style.webkitLineClamp = 'unset';
      }
      if (el.style.display === '-webkit-box') {
        el.style.display = 'block';
      }
    }
  });

  // Enforce border-collapse on all tables for crisp, gap-free border rendering and ensure cell text vertical alignment
  clone.querySelectorAll('table').forEach((table) => {
    table.style.borderCollapse = 'collapse';
  });
  clone.querySelectorAll('td, th').forEach((cell) => {
    const el = cell as HTMLElement;
    el.style.verticalAlign = 'middle';
  });

  // Explicitly enforce solid border styles and crisp hex colors on all border elements
  // (Prevents html2canvas from dropping borders due to missing iframe preflight or CSS variable resolution)
  clone.querySelectorAll('*').forEach((node) => {
    const htmlEl = node as HTMLElement;
    const cls = htmlEl.className || '';
    if (typeof cls !== 'string') return;

    if (cls.includes('border-t')) {
      htmlEl.style.borderTopStyle = 'solid';
      htmlEl.style.borderTopWidth = '1px';
      htmlEl.style.borderTopColor = htmlEl.style.borderTopColor || '#CBD5E1';
    }
    if (cls.includes('border-b')) {
      htmlEl.style.borderBottomStyle = 'solid';
      htmlEl.style.borderBottomWidth = '1px';
      htmlEl.style.borderBottomColor = htmlEl.style.borderBottomColor || '#CBD5E1';
    }
    if (cls.includes('border-l')) {
      htmlEl.style.borderLeftStyle = 'solid';
      htmlEl.style.borderLeftWidth = '1px';
      htmlEl.style.borderLeftColor = htmlEl.style.borderLeftColor || '#CBD5E1';
    }
    if (cls.includes('border-r')) {
      htmlEl.style.borderRightStyle = 'solid';
      htmlEl.style.borderRightWidth = '1px';
      htmlEl.style.borderRightColor = htmlEl.style.borderRightColor || '#CBD5E1';
    }
    if (
      (cls.includes('border ') || cls.endsWith('border') || cls.includes('border-slate')) &&
      !cls.includes('border-t') &&
      !cls.includes('border-b')
    ) {
      htmlEl.style.borderStyle = 'solid';
      htmlEl.style.borderWidth = '1px';
      htmlEl.style.borderColor = htmlEl.style.borderColor || '#CBD5E1';
    }
  });

  return clone;
}

function getA5PdfExportOptions(filename: string) {
  return {
    margin: 0,
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      windowWidth: 560,
      onclone: async (clonedDoc: Document, element: HTMLElement) => {
        // Ensure web fonts (Inter) are 100% loaded in cloned document iframe
        if (clonedDoc.fonts && typeof clonedDoc.fonts.ready !== 'undefined') {
          try {
            await clonedDoc.fonts.ready;
          } catch {
            // Ignore font ready errors
          }
        }

        // 1. Reset iframe HTML & Body to eliminate browser default 8px margin and scrollbars
        if (clonedDoc.documentElement) {
          clonedDoc.documentElement.style.margin = '0px';
          clonedDoc.documentElement.style.padding = '0px';
          clonedDoc.documentElement.style.overflow = 'hidden';
        }
        if (clonedDoc.body) {
          clonedDoc.body.style.margin = '0px';
          clonedDoc.body.style.padding = '0px';
          clonedDoc.body.style.overflow = 'hidden';
        }

        // 2. element is html2pdf's container wrapping the cloned document
        // It must have 0 margin, 0 padding, 0 border, and exact 148mm width
        element.style.position = 'absolute';
        element.style.left = '0px';
        element.style.top = '0px';
        element.style.margin = '0px';
        element.style.padding = '0px';
        element.style.border = '0px';
        element.style.backgroundColor = '#ffffff';
        element.style.width = '148mm';
        element.style.maxWidth = '148mm';
        element.style.minWidth = '148mm';
        element.style.boxSizing = 'border-box';

        // 3. Configure the actual document child inside html2pdf container
        const docChild = element.firstElementChild as HTMLElement;
        if (docChild) {
          docChild.style.margin = '0px';
          docChild.style.width = '148mm';
          docChild.style.maxWidth = '148mm';
          docChild.style.minWidth = '148mm';
          docChild.style.boxSizing = 'border-box';
          docChild.style.padding = '8mm 8mm 10mm 8mm';
          docChild.style.backgroundColor = '#ffffff';
        }
      },
    },
    jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' as const },
  };
}

export async function generateDocumentPdfBlob(element: HTMLElement, filename = 'document.pdf'): Promise<Blob> {
  if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.ready !== 'undefined') {
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  }
  const clone = prepareDocumentClone(element);
  const opt = getA5PdfExportOptions(filename);

  const worker = html2pdf().set(opt).from(clone).toPdf();
  await worker.get('pdf');
  cleanPdfBlankPages(worker);
  const pdfBlob: Blob = await worker.outputPdf('blob');
  return pdfBlob;
}

export async function exportInvoicePDF(element: HTMLElement, filename = 'invoice.pdf'): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.ready !== 'undefined') {
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  }
  const clone = prepareDocumentClone(element);
  const opt = getA5PdfExportOptions(filename);

  const worker = html2pdf().set(opt).from(clone).toPdf();
  await worker.get('pdf');
  cleanPdfBlankPages(worker);
  await worker.save();
}

/**
 * Copies a canvas element as a PNG image to the system clipboard.
 * Enables instant Ctrl+V pasting into WhatsApp Web, Telegram, Email, etc.
 */
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

/**
 * Universal document sharing with seamless WhatsApp integration:
 * - On Mobile / PWA: Uses Web Share API to attach the actual PDF file directly into WhatsApp / native share.
 * - On Desktop / WhatsApp Web: Triggers instant PDF download, copies bill/receipt image to clipboard for Ctrl+V,
 *   and opens WhatsApp Web with the customer's chat and pre-filled message.
 */
export async function shareDocumentWithWhatsApp(
  options: ShareDocumentOptions
): Promise<ShareDocumentResult> {
  const { element, filename, title, text = '', mobile } = options;
  if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.ready !== 'undefined') {
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  }
  const clone = prepareDocumentClone(element);
  const opt = getA5PdfExportOptions(filename);

  try {
    const worker = html2pdf().set(opt).from(clone).toPdf();
    await worker.get('pdf');
    cleanPdfBlankPages(worker);
    const pdfBlob: Blob = await worker.outputPdf('blob');
    const file = new File([pdfBlob], filename, { type: 'application/pdf' });

    // 1. Try Native Web Share API (Mobile / PWA - WhatsApp directly attaches PDF)
    const canShareFiles =
      typeof navigator !== 'undefined' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });

    if (canShareFiles) {
      try {
        await navigator.share({
          files: [file],
          title,
          text: text || title,
        });
        return { success: true, method: 'native_share', copiedImage: false };
      } catch (shareErr: any) {
        if (shareErr.name === 'AbortError') {
          // User cancelled / dismissed the native share sheet
          return { success: false, method: 'native_share', copiedImage: false };
        }
        console.warn('Native share failed, proceeding with desktop WhatsApp flow:', shareErr);
      }
    }

    // 2. Desktop / WhatsApp Web Flow:
    // Download PDF directly from the already generated Blob (instant, 0ms)
    const blobUrl = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

    // 3. Copy Bill/Receipt image to Clipboard for instant Ctrl+V into WhatsApp Web
    let copiedImage = false;
    if (worker.prop?.canvas) {
      copiedImage = await copyCanvasToClipboard(worker.prop.canvas);
    }

    // 4. Open WhatsApp Web / App if customer mobile is available
    if (mobile) {
      const waUrl = getWhatsAppUrl(mobile, text);
      window.open(waUrl, '_blank');
      return { success: true, method: 'whatsapp_web', copiedImage };
    }

    return { success: true, method: 'download_fallback', copiedImage };
  } catch (err) {
    console.warn('Error during document sharing:', err);
    // Fallback: save to disk
    try {
      const fallbackWorker = html2pdf().set(opt).from(clone).toPdf();
      await fallbackWorker.get('pdf');
      cleanPdfBlankPages(fallbackWorker);
      await fallbackWorker.save();
    } catch {
      // ignore
    }
    return { success: false, method: 'download_fallback', copiedImage: false };
  }
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

export async function exportReceiptPDF(element: HTMLElement, filename = 'receipt.pdf'): Promise<void> {
  if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.ready !== 'undefined') {
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  }
  const clone = prepareDocumentClone(element);
  const opt = getA5PdfExportOptions(filename);

  const worker = html2pdf().set(opt).from(clone).toPdf();
  await worker.get('pdf');
  cleanPdfBlankPages(worker);
  await worker.save();
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

/**
 * Universal A4 Document PDF Exporter for Reports, Ledgers, and Statements.
 * Clones the element into a calibrated 100% width container with overflow reset,
 * strips print-hidden UI elements, applies pagebreak rules to prevent mid-row slicing,
 * and automatically removes any trailing blank pages.
 */
export async function exportDocumentPDF(element: HTMLElement, filename = 'document.pdf'): Promise<void> {
  // Await web font loading
  if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.ready !== 'undefined') {
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  }

  // Await image and logo decodes
  const images = Array.from(element.querySelectorAll('img'));
  await Promise.all(
    images.map((img) => {
      if (img.complete) return Promise.resolve();
      return img.decode?.().catch(() => {});
    })
  );

  // 1. Clone element so live DOM is unaffected
  const clone = element.cloneNode(true) as HTMLElement;
  clone.classList.remove('hidden');
  clone.style.display = 'block';

  // 2. Force reveal all table sections that were hidden on mobile viewports (hidden md:block)
  clone.querySelectorAll('.hidden, [class*="hidden"]').forEach((el) => {
    const htmlEl = el as HTMLElement;
    if (
      !htmlEl.classList.contains('print:hidden') &&
      !htmlEl.classList.contains('no-print') &&
      !htmlEl.hasAttribute('data-print-hidden') &&
      !htmlEl.hasAttribute('data-pdf-hidden')
    ) {
      htmlEl.classList.remove('hidden');
      if (htmlEl.tagName === 'TABLE') {
        htmlEl.style.display = 'table';
      } else if (htmlEl.tagName === 'TR') {
        htmlEl.style.display = 'table-row';
      } else if (htmlEl.tagName === 'TD' || htmlEl.tagName === 'TH') {
        htmlEl.style.display = 'table-cell';
      } else {
        htmlEl.style.display = 'block';
      }
    }
  });

  // 3. Strip interactive/action elements and UI controls
  clone.querySelectorAll('.print\\:hidden, .no-print, [data-pdf-hidden], [data-print-hidden]').forEach((el) => {
    el.remove();
  });

  // 4. Configure clone width & typography calibrated for standard A4 page (794px = 210mm at 96 DPI)
  clone.style.width = '794px';
  clone.style.maxWidth = '794px';
  clone.style.minWidth = '794px';
  clone.style.margin = '0';
  clone.style.padding = '0';
  clone.style.boxShadow = 'none';
  clone.style.backgroundColor = '#ffffff';
  clone.style.color = '#0f172a';
  clone.style.boxSizing = 'border-box';
  clone.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';

  // 5. Reset overflow and scroll restrictions so all tables & cards expand to full content
  clone.querySelectorAll('.overflow-x-auto, .overflow-y-auto, .overflow-hidden').forEach((el) => {
    const htmlEl = el as HTMLElement;
    htmlEl.style.overflow = 'visible';
    htmlEl.style.maxHeight = 'none';
  });

  // Strip shadows on all descendants and neutralize truncate/line-clamp on text elements
  clone.querySelectorAll('*').forEach((node) => {
    const el = node as HTMLElement;
    if (el.style) {
      el.style.boxShadow = 'none';
      el.style.textShadow = 'none';
    }

    if (el.classList) {
      el.classList.remove('truncate', 'line-clamp-1', 'line-clamp-2', 'line-clamp-3', 'shadow-card', 'shadow-xs', 'shadow-2xs');
    }

    const isContainer =
      el.tagName === 'TABLE' ||
      el.querySelector('table') !== null ||
      el.classList.contains('rounded-lg') ||
      el.classList.contains('rounded-xl') ||
      el.classList.contains('rounded-2xl');

    if (!isContainer && el.style) {
      if (el.style.overflow === 'hidden' || el.style.overflowX === 'hidden' || el.style.overflowY === 'hidden') {
        el.style.overflow = 'visible';
      }
    }

    if (el.style) {
      if (el.style.textOverflow === 'ellipsis') {
        el.style.textOverflow = 'clip';
      }
      if (el.style.webkitLineClamp) {
        el.style.webkitLineClamp = 'unset';
      }
      if (el.style.display === '-webkit-box') {
        el.style.display = 'block';
      }
    }
  });

  // Ensure tables take 100% width, fit cleanly, and keep headers on multi-page splits
  clone.querySelectorAll('table').forEach((table) => {
    table.style.width = '100%';
    table.style.tableLayout = 'auto';
    table.style.border = 'none';
    table.style.borderCollapse = 'collapse';
  });

  clone.querySelectorAll('th, td').forEach((cell) => {
    const htmlEl = cell as HTMLElement;
    htmlEl.style.wordBreak = 'break-word';
    htmlEl.style.overflowWrap = 'break-word';
    htmlEl.style.verticalAlign = 'middle';
  });

  clone.querySelectorAll('thead').forEach((thead) => {
    const htmlEl = thead as HTMLElement;
    htmlEl.style.display = 'table-header-group';
  });

  // Prevent cards, statement headers, and table rows from being sliced across page breaks
  clone.querySelectorAll('tr, thead, .p-4, .p-5, .rounded-xl, .rounded-2xl, .bg-surface-2').forEach((node) => {
    const htmlEl = node as HTMLElement;
    htmlEl.style.breakInside = 'avoid';
    htmlEl.style.pageBreakInside = 'avoid';
  });

  // Explicitly enforce solid border styles and crisp hex colors on all border elements
  clone.querySelectorAll('*').forEach((node) => {
    const htmlEl = node as HTMLElement;
    const cls = htmlEl.className || '';
    if (typeof cls !== 'string') return;

    if (cls.includes('border-t')) {
      htmlEl.style.borderTopStyle = 'solid';
      htmlEl.style.borderTopWidth = '1px';
      htmlEl.style.borderTopColor = htmlEl.style.borderTopColor || '#CBD5E1';
    }
    if (cls.includes('border-b')) {
      htmlEl.style.borderBottomStyle = 'solid';
      htmlEl.style.borderBottomWidth = '1px';
      htmlEl.style.borderBottomColor = htmlEl.style.borderBottomColor || '#CBD5E1';
    }
    if (cls.includes('border-l')) {
      htmlEl.style.borderLeftStyle = 'solid';
      htmlEl.style.borderLeftWidth = '1px';
      htmlEl.style.borderLeftColor = htmlEl.style.borderLeftColor || '#CBD5E1';
    }
    if (cls.includes('border-r')) {
      htmlEl.style.borderRightStyle = 'solid';
      htmlEl.style.borderRightWidth = '1px';
      htmlEl.style.borderRightColor = htmlEl.style.borderRightColor || '#CBD5E1';
    }
    if (
      (cls.includes('border ') || cls.endsWith('border') || cls.includes('border-slate')) &&
      !cls.includes('border-t') &&
      !cls.includes('border-b')
    ) {
      htmlEl.style.borderStyle = 'solid';
      htmlEl.style.borderWidth = '1px';
      htmlEl.style.borderColor = htmlEl.style.borderColor || '#CBD5E1';
    }
  });

  // Ensure white summary metric cards have visible boundaries in PDF, while tables and footers stay clean
  clone.querySelectorAll('.bg-white').forEach((node) => {
    const htmlEl = node as HTMLElement;
    if (
      htmlEl.tagName === 'TABLE' ||
      htmlEl.querySelector('table') ||
      htmlEl.classList.contains('overflow-x-auto') ||
      htmlEl.classList.contains('pdf-footer') ||
      htmlEl.hasAttribute('data-no-border') ||
      htmlEl.innerText?.includes('Powered by') ||
      htmlEl.innerText?.includes('Confidential')
    ) {
      htmlEl.style.border = 'none';
      if (
        htmlEl.classList.contains('pdf-footer') ||
        htmlEl.hasAttribute('data-no-border') ||
        htmlEl.innerText?.includes('Powered by')
      ) {
        htmlEl.style.borderTop = '1px solid #E2E8F0';
      }
      return;
    }

    if (
      htmlEl.classList.contains('p-3') ||
      htmlEl.classList.contains('p-3.5') ||
      htmlEl.classList.contains('p-4') ||
      htmlEl.classList.contains('p-5') ||
      htmlEl.classList.contains('p-6') ||
      htmlEl.classList.contains('rounded-2xl') ||
      htmlEl.classList.contains('rounded-xl') ||
      htmlEl.parentElement?.classList.contains('grid')
    ) {
      htmlEl.style.border = '1px solid #CBD5E1';
      htmlEl.style.backgroundColor = '#FFFFFF';
      htmlEl.style.boxShadow = 'none';
    }
  });

  // Ensure yellow / amber notices stay clean and borderless in PDF
  clone.querySelectorAll('[class*="amber"], [class*="yellow"]').forEach((node) => {
    const htmlEl = node as HTMLElement;
    htmlEl.style.border = 'none';
  });

  // Strip shadows on all nodes to prevent canvas blur overflow
  clone.querySelectorAll('*').forEach((node) => {
    const htmlEl = node as HTMLElement;
    if (htmlEl.style) {
      htmlEl.style.boxShadow = 'none';
    }
  });

  const opt = {
    margin: [8, 8, 8, 8],
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      windowWidth: 794,
      onclone: async (clonedDoc: Document, clonedEl: HTMLElement) => {
        if (clonedDoc.fonts && typeof clonedDoc.fonts.ready !== 'undefined') {
          try {
            await clonedDoc.fonts.ready;
          } catch {
            // ignore
          }
        }

        clonedEl.style.position = 'absolute';
        clonedEl.style.left = '0px';
        clonedEl.style.top = '0px';
        clonedEl.style.right = 'auto';
        clonedEl.style.margin = '0';
        clonedEl.style.backgroundColor = '#ffffff';
        clonedEl.style.width = '794px';
        clonedEl.style.maxWidth = '794px';
      },
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  };

  const worker = html2pdf().set(opt).from(clone).toPdf();
  await worker.get('pdf');
  cleanPdfBlankPages(worker);
  await worker.save();
}

/**
 * Generates an A4 PDF Blob for Reports, Statements, and Ledgers.
 * Uses the exact same rendering pipeline as exportDocumentPDF.
 */
export async function generateReportPdfBlob(element: HTMLElement, filename = 'document.pdf'): Promise<Blob> {
  // Await web font loading
  if (typeof document !== 'undefined' && document.fonts && typeof document.fonts.ready !== 'undefined') {
    try {
      await document.fonts.ready;
    } catch {
      // ignore
    }
  }

  // Await image and logo decodes
  const images = Array.from(element.querySelectorAll('img'));
  await Promise.all(
    images.map((img) => {
      if (img.complete) return Promise.resolve();
      return img.decode?.().catch(() => {});
    })
  );

  // 1. Clone element so live DOM is unaffected
  const clone = element.cloneNode(true) as HTMLElement;
  clone.classList.remove('hidden');
  clone.style.display = 'block';

  // 2. Force reveal all table sections that were hidden on mobile viewports (hidden md:block)
  clone.querySelectorAll('.hidden, [class*="hidden"]').forEach((el) => {
    const htmlEl = el as HTMLElement;
    if (
      !htmlEl.classList.contains('print:hidden') &&
      !htmlEl.classList.contains('no-print') &&
      !htmlEl.hasAttribute('data-print-hidden') &&
      !htmlEl.hasAttribute('data-pdf-hidden')
    ) {
      htmlEl.classList.remove('hidden');
      if (htmlEl.tagName === 'TABLE') {
        htmlEl.style.display = 'table';
      } else if (htmlEl.tagName === 'TR') {
        htmlEl.style.display = 'table-row';
      } else if (htmlEl.tagName === 'TD' || htmlEl.tagName === 'TH') {
        htmlEl.style.display = 'table-cell';
      } else {
        htmlEl.style.display = 'block';
      }
    }
  });

  // 3. Strip interactive/action elements and UI controls
  clone.querySelectorAll('.print\\:hidden, .no-print, [data-pdf-hidden], [data-print-hidden]').forEach((el) => {
    el.remove();
  });

  // 4. Configure clone width & typography calibrated for standard A4 page (794px = 210mm at 96 DPI)
  clone.style.width = '794px';
  clone.style.maxWidth = '794px';
  clone.style.minWidth = '794px';
  clone.style.margin = '0';
  clone.style.padding = '0';
  clone.style.boxShadow = 'none';
  clone.style.backgroundColor = '#ffffff';
  clone.style.color = '#0f172a';
  clone.style.boxSizing = 'border-box';
  clone.style.fontFamily = 'Inter, -apple-system, BlinkMacSystemFont, sans-serif';

  // 5. Reset overflow and scroll restrictions so all tables & cards expand to full content
  clone.querySelectorAll('.overflow-x-auto, .overflow-y-auto, .overflow-hidden').forEach((el) => {
    const htmlEl = el as HTMLElement;
    htmlEl.style.overflow = 'visible';
    htmlEl.style.maxHeight = 'none';
  });

  // Strip shadows on all descendants and neutralize truncate/line-clamp on text elements
  clone.querySelectorAll('*').forEach((node) => {
    const el = node as HTMLElement;
    if (el.style) {
      el.style.boxShadow = 'none';
      el.style.textShadow = 'none';
    }

    if (el.classList) {
      el.classList.remove('truncate', 'line-clamp-1', 'line-clamp-2', 'line-clamp-3', 'shadow-card', 'shadow-xs', 'shadow-2xs');
    }

    const isContainer =
      el.tagName === 'TABLE' ||
      el.querySelector('table') !== null ||
      el.classList.contains('rounded-lg') ||
      el.classList.contains('rounded-xl') ||
      el.classList.contains('rounded-2xl');

    if (!isContainer && el.style) {
      if (el.style.overflow === 'hidden' || el.style.overflowX === 'hidden' || el.style.overflowY === 'hidden') {
        el.style.overflow = 'visible';
      }
    }

    if (el.style) {
      if (el.style.textOverflow === 'ellipsis') {
        el.style.textOverflow = 'clip';
      }
      if (el.style.webkitLineClamp) {
        el.style.webkitLineClamp = 'unset';
      }
      if (el.style.display === '-webkit-box') {
        el.style.display = 'block';
      }
    }
  });

  // Ensure tables take 100% width, fit cleanly, and keep headers on multi-page splits
  clone.querySelectorAll('table').forEach((table) => {
    table.style.width = '100%';
    table.style.tableLayout = 'auto';
    table.style.border = 'none';
    table.style.borderCollapse = 'collapse';
  });

  clone.querySelectorAll('th, td').forEach((cell) => {
    const htmlEl = cell as HTMLElement;
    htmlEl.style.wordBreak = 'break-word';
    htmlEl.style.overflowWrap = 'break-word';
    htmlEl.style.verticalAlign = 'middle';
  });

  clone.querySelectorAll('thead').forEach((thead) => {
    const htmlEl = thead as HTMLElement;
    htmlEl.style.display = 'table-header-group';
  });

  // Prevent cards, statement headers, and table rows from being sliced across page breaks
  clone.querySelectorAll('tr, thead, .p-4, .p-5, .rounded-xl, .rounded-2xl, .bg-surface-2').forEach((node) => {
    const htmlEl = node as HTMLElement;
    htmlEl.style.breakInside = 'avoid';
    htmlEl.style.pageBreakInside = 'avoid';
  });

  // Explicitly enforce solid border styles and crisp hex colors on all border elements
  clone.querySelectorAll('*').forEach((node) => {
    const htmlEl = node as HTMLElement;
    const cls = htmlEl.className || '';
    if (typeof cls !== 'string') return;

    if (cls.includes('border-t')) {
      htmlEl.style.borderTopStyle = 'solid';
      htmlEl.style.borderTopWidth = '1px';
      htmlEl.style.borderTopColor = htmlEl.style.borderTopColor || '#CBD5E1';
    }
    if (cls.includes('border-b')) {
      htmlEl.style.borderBottomStyle = 'solid';
      htmlEl.style.borderBottomWidth = '1px';
      htmlEl.style.borderBottomColor = htmlEl.style.borderBottomColor || '#CBD5E1';
    }
    if (cls.includes('border-l')) {
      htmlEl.style.borderLeftStyle = 'solid';
      htmlEl.style.borderLeftWidth = '1px';
      htmlEl.style.borderLeftColor = htmlEl.style.borderLeftColor || '#CBD5E1';
    }
    if (cls.includes('border-r')) {
      htmlEl.style.borderRightStyle = 'solid';
      htmlEl.style.borderRightWidth = '1px';
      htmlEl.style.borderRightColor = htmlEl.style.borderRightColor || '#CBD5E1';
    }
    if (
      (cls.includes('border ') || cls.endsWith('border') || cls.includes('border-slate')) &&
      !cls.includes('border-t') &&
      !cls.includes('border-b')
    ) {
      htmlEl.style.borderStyle = 'solid';
      htmlEl.style.borderWidth = '1px';
      htmlEl.style.borderColor = htmlEl.style.borderColor || '#CBD5E1';
    }
  });

  // Ensure white summary metric cards have visible boundaries in PDF, while tables and footers stay clean
  clone.querySelectorAll('.bg-white').forEach((node) => {
    const htmlEl = node as HTMLElement;
    if (
      htmlEl.tagName === 'TABLE' ||
      htmlEl.querySelector('table') ||
      htmlEl.classList.contains('overflow-x-auto') ||
      htmlEl.classList.contains('pdf-footer') ||
      htmlEl.hasAttribute('data-no-border') ||
      htmlEl.innerText?.includes('Powered by') ||
      htmlEl.innerText?.includes('Confidential')
    ) {
      htmlEl.style.border = 'none';
      if (
        htmlEl.classList.contains('pdf-footer') ||
        htmlEl.hasAttribute('data-no-border') ||
        htmlEl.innerText?.includes('Powered by')
      ) {
        htmlEl.style.borderTop = '1px solid #E2E8F0';
      }
      return;
    }

    if (
      htmlEl.classList.contains('p-3') ||
      htmlEl.classList.contains('p-3.5') ||
      htmlEl.classList.contains('p-4') ||
      htmlEl.classList.contains('p-5') ||
      htmlEl.classList.contains('p-6') ||
      htmlEl.classList.contains('rounded-2xl') ||
      htmlEl.classList.contains('rounded-xl') ||
      htmlEl.parentElement?.classList.contains('grid')
    ) {
      htmlEl.style.border = '1px solid #CBD5E1';
      htmlEl.style.backgroundColor = '#FFFFFF';
      htmlEl.style.boxShadow = 'none';
    }
  });

  // Ensure yellow / amber notices stay clean and borderless in PDF
  clone.querySelectorAll('[class*="amber"], [class*="yellow"]').forEach((node) => {
    const htmlEl = node as HTMLElement;
    htmlEl.style.border = 'none';
  });

  // Strip shadows on all nodes to prevent canvas blur overflow
  clone.querySelectorAll('*').forEach((node) => {
    const htmlEl = node as HTMLElement;
    if (htmlEl.style) {
      htmlEl.style.boxShadow = 'none';
    }
  });

  const opt = {
    margin: [8, 8, 8, 8],
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      windowWidth: 794,
      onclone: async (clonedDoc: Document, clonedEl: HTMLElement) => {
        if (clonedDoc.fonts && typeof clonedDoc.fonts.ready !== 'undefined') {
          try {
            await clonedDoc.fonts.ready;
          } catch {
            // ignore
          }
        }

        clonedEl.style.position = 'absolute';
        clonedEl.style.left = '0px';
        clonedEl.style.top = '0px';
        clonedEl.style.right = 'auto';
        clonedEl.style.margin = '0';
        clonedEl.style.backgroundColor = '#ffffff';
        clonedEl.style.width = '794px';
        clonedEl.style.maxWidth = '794px';
      },
    },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  };

  const worker = html2pdf().set(opt).from(clone).toPdf();
  await worker.get('pdf');
  cleanPdfBlankPages(worker);
  const pdfBlob: Blob = await worker.outputPdf('blob');
  return pdfBlob;
}
