import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { getErrorMessage } from '../../i18n';
import { generateIdempotencyKey, formatConcurrencyError } from '../../lib/idempotency';
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
      const { data, error } = await supabase.rpc('cancel_invoice', {
        id: invoice.id,
        reason: finalReason,
        void_receipts: voidReceipts,
        idempotency_key: generateIdempotencyKey('cancel'),
      });

      if (error) {
        console.error('cancel_invoice error:', error);
        throw error;
      }

      if (data?.already_cancelled) {
        showToast(`Bill #${invoice.number} was already cancelled on another device.`, 'info');
      } else {
        showToast(`Bill #${invoice.number} cancelled successfully`, 'success');
      }
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      console.error('Failed to cancel bill:', err);
      const rawMsg = err.message || err.error_description || String(err);
      if (rawMsg.includes('Could not find the function') || rawMsg.includes('schema cache')) {
        showToast('Database function not updated. Please run Migration in Supabase SQL editor.', 'error');
      } else {
        showToast(formatConcurrencyError(err) || getErrorMessage(rawMsg), 'error');
      }
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
        {/* Invoice Summary Badge - Borderless */}
        <div className="bg-slate-100/70 rounded-2xl p-4 flex items-center justify-between text-xs">
          <div>
            <div className="text-slate-400 font-medium text-[11px] uppercase tracking-wider">Customer / Party</div>
            <div className="text-slate-900 font-bold text-sm mt-0.5">{invoice.party_name || 'Walk-in'}</div>
          </div>
          <div className="text-right">
            <div className="text-slate-400 font-medium text-[11px] uppercase tracking-wider">Bill Amount</div>
            <div className="text-slate-900 font-bold text-sm mt-0.5">{formatINR(invoice.total)}</div>
          </div>
        </div>

        {/* Reason Selection - Borderless Pills */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <span>Cancellation Reason</span>
            <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {CANCELLATION_REASONS.map((reason) => {
              const isSelected = selectedReason === reason;
              return (
                <label
                  key={reason}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs cursor-pointer transition-all border-0 ${
                    isSelected
                      ? 'bg-rose-100/70 text-rose-800 font-semibold shadow-xs'
                      : 'bg-slate-100/60 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="cancel_reason"
                    value={reason}
                    checked={isSelected}
                    onChange={() => setSelectedReason(reason)}
                    className="accent-rose-600 w-3.5 h-3.5"
                  />
                  <span>{reason}</span>
                </label>
              );
            })}
          </div>

          {selectedReason === 'Other' && (
            <div className="mt-2 animate-in fade-in duration-150">
              <textarea
                autoFocus
                rows={2}
                placeholder="Write specific reason for cancellation (mandatory)..."
                value={otherExplanation}
                onChange={(e) => setOtherExplanation(e.target.value)}
                className="w-full text-xs p-3 rounded-xl bg-slate-100/70 hover:bg-slate-100 focus:bg-white border-0 ring-0 focus:ring-2 focus:ring-rose-500/30 focus:outline-none transition-all resize-none shadow-xs"
              />
            </div>
          )}
        </div>

        {/* Payment Handling Notice */}
        {paidAmount > 0 && (
          <div className="bg-amber-50/70 rounded-2xl p-3.5 space-y-2 text-xs">
            <div className="flex items-start gap-2.5 text-amber-900">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <div>
                <span className="font-semibold">Recorded Payment of {formatINR(paidAmount)}</span>
                <p className="text-amber-700 text-[11.5px] mt-0.5 leading-relaxed">
                  By default, this payment moves to customer advance balance for future bills.
                </p>
              </div>
            </div>

            <label className="flex items-center gap-2 pt-1 text-[11.5px] text-slate-700 cursor-pointer pl-6">
              <input
                type="checkbox"
                checked={voidReceipts}
                onChange={(e) => setVoidReceipts(e.target.checked)}
                className="accent-rose-600 rounded"
              />
              <span>Void upfront receipt and decrease Cash/Bank balance immediately</span>
            </label>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
          >
            Keep Bill
          </Button>
          <Button
            type="submit"
            variant="danger"
            size="sm"
            loading={loading}
            className="rounded-xl border-0 shadow-sm font-semibold px-4"
          >
            Confirm Cancellation
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
