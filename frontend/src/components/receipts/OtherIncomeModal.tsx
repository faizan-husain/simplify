import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getErrorMessage, t } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';
import { Building } from 'lucide-react';

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

        {/* Bank Account Picker for Online Modes */}
        {['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && (
          <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200 space-y-2">
            <label className="text-xs font-bold text-primary uppercase tracking-wider flex items-center justify-between">
              <span className="flex items-center gap-1">
                <Building className="w-3.5 h-3.5" />
                <span>Deposited to Bank Account</span>
                <span className="text-danger">*</span>
              </span>
              <span className="text-[10px] text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                Compulsory
              </span>
            </label>
            <select
              value={selectedBankId}
              onChange={(e) => setSelectedBankId(e.target.value)}
              className="w-full text-xs rounded-lg border border-blue-300 p-2.5 bg-white font-bold text-slate-800 focus:ring-2 focus:ring-primary/20 focus:outline-none cursor-pointer"
            >
              <option value="">-- Select Bank Account * --</option>
              {bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.bank_name} ({b.account_name} - {b.account_number || 'General'})
                </option>
              ))}
            </select>
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
