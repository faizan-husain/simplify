import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { t } from '../../i18n';
import { generateIdempotencyKey, formatConcurrencyError } from '../../lib/idempotency';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';

export interface RecordRepaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loan: {
    loan_id: string;
    lender_name: string;
    taken_amount: number;
    outstanding: number;
  } | null;
  onSuccess?: () => void;
}

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'] as const;

export const RecordRepaymentModal: React.FC<RecordRepaymentModalProps> = ({
  open,
  onOpenChange,
  loan,
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [mode, setMode] = useState<typeof PAYMENT_MODES[number]>('BANK');
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [repaymentDate, setRepaymentDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey('loan_repay'));

  useEffect(() => {
    if (open) {
      idempotencyKeyRef.current = generateIdempotencyKey('loan_repay');
      supabase
        .from('bank_accounts')
        .select('id, bank_name, account_name, account_number')
        .is('deleted_at', null)
        .order('bank_name')
        .then(({ data }) => {
          const list = data || [];
          setBankAccounts(list);
          if (list.length > 0 && !selectedBankId) {
            setSelectedBankId(list[0].id);
          }
        });
    }
  }, [open]);

  if (!loan) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const pNum = parseFloat(principal) || 0;
    const iNum = parseFloat(interest) || 0;

    if (pNum <= 0 && iNum <= 0) {
      showToast('Enter principal or interest amount', 'error');
      return;
    }

    if (pNum > loan.outstanding) {
      showToast(`Principal cannot exceed loan balance of ${formatINR(loan.outstanding)}`, 'error');
      return;
    }

    if (['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && !selectedBankId) {
      showToast(`Please select a Bank Account for ${mode} repayment`, 'error');
      return;
    }

    setSaving(true);
    try {
      const selectedBank = bankAccounts.find((b) => b.id === selectedBankId);
      const payload: any = {
        loan_id: loan.loan_id,
        repayment_date: repaymentDate,
        principal: pNum,
        interest: iNum,
        mode,
        bank_account_id: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBankId || null : null,
        bank_name: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBank?.bank_name || null : null,
        notes: notes.trim() || null,
        idempotency_key: idempotencyKeyRef.current,
      };

      const { error } = await supabase.rpc('record_loan_repayment', { payload });
      if (error) throw error;

      idempotencyKeyRef.current = generateIdempotencyKey('loan_repay');

      if (iNum > 0) {
        showToast(`Repayment saved! ₹${iNum} interest recorded as business expense.`, 'success');
      } else {
        showToast('Loan principal repayment recorded successfully', 'success');
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      showToast(formatConcurrencyError(err), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('loans.add_repayment')}
      description={`Repayment for ${loan.lender_name} (Current Outstanding: ${formatINR(loan.outstanding)})`}
    >
      <form onSubmit={handleSave} className="space-y-4 pt-2">
        <div className="bg-surface-2 p-3.5 rounded-control border border-hair text-xs flex justify-between">
          <div>
            <span className="text-text-muted">Total Taken:</span>
            <span className="font-medium text-text ml-1.5 tabular-nums">{formatINR(loan.taken_amount)}</span>
          </div>
          <div>
            <span className="text-text-muted">Balance Due:</span>
            <span className="font-semibold text-danger-fg ml-1.5 tabular-nums">{formatINR(loan.outstanding)}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-medium text-text">{t('loans.principal')} (₹)</label>
              <button
                type="button"
                className="text-[11px] text-accent font-medium hover:underline"
                onClick={() => setPrincipal(loan.outstanding.toString())}
              >
                Full ({formatINR(loan.outstanding)})
              </button>
            </div>
            <AmountInput
              value={principal}
              onChange={setPrincipal}
              placeholder="0.00"
              autoFocus
            />
            <span className="text-[10px] text-text-muted block mt-0.5">
              Reduces loan balance (not an expense)
            </span>
          </div>

          <div>
            <label className="text-xs font-medium text-text block mb-1.5">
              {t('loans.interest')} (₹)
            </label>
            <AmountInput
              value={interest}
              onChange={setInterest}
              placeholder="0.00"
            />
            <span className="text-[10px] text-text-muted block mt-0.5">
              Auto-recorded as business expense
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-text-muted block mb-1">Repayment Date</label>
            <Input
              type="date"
              value={repaymentDate}
              onChange={(e) => setRepaymentDate(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs font-medium text-text-muted block mb-1.5">Mode</label>
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-2.5 py-1.5 rounded-control text-xs font-medium transition-all border ${
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
        </div>

        {/* Bank Account Selection for Online Modes */}
        {['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && (
          <div className="p-3.5 bg-surface-2 rounded-control border border-hair space-y-2">
            <Select
              label="Paid from Bank Account"
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
          label="Notes (Optional)"
          placeholder="e.g. EMI #, Bank transfer ref"
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
            Save Repayment
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
