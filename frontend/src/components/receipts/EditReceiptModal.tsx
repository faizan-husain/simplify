import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import { Banknote, Building, Smartphone, CreditCard, Receipt as ReceiptIcon } from 'lucide-react';

interface EditReceiptModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: any | null;
  onSuccess: () => void;
}

const PAYMENT_MODES = [
  { id: 'CASH', label: 'Cash', icon: Banknote },
  { id: 'BANK', label: 'Bank', icon: Building },
  { id: 'UPI', label: 'UPI', icon: Smartphone },
  { id: 'CARD', label: 'Card', icon: CreditCard },
  { id: 'CHEQUE', label: 'Cheque', icon: ReceiptIcon },
] as const;

export const EditReceiptModal: React.FC<EditReceiptModalProps> = ({
  open,
  onOpenChange,
  receipt,
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [receiptDate, setReceiptDate] = useState('');
  const [mode, setMode] = useState<string>('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [incomeCategory, setIncomeCategory] = useState('');
  const [bankAccounts, setBankAccounts] = useState<Array<{ id: string; bank_name: string; account_name: string; account_number?: string | null }>>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .from('bank_accounts')
      .select('id, bank_name, account_name, account_number')
      .is('deleted_at', null)
      .order('bank_name')
      .then(({ data }) => {
        if (data) setBankAccounts(data);
      });
  }, []);

  useEffect(() => {
    if (receipt && open) {
      setReceiptDate(receipt.receipt_date || '');
      setMode(receipt.mode || 'CASH');
      setReference(receipt.reference || '');
      setNotes(receipt.notes || '');
      setIncomeCategory(receipt.income_category || '');
      setSelectedBankId(receipt.bank_account_id || '');
    }
  }, [receipt, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!receipt) return;

    if (mode !== 'CASH' && !selectedBankId) {
      showToast(`Please select a Bank Account for ${mode} payment`, 'error');
      return;
    }

    setSaving(true);
    try {
      const selectedBank = bankAccounts.find((b) => b.id === selectedBankId);
      const payload: any = {
        receipt_date: receiptDate,
        mode,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        bank_account_id: mode !== 'CASH' ? selectedBankId || null : null,
        bank_name: mode !== 'CASH' ? selectedBank?.bank_name || null : null,
      };

      if (receipt.kind === 'OTHER_INCOME') {
        payload.income_category = incomeCategory.trim() || null;
      }

      const { error } = await supabase.rpc('update_receipt', {
        id: receipt.id,
        payload,
      });

      if (error) throw error;

      showToast(`Receipt #${receipt.number} updated successfully!`, 'success');
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!receipt) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit Receipt #${receipt.number}`}
      description="Update payment method, date, bank account, and reference notes"
      className="max-w-md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Read-only Amount & Customer / Kind Banner */}
        <div className="bg-[#EEF0F3] border-0 shadow-2xs rounded-xl p-3.5 flex items-center justify-between text-xs">
          <div>
            <div className="font-bold text-slate-800">
              {receipt.customer?.name || (receipt.kind === 'OTHER_INCOME' ? 'Other Income' : 'Receipt')}
            </div>
            <div className="text-slate-500 text-[11px]">
              {receipt.kind === 'OTHER_INCOME' ? 'Non-bill Income' : 'Payment against bills'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-base font-bold text-emerald-600">
              {formatINR(receipt.amount)}
            </div>
            <div className="text-[10px] text-slate-400">Amount (Locked)</div>
          </div>
        </div>

        {/* Receipt Date */}
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1">
            Receipt Date
          </label>
          <Input
            type="date"
            required
            value={receiptDate}
            onChange={(e) => setReceiptDate(e.target.value)}
          />
        </div>

        {/* Payment Mode Selector */}
        <div>
          <label className="text-xs font-semibold text-slate-700 block mb-1.5">
            Payment Mode
          </label>
          <div className="grid grid-cols-5 gap-1 sm:gap-1.5 bg-slate-100 p-1 rounded-xl border border-slate-200">
            {PAYMENT_MODES.map((m) => {
              const Icon = m.icon;
              const isSelected = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  className={`py-2 px-0.5 sm:px-1 flex flex-col items-center gap-1 rounded-lg text-[10px] sm:text-[11px] font-medium transition-all cursor-pointer min-w-0 ${
                    isSelected
                      ? 'bg-white text-accent shadow-xs font-semibold'
                      : 'text-text-muted hover:text-text'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
                  <span className="truncate w-full text-center">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bank Account Selection (if non-cash) */}
        {mode !== 'CASH' && (
          <Select
            label="Select Bank Account"
            required
            value={selectedBankId}
            onChange={setSelectedBankId}
            options={[
              { value: '', label: '-- Choose Bank Account --' },
              ...bankAccounts.map((b) => ({
                value: b.id,
                label: `${b.bank_name} - ${b.account_name} ${b.account_number ? `(..${b.account_number.slice(-4)})` : ''}`,
              })),
            ]}
            placeholder="-- Choose Bank Account --"
            searchable={bankAccounts.length > 5}
          />
        )}

        {/* Income Category (if OTHER_INCOME) */}
        {receipt.kind === 'OTHER_INCOME' && (
          <div>
            <label className="text-xs font-medium text-text block mb-1">
              Income Category
            </label>
            <Input
              type="text"
              placeholder="e.g. Consultation, Refund, Scrap"
              value={incomeCategory}
              onChange={(e) => setIncomeCategory(e.target.value)}
            />
          </div>
        )}

        {/* Reference / UTR / Cheque No */}
        <div>
          <label className="text-xs font-medium text-text block mb-1">
            Reference / Transaction ID (Optional)
          </label>
          <Input
            type="text"
            placeholder="e.g. UTR12345678, Chq #00124"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs font-medium text-text block mb-1">
            Notes (Optional)
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Remarks or payment notes..."
            className="w-full p-2.5 rounded-xl border border-border text-xs font-medium text-text placeholder:text-text-muted focus:border-accent focus:outline-none resize-none bg-surface"
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2 border-t border-slate-200">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={saving}
            className="w-full sm:w-auto"
          >
            Save Changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
