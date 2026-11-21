import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { RotateCcw, Info } from 'lucide-react';

export interface RestoreBillModalProps {
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

const RESTORATION_REASONS = [
  'Cancelled by mistake',
  'Customer confirmed the service',
  'Cancellation reversed',
  'Other',
];

export const RestoreBillModal: React.FC<RestoreBillModalProps> = ({
  open,
  onOpenChange,
  invoice,
  onSuccess,
}) => {
  const { showToast } = useToast();
  const [selectedReason, setSelectedReason] = useState<string>(RESTORATION_REASONS[0]);
  const [otherExplanation, setOtherExplanation] = useState('');
  const [loading, setLoading] = useState(false);

  if (!invoice) return null;

  const handleRestore = async (e: React.FormEvent) => {
    e.preventDefault();

    let finalReason = selectedReason;
    if (selectedReason === 'Other') {
      if (!otherExplanation.trim()) {
        showToast('Please provide a written explanation for restoration', 'error');
        return;
      }
      finalReason = otherExplanation.trim();
    }

    setLoading(true);
    try {
      let rpcRes = await supabase.rpc('restore_invoice', {
        id: invoice.id,
        reason: finalReason,
      });

      // If schema cache says argument mismatch or parameter named p_invoice_id
      if (
        rpcRes.error &&
        (rpcRes.error.message.includes('named arguments') ||
          rpcRes.error.message.includes('p_invoice_id') ||
          rpcRes.error.message.includes('parameter') ||
          rpcRes.error.message.includes('schema cache'))
      ) {
        const retryRes = await supabase.rpc('restore_invoice', {
          p_invoice_id: invoice.id,
          p_reason: finalReason,
        } as any);
        if (!retryRes.error) {
          rpcRes = retryRes;
        }
      }

      if (rpcRes.error) {
        console.error('restore_invoice error:', rpcRes.error);
        throw rpcRes.error;
      }

      const data = rpcRes.data;
      if (data?.conflict_info) {
        showToast(`Bill #${invoice.number} restored with note: ${data.conflict_info}`, 'info');
      } else {
        showToast(`Bill #${invoice.number} restored successfully!`, 'success');
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      console.error('Failed to restore bill:', err);
      const rawMsg = err.message || err.error_description || String(err);
      if (rawMsg.includes('Could not find the function') || rawMsg.includes('schema cache')) {
        showToast('Database function not updated in Supabase. Please run the SQL migration in Supabase SQL Editor.', 'error');
      } else {
        const friendly = getErrorMessage(rawMsg);
        showToast(friendly !== 'An error occurred. Please try again.' ? friendly : (err.message || 'Failed to restore bill'), 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Restore Bill #${invoice.number}`}
      description="Reactivate this bill with its original bill number, ledger dues, and tracked jobs."
    >
      <form onSubmit={handleRestore} className="space-y-4 pt-1">
        {/* Bill Summary - Clean Borderless Surface */}
        <div className="bg-slate-100/70 rounded-2xl p-4 flex items-center justify-between text-xs">
          <div>
            <div className="text-slate-400 font-medium text-[11px] uppercase tracking-wider">Party / Customer</div>
            <div className="text-slate-900 font-bold text-sm mt-0.5">{invoice.party_name || 'Walk-in'}</div>
          </div>
          <div className="text-right">
            <div className="text-slate-400 font-medium text-[11px] uppercase tracking-wider">Original Amount</div>
            <div className="text-slate-900 font-bold text-sm mt-0.5">{formatINR(invoice.total)}</div>
          </div>
        </div>

        {/* Reason Selection - Clean Borderless Pills */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <span>Restoration Reason</span>
            <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {RESTORATION_REASONS.map((reason) => {
              const isSelected = selectedReason === reason;
              return (
                <label
                  key={reason}
                  className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs cursor-pointer transition-all border-0 ${
                    isSelected
                      ? 'bg-[#EAF2F1] text-[#0F766E] font-semibold shadow-xs'
                      : 'bg-slate-100/60 hover:bg-slate-100 text-slate-700'
                  }`}
                >
                  <input
                    type="radio"
                    name="restore_reason"
                    value={reason}
                    checked={isSelected}
                    onChange={() => setSelectedReason(reason)}
                    className="accent-[#0F766E] w-3.5 h-3.5"
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
                placeholder="Write specific reason for restoration (mandatory)..."
                value={otherExplanation}
                onChange={(e) => setOtherExplanation(e.target.value)}
                className="w-full text-xs p-3 rounded-xl bg-slate-100/70 hover:bg-slate-100 focus:bg-white border-0 ring-0 focus:ring-2 focus:ring-[#0F766E]/30 focus:outline-none transition-all resize-none shadow-xs"
              />
            </div>
          )}
        </div>

        {/* Accounting Guarantee Box - Soft Borderless Tint */}
        <div className="bg-[#EAF2F1]/70 rounded-2xl p-3.5 flex items-start gap-3 text-xs text-[#0F766E]">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-0.5 leading-relaxed text-[11.5px]">
            <div className="font-semibold text-slate-900">Accounting Guarantee</div>
            <div className="text-slate-600">
              The original bill number is preserved. Any available customer advance will be automatically re-allocated back to this bill.
            </div>
          </div>
        </div>

        {/* Action Buttons - Clean Spacing without Border Line */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
            className="rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={loading}
            className="bg-[#0F766E] hover:bg-[#0D655E] text-white font-semibold rounded-xl border-0 shadow-sm flex items-center gap-1.5 px-4"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore Bill</span>
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
