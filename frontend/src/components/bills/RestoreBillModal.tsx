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
      const { data, error } = await supabase.rpc('restore_invoice', {
        id: invoice.id,
        reason: finalReason,
      });

      if (error) throw error;

      if (data?.conflict_info) {
        showToast(`Bill #${invoice.number} restored with note: ${data.conflict_info}`, 'info');
      } else {
        showToast(`Bill #${invoice.number} restored successfully!`, 'success');
      }

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
      title={`Restore Bill #${invoice.number}`}
      description="Restoring will reactivate this bill with its original bill number, ledger dues, and tracked jobs."
    >
      <form onSubmit={handleRestore} className="space-y-4 pt-1">
        {/* Bill Info */}
        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex items-center justify-between text-xs">
          <div>
            <div className="text-slate-500 font-medium">Customer / Party</div>
            <div className="text-slate-900 font-bold text-[13px] mt-0.5">{invoice.party_name || 'Walk-in'}</div>
          </div>
          <div className="text-right">
            <div className="text-slate-500 font-medium">Original Bill Amount</div>
            <div className="text-slate-900 font-bold text-[13px] mt-0.5">{formatINR(invoice.total)}</div>
          </div>
        </div>

        {/* Reason Selection */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
            <span>Restoration Reason</span>
            <span className="text-rose-500">*</span>
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {RESTORATION_REASONS.map((reason) => (
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
                  name="restore_reason"
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
                placeholder="Write specific reason for restoration (mandatory)..."
                value={otherExplanation}
                onChange={(e) => setOtherExplanation(e.target.value)}
                className="w-full text-xs p-2.5 rounded-xl border border-slate-300 focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Accounting Guarantee Note */}
        <div className="bg-[#EAF2F1]/80 border border-[#0F766E]/20 rounded-xl p-3 flex items-start gap-2.5 text-xs text-[#0F766E]">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <div className="space-y-1 leading-relaxed text-[11.5px]">
            <div><strong>Accounting Guarantee:</strong> Original bill number is preserved.</div>
            <div>Any available customer advances from this bill are automatically re-allocated. If the advance was already used elsewhere, remaining balance will show as customer due.</div>
          </div>
        </div>

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
            variant="primary"
            size="sm"
            loading={loading}
            className="bg-[#0F766E] hover:bg-[#0D655E] text-white font-semibold flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restore Bill</span>
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
