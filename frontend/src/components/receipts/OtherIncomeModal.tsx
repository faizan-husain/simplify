import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getErrorMessage, t } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';

export interface OtherIncomeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const INCOME_CATEGORIES = [
  'Other Income',
  'Interest Received',
  'Refund Received',
  'Commission Received',
  'Other',
];

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'] as const;

export const OtherIncomeModal: React.FC<OtherIncomeModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [category, setCategory] = useState(INCOME_CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<typeof PAYMENT_MODES[number]>('CASH');
  const [reference, setReference] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      showToast('Please enter a valid amount', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        amount: amtNum,
        mode,
        kind: 'OTHER_INCOME',
        income_category: category,
        reference: reference.trim() || null,
        receipt_date: receiptDate,
        notes: notes.trim() || null,
      };

      const { error } = await supabase.rpc('create_receipt', { payload });
      if (error) throw error;

      showToast('Income recorded successfully', 'success');
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('receipts.other_income')}
    >
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-text block mb-1">
            {t('receipts.income_category')}
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full h-11 px-3.5 rounded-lg border border-border bg-white text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            {INCOME_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-text block mb-1">Amount (₹)</label>
            <AmountInput
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-text block mb-1">Date</label>
            <Input
              type="date"
              value={receiptDate}
              onChange={(e) => setReceiptDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-text block mb-1.5">Payment Mode</label>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                  mode === m
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-text border-border hover:bg-surface'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <Input
          label="Reference / Transaction ID (Optional)"
          placeholder="e.g. Bank credit ref"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />

        <Input
          label="Notes / Description (Optional)"
          placeholder="Additional notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        <div className="flex gap-2 pt-2">
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
            loading={saving}
          >
            Save Income
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
