import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatInputDate } from '../../lib/dates';
import { t } from '../../i18n';
import { generateIdempotencyKey, formatConcurrencyError } from '../../lib/idempotency';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';

export interface PayStaffModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffMember?: { id: string; name: string; balance?: number } | null;
  onSuccess?: () => void;
}

export const PayStaffModal: React.FC<PayStaffModalProps> = ({
  open,
  onOpenChange,
  staffMember,
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [staffList, setStaffList] = useState<any[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState('');
  const [amount, setAmount] = useState('');
  const [payoutDate, setPayoutDate] = useState(formatInputDate());
  const [mode, setMode] = useState('CASH');
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPayoutDate(formatInputDate());
      setNotes('');
      setMode('CASH');

      if (staffMember?.id) {
        setSelectedStaffId(staffMember.id);
        if (staffMember.balance && staffMember.balance > 0) {
          setAmount(String(staffMember.balance));
        } else {
          setAmount('');
        }
      } else {
        setSelectedStaffId('');
        setAmount('');
        // Load active staff members
        supabase
          .from('members')
          .select('id, name, role')
          .eq('role', 'STAFF')
          .eq('active', true)
          .is('deleted_at', null)
          .order('name')
          .then(({ data }) => {
            setStaffList(data || []);
          });
      }

      // Load bank accounts
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
  }, [open, staffMember]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaffId) {
      showToast(t('staff.select_staff'), 'error');
      return;
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      showToast('Please enter a valid payout amount', 'error');
      return;
    }

    if (['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && !selectedBankId) {
      showToast(`Please select a Bank Account for ${mode} payout`, 'error');
      return;
    }

    setSubmitting(true);
    try {
      const selectedBank = bankAccounts.find((b) => b.id === selectedBankId);
      const { error } = await supabase.rpc('pay_staff', {
        payload: {
          staff_id: selectedStaffId,
          amount: numAmount,
          payout_date: payoutDate,
          mode,
          bank_account_id: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBankId || null : null,
          bank_name: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBank?.bank_name || null : null,
          notes: notes.trim() || null,
          idempotency_key: generateIdempotencyKey('payout'),
        },
      });

      if (error) throw error;

      showToast(t('staff.payout_saved'), 'success');
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      showToast(formatConcurrencyError(err), 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const currentStaff =
    staffMember?.id === selectedStaffId
      ? staffMember
      : staffList.find((s) => s.id === selectedStaffId);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('staff.pay_staff')}
      description="Record a salary or commission payout. An operating expense will automatically be created in 'Salary / Commission'."
      className="sm:max-w-[480px] border-0 shadow-[0_8px_30px_rgba(0,0,0,0.1)]"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {staffMember ? (
          <div className="p-3.5 bg-surface-2 rounded-2xl border-0 shadow-2xs">
            <div className="text-xs text-text-muted">{t('staff.title')}</div>
            <div className="font-medium text-text">{staffMember.name}</div>
            {typeof staffMember.balance === 'number' && (
              <div className="text-xs text-text-muted mt-1">
                {t('staff.payable')}:{' '}
                <strong className={staffMember.balance > 0 ? 'text-accent tabular-nums' : 'text-text tabular-nums'}>
                  {formatINR(staffMember.balance)}
                </strong>
              </div>
            )}
          </div>
        ) : (
          <Select
            label={t('staff.select_staff')}
            value={selectedStaffId}
            onChange={(val) => setSelectedStaffId(val)}
            options={[
              { label: `-- ${t('staff.select_staff')} --`, value: '' },
              ...staffList.map((s) => ({
                label: `${s.name} (${s.role})`,
                value: s.id,
              })),
            ]}
          />
        )}

        <div>
          <label className="text-xs font-medium text-text-muted block mb-1.5">
            {t('staff.payout_amount')} (₹)
          </label>
          <AmountInput
            value={amount}
            onChange={(val) => setAmount(val)}
            placeholder="0.00"
          />
          {currentStaff?.balance && currentStaff.balance > 0 && (
            <div className="flex items-center justify-between text-xs text-text-muted mt-1.5">
              <span>{t('staff.payable')}: <span className="tabular-nums font-medium text-text">{formatINR(currentStaff.balance)}</span></span>
              <button
                type="button"
                onClick={() => setAmount(String(currentStaff.balance))}
                className="text-accent hover:underline font-medium text-[11px]"
              >
                Pay Full Balance
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            type="date"
            label={t('staff.payout_date')}
            value={payoutDate}
            onChange={(e) => setPayoutDate(e.target.value)}
            required
          />
          <Select
            label={t('bills.mode')}
            value={mode}
            onChange={(val) => setMode(val)}
            options={[
              { label: t('receipts.mode_cash'), value: 'CASH' },
              { label: t('receipts.mode_upi'), value: 'UPI' },
              { label: t('receipts.mode_bank'), value: 'BANK' },
              { label: t('receipts.mode_cheque'), value: 'CHEQUE' },
            ]}
          />
        </div>

        {['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && (
          <div className="p-3.5 bg-surface-2 rounded-2xl border-0 shadow-2xs space-y-2">
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
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Month end settlement"
        />

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            {t('staff.pay_staff')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
