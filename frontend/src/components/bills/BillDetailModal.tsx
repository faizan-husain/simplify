import React, { useState } from 'react';
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
import { Printer, Share2 } from 'lucide-react';
import { Database } from '../../types/supabase';

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

  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);

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

  const handleWhatsApp = () => {
    if (!invoice.party_mobile) {
      showToast('No customer mobile number for WhatsApp', 'error');
      return;
    }
    const message = `Hello ${invoice.party_name}, your bill #${invoice.number} of ${formatINR(invoice.total)} has balance ${formatINR(balance)} due on ${formatDate(invoice.due_date)}. - ${business?.name || 'SIMPLIFY'}`;
    const url = getWhatsAppUrl(invoice.party_mobile, message);
    window.open(url, '_blank');
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

          {/* Actions */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={handlePrint}
            >
              <Printer className="w-4 h-4 mr-1.5" />
              <span>Print</span>
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
    </>
  );
};
