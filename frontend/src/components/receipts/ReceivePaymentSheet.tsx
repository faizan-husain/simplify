import React, { useState, useEffect, useMemo } from 'react';
import Decimal from 'decimal.js';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getWhatsAppUrl } from '../../lib/auth';
import { getErrorMessage } from '../../i18n';
import { Sheet } from '../ui/Sheet';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../context/AuthContext';
import {
  Search,
  Share2,
  CheckCircle2,
  Eye,
  Sparkles,
} from 'lucide-react';

export interface ReceivePaymentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefillCustomer?: { id: string; name: string; mobile?: string | null };
  prefillInvoice?: { id: string; number: string; balance: number };
  onSuccess?: () => void;
  onViewReceipt?: (receiptId: string) => void;
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
  total_due?: number;
  bill_count?: number;
}

const PAYMENT_MODES = [
  { id: 'CASH', label: 'Cash', icon: '💵' },
  { id: 'UPI', label: 'UPI / QR', icon: '📱' },
  { id: 'BANK', label: 'Bank Transfer (IMPS/NEFT)', icon: '🏦' },
  { id: 'CHEQUE', label: 'Cheque', icon: '📜' },
  { id: 'CARD', label: 'Debit/Credit Card', icon: '💳' },
] as const;

const INCOME_CATEGORIES = [
  'Other Income',
  'Scrap / Waste Sale',
  'Interest Received',
  'Refund Received',
  'Commission Received',
  'Consulting / Service Fee',
  'Other',
];

export const ReceivePaymentSheet: React.FC<ReceivePaymentSheetProps> = ({
  open,
  onOpenChange,
  prefillCustomer,
  prefillInvoice,
  onSuccess,
  onViewReceipt,
}) => {
  const { business } = useAuth();
  const { showToast } = useToast();

  const [receiptKind, setReceiptKind] = useState<'INVOICE_PAYMENT' | 'OTHER_INCOME'>('INVOICE_PAYMENT');
  const [incomeCategory, setIncomeCategory] = useState('Other Income');

  const [customerSearch, setCustomerSearch] = useState('');
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerOption | null>(null);
  const [searchingCustomers, setSearchingCustomers] = useState(false);

  const [invoices, setInvoices] = useState<OutstandingInvoice[]>([]);
  const [loadingInvoices, setLoadingInvoices] = useState(false);

  // Manual allocations map: { [invoiceId: string]: string (amount) }
  const [allocations, setAllocations] = useState<{ [id: string]: string }>({});
  const [receiptAmount, setReceiptAmount] = useState<string>('');
  const [mode, setMode] = useState<'CASH' | 'UPI' | 'CARD' | 'BANK' | 'CHEQUE'>('CASH');
  const [bankAccounts, setBankAccounts] = useState<any[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [reference, setReference] = useState('');
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [savedReceipt, setSavedReceipt] = useState<any | null>(null);

  // Fetch bank accounts
  useEffect(() => {
    if (!open) return;
    const fetchBanks = async () => {
      const { data } = await supabase
        .from('bank_accounts')
        .select('*')
        .eq('active', true)
        .is('deleted_at', null)
        .order('bank_name', { ascending: true });
      const list = data || [];
      setBankAccounts(list);
      if (list.length > 0 && !selectedBankId) {
        setSelectedBankId(list[0].id);
      }
    };
    fetchBanks();
  }, [open]);

  // Initialize or reset when sheet opens
  useEffect(() => {
    if (open) {
      setSavedReceipt(null);
      setAllocations({});
      setReceiptAmount('');
      setReference('');
      setNotes('');
      setReceiptDate(new Date().toISOString().split('T')[0]);
      setReceiptKind('INVOICE_PAYMENT');

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

  // Search customers: when INVOICE_PAYMENT, ONLY fetch customers who have pending dues!
  useEffect(() => {
    if (!open || selectedCustomer) return;
    const fetchCustomers = async () => {
      setSearchingCustomers(true);
      try {
        if (receiptKind === 'INVOICE_PAYMENT') {
          // Fetch from dues_list RPC so ONLY customers with dues > 0 are shown!
          const { data, error } = await supabase.rpc('dues_list', {
            p_filter: 'ALL',
            p_search: customerSearch.trim() || null,
            p_limit: 50,
            p_offset: 0,
          });
          if (error) throw error;
          const customersWithDues = ((data as any)?.customers || [])
            .filter((c: any) => Number(c.total_due) > 0)
            .map((c: any) => ({
              id: c.customer_id,
              name: c.customer_name,
              mobile: c.customer_mobile,
              type: c.customer_type,
              total_due: Number(c.total_due),
              bill_count: Number(c.bill_count),
            }));
          setCustomerOptions(customersWithDues);
        } else {
          // OTHER_INCOME: standard customers list
          let q = supabase
            .from('customers')
            .select('id, name, mobile, type')
            .is('deleted_at', null)
            .order('name', { ascending: true })
            .limit(30);

          if (customerSearch.trim()) {
            q = q.or(`name.ilike.%${customerSearch.trim()}%,mobile.ilike.%${customerSearch.trim()}%`);
          }

          const { data, error } = await q;
          if (error) throw error;
          setCustomerOptions(data || []);
        }
      } catch (err: any) {
        console.error('Error fetching customers:', err);
      } finally {
        setSearchingCustomers(false);
      }
    };

    const timer = setTimeout(fetchCustomers, 200);
    return () => clearTimeout(timer);
  }, [customerSearch, open, selectedCustomer, receiptKind]);

  // FIFO Auto-allocation (Oldest First)
  const autoAllocate = (amountStr: string, currentInvoices: OutstandingInvoice[] = invoices) => {
    const totalToAllocate = parseFloat(amountStr);
    if (isNaN(totalToAllocate) || totalToAllocate <= 0) {
      const emptyAllocs: { [id: string]: string } = {};
      currentInvoices.forEach((inv) => {
        emptyAllocs[inv.id] = '';
      });
      setAllocations(emptyAllocs);
      return;
    }

    let remaining = totalToAllocate;
    const newAllocs: { [id: string]: string } = {};

    // Invoices are already sorted oldest first by the RPC
    currentInvoices.forEach((inv) => {
      if (remaining <= 0) {
        newAllocs[inv.id] = '0';
      } else {
        const take = Math.min(inv.balance, remaining);
        newAllocs[inv.id] = take.toFixed(2).replace(/\.00$/, '');
        remaining -= take;
      }
    });

    setAllocations(newAllocs);
  };

  const handleReceiptAmountChange = (val: string) => {
    setReceiptAmount(val);
    if (receiptKind === 'INVOICE_PAYMENT' && invoices.length > 0) {
      autoAllocate(val, invoices);
    }
  };

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
        } else if (list.length > 0 && receiptAmount) {
          autoAllocate(receiptAmount, list);
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
    const updated = {
      ...allocations,
      [invoiceId]: value,
    };
    setAllocations(updated);

    // Sum updated allocations and update receipt amount
    let sum = 0;
    Object.values(updated).forEach((v) => {
      const n = parseFloat(v);
      if (!isNaN(n) && n > 0) sum += n;
    });
    if (sum > 0) {
      setReceiptAmount(sum.toFixed(2).replace(/\.00$/, ''));
    }
  };

  // Quick 1-tap: Pay all customer dues
  const handlePayAllDues = () => {
    const newAllocs: { [id: string]: string } = {};
    invoices.forEach((inv) => {
      newAllocs[inv.id] = inv.balance.toString();
    });
    setAllocations(newAllocs);
    setReceiptAmount(totalCustomerDue.toString());
  };

  const handleSaveReceipt = async () => {
    if (receiptKind === 'INVOICE_PAYMENT' && !selectedCustomer) {
      showToast('Please select a customer with dues', 'error');
      return;
    }

    if (amountNum <= 0) {
      showToast('Please enter a valid receipt amount', 'error');
      return;
    }

    // Auto-allocate if user entered amount but allocations are incomplete
    let finalAllocations = { ...allocations };
    if (receiptKind === 'INVOICE_PAYMENT') {
      let currentAllocTotal = Object.values(finalAllocations).reduce(
        (sum, v) => sum + (parseFloat(v) || 0),
        0
      );

      if (currentAllocTotal < amountNum && invoices.length > 0) {
        let remaining = amountNum;
        const autoAllocs: { [id: string]: string } = {};
        invoices.forEach((inv) => {
          if (remaining <= 0) {
            autoAllocs[inv.id] = '0';
          } else {
            const take = Math.min(inv.balance, remaining);
            autoAllocs[inv.id] = take.toFixed(2).replace(/\.00$/, '');
            remaining -= take;
          }
        });
        finalAllocations = autoAllocs;
        setAllocations(autoAllocs);
      }

      const verifiedTotal = Object.values(finalAllocations).reduce(
        (sum, v) => sum + (parseFloat(v) || 0),
        0
      );
      if (verifiedTotal > amountNum) {
        showToast('Allocations cannot exceed the receipt amount', 'error');
        return;
      }

      const verUnallocated = Math.max(0, amountNum - verifiedTotal);
      const verRemainingDue = Math.max(0, totalCustomerDue - verifiedTotal);
      if (verUnallocated > 0 && verRemainingDue > 0) {
        showToast('All outstanding bills must be allocated before saving excess as advance', 'error');
        return;
      }
    }

    if (['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && !selectedBankId) {
      showToast(`Please select a Bank Account for ${mode} payment`, 'error');
      return;
    }

    setSaving(true);
    try {
      const selectedBank = bankAccounts.find((b) => b.id === selectedBankId);

      let payload: any = {
        receipt_date: receiptDate,
        amount: amountNum,
        mode,
        reference: reference.trim() || null,
        bank_account_id: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBankId || null : null,
        bank_name: ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) ? selectedBank?.bank_name || null : null,
        notes: notes.trim() || null,
      };

      if (receiptKind === 'OTHER_INCOME') {
        payload.kind = 'OTHER_INCOME';
        payload.income_category = incomeCategory;
        if (selectedCustomer) payload.customer_id = selectedCustomer.id;
      } else {
        payload.kind = 'INVOICE_PAYMENT';
        payload.customer_id = selectedCustomer!.id;
        payload.allocations = Object.entries(finalAllocations)
          .filter(([_, val]) => {
            const num = parseFloat(val);
            return !isNaN(num) && num > 0;
          })
          .map(([invId, val]) => ({
            invoice_id: invId,
            amount: parseFloat(val),
          }));
      }

      const { data, error } = await supabase.rpc('create_receipt', { payload });
      if (error) throw error;

      setSavedReceipt(data);
      showToast('Payment received & receipt generated!', 'success');
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
      title={savedReceipt ? 'Payment Receipt Generated' : 'Record Money IN (Receipt)'}
    >
      {savedReceipt ? (
        /* Success Screen */
        <div className="space-y-6 py-4 text-center">
          <div className="w-16 h-16 bg-success/10 text-success rounded-full flex items-center justify-center mx-auto shadow-sm">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <div>
            <h3 className="text-2xl font-black text-slate-900">
              {formatINR(savedReceipt.amount)}
            </h3>
            <p className="text-sm font-semibold text-slate-500 mt-1">
              Receipt #{savedReceipt.number} · {formatDate(savedReceipt.receipt_date)}
            </p>
            {savedReceipt.unallocated_amount > 0 && (
              <div className="mt-2 inline-block px-3 py-1 bg-primary/10 text-primary text-xs font-bold rounded-full">
                +{formatINR(savedReceipt.unallocated_amount)} added to customer advance balance
              </div>
            )}
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-left text-xs space-y-2.5">
            {selectedCustomer && (
              <div className="flex justify-between">
                <span className="text-slate-500">Customer</span>
                <span className="font-bold text-slate-900">{selectedCustomer.name}</span>
              </div>
            )}
            {selectedCustomer && receiptKind === 'INVOICE_PAYMENT' && (
              <div className="pt-2 border-t border-slate-200 space-y-1">
                <div className="flex justify-between text-slate-600">
                  <span>Total Due (Before):</span>
                  <span className="font-bold text-slate-800">{formatINR(totalCustomerDue)}</span>
                </div>
                <div className="flex justify-between text-success">
                  <span>Amount Paid Now:</span>
                  <span className="font-black">-{formatINR(savedReceipt.amount)}</span>
                </div>
                <div className="flex justify-between font-black pt-1 border-t border-slate-200">
                  <span className="text-slate-900">Remaining Balance Due:</span>
                  <span
                    className={
                      remainingDue > 0
                        ? 'text-rose-600 text-sm font-extrabold'
                        : 'text-emerald-700 text-sm font-extrabold'
                    }
                  >
                    {formatINR(remainingDue)}
                    {remainingDue === 0 && ' (All Cleared ✓)'}
                  </span>
                </div>
              </div>
            )}
            <div className="flex justify-between pt-2 border-t border-slate-200">
              <span className="text-slate-500">Payment Mode</span>
              <span className="font-bold text-slate-900">{savedReceipt.mode}</span>
            </div>
            {savedReceipt.bank_name && (
              <div className="flex justify-between">
                <span className="text-slate-500">Bank Account</span>
                <span className="font-semibold text-slate-800">{savedReceipt.bank_name}</span>
              </div>
            )}
            {savedReceipt.reference && (
              <div className="flex justify-between">
                <span className="text-slate-500">Reference / Txn ID</span>
                <span className="font-mono text-slate-900 font-bold">{savedReceipt.reference}</span>
              </div>
            )}
          </div>

          <div className="space-y-2.5 pt-2">
            <Button
              variant="primary"
              size="md"
              className="w-full font-bold shadow-sm"
              onClick={() => {
                onOpenChange(false);
                if (onViewReceipt && savedReceipt.id) {
                  onViewReceipt(savedReceipt.id);
                }
              }}
            >
              <Eye className="w-4 h-4 mr-2" />
              View & Print Receipt PDF
            </Button>

            {selectedCustomer?.mobile && (
              <Button
                variant="outline"
                size="md"
                className="w-full border-emerald-300 text-emerald-800 hover:bg-emerald-50 font-bold"
                onClick={handleWhatsAppReceipt}
              >
                <Share2 className="w-4 h-4 mr-2" />
                WhatsApp Receipt to Customer
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              className="w-full text-slate-600"
              onClick={() => {
                setSavedReceipt(null);
                setAllocations({});
                setReceiptAmount('');
              }}
            >
              + Record Another Receipt
            </Button>
          </div>
        </div>
      ) : (
        /* Form Screen */
        <div className="space-y-5 pb-6">
          {/* Kind Toggle: Bill Payment vs Other Income */}
          {!prefillCustomer && !prefillInvoice && (
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs">
              <button
                type="button"
                onClick={() => setReceiptKind('INVOICE_PAYMENT')}
                className={`py-2 rounded-lg font-bold transition-all ${
                  receiptKind === 'INVOICE_PAYMENT'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Customer Bill Payment
              </button>
              <button
                type="button"
                onClick={() => setReceiptKind('OTHER_INCOME')}
                className={`py-2 rounded-lg font-bold transition-all ${
                  receiptKind === 'OTHER_INCOME'
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Other Business Income
              </button>
            </div>
          )}

          {/* 1. Customer Selection */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              {receiptKind === 'INVOICE_PAYMENT' ? 'Customer (Required)' : 'Customer (Optional)'}
            </label>

            {selectedCustomer ? (
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <div className="text-sm font-bold text-slate-900">{selectedCustomer.name}</div>
                  <div className="text-xs text-slate-500">{selectedCustomer.mobile || 'No mobile number'}</div>
                </div>
                {!prefillCustomer && (
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
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3.5" />
                  <Input
                    type="text"
                    placeholder="Type customer name or mobile..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {searchingCustomers && (
                  <div className="text-xs text-slate-400 text-center py-2">Searching customers...</div>
                )}

                {!searchingCustomers && customerOptions.length > 0 && (
                  <div className="max-h-56 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100 bg-white shadow-sm">
                    {customerOptions.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="w-full p-2.5 text-left hover:bg-slate-50 flex items-center justify-between text-xs transition-colors"
                        onClick={() => {
                          setSelectedCustomer(c);
                          setCustomerSearch('');
                        }}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-900">{c.name}</span>
                            {c.total_due !== undefined && c.total_due > 0 && (
                              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                                Due: {formatINR(c.total_due)} ({c.bill_count} {c.bill_count === 1 ? 'bill' : 'bills'})
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {c.mobile ? `📞 ${c.mobile}` : 'No mobile'}
                          </div>
                        </div>
                        <span className="text-primary text-[11px] font-bold shrink-0">
                          Select →
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {!searchingCustomers && customerOptions.length === 0 && (
                  <div className="text-xs text-slate-500 p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
                    {receiptKind === 'INVOICE_PAYMENT'
                      ? 'No customers with pending dues found.'
                      : 'No matching customers found.'}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* If Other Income: Category Selector */}
          {receiptKind === 'OTHER_INCOME' && (
            <div>
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block mb-1">
                Income Category
              </label>
              <select
                value={incomeCategory}
                onChange={(e) => setIncomeCategory(e.target.value)}
                className="w-full text-xs rounded-lg border border-slate-300 p-2.5 bg-white font-medium focus:ring-2 focus:ring-primary/20 focus:outline-none"
              >
                {INCOME_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 2. Payment Amount & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AmountInput
              label="Total Amount Received (₹)"
              value={receiptAmount}
              onChange={handleReceiptAmountChange}
              required
            />

            <Input
              label="Payment Date"
              type="date"
              value={receiptDate}
              onChange={(e) => setReceiptDate(e.target.value)}
              required
            />
          </div>

          {/* 3. Outstanding Bills & Allocations (if Customer Bill Payment) */}
          {receiptKind === 'INVOICE_PAYMENT' && selectedCustomer && (
            <div className="space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                    Pending Invoices (Oldest First)
                  </label>
                  <span className="text-xs font-bold text-danger">
                    Total Balance Due: {formatINR(totalCustomerDue)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 self-end sm:self-auto">
                  {invoices.length > 0 && receiptAmount && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => autoAllocate(receiptAmount, invoices)}
                      className="border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-bold"
                      title="Auto distribute entered amount oldest-first"
                    >
                      <Sparkles className="w-3.5 h-3.5 mr-1 text-primary" />
                      Auto-Allocate
                    </Button>
                  )}
                  {invoices.length > 0 && totalCustomerDue > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handlePayAllDues}
                      className="border-primary text-primary hover:bg-primary/5 text-xs font-bold"
                    >
                      Pay All Dues ({formatINR(totalCustomerDue)})
                    </Button>
                  )}
                </div>
              </div>

              {/* Live 3-Part Dues Ledger Card */}
              {invoices.length > 0 && (
                <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-center">
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold uppercase">Total Due</div>
                    <div className="text-xs sm:text-sm font-black text-slate-800">
                      {formatINR(totalCustomerDue)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold uppercase">Paying Now</div>
                    <div className="text-xs sm:text-sm font-black text-success">
                      {formatINR(totalAllocated || amountNum || 0)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-500 font-bold uppercase">Remaining Due</div>
                    <div
                      className={`text-xs sm:text-sm font-black ${
                        remainingDue > 0 ? 'text-rose-600' : 'text-emerald-700'
                      }`}
                    >
                      {formatINR(remainingDue)}
                    </div>
                  </div>
                </div>
              )}

              {loadingInvoices ? (
                <div className="p-4 text-center text-xs text-slate-400 border border-slate-200 rounded-xl">
                  Loading pending invoices...
                </div>
              ) : invoices.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl">
                  🎉 No pending dues for this customer. Any amount entered will be saved as customer advance.
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 bg-white">
                  <div className="bg-slate-50 grid grid-cols-12 p-2.5 text-[11px] font-bold text-slate-600">
                    <div className="col-span-5">Bill # / Date</div>
                    <div className="col-span-3 text-right">Balance Due</div>
                    <div className="col-span-4 text-right font-bold text-slate-900">
                      Allocate (₹)
                    </div>
                  </div>

                  {invoices.map((inv) => {
                    const allocVal = parseFloat(allocations[inv.id] || '0') || 0;
                    const isFullyAllocated = allocVal >= inv.balance;
                    const isPartiallyAllocated = allocVal > 0 && allocVal < inv.balance;

                    return (
                      <div
                        key={inv.id}
                        className="grid grid-cols-12 p-2.5 items-center text-xs gap-1 sm:gap-2"
                      >
                        <div className="col-span-5 min-w-0 pr-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-slate-900">#{inv.number}</span>
                            {isFullyAllocated && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                Paid ✓
                              </span>
                            )}
                            {isPartiallyAllocated && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded font-extrabold bg-amber-50 text-amber-800 border border-amber-200">
                                Partial ({formatINR(inv.balance - allocVal)} left)
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {formatDate(inv.invoice_date)}
                            {inv.is_overdue && (
                              <span className="text-danger font-bold ml-1">
                                ({inv.days_overdue}d late)
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="col-span-3 text-right font-black text-danger text-xs">
                          {formatINR(inv.balance)}
                        </div>

                        <div className="col-span-4 flex items-center justify-end gap-1">
                          <input
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                            value={allocations[inv.id] || ''}
                            onChange={(e) =>
                              handleAllocationChange(inv.id, e.target.value, inv.balance)
                            }
                            className="w-20 sm:w-24 p-1.5 text-right text-xs font-bold border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary/20 focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleAllocationChange(inv.id, inv.balance.toString(), inv.balance)
                            }
                            className="text-[10px] text-primary font-bold hover:underline px-1 py-1 shrink-0"
                          >
                            Full
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 4. Payment Mode Selection */}
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

          {/* 5. Bank Account Selection (when Bank, UPI, Card, or Cheque) */}
          {['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(mode) && (
            <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200 space-y-3">
              <div>
                <label className="text-xs font-bold text-primary uppercase tracking-wider flex items-center justify-between mb-1">
                  <span>
                    Deposited to Bank Account <span className="text-danger">*</span>
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

          {/* Notes */}
          <Input
            label="Internal Notes / Remarks (Optional)"
            placeholder="Add any additional details about this payment..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />

          {/* 6. Live Breakdown Card */}
          <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs space-y-2 font-medium">
            <div className="flex justify-between">
              <span className="text-slate-500">Total Received:</span>
              <span className="font-bold text-slate-900">{formatINR(amountNum)}</span>
            </div>
            {receiptKind === 'INVOICE_PAYMENT' && (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-500">Allocated to Invoices:</span>
                  <span className="font-bold text-success">{formatINR(totalAllocated)}</span>
                </div>
                {unallocated > 0 && (
                  <div className="flex justify-between text-primary font-bold border-t border-slate-200 pt-1.5">
                    <span>Remaining as Customer Advance:</span>
                    <span>+{formatINR(unallocated)}</span>
                  </div>
                )}
                {remainingDue > 0 && (
                  <div className="flex justify-between text-danger font-semibold border-t border-slate-200 pt-1.5">
                    <span>Customer Remaining Due:</span>
                    <span>{formatINR(remainingDue)}</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Submit Button */}
          <Button
            type="button"
            variant="primary"
            size="lg"
            className="w-full font-bold shadow-sm"
            onClick={handleSaveReceipt}
            disabled={saving || amountNum <= 0}
          >
            {saving ? 'Recording Payment...' : `Record Payment (+${formatINR(amountNum)})`}
          </Button>
        </div>
      )}
    </Sheet>
  );
};
