import { supabase } from './supabase';

export interface UploadDocumentParams {
  businessId: string;
  docType: 'invoices' | 'receipts';
  docId: string;
  pdfBlob: Blob;
  filename?: string;
}

export interface DocumentSignedUrlResult {
  signedUrl: string;
  path: string;
}

// In-memory cache for signed URLs to avoid duplicate uploads/requests during the session
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();

/**
 * Uploads an invoice or receipt PDF into the private 'documents' Supabase storage bucket,
 * and generates a secure time-limited signed download URL (default: 7 days).
 */
export async function uploadAndSignDocumentPDF(
  params: UploadDocumentParams,
  expiresInSeconds = 7 * 24 * 60 * 60
): Promise<DocumentSignedUrlResult> {
  const { businessId, docType, docId, pdfBlob } = params;
  const storagePath = `${businessId}/${docType}/${docId}.pdf`;

  // 1. Check in-memory cache first (reuse if > 1 hour remaining)
  const cached = signedUrlCache.get(storagePath);
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt - now > 3600) {
    return { signedUrl: cached.url, path: storagePath };
  }

  // 2. Upload to private 'documents' bucket
  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, pdfBlob, {
      contentType: 'application/pdf',
      upsert: true,
    });

  if (uploadError) {
    throw new Error(`Failed to upload document PDF: ${uploadError.message}`);
  }

  // 3. Create secure signed URL
  const { data: signData, error: signError } = await supabase.storage
    .from('documents')
    .createSignedUrl(storagePath, expiresInSeconds);

  if (signError || !signData?.signedUrl) {
    throw new Error(`Failed to generate signed document URL: ${signError?.message || 'Unknown error'}`);
  }

  // Ensure full URL if relative
  let fullSignedUrl = signData.signedUrl;
  if (!fullSignedUrl.startsWith('http://') && !fullSignedUrl.startsWith('https://')) {
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321').replace(/\/+$/, '');
    fullSignedUrl = `${supabaseUrl}${fullSignedUrl.startsWith('/') ? '' : '/'}${fullSignedUrl}`;
  }

  // Save to cache
  signedUrlCache.set(storagePath, {
    url: fullSignedUrl,
    expiresAt: now + expiresInSeconds,
  });

  return {
    signedUrl: fullSignedUrl,
    path: storagePath,
  };
}

/**
 * Clears signed URL cache for a document (useful when invoice/receipt is updated).
 */
export function invalidateDocumentSignedUrlCache(businessId: string, docType: 'invoices' | 'receipts', docId: string): void {
  signedUrlCache.delete(`${businessId}/${docType}/${docId}.pdf`);
}
