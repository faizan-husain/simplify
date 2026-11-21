import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { getErrorMessage, t } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';

export interface ApplyAdvanceModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceNumber: string;
  balance: number;
  availableAdvance: number;
  onSuccess?: () => void;
}

export const ApplyAdvanceModal: React.FC<ApplyAdvanceModalProps> = ({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  balance,
  availableAdvance,
  onSuccess,
}) => {
  const { showToast } = useToast();
  const maxApplicable = Math.min(balance, availableAdvance);
  const [amount, setAmount] = useState(maxApplicable.toString());
  const [applying, setApplying] = useState(false);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }
    if (amtNum > maxApplicable) {
      showToast(`Amount cannot exceed ${formatINR(maxApplicable)}`, 'error');
      return;
    }

    setApplying(true);
    try {
      const { error } = await supabase.rpc('apply_advance', {
        invoice_id: invoiceId,
        amount: amtNum,
      });

      if (error) throw error;

      showToast(`Applied ${formatINR(amtNum)} advance to bill #${invoiceNumber}`, 'success');
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('billing.apply_advance')}
      description={`Apply customer advance balance to Bill #${invoiceNumber}`}
    >
      <form onSubmit={handleApply} className="space-y-4 pt-2">
        <div className="bg-surface-2 p-3.5 rounded-control border border-hair text-xs space-y-2">
          <div className="flex justify-between text-text-muted">
            <span>Bill Balance Due:</span>
            <span className="font-semibold text-danger-fg tabular-nums">{formatINR(balance)}</span>
          </div>
          <div className="flex justify-between text-text-muted">
            <span>Customer Available Advance:</span>
            <span className="font-semibold text-accent tabular-nums">{formatINR(availableAdvance)}</span>
          </div>
          <div className="flex justify-between text-text font-medium pt-1.5 border-t border-hair">
            <span>Max Applicable:</span>
            <span className="text-text tabular-nums">{formatINR(maxApplicable)}</span>
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-1.5">
            <label className="text-xs font-medium text-text">Amount to Apply (₹)</label>
            <button
              type="button"
              className="text-[11px] text-accent font-medium hover:underline"
              onClick={() => setAmount(maxApplicable.toString())}
            >
              Max ({formatINR(maxApplicable)})
            </button>
          </div>
          <AmountInput
            value={amount}
            onChange={setAmount}
            placeholder="0.00"
            autoFocus
          />
        </div>

        <div className="flex gap-2 pt-3 border-t border-hair">
          <Button
            type="button"
            variant="outline"
            size="md"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            className="flex-1"
            loading={applying}
          >
            Apply Advance
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
