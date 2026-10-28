import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { getErrorMessage, t } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';
import { Search } from 'lucide-react';
import { Database } from '../../types/supabase';

type Vendor = Database['public']['Tables']['vendors']['Row'];

export interface NewPaymentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillVendorId?: string;
  onSuccess?: () => void;
}

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'] as const;

export const NewPaymentModal: React.FC<NewPaymentModalProps> = ({
  open,
  onOpenChange,
  prefillVendorId,
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<typeof PAYMENT_MODES[number]>('CASH');
  const [description, setDescription] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [creatingVendor, setCreatingVendor] = useState(false);

  // Fetch vendors
  useEffect(() => {
    if (!open) return;
    const fetchVendors = async () => {
      const { data } = await supabase
        .from('vendors')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });
      const list = (data as Vendor[]) || [];
      setVendors(list);

      if (prefillVendorId) {
        const found = list.find((v) => v.id === prefillVendorId);
        if (found) setSelectedVendor(found);
      }
    };
    fetchVendors();
  }, [open, prefillVendorId]);

  const handleCreateVendorInline = async () => {
    if (!vendorSearch.trim()) return;
    setCreatingVendor(true);
    try {
      const { data, error } = await supabase
        .from('vendors')
        .insert({
          name: vendorSearch.trim(),
        })
        .select()
        .single();

      if (error) throw error;
      const newV = data as Vendor;
      setVendors((prev) => [...prev, newV]);
      setSelectedVendor(newV);
      setVendorSearch('');
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
      showToast('Please enter a valid amount', 'error');
      return;
    }

    if (!description.trim()) {
      showToast('Please provide a description', 'error');
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
            .insert({ name: vendorSearch.trim() })
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

      const { error } = await supabase.from('payments').insert({
        vendor_id: vendorToUse.id,
        amount: amtNum,
        mode,
        payment_date: paymentDate,
        description: description.trim(),
        notes: notes.trim() || null,
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
      title={t('payments.add_payment')}
    >
      <form onSubmit={handleSave} className="space-y-4">
        {/* Vendor Selector / Inline Create */}
        <div>
          <label className="text-xs font-semibold text-text block mb-1">
            {t('payments.vendor')}
          </label>

          {selectedVendor ? (
            <div className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border">
              <div>
                <div className="text-sm font-bold text-text">{selectedVendor.name}</div>
                <div className="text-xs text-text-muted">{selectedVendor.mobile || 'No mobile'}</div>
              </div>
              <Button
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
                <Search className="w-4 h-4 text-text-muted absolute left-3 top-3.5" />
                <Input
                  type="text"
                  placeholder="Type vendor name..."
                  value={vendorSearch}
                  onChange={(e) => setVendorSearch(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>

              {vendorSearch.trim() && (
                <div className="border border-border rounded-lg max-h-40 overflow-y-auto bg-white divide-y divide-border/60">
                  {filteredVendors.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="w-full p-2.5 text-left text-xs hover:bg-surface flex justify-between font-medium"
                      onClick={() => {
                        setSelectedVendor(v);
                        setVendorSearch('');
                      }}
                    >
                      <span>{v.name}</span>
                      <span className="text-text-muted">{v.mobile || ''}</span>
                    </button>
                  ))}

                  {/* Inline create button */}
                  <button
                    type="button"
                    className="w-full p-2.5 text-left text-xs bg-primary/5 hover:bg-primary/10 text-primary font-semibold flex items-center justify-between"
                    onClick={handleCreateVendorInline}
                    disabled={creatingVendor}
                  >
                    <span>+ Add "{vendorSearch.trim()}" as new vendor</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Amount & Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-text block mb-1">Amount (₹)</label>
            <AmountInput
              value={amount}
              onChange={setAmount}
              placeholder="0.00"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-text block mb-1">Date</label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>
        </div>

        {/* Payment Mode */}
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

        <Input
          label="Description / Purpose"
          placeholder="e.g. Laminating sheets, Raw material"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
        />

        <Input
          label="Notes (Optional)"
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
            Record Payment
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
