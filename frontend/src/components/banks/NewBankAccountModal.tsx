import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';

export interface NewBankAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountToEdit?: any | null;
  onSuccess?: () => void;
}

const COMMON_BANKS = [
  'State Bank of India',
  'HDFC Bank',
  'ICICI Bank',
  'Punjab National Bank',
  'Axis Bank',
  'Bank of Baroda',
  'Kotak Mahindra Bank',
  'Canara Bank',
  'Union Bank of India',
  'Other Bank',
];

export const NewBankAccountModal: React.FC<NewBankAccountModalProps> = ({
  open,
  onOpenChange,
  accountToEdit,
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [bankName, setBankName] = useState(COMMON_BANKS[0]);
  const [customBankName, setCustomBankName] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [upiId, setUpiId] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (accountToEdit) {
      if (COMMON_BANKS.includes(accountToEdit.bank_name)) {
        setBankName(accountToEdit.bank_name);
        setCustomBankName('');
      } else {
        setBankName('Other Bank');
        setCustomBankName(accountToEdit.bank_name || '');
      }
      setAccountName(accountToEdit.account_name || '');
      setAccountNumber(accountToEdit.account_number || '');
      setIfsc(accountToEdit.ifsc || '');
      setUpiId(accountToEdit.upi_id || '');
      setOpeningBalance(String(accountToEdit.opening_balance || 0));
    } else {
      setBankName(COMMON_BANKS[0]);
      setCustomBankName('');
      setAccountName('');
      setAccountNumber('');
      setIfsc('');
      setUpiId('');
      setOpeningBalance('0');
    }
  }, [accountToEdit, open]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const actualBank = bankName === 'Other Bank' ? customBankName.trim() : bankName;
    if (!actualBank) {
      showToast('Please specify a bank name', 'error');
      return;
    }

    if (!accountName.trim()) {
      showToast('Please provide an account label (e.g. Primary Current A/c)', 'error');
      return;
    }

    setSaving(true);
    try {
      if (accountToEdit) {
        const { error } = await supabase
          .from('bank_accounts')
          .update({
            bank_name: actualBank,
            account_name: accountName.trim(),
            account_number: accountNumber.trim() || null,
            ifsc: ifsc.trim().toUpperCase() || null,
            upi_id: upiId.trim() || null,
            opening_balance: parseFloat(openingBalance) || 0,
          })
          .eq('id', accountToEdit.id);

        if (error) throw error;
        showToast('Bank account updated successfully', 'success');
      } else {
        const { error } = await supabase.from('bank_accounts').insert({
          bank_name: actualBank,
          account_name: accountName.trim(),
          account_number: accountNumber.trim() || null,
          ifsc: ifsc.trim().toUpperCase() || null,
          upi_id: upiId.trim() || null,
          opening_balance: parseFloat(openingBalance) || 0,
          active: true,
        });

        if (error) throw error;
        showToast('Bank account added successfully', 'success');
      }

      onOpenChange(false);
      // Reset form
      setAccountName('');
      setAccountNumber('');
      setIfsc('');
      setUpiId('');
      setOpeningBalance('0');
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
      title={accountToEdit ? 'Edit Bank Account' : 'Add Bank Account'}
      description={
        accountToEdit
          ? 'Update bank account details and information'
          : 'Track Money IN and Money OUT transactions for this bank'
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Bank Name"
          value={bankName}
          onChange={setBankName}
          options={COMMON_BANKS.map((b) => ({ value: b, label: b }))}
          searchable
          placeholder="Select or search bank..."
        />

        {bankName === 'Other Bank' && (
          <Input
            label="Custom Bank Name"
            placeholder="e.g. Federal Bank, Cooperative Bank"
            value={customBankName}
            onChange={(e) => setCustomBankName(e.target.value)}
            required
          />
        )}

        <Input
          label="Account Label / Description"
          placeholder="e.g. Shop Current Account, QR Savings"
          value={accountName}
          onChange={(e) => setAccountName(e.target.value)}
          required
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="A/c Number (Last 4 Digits or Full)"
            placeholder="e.g. XXXX9821"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
          />

          <Input
            label="IFSC Code (Optional)"
            placeholder="e.g. SBIN0001234"
            value={ifsc}
            onChange={(e) => setIfsc(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label="Linked UPI ID (Optional)"
            placeholder="e.g. shop@sbi"
            value={upiId}
            onChange={(e) => setUpiId(e.target.value)}
          />

          <AmountInput
            label="Opening Balance (₹)"
            value={openingBalance}
            onChange={setOpeningBalance}
            min={0}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            {saving ? 'Saving...' : accountToEdit ? 'Update Bank Account' : 'Save Bank Account'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
