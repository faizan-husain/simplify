import html2pdf from 'html2pdf.js';

export async function exportInvoicePDF(element: HTMLElement, filename = 'invoice.pdf'): Promise<void> {
  const opt = {
    margin: [10, 10, 10, 10],
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
  };

  await html2pdf().set(opt).from(element).save();
}

export async function shareInvoicePDF(
  element: HTMLElement,
  filename = 'invoice.pdf',
  title = 'Invoice'
): Promise<boolean> {
  const opt = {
    margin: [10, 10, 10, 10],
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
  };

  try {
    const pdfBlob: Blob = await html2pdf().set(opt).from(element).outputPdf('blob');
    const file = new File([pdfBlob], filename, { type: 'application/pdf' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title,
      });
      return true;
    }
  } catch (e) {
    console.warn('Web Share failed or unsupported:', e);
  }

  // Fallback: save to disk
  await html2pdf().set(opt).from(element).save();
  return false;
}

export async function exportReceiptPDF(element: HTMLElement, filename = 'receipt.pdf'): Promise<void> {
  const opt = {
    margin: [10, 10, 10, 10],
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
  };

  await html2pdf().set(opt).from(element).save();
}

export async function exportDocumentPDF(element: HTMLElement, filename = 'document.pdf'): Promise<void> {
  const opt = {
    margin: [10, 10, 10, 10],
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as const },
  };

  await html2pdf().set(opt).from(element).save();
}
