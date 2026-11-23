import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { StatusDot } from '../ui/StatusDot';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { Printer, Share2, Download, CheckCircle2, Pencil, AlertTriangle, RotateCcw } from 'lucide-react';
import { Database } from '../../types/supabase';
import { ApplyAdvanceModal } from './ApplyAdvanceModal';
import { CancelBillModal } from './CancelBillModal';
import { RestoreBillModal } from './RestoreBillModal';
import { BillActivityHistory } from './BillActivityHistory';
import { InvoiceDocument } from '../documents/InvoiceDocument';
import { exportInvoicePDF, setPrintPageSize, generateDocumentPdfBlob } from '../documents/pdfExport';
import {
  normalizeCustomerMobile,
  buildInvoiceWhatsAppMessage,
  sharePdfViaNativeShare,
} from '../documents/documentSharing';
import { UpdateMobileModal } from '../documents/UpdateMobileModal';

type Invoice = Database['public']['Tables']['invoices']['Row'];
type InvoiceItem = Database['public']['Tables']['invoice_items']['Row'];

export interface BillDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: (Invoice & { invoice_items?: InvoiceItem[] }) | null;
  onInvoiceUpdated?: () => void;
  onReceivePayment?: (invoice: Invoice) => void;
  onNewBill?: () => void;
  onGoToBills?: () => void;
}

export const BillDetailModal: React.FC<BillDetailModalProps> = ({
  open,
  onOpenChange,
  invoice,
  onInvoiceUpdated,
  onReceivePayment,
  onNewBill,
  onGoToBills,
}) => {
  const { business, role } = useAuth();
  const isStaff = role === 'STAFF';
  const { showToast } = useToast();
  const navigate = useNavigate();
  const docRef = useRef<HTMLDivElement>(null);

  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [historyRefreshTrigger, setHistoryRefreshTrigger] = useState(0);
  const [customerAdvance, setCustomerAdvance] = useState(0);
  const [isAdvanceOpen, setIsAdvanceOpen] = useState(false);

  const [printFormat, setPrintFormat] = useState<'a5' | 'thermal58' | 'thermal80'>(
    business?.thermal_width === 58 ? 'thermal58' : business?.thermal_width === 80 ? 'thermal80' : 'a5'
  );
  const [localPartyMobile, setLocalPartyMobile] = useState(invoice?.party_mobile || '');
  const [isUpdateMobileOpen, setIsUpdateMobileOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<'whatsapp_direct' | 'share_pdf' | null>(null);
  const [sharingState, setSharingState] = useState<'idle' | 'generating' | 'uploading' | 'sharing'>('idle');
  const pdfBlobCacheRef = useRef<Blob | null>(null);

  useEffect(() => {
    setLocalPartyMobile(invoice?.party_mobile || '');
    pdfBlobCacheRef.current = null;
  }, [invoice?.id, invoice?.party_mobile]);

  useEffect(() => {
    pdfBlobCacheRef.current = null;
  }, [printFormat]);

  useEffect(() => {
    if (open && invoice?.customer_id && invoice.total > invoice.paid_amount) {
      supabase
        .from('receipts')
        .select('unallocated_amount')
        .eq('customer_id', invoice.customer_id)
        .is('deleted_at', null)
        .gt('unallocated_amount', 0)
        .then(({ data }) => {
          const tot = (data || []).reduce(
            (acc: number, r: any) => acc + (parseFloat(r.unallocated_amount) || 0),
            0
          );
          setCustomerAdvance(tot);
        });
    } else {
      setCustomerAdvance(0);
    }
  }, [open, invoice?.id, invoice?.customer_id, invoice?.paid_amount]);

  if (!invoice) return null;

  const balance = Math.max(0, invoice.total - invoice.paid_amount);
  const isOverdue = invoice.status === 'ACTIVE' && balance > 0 && new Date(invoice.due_date) < new Date();
  const statusVariant =
    invoice.status === 'CANCELLED'
      ? 'cancelled'
      : invoice.paid_amount >= invoice.total
        ? 'paid'
        : invoice.paid_amount > 0
          ? 'partial'
          : 'unpaid';

  const handlePrint = () => {
    setPrintPageSize(
      printFormat === 'thermal58' ? 'thermal58' : printFormat === 'thermal80' ? 'thermal80' : 'a5',
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

  const getOrGeneratePdfBlob = async (): Promise<Blob> => {
    if (pdfBlobCacheRef.current) return pdfBlobCacheRef.current;
    if (!docRef.current) throw new Error('Document preview not ready');
    const blob = await generateDocumentPdfBlob(docRef.current, `bill-${invoice.number}.pdf`);
    pdfBlobCacheRef.current = blob;
    return blob;
  };

  const handleDownloadPDF = async () => {
    if (!docRef.current) return;
    setSharingState('generating');
    try {
      await exportInvoicePDF(docRef.current, `bill-${invoice.number}.pdf`);
      showToast('PDF downloaded successfully', 'success');
    } catch (err: any) {
      showToast('Failed to export PDF: ' + err.message, 'error');
    } finally {
      setSharingState('idle');
    }
  };

  const handleWhatsAppDirect = async (overrideMobile?: string) => {
    const targetMobile = overrideMobile || localPartyMobile;
    const mob = normalizeCustomerMobile(targetMobile);

    if (!mob.valid) {
      setPendingAction('whatsapp_direct');
      setIsUpdateMobileOpen(true);
      return;
    }

    try {
      const message = buildInvoiceWhatsAppMessage({
        customerName: invoice.party_name,
        invoiceNumber: invoice.number,
        totalFormatted: formatINR(invoice.total),
        balanceFormatted: formatINR(balance),
        hasBalance: balance > 0,
        dueDateFormatted: formatDate(invoice.due_date),
        businessName: business?.name || 'SIMPLIFY',
      });

      const waUrl = `https://wa.me/${mob.whatsappNumber}?text=${encodeURIComponent(message)}`;
      window.open(waUrl, '_blank');
      showToast('WhatsApp opened with invoice message', 'success');
    } catch (err: any) {
      showToast('Failed to share to WhatsApp: ' + err.message, 'error');
    }
  };

  const handleSharePDF = async () => {
    if (!docRef.current || !invoice) return;

    setSharingState('generating');
    try {
      const pdfBlob = await getOrGeneratePdfBlob();
      setSharingState('sharing');

      // 1. Attempt native Web Share API with actual PDF file
      const nativeRes = await sharePdfViaNativeShare({
        pdfBlob,
        filename: `bill-${invoice.number}.pdf`,
        title: `Bill #${invoice.number}`,
        text: `Bill #${invoice.number} - ${business?.name || 'SIMPLIFY'}`,
      });

      if (nativeRes.supported) {
        if (nativeRes.success) {
          showToast('Invoice PDF shared successfully', 'success');
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
      a.download = `bill-${invoice.number}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

      const mob = normalizeCustomerMobile(localPartyMobile);
      if (mob.valid) {
        showToast('PDF downloaded! Opening WhatsApp link...', 'info');
        await handleWhatsAppDirect(localPartyMobile);
      } else {
        showToast('PDF downloaded to your device', 'success');
      }
    } catch (err: any) {
      showToast('Failed to share PDF: ' + err.message, 'error');
    } finally {
      setSharingState('idle');
    }
  };

  const handleSaveMobile = async (newMobile: string) => {
    try {
      await supabase.from('invoices').update({ party_mobile: newMobile }).eq('id', invoice.id);
      if (invoice.customer_id) {
        await supabase.from('customers').update({ mobile: newMobile }).eq('id', invoice.customer_id);
      }
      setLocalPartyMobile(newMobile);
      showToast('Customer mobile number updated', 'success');
      onInvoiceUpdated?.();

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

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Bill #${invoice.number}`}
        description={`Customer: ${invoice.party_name || 'Walk-in'}`}
        className="sm:max-w-[680px] border-0 shadow-[0_12px_40px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]"
        contentClassName="flex flex-col p-4 sm:p-5 overflow-hidden"
      >
        <div className="space-y-3 flex-1 min-h-0 flex flex-col">
          {/* New Bill Created Success Banner */}
          {onNewBill && (
            <div className="bg-[#EAF2F1] text-[#0F766E] px-3.5 py-2.5 rounded-xl flex items-center justify-between text-xs shrink-0 shadow-[0_2px_8px_rgba(0,0,0,0.03)] border-0">
              <div className="flex items-center gap-1.5 font-bold">
                <CheckCircle2 className="w-4 h-4 text-[#0F766E] shrink-0" />
                <span>Bill Created Successfully!</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    onNewBill();
                  }}
                  className="px-2.5 py-1 bg-ink hover:bg-black text-white rounded-lg font-medium text-xs transition-colors shadow-btn cursor-pointer"
                >
                  + New Bill
                </button>
                {onGoToBills && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      onGoToBills();
                    }}
                    className="px-2.5 py-1 bg-white hover:bg-slate-50 text-slate-700 border-0 shadow-[0_1px_3px_rgba(0,0,0,0.05)] rounded-lg font-bold text-xs transition-colors cursor-pointer"
                  >
                    Bills List
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Top Control Bar: Format Switcher & Document Quick Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-[#F8FAFC] border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] rounded-xl shrink-0">
            <div className="flex items-center gap-1 bg-[#EEF2F6] p-0.5 rounded-lg">
              <button
                type="button"
                onClick={() => setPrintFormat('a5')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${printFormat === 'a5'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                A5 (Half A4)
              </button>
              <button
                type="button"
                onClick={() => setPrintFormat('thermal58')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${printFormat === 'thermal58'
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
                  }`}
              >
                58mm
              </button>
              <button
                type="button"
                onClick={() => setPrintFormat('thermal80')}
                className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${printFormat === 'thermal80'
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
                disabled={sharingState !== 'idle'}
                title="Send Bill text message on WhatsApp"
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
                title="Print Invoice"
                className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border-0 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-all shadow-[0_1px_3px_rgba(0,0,0,0.05)] cursor-pointer"
              >
                <Printer className="w-3.5 h-3.5 mr-1" />
                Print ({printFormat === 'a5' ? 'A5' : printFormat === 'thermal58' ? '58mm' : '80mm'})
              </button>

              <button
                type="button"
                onClick={() => handleSharePDF()}
                disabled={sharingState !== 'idle'}
                title="Share PDF Invoice File via Web Share / WhatsApp"
                className="inline-flex items-center justify-center px-2.5 py-1.5 rounded-lg border-0 bg-white hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-all shadow-[0_1px_3px_rgba(0,0,0,0.05)] cursor-pointer disabled:opacity-50"
              >
                <Share2 className="w-3.5 h-3.5 mr-1" />
                {sharingState === 'sharing' ? 'Sharing...' : 'Share PDF'}
              </button>

              <button
                type="button"
                onClick={handleDownloadPDF}
                disabled={sharingState !== 'idle'}
                title="Download A5 PDF"
                className="inline-flex items-center justify-center px-3 py-1.5 rounded-lg border-0 bg-[#0F766E] hover:bg-[#0D655E] text-white font-semibold text-xs transition-all shadow-[0_2px_6px_rgba(15,118,110,0.25)] cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 mr-1" />
                {sharingState === 'generating' ? 'Exporting...' : 'PDF'}
              </button>
            </div>
          </div>

          {/* Centered Document Preview Container - matches ReceiptDetailModal layout */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto bg-[#F6F7F9] p-3 sm:p-4 rounded-xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.03),inset_0_1px_3px_rgba(0,0,0,0.02)] space-y-3">
            {invoice.status === 'CANCELLED' && (
              <div className="p-3.5 rounded-2xl bg-rose-100/70 text-rose-800 text-xs flex items-start gap-3 shadow-xs border-0">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <div className="font-bold text-[13px]">This Bill is Cancelled</div>
                  <div className="text-[12px] text-rose-700">
                    Reason: <span className="font-semibold italic">"{invoice.cancel_reason || 'No reason specified'}"</span>
                  </div>
                  <div className="text-[11px] text-rose-500">
                    Cancelled on {formatDate((invoice as any).cancelled_at || invoice.updated_at)}
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-center">
              <InvoiceDocument
                invoice={invoice}
                business={business}
                format={printFormat}
              />
            </div>

            {/* Complete Activity & Audit History */}
            <BillActivityHistory invoiceId={invoice.id} refreshTrigger={historyRefreshTrigger} />
          </div>

          {/* Bottom Operational Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#F1F5F9] shrink-0">
            <div className="flex items-center gap-2">
              <StatusDot status={statusVariant} />
              {isOverdue && (
                <span className="text-[10px] text-red-700 font-bold uppercase bg-red-50 border-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)] px-2 py-0.5 rounded-md">
                  OVERDUE
                </span>
              )}
              <span className="text-xs text-text-muted">
                Total: <strong className="text-text">{formatINR(invoice.total)}</strong>
                {balance > 0 ? (
                  <>
                    {' '}
                    · Due:{' '}
                    <strong className="text-danger">{formatINR(balance)}</strong>
                  </>
                ) : (
                  <>
                    {' '}
                    · <span className="text-emerald-600 font-semibold">Fully Paid</span>
                  </>
                )}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
              {balance > 0 && customerAdvance > 0 && invoice.status === 'ACTIVE' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-0 bg-[#EAF2F1] text-[#0F766E] hover:bg-[#D9E9E7] shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-xs font-semibold"
                  onClick={() => setIsAdvanceOpen(true)}
                >
                  Apply Advance ({formatINR(customerAdvance)})
                </Button>
              )}

              {!isStaff && invoice.status === 'ACTIVE' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="border-0 bg-slate-100/90 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] shadow-2xs text-xs font-semibold transition-all hover:scale-105"
                  onClick={() => {
                    onOpenChange(false);
                    navigate(`/bills/${invoice.id}/edit`);
                  }}
                >
                  <Pencil className="w-3.5 h-3.5 mr-1" />
                  Edit
                </Button>
              )}

              {invoice.status === 'ACTIVE' && (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className="text-xs shadow-2xs border-0 font-semibold bg-rose-100/80 hover:bg-rose-200/80 text-rose-700"
                  onClick={() => setIsCancelOpen(true)}
                >
                  Cancel Bill
                </Button>
              )}

              {invoice.status === 'CANCELLED' && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="bg-[#0F766E] hover:bg-[#0D655E] text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm"
                  onClick={() => setIsRestoreOpen(true)}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Restore Bill
                </Button>
              )}

              {balance > 0 && invoice.status === 'ACTIVE' && onReceivePayment && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  className="text-xs shadow-[0_2px_6px_rgba(15,118,110,0.25)] border-0 font-semibold"
                  onClick={() => {
                    onOpenChange(false);
                    onReceivePayment(invoice);
                  }}
                >
                  Receive Payment ({formatINR(balance)})
                </Button>
              )}
            </div>
          </div>
        </div>
      </Dialog>

      {/* Hidden container for print mounted at document.body for exact horizontal page centering */}
      {invoice &&
        createPortal(
          <div id="print-invoice-root" className="hidden print:flex">
            <InvoiceDocument invoice={invoice} business={business} format={printFormat} />
          </div>,
          document.body
        )}

      {/* Offscreen container for crisp PDF generation */}
      <div style={{ position: 'fixed', left: '-9999px', top: '-9999px', width: '148mm' }}>
        <InvoiceDocument ref={docRef} invoice={invoice} business={business} format="a5" />
      </div>

      {/* Cancel Bill Modal */}
      <CancelBillModal
        open={isCancelOpen}
        onOpenChange={setIsCancelOpen}
        invoice={invoice}
        onSuccess={() => {
          onInvoiceUpdated?.();
          setHistoryRefreshTrigger((prev) => prev + 1);
        }}
      />

      {/* Restore Bill Modal */}
      <RestoreBillModal
        open={isRestoreOpen}
        onOpenChange={setIsRestoreOpen}
        invoice={invoice}
        onSuccess={() => {
          onInvoiceUpdated?.();
          setHistoryRefreshTrigger((prev) => prev + 1);
        }}
      />

      {/* Apply Advance Dialog */}
      <ApplyAdvanceModal
        open={isAdvanceOpen}
        onOpenChange={setIsAdvanceOpen}
        invoiceId={invoice.id}
        invoiceNumber={invoice.number}
        balance={balance}
        availableAdvance={customerAdvance}
        onSuccess={() => {
          onInvoiceUpdated?.();
          onOpenChange(false);
        }}
      />

      {/* Customer WhatsApp Number Modal */}
      <UpdateMobileModal
        open={isUpdateMobileOpen}
        onOpenChange={setIsUpdateMobileOpen}
        partyName={invoice.party_name || 'Customer'}
        initialMobile={localPartyMobile}
        onSave={handleSaveMobile}
      />
    </>
  );
};
