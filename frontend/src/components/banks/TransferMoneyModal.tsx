import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { generateIdempotencyKey, formatConcurrencyError } from '../../lib/idempotency';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Repeat,
  Wallet,
  Info,
} from 'lucide-react';

export type TransferType = 'CASH_TO_BANK' | 'BANK_TO_CASH' | 'BANK_TO_BANK';

export interface BankAccountItem {
  id: string;
  bank_name: string;
  account_name: string;
  account_number: string | null;
  current_balance?: number;
  opening_balance?: number;
}

export interface TransferMoneyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bankAccounts: BankAccountItem[];
  cashBalance?: number;
  initialType?: TransferType;
  onSuccess?: () => void;
}

export const TransferMoneyModal: React.FC<TransferMoneyModalProps> = ({
  open,
  onOpenChange,
  bankAccounts,
  cashBalance = 0,
  initialType = 'CASH_TO_BANK',
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [type, setType] = useState<TransferType>(initialType);
  const [fromBankId, setFromBankId] = useState<string>('');
  const [toBankId, setToBankId] = useState<string>('');
  const [amount, setAmount] = useState<string>('');
  const [transferDate, setTransferDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [reference, setReference] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  // Sync initial type and default bank selections when opened
  useEffect(() => {
    if (open) {
      setType(initialType);
      setAmount('');
      setReference('');
      setNotes('');
      setTransferDate(new Date().toISOString().split('T')[0]);

      if (bankAccounts.length > 0) {
        if (initialType === 'CASH_TO_BANK') {
          setToBankId(bankAccounts[0].id);
          setFromBankId('');
        } else if (initialType === 'BANK_TO_CASH') {
          setFromBankId(bankAccounts[0].id);
          setToBankId('');
        } else if (initialType === 'BANK_TO_BANK') {
          setFromBankId(bankAccounts[0].id);
          setToBankId(bankAccounts.length > 1 ? bankAccounts[1].id : '');
        }
      }
    }
  }, [open, initialType, bankAccounts]);

  // When type changes, auto-select appropriate defaults
  const handleTypeChange = (newType: TransferType) => {
    setType(newType);
    if (bankAccounts.length > 0) {
      if (newType === 'CASH_TO_BANK') {
        setFromBankId('');
        if (!toBankId || toBankId === fromBankId) {
          setToBankId(bankAccounts[0].id);
        }
      } else if (newType === 'BANK_TO_CASH') {
        setToBankId('');
        if (!fromBankId) {
          setFromBankId(bankAccounts[0].id);
        }
      } else if (newType === 'BANK_TO_BANK') {
        const src = fromBankId || bankAccounts[0].id;
        setFromBankId(src);
        const dest = bankAccounts.find((b) => b.id !== src)?.id || '';
        setToBankId(dest);
      }
    }
  };

  const parsedAmount = parseFloat(amount || '0') || 0;

  // Source & Destination account objects
  const sourceBank = bankAccounts.find((b) => b.id === fromBankId);
  const destBank = bankAccounts.find((b) => b.id === toBankId);

  const sourceBalance =
    type === 'CASH_TO_BANK'
      ? cashBalance
      : sourceBank?.current_balance ?? sourceBank?.opening_balance ?? 0;

  const destBalance =
    type === 'BANK_TO_CASH'
      ? cashBalance
      : destBank?.current_balance ?? destBank?.opening_balance ?? 0;

  const sourceAfter = sourceBalance - parsedAmount;
  const destAfter = destBalance + parsedAmount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (parsedAmount <= 0) {
      showToast('Please enter a valid transfer amount greater than 0', 'error');
      return;
    }

    if (type === 'CASH_TO_BANK' && !toBankId) {
      showToast('Please select a destination bank account', 'error');
      return;
    }

    if (type === 'BANK_TO_CASH' && !fromBankId) {
      showToast('Please select a source bank account', 'error');
      return;
    }

    if (type === 'BANK_TO_BANK') {
      if (!fromBankId || !toBankId) {
        showToast('Please select both source and destination bank accounts', 'error');
        return;
      }
      if (fromBankId === toBankId) {
        showToast('Source and destination bank accounts cannot be the same', 'error');
        return;
      }
    }

    setSubmitting(true);
    try {
      const payload: any = {
        transfer_type: type,
        from_bank_account_id: type === 'CASH_TO_BANK' ? null : fromBankId,
        to_bank_account_id: type === 'BANK_TO_CASH' ? null : toBankId,
        amount: parsedAmount,
        transfer_date: transferDate,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
        idempotency_key: generateIdempotencyKey('xfer'),
      };

      const { error } = await supabase.rpc('record_money_transfer', { payload });
      if (error) throw error;

      let successMsg = 'Transfer recorded successfully';
      if (type === 'CASH_TO_BANK') {
        successMsg = `Deposited ${formatINR(parsedAmount)} cash into ${destBank?.bank_name || 'Bank'}`;
      } else if (type === 'BANK_TO_CASH') {
        successMsg = `Withdrew ${formatINR(parsedAmount)} cash from ${sourceBank?.bank_name || 'Bank'}`;
      } else if (type === 'BANK_TO_BANK') {
        successMsg = `Transferred ${formatINR(parsedAmount)} from ${sourceBank?.bank_name} to ${destBank?.bank_name}`;
      }

      showToast(successMsg, 'success');
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      showToast(formatConcurrencyError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Transfer Money (Contra)"
      description="Move funds between Cash and Bank Accounts. Zero impact on P&L, Income, or Expenses."
      className="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        {/* 1. Transfer Type Switcher */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5">
            Transfer Type
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => handleTypeChange('CASH_TO_BANK')}
              className={`p-2.5 rounded-control border text-left flex flex-col items-center justify-center text-center transition-all ${
                type === 'CASH_TO_BANK'
                  ? 'bg-surface-2 border-accent text-text ring-1 ring-accent font-medium'
                  : 'bg-surface border-hair text-text-muted hover:bg-surface-2 hover:text-text'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-surface-2 border border-hair flex items-center justify-center text-accent mb-1.5">
                <ArrowDownLeft className="w-4 h-4" />
              </div>
              <span className="text-xs font-medium leading-tight">Cash &rarr; Bank</span>
              <span className="text-[10px] text-text-muted mt-0.5">Deposit</span>
            </button>

            <button
              type="button"
              onClick={() => handleTypeChange('BANK_TO_CASH')}
              className={`p-2.5 rounded-control border text-left flex flex-col items-center justify-center text-center transition-all ${
                type === 'BANK_TO_CASH'
                  ? 'bg-surface-2 border-accent text-text ring-1 ring-accent font-medium'
                  : 'bg-surface border-hair text-text-muted hover:bg-surface-2 hover:text-text'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-surface-2 border border-hair flex items-center justify-center text-accent mb-1.5">
                <ArrowUpRight className="w-4 h-4" />
              </div>
              <span className="text-xs font-medium leading-tight">Bank &rarr; Cash</span>
              <span className="text-[10px] text-text-muted mt-0.5">Withdrawal</span>
            </button>

            <button
              type="button"
              onClick={() => handleTypeChange('BANK_TO_BANK')}
              className={`p-2.5 rounded-control border text-left flex flex-col items-center justify-center text-center transition-all ${
                type === 'BANK_TO_BANK'
                  ? 'bg-surface-2 border-accent text-text ring-1 ring-accent font-medium'
                  : 'bg-surface border-hair text-text-muted hover:bg-surface-2 hover:text-text'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-surface-2 border border-hair flex items-center justify-center text-accent mb-1.5">
                <Repeat className="w-4 h-4" />
              </div>
              <span className="text-xs font-medium leading-tight">Bank &rarr; Bank</span>
              <span className="text-[10px] text-text-muted mt-0.5">Inter-Bank</span>
            </button>
          </div>
        </div>

        {/* 2. From & To Selectors */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-surface-2 border border-hair rounded-control">
          {/* Source Account */}
          <div>
            <label className="block text-[11px] font-medium text-text-muted uppercase mb-1">
              From (Source)
            </label>
            {type === 'CASH_TO_BANK' ? (
              <div className="p-2.5 bg-surface border border-hair rounded-control flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-accent" />
                  <span className="text-xs font-medium text-text">Cash in Hand</span>
                </div>
                <span className="text-[11px] font-medium text-text tabular-nums bg-surface-2 px-2 py-0.5 rounded-full border border-hair">
                  {formatINR(cashBalance)}
                </span>
              </div>
            ) : (
              <Select
                value={fromBankId}
                onChange={(val) => {
                  setFromBankId(val);
                  if (type === 'BANK_TO_BANK' && toBankId === val) {
                    const other = bankAccounts.find((b) => b.id !== val);
                    setToBankId(other ? other.id : '');
                  }
                }}
                options={
                  bankAccounts.length === 0
                    ? [{ value: '', label: 'No Bank Accounts Configured' }]
                    : bankAccounts.map((b) => ({
                        value: b.id,
                        label: `${b.bank_name} - ${b.account_name}`,
                        sublabel: formatINR(b.current_balance ?? b.opening_balance ?? 0),
                      }))
                }
                size="sm"
                searchable={bankAccounts.length > 5}
              />
            )}
          </div>

          {/* Destination Account */}
          <div>
            <label className="block text-[11px] font-medium text-text-muted uppercase mb-1">
              To (Destination)
            </label>
            {type === 'BANK_TO_CASH' ? (
              <div className="p-2.5 bg-surface border border-hair rounded-control flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-accent" />
                  <span className="text-xs font-medium text-text">Cash in Hand</span>
                </div>
                <span className="text-[11px] font-medium text-text tabular-nums bg-surface-2 px-2 py-0.5 rounded-full border border-hair">
                  {formatINR(cashBalance)}
                </span>
              </div>
            ) : (
              <Select
                value={toBankId}
                onChange={setToBankId}
                options={bankAccounts
                  .filter((b) => type !== 'BANK_TO_BANK' || b.id !== fromBankId)
                  .map((b) => ({
                    value: b.id,
                    label: `${b.bank_name} - ${b.account_name}`,
                    sublabel: formatINR(b.current_balance ?? b.opening_balance ?? 0),
                  }))}
                size="sm"
                searchable={bankAccounts.length > 5}
              />
            )}
          </div>
        </div>

        {/* 3. Amount Input with Quick Buttons */}
        <div>
          <label className="block text-xs font-medium text-text-muted mb-1.5">
            Transfer Amount (₹) <span className="text-danger-fg">*</span>
          </label>
          <AmountInput
            value={amount}
            onChange={(v) => setAmount(v)}
            placeholder="0.00"
            className="text-lg font-medium"
            autoFocus
          />

          {/* Quick preset amount chips */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {[500, 1000, 2000, 5000, 10000].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(String(preset))}
                className="px-2.5 py-1 text-[11px] font-medium bg-surface-2 hover:bg-surface text-text rounded-control transition-colors border border-hair"
              >
                +₹{preset.toLocaleString('en-IN')}
              </button>
            ))}
            {sourceBalance > 0 && (
              <button
                type="button"
                onClick={() => setAmount(String(sourceBalance))}
                className="px-2.5 py-1 text-[11px] font-medium bg-surface-2 hover:bg-surface text-accent rounded-control transition-colors border border-hair"
              >
                Max ({formatINR(sourceBalance)})
              </button>
            )}
          </div>
        </div>

        {/* 4. Live Balance Preview */}
        {parsedAmount > 0 && (
          <div className="p-3.5 bg-surface-2 border border-hair rounded-control text-xs space-y-1.5">
            <div className="text-[11px] font-medium text-text flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-text-muted" />
              <span>Projected Balances After Transfer</span>
            </div>
            <div className="flex items-center justify-between text-text-muted font-normal">
              <span>{type === 'CASH_TO_BANK' ? 'Cash in Hand' : sourceBank?.bank_name}:</span>
              <span className="tabular-nums">
                {formatINR(sourceBalance)} &rarr;{' '}
                <strong className={sourceAfter < 0 ? 'text-danger-fg font-semibold' : 'text-text font-semibold'}>
                  {formatINR(sourceAfter)}
                </strong>
              </span>
            </div>
            <div className="flex items-center justify-between text-text-muted font-normal">
              <span>{type === 'BANK_TO_CASH' ? 'Cash in Hand' : destBank?.bank_name}:</span>
              <span className="tabular-nums">
                {formatINR(destBalance)} &rarr;{' '}
                <strong className="text-text font-semibold">{formatINR(destAfter)}</strong>
              </span>
            </div>
          </div>
        )}

        {/* 5. Date & Reference */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Date
            </label>
            <Input
              type="date"
              value={transferDate}
              onChange={(e) => setTransferDate(e.target.value)}
              className="text-xs"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Reference / Slip No.
            </label>
            <Input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Cheque # / UTR / ATM Ref"
              className="text-xs"
            />
          </div>
        </div>

        {/* 6. Notes */}
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
            Notes / Purpose
          </label>
          <Input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Deposited daily counter cash / Monthly ATM withdrawal"
            className="text-xs"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-hair">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            className="min-w-[140px]"
          >
            Confirm Transfer
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
