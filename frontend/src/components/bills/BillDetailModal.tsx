import React, { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getWhatsAppUrl } from '../../lib/auth';
import { getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { StatusDot } from '../ui/StatusDot';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { Printer, Share2, Download } from 'lucide-react';
import { Database } from '../../types/supabase';
import { ApplyAdvanceModal } from './ApplyAdvanceModal';
import { InvoiceDocument } from '../documents/InvoiceDocument';
import { exportInvoicePDF, shareInvoicePDF } from '../documents/pdfExport';

type Invoice = Database['public']['Tables']['invoices']['Row'];
type InvoiceItem = Database['public']['Tables']['invoice_items']['Row'];

export interface BillDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: (Invoice & { invoice_items?: InvoiceItem[] }) | null;
  onInvoiceUpdated?: () => void;
  onReceivePayment?: (invoice: Invoice) => void;
}

export const BillDetailModal: React.FC<BillDetailModalProps> = ({
  open,
  onOpenChange,
  invoice,
  onInvoiceUpdated,
  onReceivePayment,
}) => {
  const { business } = useAuth();
  const { showToast } = useToast();
  const docRef = useRef<HTMLDivElement>(null);

  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [customerAdvance, setCustomerAdvance] = useState(0);
  const [isAdvanceOpen, setIsAdvanceOpen] = useState(false);

  const [showDocPreview, setShowDocPreview] = useState(false);
  const [printFormat, setPrintFormat] = useState<'a4' | 'thermal58' | 'thermal80'>(
    business?.thermal_width === 58 ? 'thermal58' : business?.thermal_width === 80 ? 'thermal80' : 'a4'
  );
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);

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
  const statusVariant = invoice.status === 'CANCELLED' ? 'cancelled' : invoice.paid_amount >= invoice.total ? 'paid' : invoice.paid_amount > 0 ? 'partial' : 'unpaid';

  // UPI QR String per BR-19:
  // upi://pay?pa=<upi_id>&pn=<business name>&am=<balance>&cu=INR&tn=<invoice number>
  const upiQrString = business?.upi_id && balance > 0
    ? `upi://pay?pa=${encodeURIComponent(business.upi_id)}&pn=${encodeURIComponent(business.name)}&am=${balance.toFixed(2)}&cu=INR&tn=${encodeURIComponent(invoice.number)}`
    : null;

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    if (!docRef.current) return;
    setIsGeneratingPdf(true);
    try {
      await exportInvoicePDF(docRef.current, `bill-${invoice.number}.pdf`);
      showToast('PDF downloaded', 'success');
    } catch (err: any) {
      showToast('Failed to export PDF', 'error');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleSharePDF = async () => {
    if (!docRef.current) return;
    setIsGeneratingPdf(true);
    try {
      const shared = await shareInvoicePDF(docRef.current, `bill-${invoice.number}.pdf`, `Bill #${invoice.number}`);
      if (shared) {
        showToast('Shared successfully', 'success');
      } else {
        showToast('PDF downloaded to device', 'info');
      }
    } catch (err: any) {
      showToast('Failed to share PDF', 'error');
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  const handleWhatsApp = async () => {
    if (!invoice.party_mobile) {
      showToast('No customer mobile number for WhatsApp', 'error');
      return;
    }
    try {
      const { data: renderedText, error } = await supabase.rpc('render_whatsapp_template', {
        p_type: 'INVOICE',
        p_context: {
          customer_name: invoice.party_name,
          invoice_no: invoice.number,
          amount: formatINR(invoice.total),
          balance: formatINR(balance),
          due_date: formatDate(invoice.due_date),
          business_name: business?.name || 'SIMPLIFY',
        },
      });

      const message =
        !error && renderedText
          ? renderedText
          : `Hello ${invoice.party_name}, your bill #${invoice.number} of ${formatINR(invoice.total)} has balance ${formatINR(balance)} due on ${formatDate(invoice.due_date)}. - ${business?.name || 'SIMPLIFY'}`;

      const url = getWhatsAppUrl(invoice.party_mobile, message);
      window.open(url, '_blank');
    } catch {
      const fallback = `Hello ${invoice.party_name}, your bill #${invoice.number} of ${formatINR(invoice.total)} has balance ${formatINR(balance)}. - ${business?.name || 'SIMPLIFY'}`;
      window.open(getWhatsAppUrl(invoice.party_mobile, fallback), '_blank');
    }
  };

  const handleConfirmCancel = async () => {
    if (!cancelReason.trim()) {
      showToast('Cancellation reason is required', 'error');
      return;
    }

    setCancelling(true);
    try {
      const { error } = await supabase.rpc('cancel_invoice', {
        id: invoice.id,
        reason: cancelReason.trim(),
      });

      if (error) throw error;

      showToast('Invoice cancelled. Any payments moved to customer advance.', 'info');
      setIsCancelOpen(false);
      onOpenChange(false);
      onInvoiceUpdated?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setCancelling(false);
    }
  };


  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Bill #${invoice.number}`}
      >
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {/* View Mode & Format Controls */}
          <div className="flex items-center justify-between pb-2 border-b border-border">
            <div className="flex gap-1 bg-surface p-0.5 rounded-lg border border-border text-xs">
              <button
                type="button"
                onClick={() => setShowDocPreview(false)}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  !showDocPreview ? 'bg-white text-text shadow-xs' : 'text-text-muted hover:text-text'
                }`}
              >
                Summary
              </button>
              <button
                type="button"
                onClick={() => setShowDocPreview(true)}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  showDocPreview ? 'bg-white text-text shadow-xs' : 'text-text-muted hover:text-text'
                }`}
              >
                Preview Document
              </button>
            </div>

            {showDocPreview && (
              <div className="flex gap-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => setPrintFormat('a4')}
                  className={`px-2 py-0.5 rounded border transition-colors ${
                    printFormat === 'a4'
                      ? 'bg-primary text-white border-primary font-semibold'
                      : 'bg-white text-text-muted border-border hover:bg-surface'
                  }`}
                >
                  A4
                </button>
                <button
                  type="button"
                  onClick={() => setPrintFormat('thermal58')}
                  className={`px-2 py-0.5 rounded border transition-colors ${
                    printFormat === 'thermal58'
                      ? 'bg-primary text-white border-primary font-semibold'
                      : 'bg-white text-text-muted border-border hover:bg-surface'
                  }`}
                >
                  58mm
                </button>
                <button
                  type="button"
                  onClick={() => setPrintFormat('thermal80')}
                  className={`px-2 py-0.5 rounded border transition-colors ${
                    printFormat === 'thermal80'
                      ? 'bg-primary text-white border-primary font-semibold'
                      : 'bg-white text-text-muted border-border hover:bg-surface'
                  }`}
                >
                  80mm
                </button>
              </div>
            )}
          </div>

          {showDocPreview ? (
            /* Document Preview */
            <div className="bg-surface/50 p-2 rounded-lg border border-border overflow-x-auto">
              <InvoiceDocument
                invoice={invoice}
                business={business}
                format={printFormat}
              />
            </div>
          ) : (
            /* Standard Quick Summary */
            <>
              {/* Header Details */}
              <div className="flex items-start justify-between pb-3 border-b border-border">
                <div>
                  <div className="text-sm font-bold text-text">{invoice.party_name}</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {invoice.party_mobile || 'Walk-in'} · Date: {formatDate(invoice.invoice_date)}
                  </div>
                </div>
                <div className="text-right flex flex-col items-end">
                  <StatusDot status={statusVariant} />
                  {isOverdue && <span className="text-[10px] text-danger font-bold mt-0.5">OVERDUE</span>}
                </div>
              </div>

              {/* Items Table */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Items
                </div>
                <div className="border border-border rounded-lg overflow-hidden text-xs">
                  <div className="bg-surface grid grid-cols-12 p-2 font-semibold text-text-muted border-b border-border">
                    <div className="col-span-6">Description</div>
                    <div className="col-span-2 text-center">Qty</div>
                    <div className="col-span-2 text-right">Rate</div>
                    <div className="col-span-2 text-right">Amount</div>
                  </div>
                  <div className="divide-y divide-border/60">
                    {invoice.invoice_items && invoice.invoice_items.length > 0 ? (
                      invoice.invoice_items.map((item) => (
                        <div key={item.id} className="grid grid-cols-12 p-2 text-text">
                          <div className="col-span-6 truncate font-medium">
                            {item.description}
                            {item.applicant_name && (
                              <span className="block text-[10px] text-text-muted">
                                Applicant: {item.applicant_name}
                              </span>
                            )}
                          </div>
                          <div className="col-span-2 text-center text-text-muted">{item.quantity}</div>
                          <div className="col-span-2 text-right text-text-muted">{formatINR(item.rate)}</div>
                          <div className="col-span-2 text-right font-semibold">{formatINR(item.amount)}</div>
                        </div>
                      ))
                    ) : (
                      <div className="p-3 text-center text-text-muted">No item details</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Totals Summary */}
              <div className="bg-surface p-3 rounded-lg border border-border space-y-1.5 text-xs">
                <div className="flex justify-between text-text-muted">
                  <span>Subtotal</span>
                  <span>{formatINR(invoice.subtotal)}</span>
                </div>
                {invoice.discount_amount > 0 && (
                  <div className="flex justify-between text-danger">
                    <span>Discount ({invoice.discount_type})</span>
                    <span>-{formatINR(invoice.discount_amount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-text pt-1 border-t border-border">
                  <span>Total</span>
                  <span>{formatINR(invoice.total)}</span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>Paid</span>
                  <span className="text-success font-semibold">{formatINR(invoice.paid_amount)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-text">
                  <span>Balance Due</span>
                  <span className={balance > 0 ? 'text-danger' : 'text-success'}>
                    {formatINR(balance)}
                  </span>
                </div>
              </div>

              {/* UPI QR per BR-19 */}
              {upiQrString && balance > 0 && (
                <div className="flex flex-col items-center justify-center p-3 bg-white border border-border rounded-lg text-center">
                  <span className="text-xs font-semibold text-text mb-2">
                    Scan & Pay via UPI ({formatINR(balance)})
                  </span>
                  <QRCodeSVG value={upiQrString} size={130} level="M" />
                  <span className="text-[10px] text-text-muted mt-1.5">UPI ID: {business?.upi_id}</span>
                </div>
              )}
            </>
          )}

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handlePrint}
            >
              <Printer className="w-4 h-4 mr-1.5" />
              <span>Print ({printFormat === 'a4' ? 'A4' : printFormat === 'thermal58' ? '58mm' : '80mm'})</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handleWhatsApp}
            >
              <Share2 className="w-4 h-4 mr-1.5" />
              <span>WhatsApp</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="md"
              loading={isGeneratingPdf}
              onClick={handleDownloadPDF}
            >
              <Download className="w-4 h-4 mr-1.5" />
              <span>Download PDF</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="md"
              loading={isGeneratingPdf}
              onClick={handleSharePDF}
            >
              <Share2 className="w-4 h-4 mr-1.5" />
              <span>Share PDF</span>
            </Button>

            {balance > 0 && customerAdvance > 0 && invoice.status === 'ACTIVE' && (
              <Button
                type="button"
                variant="outline"
                size="md"
                className="col-span-2 border-primary text-primary hover:bg-primary/5"
                onClick={() => setIsAdvanceOpen(true)}
              >
                Apply Advance ({formatINR(customerAdvance)} available)
              </Button>
            )}

            {balance > 0 && invoice.status === 'ACTIVE' && onReceivePayment && (
              <Button
                type="button"
                variant="primary"
                size="md"
                className="col-span-2"
                onClick={() => {
                  onOpenChange(false);
                  onReceivePayment(invoice);
                }}
              >
                Receive Payment ({formatINR(balance)})
              </Button>
            )}

            {invoice.status === 'ACTIVE' && (
              <Button
                type="button"
                variant="danger"
                size="md"
                className="col-span-2"
                onClick={() => setIsCancelOpen(true)}
              >
                Cancel Bill
              </Button>
            )}
          </div>
        </div>
      </Dialog>

      {/* Hidden container for print and offscreen container for PDF generation */}
      <div id="print-invoice-root" className="hidden print:block">
        <InvoiceDocument invoice={invoice} business={business} format={printFormat} />
      </div>
      <div style={{ position: 'fixed', left: '-9999px', top: '-9999px', width: '210mm' }}>
        <InvoiceDocument ref={docRef} invoice={invoice} business={business} format="a4" />
      </div>


      {/* Cancel Bill Confirmation Dialog */}
      <Dialog
        open={isCancelOpen}
        onOpenChange={setIsCancelOpen}
        title="Cancel Bill"
        description="Cancelling an invoice releases any payments to customer advance. Cancelled invoices cannot be undone."
      >
        <div className="space-y-4">
          <input
            type="text"
            placeholder="Reason for cancellation (mandatory)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            className="w-full h-11 px-3.5 rounded-lg border border-border text-sm"
          />

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="md"
              className="flex-1"
              onClick={() => setIsCancelOpen(false)}
            >
              Back
            </Button>
            <Button
              variant="danger"
              size="md"
              className="flex-1"
              loading={cancelling}
              onClick={handleConfirmCancel}
            >
              Confirm Cancel
            </Button>
          </div>
        </div>
      </Dialog>
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
    </>
  );
};
