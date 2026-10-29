import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';
import { Search, Plus } from 'lucide-react';
import { Database } from '../../types/supabase';

type Vendor = Database['public']['Tables']['vendors']['Row'];

export interface NewPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillVendorId?: string;
  onSuccess?: () => void;
}

const PAYMENT_MODES = [
  { id: 'CASH', label: 'Cash', icon: '💵' },
  { id: 'UPI', label: 'UPI / QR', icon: '📱' },
  { id: 'BANK', label: 'Bank Transfer (IMPS/NEFT)', icon: '🏦' },
  { id: 'CHEQUE', label: 'Cheque', icon: '📜' },
  { id: 'CARD', label: 'Debit/Credit Card', icon: '💳' },
] as const;

export const NewPaymentModal: React.FC<NewPaymentModalProps> = ({
  open,
  onOpenChange,
  prefillVendorId,
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

      if (prefillVendorId) {
        const found = vList.find((v) => v.id === prefillVendorId);
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
      if (bList.length > 0 && !selectedBankId) {
        setSelectedBankId(bList[0].id);
      }
    };
    fetchData();
  }, [open, prefillVendorId]);

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
      title="Record Vendor Payment (Money OUT)"
      description="Record payments made to workers, printers, or materials vendors"
    >
      <form onSubmit={handleSave} className="space-y-4">
        {/* Vendor Selection */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
            Vendor / Payee
          </label>

          {selectedVendor ? (
            <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <div>
                <div className="font-bold text-slate-900 text-sm">{selectedVendor.name}</div>
                {selectedVendor.mobile && (
                  <div className="text-xs text-slate-500">{selectedVendor.mobile}</div>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setSelectedVendor(null)}
              >
                Change
              </Button>
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
                  <div className="p-2.5 bg-slate-50 space-y-2">
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
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
            Payment Mode
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {PAYMENT_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id as any)}
                className={`p-2.5 rounded-xl border text-xs font-bold transition-all flex items-center gap-2 ${
                  mode === m.id
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <span>{m.icon}</span>
                <span className="truncate">{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Bank Account Selection (when Bank, UPI, Card, or Cheque) */}
        {['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && (
          <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200 space-y-3">
            <div>
              <label className="text-xs font-bold text-primary uppercase tracking-wider flex items-center justify-between mb-1">
                <span>
                  Paid from Bank Account <span className="text-danger">*</span>
                </span>
                <span className="text-[10px] text-amber-700 font-semibold bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
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
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={saving || !amount || parseFloat(amount) <= 0}
            className="font-bold"
          >
            {saving ? 'Recording...' : 'Record Payment'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
