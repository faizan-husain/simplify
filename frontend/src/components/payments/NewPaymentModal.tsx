import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';
import { Search, Plus, Banknote, Smartphone, Landmark, FileText, CreditCard } from 'lucide-react';
import { Database } from '../../types/supabase';

type Vendor = Database['public']['Tables']['vendors']['Row'];

export interface NewPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillVendorId?: string;
  paymentToEdit?: any | null;
  onSuccess?: () => void;
}

const PAYMENT_MODES = [
  { id: 'CASH', label: 'Cash', icon: Banknote },
  { id: 'UPI', label: 'UPI / QR', icon: Smartphone },
  { id: 'BANK', label: 'Bank Transfer', icon: Landmark },
  { id: 'CHEQUE', label: 'Cheque', icon: FileText },
  { id: 'CARD', label: 'Card', icon: CreditCard },
] as const;

export const NewPaymentModal: React.FC<NewPaymentModalProps> = ({
  open,
  onOpenChange,
  prefillVendorId,
  paymentToEdit,
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [vendorMobile, setVendorMobile] = useState('');
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<'CASH' | 'UPI' | 'CARD' | 'BANK' | 'CHEQUE'>('CASH');
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [creatingVendor, setCreatingVendor] = useState(false);

  // Fetch vendors and bank accounts
  useEffect(() => {
    if (!open) return;
    const fetchData = async () => {
      const { data: vData } = await supabase
        .from('vendors')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });
      const vList = (vData as Vendor[]) || [];
      setVendors(vList);

      const targetVendorId = paymentToEdit?.vendor_id || prefillVendorId;
      if (targetVendorId) {
        const found = vList.find((v) => v.id === targetVendorId);
        if (found) setSelectedVendor(found);
      }

      const { data: bData } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('active', true)
        .is('deleted_at', null)
        .order('bank_name', { ascending: true });
      const bList = bData || [];
      setBankAccounts(bList);
      if (paymentToEdit?.bank_account_id) {
        setSelectedBankId(paymentToEdit.bank_account_id);
      } else if (bList.length > 0 && !selectedBankId) {
        setSelectedBankId(bList[0].id);
      }
    };
    fetchData();
  }, [open, prefillVendorId, paymentToEdit]);

  // Pre-fill state when editing payment
  useEffect(() => {
    if (open && paymentToEdit) {
      setAmount(String(paymentToEdit.amount || ''));
      setMode(paymentToEdit.mode || 'CASH');
      setDescription(paymentToEdit.description || '');
      setPaymentDate(paymentToEdit.payment_date || new Date().toISOString().split('T')[0]);
      setNotes(paymentToEdit.notes || '');
      setSelectedBankId(paymentToEdit.bank_account_id || '');
    } else if (open && !paymentToEdit) {
      setAmount('');
      setDescription('');
      setNotes('');
      setReference('');
      setPaymentDate(new Date().toISOString().split('T')[0]);
    }
  }, [open, paymentToEdit]);

  const handleCreateVendorInline = async () => {
    if (!vendorSearch.trim()) return;
    setCreatingVendor(true);
    try {
      const { data, error } = await supabase
        .from('vendors')
        .insert({
          name: vendorSearch.trim(),
          mobile: vendorMobile.trim() || null,
        })
        .select()
        .single();

      if (error) throw error;
      const newV = data as Vendor;
      setVendors((prev) => [...prev, newV]);
      setSelectedVendor(newV);
      setVendorSearch('');
      setVendorMobile('');
      showToast(`Vendor '${newV.name}' created`, 'success');
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setCreatingVendor(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    const amtNum = parseFloat(amount);
    if (isNaN(amtNum) || amtNum <= 0) {
      showToast('Please enter a valid payment amount', 'error');
      return;
    }

    if (!description.trim()) {
      showToast('Please provide a description (what work/material was paid for)', 'error');
      return;
    }

    setSaving(true);
    try {
      let vendorToUse = selectedVendor;
      if (!vendorToUse) {
        if (vendorSearch.trim()) {
          // Auto create vendor inline if user entered name
          const { data: newV, error: vErr } = await supabase
            .from('vendors')
            .insert({
              name: vendorSearch.trim(),
              mobile: vendorMobile.trim() || null,
            })
            .select()
            .single();
          if (vErr) throw vErr;
          vendorToUse = newV as Vendor;
        } else {
          showToast('Please select or enter a vendor name', 'error');
          setSaving(false);
          return;
        }
      }

      if (['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && !selectedBankId) {
        showToast(`Please select a Bank Account for ${mode} payment`, 'error');
        setSaving(false);
        return;
      }

      const selectedBank = bankAccounts.find((b) => b.id === selectedBankId);

      if (paymentToEdit) {
        const { error } = await supabase
          .from('payments')
          .update({
            vendor_id: vendorToUse.id,
            amount: amtNum,
            mode,
            payment_date: paymentDate,
            description: description.trim(),
            bank_account_id: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBankId || null : null,
            bank_name: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBank?.bank_name || null : null,
            notes: notes.trim() ? (reference ? `${notes.trim()} (Ref: ${reference.trim()})` : notes.trim()) : (reference ? `Ref: ${reference.trim()}` : null),
            updated_at: new Date().toISOString(),
          })
          .eq('id', paymentToEdit.id);

        if (error) throw error;
        showToast('Vendor payment updated successfully', 'success');
      } else {
        const { error } = await supabase.from('payments').insert({
          vendor_id: vendorToUse.id,
          amount: amtNum,
          mode,
          payment_date: paymentDate,
          description: description.trim(),
          bank_account_id: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBankId || null : null,
          bank_name: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBank?.bank_name || null : null,
          notes: notes.trim() ? (reference ? `${notes.trim()} (Ref: ${reference.trim()})` : notes.trim()) : (reference ? `Ref: ${reference.trim()}` : null),
          fy_label: '', // will be set by DB trigger
        });

        if (error) throw error;
        showToast('Vendor payment recorded successfully', 'success');
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  const filteredVendors = vendors.filter((v) =>
    v.name.toLowerCase().includes(vendorSearch.toLowerCase())
  );

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={paymentToEdit ? 'Edit Vendor Payment' : 'Record Vendor Payment (Money OUT)'}
      description={paymentToEdit ? 'Update vendor, payment method, date or notes' : 'Record payments made to workers, printers, or materials vendors'}
    >
      <form onSubmit={handleSave} className="space-y-4">
        {/* Vendor Selection */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
            Vendor / Payee
          </label>

          {selectedVendor ? (
            <div className="flex items-center justify-between p-3.5 bg-[#EEF0F3] border-0 shadow-2xs rounded-xl gap-2">
              <div className="min-w-0 flex-1 pr-2">
                <div className="font-bold text-slate-900 text-sm break-words">{selectedVendor.name}</div>
                {selectedVendor.mobile && (
                  <div className="text-xs text-slate-500">{selectedVendor.mobile}</div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedVendor(null)}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg border-0 bg-white hover:bg-slate-100 text-slate-700 shadow-2xs transition-all cursor-pointer shrink-0"
              >
                Change
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                <Input
                  type="text"
                  placeholder="Search existing vendor or type new vendor name..."
                  value={vendorSearch}
                  onChange={(e) => setVendorSearch(e.target.value)}
                  className="pl-9"
                />
              </div>

              {vendorSearch.trim() && (
                <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 bg-white max-h-48 overflow-y-auto shadow-sm">
                  {filteredVendors.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="w-full p-2.5 text-left hover:bg-slate-50 text-xs font-semibold text-slate-800 flex justify-between items-center"
                      onClick={() => {
                        setSelectedVendor(v);
                        setVendorSearch('');
                      }}
                    >
                      <span>{v.name}</span>
                      <span className="text-slate-400 font-normal">{v.mobile || ''}</span>
                    </button>
                  ))}

                  {/* Create New Vendor Option */}
                  <div className="p-3 bg-[#EEF0F3] rounded-xl border-0 shadow-2xs space-y-2">
                    <div className="text-[11px] font-bold text-slate-700">
                      Create new vendor: "{vendorSearch.trim()}"
                    </div>
                    <Input
                      placeholder="Vendor mobile number (optional)..."
                      value={vendorMobile}
                      onChange={(e) => setVendorMobile(e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCreateVendorInline}
                      disabled={creatingVendor}
                      className="w-full text-xs font-bold"
                    >
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add "{vendorSearch.trim()}" as New Vendor
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        <Input
          label="Payment Description / Purpose"
          placeholder="e.g. Flex printing charges, Xerox paper purchase, Courier charges"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />

        {/* Amount & Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <AmountInput
            label="Payment Amount (₹)"
            value={amount}
            onChange={setAmount}
            required
          />

          <Input
            label="Payment Date"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            required
          />
        </div>

        {/* Payment Mode Selection */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-muted block">
            Payment Mode
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PAYMENT_MODES.map((m) => {
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id as any)}
                  className={`p-2.5 rounded-control border text-xs font-medium transition-all flex items-center gap-2 ${
                    mode === m.id
                      ? 'bg-surface-2 text-text border-accent ring-1 ring-accent'
                      : 'bg-surface text-text-muted border-hair hover:bg-surface-2 hover:text-text'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0 text-text-muted" />
                  <span className="truncate">{m.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bank Account Selection (when Bank, UPI, Card, or Cheque) */}
        {['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && (
          <div className="p-3.5 bg-surface-2 rounded-control border border-hair space-y-3">
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

            <Input
              label="Transaction UTR / Ref No / Cheque No"
              placeholder="e.g. UTR 9182390123 / Cheque #004521"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>
        )}

        <Input
          label="Notes / Remarks (Optional)"
          placeholder="Additional notes about this vendor payment..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {/* Form Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="ghost"
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
            disabled={saving || !amount || parseFloat(amount) <= 0}
            className="font-bold w-full sm:w-auto"
          >
            {saving ? (paymentToEdit ? 'Updating...' : 'Recording...') : (paymentToEdit ? 'Save Changes' : 'Record Payment')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
