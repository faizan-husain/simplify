import React, { useState, useEffect, useMemo } from 'react';
import Decimal from 'decimal.js';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getWhatsAppUrl } from '../../lib/auth';
import { getErrorMessage, t } from '../../i18n';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { Search, Share2, CheckCircle2, AlertCircle } from 'lucide-react';

export interface ReceivePaymentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillCustomer?: { id: string; name: string; mobile?: string | null };
  prefillInvoice?: { id: string; number: string; balance: number };
  onSuccess?: () => void;
}

interface OutstandingInvoice {
  id: string;
  number: string;
  fy_label: string;
  invoice_date: string;
  due_date: string;
  total: number;
  paid_amount: number;
  balance: number;
  is_overdue: boolean;
  days_overdue: number;
}

interface CustomerOption {
  id: string;
  name: string;
  mobile: string | null;
  type: string;
}

const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'] as const;

export const ReceivePaymentSheet: React.FC<ReceivePaymentSheetProps> = ({
  open,
  onOpenChange,
  prefillCustomer,
  prefillInvoice,
  onSuccess,
}) => {
  const { business } = useAuth();
  const { showToast } = useToast();

  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [searchingCustomers, setSearchingCustomers] = useState(false);

  const [invoices, setInvoices] = useState<OutstandingInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // Manual allocations map: { [invoiceId: string]: string (amount) }
  const [allocations, setAllocations] = useState<{ [id: string]: string }>({});
  const [receiptAmount, setReceiptAmount] = useState<string>('');
  const [mode, setMode] = useState<typeof PAYMENT_MODES[number]>('CASH');
  const [reference, setReference] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [savedReceipt, setSavedReceipt] = useState<any | null>(null);

  // Initialize or reset when sheet opens
  useEffect(() => {
    if (open) {
      setSavedReceipt(null);
      setAllocations({});
      setReceiptAmount('');
      setReference('');
      setNotes('');
      setReceiptDate(new Date().toISOString().split('T')[0]);

      if (prefillCustomer) {
        setSelectedCustomer({
          id: prefillCustomer.id,
          name: prefillCustomer.name,
          mobile: prefillCustomer.mobile || null,
          type: 'REGULAR',
        });
      } else {
        setSelectedCustomer(null);
        setCustomerSearch('');
      }
    }
  }, [open, prefillCustomer]);

  // Search customers
  useEffect(() => {
    if (!open || selectedCustomer) return;
    const fetchCustomers = async () => {
      setSearchingCustomers(true);
      try {
        let q = supabase
          .from('customers')
          .select('id, name, mobile, type')
          .is('deleted_at', null)
          .order('name', { ascending: true })
          .limit(20);

        if (customerSearch.trim()) {
          q = q.or(`name.ilike.%${customerSearch.trim()}%,mobile.ilike.%${customerSearch.trim()}%`);
        }

        const { data, error } = await q;
        if (error) throw error;
        setCustomerOptions(data || []);
      } catch (err: any) {
        console.error('Error fetching customers:', err);
      } finally {
        setSearchingCustomers(false);
      }
    };

    const timer = setTimeout(fetchCustomers, 250);
    return () => clearTimeout(timer);
  }, [customerSearch, open, selectedCustomer]);

  // Fetch outstanding invoices when customer changes
  useEffect(() => {
    if (!selectedCustomer) {
      setInvoices([]);
      setAllocations({});
      return;
    }

    const fetchDues = async () => {
      setLoadingInvoices(true);
      try {
        const { data, error } = await supabase.rpc('outstanding_invoices', {
          customer_id: selectedCustomer.id,
        });
        if (error) throw error;
        const list: OutstandingInvoice[] = (data as any) || [];
        setInvoices(list);

        // If prefill invoice is present, prefill its balance
        if (prefillInvoice) {
          const inv = list.find((i) => i.id === prefillInvoice.id);
          const bal = inv ? inv.balance : prefillInvoice.balance;
          setAllocations({ [prefillInvoice.id]: bal.toString() });
          setReceiptAmount(bal.toString());
        }
      } catch (err: any) {
        showToast(getErrorMessage(err.message), 'error');
      } finally {
        setLoadingInvoices(false);
      }
    };

    fetchDues();
  }, [selectedCustomer, prefillInvoice]);

  // Allocation maths using Decimal.js
  const { totalAllocated, amountNum, unallocated, totalCustomerDue, remainingDue } = useMemo(() => {
    let totAlloc = new Decimal(0);
    Object.values(allocations).forEach((val) => {
      const num = parseFloat(val);
      if (!isNaN(num) && num > 0) {
        totAlloc = totAlloc.plus(num);
      }
    });

    const amt = parseFloat(receiptAmount);
    const totAmt = !isNaN(amt) && amt > 0 ? new Decimal(amt) : new Decimal(0);
    const unalloc = Decimal.max(0, totAmt.minus(totAlloc));

    let custDue = new Decimal(0);
    invoices.forEach((inv) => {
      custDue = custDue.plus(inv.balance);
    });

    const remDue = Decimal.max(0, custDue.minus(totAlloc));

    return {
      totalAllocated: totAlloc.toNumber(),
      amountNum: totAmt.toNumber(),
      unallocated: unalloc.toNumber(),
      totalCustomerDue: custDue.toNumber(),
      remainingDue: remDue.toNumber(),
    };
  }, [allocations, receiptAmount, invoices]);

  const handleAllocationChange = (invoiceId: string, value: string, maxBalance: number) => {
    const num = parseFloat(value);
    if (!isNaN(num) && num > maxBalance) {
      value = maxBalance.toString();
    }
    setAllocations((prev) => ({
      ...prev,
      [invoiceId]: value,
    }));
  };

  const handleAutoFillAmount = () => {
    setReceiptAmount(totalAllocated.toString());
  };

  const handleSaveReceipt = async () => {
    if (!selectedCustomer) {
      showToast('Please select a customer', 'error');
      return;
    }

    if (amountNum <= 0) {
      showToast('Please enter a valid receipt amount', 'error');
      return;
    }

    if (totalAllocated > amountNum) {
      showToast('Allocations cannot exceed the receipt amount', 'error');
      return;
    }

    // Validation per BR-7: unallocated > 0 with remaining dues is prohibited
    if (unallocated > 0 && remainingDue > 0) {
      showToast('All outstanding bills must be allocated before saving excess as advance', 'error');
      return;
    }

    setSaving(true);
    try {
      const allocPayload = Object.entries(allocations)
        .filter(([_, val]) => {
          const num = parseFloat(val);
          return !isNaN(num) && num > 0;
        })
        .map(([invId, val]) => ({
          invoice_id: invId,
          amount: parseFloat(val),
        }));

      const payload = {
        customer_id: selectedCustomer.id,
        receipt_date: receiptDate,
        amount: amountNum,
        mode,
        reference: reference.trim() || null,
        kind: 'INVOICE_PAYMENT',
        notes: notes.trim() || null,
        allocations: allocPayload,
      };

      const { data, error } = await supabase.rpc('create_receipt', { payload });
      if (error) throw error;

      showToast(t('receipts.receipt_saved'), 'success');
      setSavedReceipt(data);
      onSuccess?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleWhatsAppReceipt = () => {
    if (!savedReceipt || !selectedCustomer?.mobile) {
      showToast('No customer mobile number available', 'error');
      return;
    }
    const message = `Hello ${selectedCustomer.name}, payment of ${formatINR(savedReceipt.amount)} received against receipt #${savedReceipt.number} on ${formatDate(savedReceipt.receipt_date)} via ${savedReceipt.mode}. Thank you! - ${business?.name || 'SIMPLIFY'}`;
    const url = getWhatsAppUrl(selectedCustomer.mobile, message);
    window.open(url, '_blank');
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={savedReceipt ? 'Payment Received' : t('receipts.receive_payment')}
    >
      {savedReceipt ? (
        /* Success Screen */
        <div className="space-y-6 py-4 text-center">
          <div className="w-16 h-16 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div>
            <h3 className="text-xl font-bold text-text">
              {formatINR(savedReceipt.amount)}
            </h3>
            <p className="text-sm text-text-muted mt-1">
              Receipt #{savedReceipt.number} · {formatDate(savedReceipt.receipt_date)}
            </p>
            {savedReceipt.unallocated_amount > 0 && (
              <div className="mt-2 inline-block px-3 py-1 bg-primary/10 text-primary text-xs font-semibold rounded-full">
                ₹{savedReceipt.unallocated_amount} added to customer advance
              </div>
            )}
          </div>

          <div className="bg-surface p-4 rounded-xl border border-border text-left text-xs space-y-2">
            <div className="flex justify-between">
              <span className="text-text-muted">Customer</span>
              <span className="font-semibold text-text">{selectedCustomer?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Payment Mode</span>
              <span className="font-semibold text-text">{savedReceipt.mode}</span>
            </div>
            {savedReceipt.reference && (
              <div className="flex justify-between">
                <span className="text-text-muted">Reference / Txn ID</span>
                <span className="font-semibold text-text">{savedReceipt.reference}</span>
              </div>
            )}
          </div>

          <div className="space-y-2 pt-2">
            {selectedCustomer?.mobile && (
              <Button
                variant="outline"
                size="md"
                className="w-full"
                onClick={handleWhatsAppReceipt}
              >
                <Share2 className="w-4 h-4 mr-2" />
                WhatsApp Receipt
              </Button>
            )}
            <Button
              variant="primary"
              size="md"
              className="w-full"
              onClick={() => onOpenChange(false)}
            >
              Done
            </Button>
          </div>
        </div>
      ) : (
        /* Form Screen */
        <div className="space-y-5 pb-6">
          {/* Customer Selection */}
          {!prefillCustomer && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                {t('billing.customer')}
              </label>

              {selectedCustomer ? (
                <div className="flex items-center justify-between p-3 bg-surface rounded-lg border border-border">
                  <div>
                    <div className="text-sm font-bold text-text">{selectedCustomer.name}</div>
                    <div className="text-xs text-text-muted">{selectedCustomer.mobile || 'No mobile'}</div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedCustomer(null);
                      setAllocations({});
                    }}
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
                      placeholder="Search customer by name or mobile..."
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  {searchingCustomers && (
                    <div className="text-xs text-text-muted text-center py-2">Searching...</div>
                  )}

                  {!searchingCustomers && customerOptions.length > 0 && (
                    <div className="max-h-44 overflow-y-auto border border-border rounded-lg divide-y divide-border/60 bg-white">
                      {customerOptions.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          className="w-full p-2.5 text-left hover:bg-surface flex items-center justify-between text-xs transition-colors"
                          onClick={() => {
                            setSelectedCustomer(c);
                            setCustomerSearch('');
                          }}
                        >
                          <span className="font-semibold text-text">{c.name}</span>
                          <span className="text-text-muted">{c.mobile || c.type}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Outstanding Bills Table (Manual allocation per BR-7) */}
          {selectedCustomer && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Outstanding Invoices (Oldest First)
                </label>
                <span className="text-xs font-semibold text-danger">
                  Total Due: {formatINR(totalCustomerDue)}
                </span>
              </div>

              {loadingInvoices ? (
                <div className="p-4 text-center text-xs text-text-muted border border-border rounded-lg">
                  Loading unpaid bills...
                </div>
              ) : invoices.length === 0 ? (
                <div className="p-4 text-center text-xs text-text-muted bg-surface border border-border rounded-lg">
                  No outstanding bills for this customer. Any payment entered will be recorded as customer advance.
                </div>
              ) : (
                <div className="border border-border rounded-lg overflow-hidden text-xs divide-y divide-border/60">
                  <div className="bg-surface grid grid-cols-12 p-2.5 font-semibold text-text-muted">
                    <div className="col-span-5">Bill # / Date</div>
                    <div className="col-span-3 text-right">Balance</div>
                    <div className="col-span-4 text-right">Allocate (₹)</div>
                  </div>
                  {invoices.map((inv) => (
                    <div key={inv.id} className="grid grid-cols-12 p-2.5 items-center gap-1.5">
                      <div className="col-span-5">
                        <div className="font-semibold text-text">#{inv.number}</div>
                        <div className="text-[10px] text-text-muted">
                          {formatDate(inv.invoice_date)}
                          {inv.is_overdue && (
                            <span className="text-danger font-bold ml-1">({inv.days_overdue}d late)</span>
                          )}
                        </div>
                      </div>
                      <div className="col-span-3 text-right font-medium text-danger">
                        {formatINR(inv.balance)}
                      </div>
                      <div className="col-span-4 flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="text-[10px] text-primary hover:underline font-semibold px-1"
                          onClick={() => handleAllocationChange(inv.id, inv.balance.toString(), inv.balance)}
                        >
                          Full
                        </button>
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={allocations[inv.id] || ''}
                          onChange={(e) => handleAllocationChange(inv.id, e.target.value, inv.balance)}
                          className="w-20 h-8 px-2 text-right border border-border rounded font-semibold text-text text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Receipt Amount and Summary */}
          {selectedCustomer && (
            <div className="space-y-4 pt-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-text">Receipt Amount (₹)</label>
                    {totalAllocated > 0 && (
                      <button
                        type="button"
                        onClick={handleAutoFillAmount}
                        className="text-[10px] text-primary font-semibold hover:underline"
                      >
                        Auto-fill ₹{totalAllocated}
                      </button>
                    )}
                  </div>
                  <AmountInput
                    value={receiptAmount}
                    onChange={setReceiptAmount}
                    placeholder="0.00"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-text block mb-1">Receipt Date</label>
                  <Input
                    type="date"
                    value={receiptDate}
                    onChange={(e) => setReceiptDate(e.target.value)}
                  />
                </div>
              </div>

              {/* Mode Chips */}
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

              {/* Reference & Notes */}
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Reference / Txn ID (Optional)"
                  placeholder="e.g. UPI / Cheque #"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
                <Input
                  label="Notes (Optional)"
                  placeholder="Additional remarks"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              {/* Allocation Validation & Advance Warning Banner */}
              {unallocated > 0 && remainingDue > 0 && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <div>
                    <span className="font-semibold">Allocation incomplete (BR-7):</span> You have ₹
                    {formatINR(unallocated)} unallocated while ₹{formatINR(remainingDue)} remains due across customer bills. Allocate all bills or set the receipt amount to ₹{formatINR(totalAllocated)}.
                  </div>
                </div>
              )}

              {unallocated > 0 && remainingDue === 0 && (
                <div className="p-3 bg-success/10 border border-success/30 rounded-lg text-xs text-success font-medium">
                  All customer bills are settled! Excess {formatINR(unallocated)} will be saved as customer advance.
                </div>
              )}

              {/* Summary Bar */}
              <div className="bg-surface p-3 rounded-lg border border-border text-xs space-y-1">
                <div className="flex justify-between text-text-muted">
                  <span>Total Allocated to Bills:</span>
                  <span className="font-semibold text-text">{formatINR(totalAllocated)}</span>
                </div>
                <div className="flex justify-between text-text-muted">
                  <span>Receipt Amount:</span>
                  <span className="font-semibold text-text">{formatINR(amountNum)}</span>
                </div>
                <div className="flex justify-between text-text pt-1 border-t border-border font-bold">
                  <span>Customer Advance (Unallocated):</span>
                  <span className="text-primary">{formatINR(unallocated)}</span>
                </div>
              </div>

              {/* Submit Button */}
              <Button
                variant="primary"
                size="lg"
                className="w-full mt-2"
                loading={saving}
                disabled={amountNum <= 0 || totalAllocated > amountNum || (unallocated > 0 && remainingDue > 0)}
                onClick={handleSaveReceipt}
              >
                Save Receipt ({formatINR(amountNum)})
              </Button>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
};
