import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatInputDate } from '../../lib/dates';
import { t, getErrorMessage } from '../../i18n';
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
          .eq('active', true)
          .is('deleted_at', null)
          .order('name')
          .then(({ data }) => {
            setStaffList(data || []);
          });
      }
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

    setSubmitting(true);
    try {
      const { error } = await supabase.rpc('pay_staff', {
        payload: {
          staff_id: selectedStaffId,
          amount: numAmount,
          payout_date: payoutDate,
          mode,
          notes: notes.trim() || null,
        },
      });

      if (error) throw error;

      showToast(t('staff.payout_saved'), 'success');
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
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
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {staffMember ? (
          <div className="p-3 bg-surface rounded-card border border-border">
            <div className="text-xs text-text-muted">{t('staff.title')}</div>
            <div className="font-semibold text-text">{staffMember.name}</div>
            {typeof staffMember.balance === 'number' && (
              <div className="text-xs text-text-muted mt-1">
                {t('staff.payable')}:{' '}
                <strong className={staffMember.balance > 0 ? 'text-primary' : 'text-text'}>
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
          <label className="text-xs font-semibold text-text-muted block mb-1.5">
            {t('staff.payout_amount')} (₹)
          </label>
          <AmountInput
            value={amount}
            onChange={(val) => setAmount(val)}
            placeholder="0.00"
          />
          {currentStaff?.balance && currentStaff.balance > 0 && (
            <div className="flex items-center justify-between text-xs text-text-muted mt-1">
              <span>{t('staff.payable')}: {formatINR(currentStaff.balance)}</span>
              <button
                type="button"
                onClick={() => setAmount(String(currentStaff.balance))}
                className="text-primary hover:underline font-medium"
              >
                Pay Full Balance
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
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

        <Input
          label="Notes (Optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. Month end settlement"
        />

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={submitting}>
            {t('staff.pay_staff')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
