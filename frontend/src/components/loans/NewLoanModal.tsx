import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getErrorMessage, t } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';

export interface NewLoanModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loanToEdit?: any | null;
  onSuccess?: () => void;
}

export const NewLoanModal: React.FC<NewLoanModalProps> = ({
  open,
  onOpenChange,
  loanToEdit,
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [lenderName, setLenderName] = useState('');
  const [amount, setAmount] = useState('');
  const [loanDate, setLoanDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [interestRate, setInterestRate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (open && loanToEdit) {
      setLenderName(loanToEdit.lender_name || '');
      setAmount(String(loanToEdit.amount || ''));
      setLoanDate(loanToEdit.loan_date || new Date().toISOString().split('T')[0]);
      setInterestRate(loanToEdit.interest_rate ? String(loanToEdit.interest_rate) : '');
      setNotes(loanToEdit.notes || '');
    } else if (open && !loanToEdit) {
      setLenderName('');
      setAmount('');
      setInterestRate('');
      setNotes('');
      setLoanDate(new Date().toISOString().split('T')[0]);
    }
  }, [open, loanToEdit]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lenderName.trim()) {
      showToast('Please enter the lender name', 'error');
      return;
    }

    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      showToast('Please enter a valid loan amount', 'error');
      return;
    }

    setSaving(true);
    try {
      if (loanToEdit) {
        const { error } = await supabase
          .from('loans')
          .update({
            lender_name: lenderName.trim(),
            amount: amtNum,
            loan_date: loanDate,
            interest_rate: interestRate ? parseFloat(interestRate) : null,
            notes: notes.trim() || null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', loanToEdit.id || loanToEdit.loan_id);

        if (error) throw error;
        showToast('Loan updated successfully', 'success');
      } else {
        const { error } = await supabase.from('loans').insert({
          lender_name: lenderName.trim(),
          amount: amtNum,
          loan_date: loanDate,
          interest_rate: interestRate ? parseFloat(interestRate) : null,
          notes: notes.trim() || null,
        });

        if (error) throw error;
        showToast('Loan recorded in Capital Ledger (excluded from profit)', 'success');
      }

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
      title={loanToEdit ? 'Edit Loan' : t('loans.add_loan')}
      description="Capital Ledger entry: Loans taken are non-operating and do not count as income or profit."
    >
      <form onSubmit={handleSave} className="space-y-4">
        <Input
          label={t('loans.lender')}
          placeholder="e.g. Bank name, Friend/Family name"
          value={lenderName}
          onChange={(e) => setLenderName(e.target.value)}
          required
          autoFocus
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-text block mb-1">Loan Amount (₹)</label>
            <AmountInput
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-text block mb-1">Date Received</label>
            <Input
              type="date"
              value={loanDate}
              onChange={(e) => setLoanDate(e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={t('loans.interest_rate')}
            type="number"
            step="0.1"
            placeholder="e.g. 10.5"
            value={interestRate}
            onChange={(e) => setInterestRate(e.target.value)}
          />

          <Input
            label="Notes (Optional)"
            placeholder="Terms or remarks"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

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
            {saving ? (loanToEdit ? 'Updating...' : 'Recording...') : (loanToEdit ? 'Save Changes' : 'Record Loan')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
