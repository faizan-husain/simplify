import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../../lib/supabase';
import { getErrorMessage } from '../../i18n';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { Dialog } from '../ui/Dialog';
import { useToast } from '../ui/Toast';
import { ReceiptDocument } from '../documents/ReceiptDocument';
import { setPrintPageSize, generateDocumentPdfBlob } from '../documents/pdfExport';
import {
  normalizeCustomerMobile,
  buildReceiptWhatsAppMessage,
  sharePdfViaNativeShare,
} from '../documents/documentSharing';
import { UpdateMobileModal } from '../documents/UpdateMobileModal';
import { Printer, Download, Share2 } from 'lucide-react';

export interface ReceiptDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receiptId: string | null;
}

export const ReceiptDetailModal: React.FC<ReceiptDetailModalProps> = ({
  open,
  onOpenChange,
  receiptId,
}) => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    receipt: any;
    customer: any;
    allocations: any[];
    ledger_summary?: any;
    business: any;
  } | null>(null);

  const [format, setFormat] = useState<'a5' | 'thermal58' | 'thermal80'>('a5');
  const [localCustomerMobile, setLocalCustomerMobile] = useState('');
  const [isUpdateMobileOpen, setIsUpdateMobileOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'whatsapp_direct' | 'share_pdf' | null>(null);
  const [sharingState, setSharingState] = useState<'idle' | 'generating' | 'uploading' | 'sharing'>('idle');
  const pdfDocRef = useRef<HTMLDivElement>(null);
  const pdfBlobCacheRef = useRef<Blob | null>(null);

  useEffect(() => {
    setLocalCustomerMobile(data?.customer?.mobile || '');
    pdfBlobCacheRef.current = null;
  }, [data?.receipt?.id, data?.customer?.mobile]);

  useEffect(() => {
    pdfBlobCacheRef.current = null;
  }, [format]);

  useEffect(() => {
    if (!open || !receiptId) {
      setData(null);
      return;
    }

    const fetchDetail = async () => {
      setLoading(true);
      try {
        const { data: res, error } = await supabase.rpc('receipt_detail', {
          p_receipt_id: receiptId,
        });
        if (error) throw error;
        
        const result = res as any;
        if (result?.allocations && result.allocations.length > 0) {
          const invIds = result.allocations.map((a: any) => a.invoice_id).filter(Boolean);
          if (invIds.length > 0) {
            const { data: items } = await supabase
              .from('invoice_items')
              .select('id, invoice_id, description, quantity, rate, amount, applicant_name')
              .in('invoice_id', invIds);

            if (items && items.length > 0) {
              result.allocations = result.allocations.map((a: any) => ({
                ...a,
                items: items.filter((it: any) => it.invoice_id === a.invoice_id),
              }));
              result.items = items;
            }
          }
        }

        setData(result);
        if (result?.business?.thermal_width === 58) {
          setFormat('thermal58');
        } else if (result?.business?.thermal_width === 80) {
          setFormat('thermal80');
        } else {
          setFormat('a5');
        }
      } catch (err: any) {
        showToast(getErrorMessage(err.message), 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [open, receiptId]);

  const handlePrint = () => {
    setPrintPageSize(
      format === 'thermal58' ? 'thermal58' : format === 'thermal80' ? 'thermal80' : 'a5',
      0
    );
    document.body.classList.add('printing-portal-active');
    const cleanup = () => {
      document.body.classList.remove('printing-portal-active');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  const getOrGenerateReceiptPdfBlob = async (): Promise<Blob> => {
    if (pdfBlobCacheRef.current) return pdfBlobCacheRef.current;
    if (!pdfDocRef.current || !data) throw new Error('Receipt preview not ready');
    const blob = await generateDocumentPdfBlob(pdfDocRef.current, `Receipt-${data.receipt.number}.pdf`);
    pdfBlobCacheRef.current = blob;
    return blob;
  };

  const handleDownloadPDF = () => {
    handlePrint();
  };

  const handleWhatsAppDirect = async (overrideMobile?: string) => {
    if (!data) return;
    const targetMobile = overrideMobile || localCustomerMobile;
    const mob = normalizeCustomerMobile(targetMobile);

    if (!mob.valid) {
      setPendingAction('whatsapp_direct');
      setIsUpdateMobileOpen(true);
      return;
    }

    try {
      const message = buildReceiptWhatsAppMessage({
        customerName: data.customer?.name || 'Customer',
        receiptNumber: data.receipt.number,
        amountFormatted: formatINR(data.receipt.amount),
        paymentMode: data.receipt.mode || 'CASH',
        receiptDateFormatted: formatDate(data.receipt.receipt_date),
        businessName: data.business?.name || 'SIMPLIFY',
      });

      const waUrl = `https://wa.me/${mob.whatsappNumber}?text=${encodeURIComponent(message)}`;
      window.open(waUrl, '_blank');
      showToast('WhatsApp opened with receipt details', 'success');
    } catch (err: any) {
      showToast('Failed to share to WhatsApp: ' + err.message, 'error');
    }
  };

  const handleSharePDF = async () => {
    if (!pdfDocRef.current || !data) return;

    setSharingState('generating');
    try {
      const pdfBlob = await getOrGenerateReceiptPdfBlob();
      setSharingState('sharing');

      // 1. Attempt native Web Share API with actual PDF file
      const nativeRes = await sharePdfViaNativeShare({
        pdfBlob,
        filename: `Receipt-${data.receipt.number}.pdf`,
        title: `Receipt #${data.receipt.number}`,
        text: `Receipt #${data.receipt.number} - ${data.business?.name || 'SIMPLIFY'}`,
      });

      if (nativeRes.supported) {
        if (nativeRes.success) {
          showToast('Receipt PDF shared successfully', 'success');
        } else if (nativeRes.cancelled) {
          // User dismissed share dialog
        } else if (nativeRes.error) {
          showToast('Share failed: ' + nativeRes.error, 'error');
        }
        return;
      }

      // 2. Desktop Fallback: Download PDF & offer WhatsApp link if mobile available
      const blobUrl = URL.createObjectURL(pdfBlob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `Receipt-${data.receipt.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

      const mob = normalizeCustomerMobile(localCustomerMobile);
      if (mob.valid) {
        showToast('Receipt PDF downloaded! Opening WhatsApp link...', 'info');
        await handleWhatsAppDirect(localCustomerMobile);
      } else {
        showToast('Receipt PDF saved to device', 'success');
      }
    } catch (err: any) {
      showToast('Failed to share PDF: ' + err.message, 'error');
    } finally {
      setSharingState('idle');
    }
  };

  const handleSaveMobile = async (newMobile: string) => {
    try {
      if (data?.customer?.id) {
        await supabase.from('customers').update({ mobile: newMobile }).eq('id', data.customer.id);
      }
      setLocalCustomerMobile(newMobile);
      showToast('Customer mobile number updated', 'success');

      if (pendingAction === 'whatsapp_direct') {
        setPendingAction(null);
        setTimeout(() => handleWhatsAppDirect(newMobile), 150);
      } else if (pendingAction === 'share_pdf') {
        setPendingAction(null);
        setTimeout(() => handleSharePDF(), 150);
      }
    } catch (err: any) {
      showToast('Failed to update mobile: ' + err.message, 'error');
    }
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={data ? `Payment Receipt #${data.receipt.number}` : 'Loading Receipt...'}
      description={data?.customer ? `Customer: ${data.customer.name}` : undefined}
      className="sm:max-w-[680px] border-0 shadow-[0_12px_40px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]"
      contentClassName="flex flex-col p-4 sm:p-5 overflow-hidden"
    >
      <div className="space-y-3 flex-1 min-h-0 flex flex-col">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[#F8FAFC] border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] rounded-xl">
          <div className="flex items-center gap-1 bg-[#EEF2F6] p-0.5 rounded-lg">
            <button
              type="button"
              onClick={() => setFormat('a5')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${format === 'a5'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              A5 (Half A4)
            </button>
            <button
              type="button"
              onClick={() => setFormat('thermal58')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${format === 'thermal58'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              58mm
            </button>
            <button
              type="button"
              onClick={() => setFormat('thermal80')}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${format === 'thermal80'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
                }`}
            >
              80mm
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => handleWhatsAppDirect()}
              disabled={sharingState !== 'idle' || loading}
              title="Send Receipt text message on WhatsApp"
              className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border-0 bg-[#25D366]/12 hover:bg-[#25D366]/20 text-[#075E54] font-semibold text-xs transition-all shadow-[0_1px_3px_rgba(0,0,0,0.04)] cursor-pointer disabled:opacity-50"
            >
              <Share2 className="w-3.5 h-3.5 mr-1" />
              {sharingState === 'uploading'
                ? 'Creating Link...'
                : sharingState === 'generating'
                  ? 'Preparing...'
                  : 'WhatsApp Direct'}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              title="Print Receipt"
              className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border-0 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-all shadow-[0_1px_3px_rgba(0,0,0,0.05)] cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 mr-1" />
              Print ({format === 'a5' ? 'A5' : format === 'thermal58' ? '58mm' : '80mm'})
            </button>

            <button
              type="button"
              onClick={handleSharePDF}
              disabled={sharingState !== 'idle' || loading}
              title="Share PDF Receipt File via Web Share / WhatsApp"
              className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border-0 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-all shadow-[0_1px_3px_rgba(0,0,0,0.05)] cursor-pointer disabled:opacity-50"
            >
              <Share2 className="w-3.5 h-3.5 mr-1" />
              {sharingState === 'sharing' ? 'Sharing...' : 'Share PDF'}
            </button>

            <button
              type="button"
              onClick={handleDownloadPDF}
              disabled={sharingState !== 'idle' || loading}
              title="Download A5 PDF"
              className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg border-0 bg-[#0F766E] hover:bg-[#0D655E] text-white font-semibold text-xs transition-all shadow-[0_2px_6px_rgba(15,118,110,0.25)] cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              {sharingState === 'generating' ? 'Exporting...' : 'PDF'}
            </button>
          </div>
        </div>

        {/* Document Preview Container */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto bg-[#F6F7F9] p-3 sm:p-4 rounded-xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.03),inset_0_1px_3px_rgba(0,0,0,0.02)]">
          {loading ? (
            <div className="py-20 text-center text-xs text-slate-500 font-medium">
              Loading receipt document...
            </div>
          ) : data ? (
            <div className="flex justify-center">
              <ReceiptDocument
                ref={pdfDocRef}
                receipt={data.receipt}
                customer={data.customer}
                allocations={data.allocations}
                items={(data as any)?.items}
                ledger_summary={data.ledger_summary}
                business={data.business}
                format={format}
              />
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-danger font-medium">
              Failed to load receipt details.
            </div>
          )}
        </div>
      </div>

      {/* Hidden container for print mounted at document.body for exact horizontal page centering */}
      {data &&
        createPortal(
          <div id="print-receipt-root" className="hidden print:flex">
            <ReceiptDocument
              receipt={data.receipt}
              customer={data.customer}
              allocations={data.allocations}
              items={(data as any)?.items}
              ledger_summary={data.ledger_summary}
              business={data.business}
              format={format}
            />
          </div>,
          document.body
        )}
      {/* Customer WhatsApp Number Modal */}
      <UpdateMobileModal
        open={isUpdateMobileOpen}
        onOpenChange={setIsUpdateMobileOpen}
        partyName={data?.customer?.name || 'Customer'}
        initialMobile={localCustomerMobile}
        onSave={handleSaveMobile}
      />
    </Dialog>
  );
};
