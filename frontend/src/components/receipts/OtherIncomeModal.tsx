import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getErrorMessage, t } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
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
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [reference, setReference] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      supabase
        .from('bank_accounts')
        .select('id, bank_name, account_name, account_number')
        .is('deleted_at', null)
        .order('bank_name')
        .then(({ data }) => {
          const list = data || [];
          setBankAccounts(list);
          if (list.length > 0) setSelectedBankId(list[0].id);
        });
    }
  }, [open]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      showToast('Please enter a valid amount', 'error');
      return;
    }

    if (['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && !selectedBankId) {
      showToast(`Please select a Bank Account for ${mode} payment`, 'error');
      return;
    }

    setSaving(true);
    try {
      const selectedBank = bankAccounts.find((b) => b.id === selectedBankId);
      const payload = {
        amount: amtNum,
        mode,
        kind: 'OTHER_INCOME',
        income_category: category,
        bank_account_id: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBankId || null : null,
        bank_name: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBank?.bank_name || null : null,
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
      <form onSubmit={handleSave} className="space-y-4 pt-2">
        <Select
          label={t('receipts.income_category')}
          value={category}
          onChange={setCategory}
          options={INCOME_CATEGORIES.map((cat) => ({
            value: cat,
            label: cat,
          }))}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-text-muted block mb-1">Amount (₹)</label>
            <AmountInput
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-medium text-text-muted block mb-1">Date</label>
            <Input
              type="date"
              value={receiptDate}
              onChange={(e) => setReceiptDate(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-text-muted block mb-1.5">Payment Mode</label>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded-control text-xs font-medium transition-all border ${
                  mode === m
                    ? 'bg-surface-2 text-text border-accent ring-1 ring-accent'
                    : 'bg-surface text-text-muted border-hair hover:bg-surface-2 hover:text-text'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        {['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && (
          <div className="p-3.5 bg-surface-2 rounded-control border border-hair space-y-2">
            <Select
              label="Deposited to Bank Account"
              required
              value={selectedBankId}
              onChange={setSelectedBankId}
              options={[
                { value: '', label: '-- Select Bank Account * --' },
                ...bankAccounts.map((b) => ({
                  value: b.id,
                  label: `${b.bank_name} (${b.account_name} - ${b.account_number || 'General'})`,
                })),
              ]}
              size="sm"
              searchable={bankAccounts.length > 5}
            />
          </div>
        )}

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
            loading={saving}
          >
            Save Income
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
