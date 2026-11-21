import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { AlertTriangle } from 'lucide-react';

export interface CancelBillModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    number: string;
    party_name?: string | null;
    total: number;
    paid_amount?: number | null;
    cancel_reason?: string | null;
  } | null;
  onSuccess?: () => void;
}

const CANCELLATION_REASONS = [
  'Bill created by mistake',
  'Wrong amount entered',
  'Duplicate bill',
  'Customer cancelled service',
  'Other',
];

export const CancelBillModal: React.FC<CancelBillModalProps> = ({
  open,
  onOpenChange,
  invoice,
  onSuccess,
}) => {
  const { showToast } = useToast();
  const [selectedReason, setSelectedReason] = useState<string>(CANCELLATION_REASONS[0]);
  const [otherExplanation, setOtherExplanation] = useState('');
  const [voidReceipts, setVoidReceipts] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!invoice) return null;

  const paidAmount = Number(invoice.paid_amount || 0);

  const handleCancel = async (e: React.FormEvent) => {
    e.preventDefault();

    let finalReason = selectedReason;
    if (selectedReason === 'Other') {
      if (!otherExplanation.trim()) {
        showToast('Please provide a written explanation for cancellation', 'error');
        return;
      }
      finalReason = otherExplanation.trim();
    }

    setLoading(true);
    try {
      const { error } = await supabase.rpc('cancel_invoice', {
        id: invoice.id,
        reason: finalReason,
        void_receipts: voidReceipts,
      });

      if (error) throw error;

      showToast(`Bill #${invoice.number} cancelled successfully`, 'success');
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Cancel Bill #${invoice.number}`}
      description="Cancelling will remove this bill from active revenue and customer dues."
    >
      <form onSubmit={handleCancel} className="space-y-4 pt-1">
        {/* Invoice Summary Badge */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex items-center justify-between text-xs">
          <div>
            <div className="text-slate-500 font-medium">Customer / Party</div>
            <div className="text-slate-900 font-bold text-[13px] mt-0.5">{invoice.party_name || 'Walk-in'}</div>
          </div>
          <div className="text-right">
            <div className="text-slate-500 font-medium">Bill Amount</div>
            <div className="text-slate-900 font-bold text-[13px] mt-0.5">{formatINR(invoice.total)}</div>
          </div>
        </div>

        {/* Reason Selection */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <span>Cancellation Reason</span>
            <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {CANCELLATION_REASONS.map((reason) => (
              <label
                key={reason}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs cursor-pointer transition-all ${
                  selectedReason === reason
                    ? 'border-[#0F766E] bg-[#EAF2F1] text-[#0F766E] font-semibold'
                    : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="cancel_reason"
                  value={reason}
                  checked={selectedReason === reason}
                  onChange={() => setSelectedReason(reason)}
                  className="accent-[#0F766E] w-3.5 h-3.5"
                />
                <span>{reason}</span>
              </label>
            ))}
          </div>

          {selectedReason === 'Other' && (
            <div className="mt-2 animate-in fade-in duration-150">
              <textarea
                autoFocus
                rows={2}
                placeholder="Write specific reason for cancellation (mandatory)..."
                value={otherExplanation}
                onChange={(e) => setOtherExplanation(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Payment Handling if Bill had Payments */}
        {paidAmount > 0 && (
          <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-amber-900">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>Paid Amount: {formatINR(paidAmount)}</span>
            </div>
            <div className="text-[11.5px] text-amber-800 leading-relaxed">
              How should the collected payment be recorded?
            </div>
            <div className="space-y-1 pt-1">
              <label className="flex items-start gap-2 cursor-pointer text-[12px] text-slate-700">
                <input
                  type="radio"
                  name="payment_action"
                  checked={!voidReceipts}
                  onChange={() => setVoidReceipts(false)}
                  className="accent-[#0F766E] w-3.5 h-3.5 mt-0.5"
                />
                <span>
                  <strong>Keep as Customer Advance (Credit):</strong> Money stays in Cash/Bank, customer gets {formatINR(paidAmount)} credit for future bills.
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-[12px] text-slate-700">
                <input
                  type="radio"
                  name="payment_action"
                  checked={voidReceipts}
                  onChange={() => setVoidReceipts(true)}
                  className="accent-[#0F766E] w-3.5 h-3.5 mt-0.5"
                />
                <span>
                  <strong>Void / Return Money:</strong> Bill was a mistake or money was refunded. Decreases Cash/Bank balance immediately.
                </span>
              </label>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            size="sm"
            loading={loading}
            className="bg-rose-600 hover:bg-rose-700 text-white font-semibold"
          >
            Confirm Cancellation
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
