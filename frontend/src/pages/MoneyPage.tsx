import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate } from '../lib/dates';
import { getWhatsAppUrl } from '../lib/auth';
import { getErrorMessage, t } from '../i18n';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Card } from '../components/ui/Card';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { ReceivePaymentSheet } from '../components/receipts/ReceivePaymentSheet';
import { ReceiptDetailModal } from '../components/receipts/ReceiptDetailModal';
import { OtherIncomeModal } from '../components/receipts/OtherIncomeModal';
import { CustomerLedgerModal } from '../components/customers/CustomerLedgerModal';
import { RemindAllDrawer } from '../components/dues/RemindAllDrawer';
import { NewPaymentModal } from '../components/payments/NewPaymentModal';
import { VendorDetailModal } from '../components/payments/VendorDetailModal';
import { NewExpenseModal } from '../components/expenses/NewExpenseModal';
import { NewLoanModal } from '../components/loans/NewLoanModal';
import { RecordRepaymentModal } from '../components/loans/RecordRepaymentModal';
import { BankLedgerTab } from '../components/banks/BankLedgerTab';
import {
  Plus,
  Search,
  Share2,
  Trash2,
  ChevronDown,
  ChevronRight,
  ArrowUpRight,
  Building,
  Banknote,
  Printer,
  FileText,
} from 'lucide-react';
import { Database } from '../types/supabase';

type Receipt = Database['public']['Tables']['receipts']['Row'] & {
  customer?: { name: string; mobile: string | null } | null;
  bank_name?: string | null;
};
type Payment = Database['public']['Tables']['payments']['Row'] & {
  vendors?: { id: string; name: string; mobile: string | null };
};
type Expense = Database['public']['Tables']['expenses']['Row'] & {
  expense_categories?: { id: string; name: string };
};

type MoneyTab = 'dues' | 'receipts' | 'payments' | 'expenses' | 'loans' | 'bank';

interface DuesSummary {
  total_outstanding: number;
  total_overdue: number;
  total_bills_due: number;
  customer_count: number;
}

interface CustomerDueItem {
  customer_id: string;
  customer_name: string;
  customer_mobile: string | null;
  customer_type: string;
  total_due: number;
  overdue_balance: number;
  bill_count: number;
  oldest_bill_date: string;
  oldest_due_date: string;
  max_days_overdue: number;
  invoices: Array<{
    id: string;
    number: string;
    invoice_date: string;
    due_date: string;
    total: number;
    paid_amount: number;
    balance: number;
    is_overdue: boolean;
    days_overdue: number;
  }>;
}

interface LoanSummaryData {
  summary: {
    total_taken: number;
    total_principal_repaid: number;
    total_outstanding: number;
    total_interest_paid: number;
  };
  loans: Array<{
    loan_id: string;
    lender_name: string;
    taken_amount: number;
    loan_date: string;
    interest_rate: number | null;
    notes: string | null;
    principal_repaid: number;
    interest_paid: number;
    outstanding: number;
    repayments?: Array<{
      id: string;
      repayment_date: string;
      principal: number;
      interest: number;
      mode: string;
      notes: string | null;
    }>;
  }>;
}

export const MoneyPage: React.FC = () => {
  const { business } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<MoneyTab>('dues');

  // Modals & Sheets
  const [isReceivePaymentOpen, setIsReceivePaymentOpen] = useState(false);
  const [selectedReceiptDetailId, setSelectedReceiptDetailId] = useState<string | null>(null);
  const [isOtherIncomeOpen, setIsOtherIncomeOpen] = useState(false);
  const [isRemindAllOpen, setIsRemindAllOpen] = useState(false);
  const [ledgerCustomerId, setLedgerCustomerId] = useState<string | null>(null);

  const [isNewPaymentOpen, setIsNewPaymentOpen] = useState(false);
  const [selectedVendorDetailId, setSelectedVendorDetailId] = useState<string | null>(null);

  const [isNewExpenseOpen, setIsNewExpenseOpen] = useState(false);

  const [isNewLoanOpen, setIsNewLoanOpen] = useState(false);
  const [repaymentLoan, setRepaymentLoan] = useState<{
    loan_id: string;
    lender_name: string;
    taken_amount: number;
    outstanding: number;
  } | null>(null);

  // Selected customer for pre-filling receive payment
  const [receivePrefillCustomer, setReceivePrefillCustomer] = useState<{
    id: string;
    name: string;
    mobile?: string | null;
  } | undefined>(undefined);

  // Dues state
  const [duesSummary, setDuesSummary] = useState<DuesSummary>({
    total_outstanding: 0,
    total_overdue: 0,
    total_bills_due: 0,
    customer_count: 0,
  });
  const [customerDues, setCustomerDues] = useState<CustomerDueItem[]>([]);
  const [duesFilter, setDuesFilter] = useState<'ALL' | 'OVERDUE' | 'REGULAR' | 'WALK_IN'>('ALL');
  const [duesSearch, setDuesSearch] = useState('');
  const [loadingDues, setLoadingDues] = useState(true);
  const [expandedCustomers, setExpandedCustomers] = useState<{ [id: string]: boolean }>({});

  // Receipts state
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [receiptsSearch, setReceiptsSearch] = useState('');
  const [loadingReceipts, setLoadingReceipts] = useState(true);
  const [deletingReceiptId, setDeletingReceiptId] = useState<string | null>(null);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Payments state
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsSearch, setPaymentsSearch] = useState('');
  const [loadingPayments, setLoadingPayments] = useState(true);

  // Expenses state
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expensesSearch, setExpensesSearch] = useState('');
  const [loadingExpenses, setLoadingExpenses] = useState(true);

  // Loans state
  const [loansData, setLoansData] = useState<LoanSummaryData | null>(null);
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [expandedLoans, setExpandedLoans] = useState<{ [id: string]: boolean }>({});

  // Mode filter for Receipts, Payments, Expenses (All vs Bank/UPI vs Cash)
  const [modeFilter, setModeFilter] = useState<'ALL' | 'BANK_UPI' | 'CASH'>('ALL');

  // Computed Bank vs Cash statistics
  const receiptStats = React.useMemo(() => {
    let total = 0;
    let bankUpi = 0;
    let cash = 0;
    for (const r of receipts) {
      const amt = parseFloat(String(r.amount || '0'));
      total += amt;
      if (['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(r.mode)) {
        bankUpi += amt;
      } else {
        cash += amt;
      }
    }
    return { total, bankUpi, cash };
  }, [receipts]);

  const paymentStats = React.useMemo(() => {
    let total = 0;
    let bankUpi = 0;
    let cash = 0;
    for (const p of payments) {
      const amt = parseFloat(String(p.amount || '0'));
      total += amt;
      if (['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(p.mode)) {
        bankUpi += amt;
      } else {
        cash += amt;
      }
    }
    return { total, bankUpi, cash };
  }, [payments]);

  const expenseStats = React.useMemo(() => {
    let total = 0;
    let bankUpi = 0;
    let cash = 0;
    for (const e of expenses) {
      const amt = parseFloat(String(e.amount || '0'));
      total += amt;
      if (['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(e.mode)) {
        bankUpi += amt;
      } else {
        cash += amt;
      }
    }
    return { total, bankUpi, cash };
  }, [expenses]);

  // Fetch dues
  const fetchDues = async () => {
    setLoadingDues(true);
    try {
      const { data, error } = await supabase.rpc('dues_list', {
        p_filter: duesFilter,
        p_search: duesSearch.trim() || null,
        p_limit: 100,
        p_offset: 0,
      });

      if (error) throw error;
      const res = data as any;
      setDuesSummary(
        res.summary || {
          total_outstanding: 0,
          total_overdue: 0,
          total_bills_due: 0,
          customer_count: 0,
        }
      );
      setCustomerDues(res.customers || []);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoadingDues(false);
    }
  };

  // Fetch receipts
  const fetchReceipts = async () => {
    setLoadingReceipts(true);
    try {
      let query = supabase
        .from('receipts')
        .select('*, customer:customers(name, mobile)')
        .is('deleted_at', null)
        .order('receipt_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(100);

      if (receiptsSearch.trim()) {
        query = query.or(
          `number.ilike.%${receiptsSearch.trim()}%,reference.ilike.%${receiptsSearch.trim()}%`
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      setReceipts((data as Receipt[]) || []);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoadingReceipts(false);
    }
  };

  // Fetch payments
  const fetchPayments = async () => {
    setLoadingPayments(true);
    try {
      let query = supabase
        .from('payments')
        .select('*, vendors(id, name, mobile)')
        .is('deleted_at', null)
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);

      if (paymentsSearch.trim()) {
        query = query.ilike('description', `%${paymentsSearch.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setPayments((data as any) || []);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoadingPayments(false);
    }
  };

  // Fetch expenses
  const fetchExpenses = async () => {
    setLoadingExpenses(true);
    try {
      let query = supabase
        .from('expenses')
        .select('*, expense_categories(id, name)')
        .is('deleted_at', null)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);

      if (expensesSearch.trim()) {
        query = query.ilike('description', `%${expensesSearch.trim()}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      setExpenses((data as any) || []);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoadingExpenses(false);
    }
  };

  // Fetch loans
  const fetchLoans = async () => {
    setLoadingLoans(true);
    try {
      const { data, error } = await supabase.rpc('loans_summary');
      if (error) throw error;
      setLoansData(data as any);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoadingLoans(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'dues') fetchDues();
    else if (activeTab === 'receipts') fetchReceipts();
    else if (activeTab === 'payments') fetchPayments();
    else if (activeTab === 'expenses') fetchExpenses();
    else if (activeTab === 'loans') fetchLoans();
  }, [activeTab, duesFilter]);

  const toggleCustomerExpand = (customerId: string) => {
    setExpandedCustomers((prev) => ({
      ...prev,
      [customerId]: !prev[customerId],
    }));
  };

  const toggleLoanExpand = (loanId: string) => {
    setExpandedLoans((prev) => ({
      ...prev,
      [loanId]: !prev[loanId],
    }));
  };

  const handleRemindCustomer = (c: CustomerDueItem) => {
    if (!c.customer_mobile) {
      showToast('No mobile number available for this customer', 'error');
      return;
    }
    const upiNote = business?.upi_id ? ` Payment UPI: ${business.upi_id}.` : '';
    const message = `Namaste ${c.customer_name}, your outstanding with ${business?.name || 'SIMPLIFY'} is ${formatINR(c.total_due)} across ${c.bill_count} bills (oldest ${formatDate(c.oldest_bill_date)}).${upiNote} Thank you!`;
    const url = getWhatsAppUrl(c.customer_mobile, message);
    window.open(url, '_blank');
  };

  const handleOpenReceive = (customer?: { id: string; name: string; mobile?: string | null }) => {
    setReceivePrefillCustomer(customer);
    setIsReceivePaymentOpen(true);
  };

  const handleDeleteReceiptClick = (receiptId: string) => {
    setDeletingReceiptId(receiptId);
    setIsDeleteConfirmOpen(true);
  };

  const handleConfirmDeleteReceipt = async () => {
    if (!deletingReceiptId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_receipt', {
        id: deletingReceiptId,
      });

      if (error) throw error;

      showToast('Receipt deleted and linked bill balances reopened', 'info');
      setIsDeleteConfirmOpen(false);
      setDeletingReceiptId(null);
      fetchReceipts();
      fetchDues();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('Are you sure you want to delete this payment record?')) return;
    try {
      const { error } = await supabase.rpc('soft_delete', {
        p_table: 'payments',
        p_id: paymentId,
      });
      if (error) throw error;
      showToast('Payment deleted', 'info');
      fetchPayments();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    }
  };

  const handleDeleteExpense = async (expenseId: string) => {
    if (!confirm('Are you sure you want to delete this expense record?')) return;
    try {
      const { error } = await supabase.rpc('soft_delete', {
        p_table: 'expenses',
        p_id: expenseId,
      });
      if (error) throw error;
      showToast('Expense deleted', 'info');
      fetchExpenses();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">{t('nav.money')}</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Track receivables, cash inflow, vendor payments, expenses & capital ledger
          </p>
        </div>

        {/* Tab specific top actions */}
        <div className="flex items-center gap-2">
          {activeTab === 'dues' || activeTab === 'receipts' ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsOtherIncomeOpen(true)}
              >
                + Other Income
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleOpenReceive()}
              >
                <Plus className="w-4 h-4 mr-1.5" />
                Receive Payment
              </Button>
            </>
          ) : activeTab === 'payments' ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsNewPaymentOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New Vendor Payment
            </Button>
          ) : activeTab === 'expenses' ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsNewExpenseOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New Expense
            </Button>
          ) : activeTab === 'loans' ? (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsNewLoanOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Record Loan Received
            </Button>
          ) : activeTab === 'bank' ? (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsNewPaymentOpen(true)}
                className="border-rose-300 text-rose-800 hover:bg-rose-50 font-bold"
              >
                - Bank Payout
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleOpenReceive()}
                className="font-bold"
              >
                <Plus className="w-4 h-4 mr-1.5" />
                + Bank Deposit
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as MoneyTab)}>
        <TabsList className="w-full">
          <TabsTrigger value="dues" className="flex-1">
            Dues ({duesSummary.total_bills_due})
          </TabsTrigger>
          <TabsTrigger value="receipts" className="flex-1">
            Receipts (IN)
          </TabsTrigger>
          <TabsTrigger value="payments" className="flex-1">
            Payments (OUT)
          </TabsTrigger>
          <TabsTrigger value="bank" className="flex-1 font-bold">
            Bank IN/OUT
          </TabsTrigger>
          <TabsTrigger value="expenses" className="flex-1">
            Expenses
          </TabsTrigger>
          <TabsTrigger value="loans" className="flex-1">
            Loans
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* TAB 1: DUES */}
      {activeTab === 'dues' && (
        <div className="space-y-4">
          {/* Prominent Totals Summary Banner */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-border">
            <div>
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Total Outstanding
              </div>
              <div className="text-2xl font-bold text-danger mt-1">
                {formatINR(duesSummary.total_outstanding)}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Overdue Amount
              </div>
              <div className="text-2xl font-bold text-danger mt-1">
                {formatINR(duesSummary.total_overdue)}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Unpaid Bills
              </div>
              <div className="text-2xl font-bold text-text mt-1">
                {duesSummary.total_bills_due}
              </div>
            </div>

            <div>
              <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                Customers with Dues
              </div>
              <div className="text-2xl font-bold text-text mt-1">
                {duesSummary.customer_count}
              </div>
            </div>
          </div>

          {/* Dues Filter Chips & Search & Remind All */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              {(['ALL', 'OVERDUE', 'REGULAR', 'WALK_IN'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setDuesFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors border ${
                    duesFilter === f
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-text border-border hover:bg-surface'
                  }`}
                >
                  {f === 'ALL'
                    ? 'All Dues'
                    : f === 'OVERDUE'
                    ? 'Overdue Only'
                    : f === 'REGULAR'
                    ? 'Regular'
                    : 'Walk-in'}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1 sm:w-64">
                <Search className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
                <Input
                  type="text"
                  placeholder="Search customer / bill #..."
                  value={duesSearch}
                  onChange={(e) => setDuesSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchDues()}
                  className="pl-9 h-9 text-xs"
                />
              </div>

              {customerDues.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsRemindAllOpen(true)}
                  className="border-primary text-primary hover:bg-primary/5 shrink-0"
                >
                  <Share2 className="w-3.5 h-3.5 mr-1.5" />
                  Remind All
                </Button>
              )}
            </div>
          </div>

          {/* Customer Dues List */}
          {loadingDues ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : customerDues.length === 0 ? (
            <Card className="p-8 text-center">
              <EmptyState message="No outstanding dues. All bills have been collected, or no customers match the current filter." />
            </Card>
          ) : (
            <div className="space-y-3">
              {customerDues.map((c) => {
                const isExpanded = Boolean(expandedCustomers[c.customer_id]);
                return (
                  <div
                    key={c.customer_id}
                    className="bg-white border border-border rounded-xl overflow-hidden transition-shadow shadow-xs"
                  >
                    {/* Customer Row Header */}
                    <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => toggleCustomerExpand(c.customer_id)}
                          className="p-1 hover:bg-surface rounded text-text-muted"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>

                        <div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setLedgerCustomerId(c.customer_id)}
                              className="font-bold text-text hover:text-primary text-sm text-left flex items-center gap-1 group"
                            >
                              <span>{c.customer_name}</span>
                              <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                            </button>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface border border-border text-text-muted font-medium">
                              {c.customer_type}
                            </span>
                          </div>
                          <div className="text-xs text-text-muted mt-0.5">
                            {c.customer_mobile || 'No mobile'} · {c.bill_count} unpaid bill
                            {c.bill_count > 1 ? 's' : ''} · Oldest: {formatDate(c.oldest_bill_date)}
                            {c.max_days_overdue > 0 && (
                              <span className="text-danger font-bold ml-1.5">
                                ({c.max_days_overdue}d overdue)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Balance & Actions */}
                      <div className="flex items-center justify-between sm:justify-end gap-3 pl-8 sm:pl-0">
                        <div className="text-right">
                          <div className="text-base font-bold text-danger">
                            {formatINR(c.total_due)}
                          </div>
                          {c.overdue_balance > 0 && (
                            <div className="text-[10px] text-danger font-medium">
                              Overdue: {formatINR(c.overdue_balance)}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          {c.customer_mobile && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemindCustomer(c)}
                              title="Send WhatsApp Reminder"
                            >
                              <Share2 className="w-4 h-4 text-primary" />
                            </Button>
                          )}

                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() =>
                              handleOpenReceive({
                                id: c.customer_id,
                                name: c.customer_name,
                                mobile: c.customer_mobile,
                              })
                            }
                          >
                            Receive
                          </Button>
                        </div>
                      </div>
                    </div>

                    {/* Expandable Unpaid Bills Table */}
                    {isExpanded && (
                      <div className="border-t border-border bg-surface/50 p-3">
                        <div className="border border-border rounded-lg overflow-hidden bg-white text-xs">
                          <div className="bg-surface grid grid-cols-12 p-2 font-semibold text-text-muted border-b border-border">
                            <div className="col-span-3">Bill #</div>
                            <div className="col-span-3">Date / Due</div>
                            <div className="col-span-2 text-right">Total</div>
                            <div className="col-span-2 text-right">Paid</div>
                            <div className="col-span-2 text-right">Balance</div>
                          </div>

                          <div className="divide-y divide-border/60">
                            {c.invoices.map((inv) => (
                              <div key={inv.id} className="grid grid-cols-12 p-2 items-center">
                                <div className="col-span-3 font-semibold text-text">
                                  #{inv.number}
                                </div>
                                <div className="col-span-3 text-text-muted text-[11px]">
                                  {formatDate(inv.invoice_date)}
                                  {inv.is_overdue && (
                                    <span className="text-danger font-bold ml-1">
                                      ({inv.days_overdue}d late)
                                    </span>
                                  )}
                                </div>
                                <div className="col-span-2 text-right text-text-muted">
                                  {formatINR(inv.total)}
                                </div>
                                <div className="col-span-2 text-right text-success font-medium">
                                  {formatINR(inv.paid_amount)}
                                </div>
                                <div className="col-span-2 text-right font-bold text-danger">
                                  {formatINR(inv.balance)}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: RECEIPTS */}
      {activeTab === 'receipts' && (
        <div className="space-y-4">
          {/* Bank vs Cash Summary Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded-xl border border-border shadow-2xs">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Total Income (IN)
              </div>
              <div className="text-2xl font-bold text-success mt-1">
                +{formatINR(receiptStats.total)}
              </div>
            </div>

            <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary uppercase tracking-wider">
                <Building className="w-3.5 h-3.5" />
                <span>Bank & UPI (Online)</span>
              </div>
              <div className="text-2xl font-bold text-primary mt-1">
                +{formatINR(receiptStats.bankUpi)}
              </div>
            </div>

            <div className="p-3 bg-emerald-50/60 rounded-lg border border-emerald-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800 uppercase tracking-wider">
                <Banknote className="w-3.5 h-3.5" />
                <span>Cash in Hand</span>
              </div>
              <div className="text-2xl font-bold text-emerald-700 mt-1">
                +{formatINR(receiptStats.cash)}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Mode Filter Chips */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setModeFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  modeFilter === 'ALL'
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                All Receipts ({receipts.length})
              </button>
              <button
                type="button"
                onClick={() => setModeFilter('BANK_UPI')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1 ${
                  modeFilter === 'BANK_UPI'
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Building className="w-3 h-3" />
                <span>Bank & UPI</span>
              </button>
              <button
                type="button"
                onClick={() => setModeFilter('CASH')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1 ${
                  modeFilter === 'CASH'
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Banknote className="w-3 h-3" />
                <span>Cash Only</span>
              </button>
            </div>

            <div className="relative flex-1 sm:w-72">
              <Search className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
              <Input
                type="text"
                placeholder="Search receipt # / reference..."
                value={receiptsSearch}
                onChange={(e) => setReceiptsSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchReceipts()}
                className="pl-9 h-9 text-xs"
              />
            </div>
          </div>

          {loadingReceipts ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : receipts.length === 0 ? (
            <Card className="p-8 text-center">
              <EmptyState message="No receipts recorded. Customer payments and other income receipts will appear here." />
            </Card>
          ) : (
            <div className="space-y-2">
              {receipts
                .filter((r) => {
                  if (modeFilter === 'ALL') return true;
                  if (modeFilter === 'CASH') return r.mode === 'CASH';
                  if (modeFilter === 'BANK_UPI') return ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(r.mode);
                  return true;
                })
                .map((r) => (
                  <div
                    key={r.id}
                    className="bg-white border border-border rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-surface/30 transition-colors shadow-2xs"
                  >
                    <div className="space-y-1.5 flex-1 pr-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-slate-900 text-sm">#{r.number}</span>
                        {r.customer?.name && (
                          <span className="font-bold text-primary text-xs bg-primary/5 px-2 py-0.5 rounded-md border border-primary/10">
                            👤 {r.customer.name}
                          </span>
                        )}
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                            ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(r.mode)
                              ? 'bg-blue-50 text-primary border-blue-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}
                        >
                          {r.mode === 'BANK' ? '🏦 Bank' : r.mode === 'UPI' ? '📱 UPI' : r.mode}
                        </span>
                        {r.bank_name && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-700">
                            {r.bank_name}
                          </span>
                        )}
                        {r.kind === 'OTHER_INCOME' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            {r.income_category || 'Other Income'}
                          </span>
                        )}
                        {r.unallocated_amount > 0 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-primary/10 text-primary border border-primary/20">
                            Advance: {formatINR(r.unallocated_amount)}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2">
                        <span>{formatDate(r.receipt_date)}</span>
                        {r.customer?.mobile && <span>· 📞 {r.customer.mobile}</span>}
                        {r.reference && <span className="font-mono text-slate-700 font-semibold">· Ref: {r.reference}</span>}
                        {r.notes && <span className="italic">· {r.notes}</span>}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2.5 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                      <div className="text-right font-black text-success text-base sm:text-lg pr-1">
                        +{formatINR(r.amount)}
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedReceiptDetailId(r.id)}
                          title="View & Print Receipt PDF"
                          className="h-8 text-xs font-bold"
                        >
                          <Printer className="w-3.5 h-3.5 mr-1" />
                          Receipt
                        </Button>

                        {r.customer?.mobile && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const message = `Hello ${r.customer?.name || 'Customer'}, payment receipt #${r.number} of ${formatINR(r.amount)} received on ${formatDate(r.receipt_date)} via ${r.mode}. Thank you! - ${business?.name || 'SIMPLIFY'}`;
                              const url = getWhatsAppUrl(r.customer!.mobile!, message);
                              window.open(url, '_blank');
                            }}
                            title="WhatsApp Receipt to Customer"
                            className="h-8 w-8 p-0"
                          >
                            <Share2 className="w-3.5 h-3.5 text-emerald-600" />
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteReceiptClick(r.id)}
                          title="Delete Receipt (Reverses Allocations)"
                          className="h-8 w-8 p-0"
                        >
                          <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-danger" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: VENDOR PAYMENTS */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          {/* Bank vs Cash Summary Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded-xl border border-border shadow-2xs">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Total Payments (OUT)
              </div>
              <div className="text-2xl font-bold text-danger mt-1">
                -{formatINR(paymentStats.total)}
              </div>
            </div>

            <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary uppercase tracking-wider">
                <Building className="w-3.5 h-3.5" />
                <span>Bank & UPI Paid</span>
              </div>
              <div className="text-2xl font-bold text-primary mt-1">
                -{formatINR(paymentStats.bankUpi)}
              </div>
            </div>

            <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 uppercase tracking-wider">
                <Banknote className="w-3.5 h-3.5" />
                <span>Cash Paid</span>
              </div>
              <div className="text-2xl font-bold text-amber-700 mt-1">
                -{formatINR(paymentStats.cash)}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Mode Filter Chips */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setModeFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  modeFilter === 'ALL'
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                All Payments ({payments.length})
              </button>
              <button
                type="button"
                onClick={() => setModeFilter('BANK_UPI')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1 ${
                  modeFilter === 'BANK_UPI'
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Building className="w-3 h-3" />
                <span>Bank & UPI</span>
              </button>
              <button
                type="button"
                onClick={() => setModeFilter('CASH')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1 ${
                  modeFilter === 'CASH'
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Banknote className="w-3 h-3" />
                <span>Cash Only</span>
              </button>
            </div>

            <div className="relative flex-1 sm:w-72">
              <Search className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
              <Input
                type="text"
                placeholder="Search payments by description..."
                value={paymentsSearch}
                onChange={(e) => setPaymentsSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchPayments()}
                className="pl-9 h-9 text-xs"
              />
            </div>
          </div>

          {loadingPayments ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : payments.length === 0 ? (
            <Card className="p-8 text-center">
              <EmptyState message="No vendor payments recorded yet." />
            </Card>
          ) : (
            <div className="space-y-2">
              {payments
                .filter((p) => {
                  if (modeFilter === 'ALL') return true;
                  if (modeFilter === 'CASH') return p.mode === 'CASH';
                  if (modeFilter === 'BANK_UPI') return ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(p.mode);
                  return true;
                })
                .map((p) => (
                  <div
                    key={p.id}
                    className="bg-white border border-border rounded-xl p-3.5 flex items-center justify-between hover:bg-surface/30 transition-colors shadow-2xs"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedVendorDetailId(p.vendor_id)}
                          className="font-bold text-text text-sm hover:text-primary flex items-center gap-1 group"
                        >
                          <Building className="w-3.5 h-3.5 text-text-muted" />
                          <span>{p.vendors?.name || 'Vendor'}</span>
                          <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                        </button>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                            ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(p.mode)
                              ? 'bg-blue-50 text-primary border-blue-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {p.mode === 'BANK' ? '🏦 Bank' : p.mode === 'UPI' ? '📱 UPI' : p.mode}
                        </span>
                      </div>

                      <div className="text-xs text-text-muted">
                        {formatDate(p.payment_date)} · {p.description} {p.notes && `· ${p.notes}`}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div className="text-right font-black text-danger text-base pr-1">
                        -{formatINR(p.amount)}
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedVendorDetailId(p.vendor_id)}
                        className="h-8 text-xs font-bold"
                        title="View Vendor Statement & History"
                      >
                        <FileText className="w-3.5 h-3.5 mr-1" />
                        Statement
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeletePayment(p.id)}
                        title="Delete payment"
                        className="h-8 w-8 p-0"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-slate-400 hover:text-danger" />
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: BANK IN/OUT LEDGER */}
      {activeTab === 'bank' && (
        <BankLedgerTab
          onRecordIncome={() => {
            setReceivePrefillCustomer(undefined);
            setIsReceivePaymentOpen(true);
          }}
          onRecordPayment={() => setIsNewPaymentOpen(true)}
        />
      )}

      {/* TAB 4: EXPENSES */}
      {activeTab === 'expenses' && (
        <div className="space-y-4">
          {/* Bank vs Cash Summary Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded-xl border border-border shadow-2xs">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Total Expenses (OUT)
              </div>
              <div className="text-2xl font-bold text-danger mt-1">
                -{formatINR(expenseStats.total)}
              </div>
            </div>

            <div className="p-3 bg-blue-50/60 rounded-lg border border-blue-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-primary uppercase tracking-wider">
                <Building className="w-3.5 h-3.5" />
                <span>Bank & UPI Paid</span>
              </div>
              <div className="text-2xl font-bold text-primary mt-1">
                -{formatINR(expenseStats.bankUpi)}
              </div>
            </div>

            <div className="p-3 bg-amber-50/60 rounded-lg border border-amber-100">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 uppercase tracking-wider">
                <Banknote className="w-3.5 h-3.5" />
                <span>Cash Paid</span>
              </div>
              <div className="text-2xl font-bold text-amber-700 mt-1">
                -{formatINR(expenseStats.cash)}
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            {/* Mode Filter Chips */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setModeFilter('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  modeFilter === 'ALL'
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                All Expenses ({expenses.length})
              </button>
              <button
                type="button"
                onClick={() => setModeFilter('BANK_UPI')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1 ${
                  modeFilter === 'BANK_UPI'
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Building className="w-3 h-3" />
                <span>Bank & UPI</span>
              </button>
              <button
                type="button"
                onClick={() => setModeFilter('CASH')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all flex items-center gap-1 ${
                  modeFilter === 'CASH'
                    ? 'bg-primary text-white border-primary shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Banknote className="w-3 h-3" />
                <span>Cash Only</span>
              </button>
            </div>

            <div className="relative flex-1 sm:w-72">
              <Search className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
              <Input
                type="text"
                placeholder="Search expenses by description..."
                value={expensesSearch}
                onChange={(e) => setExpensesSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchExpenses()}
                className="pl-9 h-9 text-xs"
              />
            </div>
          </div>

          {loadingExpenses ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : expenses.length === 0 ? (
            <Card className="p-8 text-center">
              <EmptyState message="No business overhead expenses recorded yet." />
            </Card>
          ) : (
            <div className="space-y-2">
              {expenses
                .filter((e) => {
                  if (modeFilter === 'ALL') return true;
                  if (modeFilter === 'CASH') return e.mode === 'CASH';
                  if (modeFilter === 'BANK_UPI') return ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(e.mode);
                  return true;
                })
                .map((e) => {
                  const isSystemGen = Boolean(e.loan_repayment_id || e.staff_id);
                  return (
                    <div
                      key={e.id}
                      className="bg-white border border-border rounded-xl p-3.5 flex items-center justify-between hover:bg-surface/30 transition-colors shadow-2xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-text text-sm">{e.description}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-surface border border-border text-text-muted">
                            {e.expense_categories?.name || 'Overhead'}
                          </span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                              ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(e.mode)
                                ? 'bg-blue-50 text-primary border-blue-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            {e.mode === 'BANK' ? '🏦 Bank' : e.mode === 'UPI' ? '📱 UPI' : e.mode}
                          </span>
                          {e.loan_repayment_id && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                              Loan Interest
                            </span>
                          )}
                          {e.staff_id && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                              Commission Payout
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-text-muted">
                          {formatDate(e.expense_date)} · Mode: {e.mode}{' '}
                          {e.payee && `· Payee: ${e.payee}`} {e.notes && `· ${e.notes}`}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="text-right font-bold text-danger text-base">
                          -{formatINR(e.amount)}
                        </div>

                        {!isSystemGen && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteExpense(e.id)}
                            title="Delete expense"
                          >
                            <Trash2 className="w-4 h-4 text-text-muted hover:text-danger" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

      {/* TAB 5: CAPITAL LEDGER (LOANS) */}
      {activeTab === 'loans' && (
        <div className="space-y-4">
          {/* Prominent Loan Summary Banner */}
          {loansData && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white p-4 rounded-xl border border-border">
              <div>
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Total Taken
                </div>
                <div className="text-2xl font-bold text-text mt-1">
                  {formatINR(loansData.summary.total_taken)}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Principal Repaid
                </div>
                <div className="text-2xl font-bold text-success mt-1">
                  {formatINR(loansData.summary.total_principal_repaid)}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Loan Outstanding
                </div>
                <div className="text-2xl font-bold text-danger mt-1">
                  {formatINR(loansData.summary.total_outstanding)}
                </div>
              </div>

              <div>
                <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                  Interest Paid
                </div>
                <div className="text-2xl font-bold text-amber-700 mt-1">
                  {formatINR(loansData.summary.total_interest_paid)}
                </div>
              </div>
            </div>
          )}

          {loadingLoans ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-xl" />
              ))}
            </div>
          ) : !loansData || loansData.loans.length === 0 ? (
            <Card className="p-8 text-center">
              <EmptyState message="No outside loans or udhar recorded in the Capital Ledger." />
            </Card>
          ) : (
            <div className="space-y-3">
              {loansData.loans.map((l) => {
                const isExpanded = Boolean(expandedLoans[l.loan_id]);
                return (
                  <div
                    key={l.loan_id}
                    className="bg-white border border-border rounded-xl overflow-hidden transition-shadow shadow-xs"
                  >
                    <div className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => toggleLoanExpand(l.loan_id)}
                          className="p-1 hover:bg-surface rounded text-text-muted"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>

                        <div>
                          <div className="font-bold text-text text-sm">{l.lender_name}</div>
                          <div className="text-xs text-text-muted mt-0.5">
                            Date: {formatDate(l.loan_date)}{' '}
                            {l.interest_rate ? `· Interest: ${l.interest_rate}% p.a.` : ''}{' '}
                            {l.notes && `· ${l.notes}`}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-4 pl-8 sm:pl-0">
                        <div className="text-right">
                          <div className="text-xs text-text-muted">
                            Taken: {formatINR(l.taken_amount)} · Repaid: {formatINR(l.principal_repaid)}
                          </div>
                          <div className="text-base font-bold text-danger">
                            Due: {formatINR(l.outstanding)}
                          </div>
                        </div>

                        {l.outstanding > 0 && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() =>
                              setRepaymentLoan({
                                loan_id: l.loan_id,
                                lender_name: l.lender_name,
                                taken_amount: l.taken_amount,
                                outstanding: l.outstanding,
                              })
                            }
                          >
                            Repay
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Expandable Repayments Timeline */}
                    {isExpanded && (
                      <div className="border-t border-border bg-surface/50 p-3">
                        {!l.repayments || l.repayments.length === 0 ? (
                          <div className="text-xs text-text-muted text-center py-2">
                            No repayments recorded yet for this loan.
                          </div>
                        ) : (
                          <div className="border border-border rounded-lg overflow-hidden bg-white text-xs divide-y divide-border/60">
                            <div className="bg-surface grid grid-cols-12 p-2 font-semibold text-text-muted">
                              <div className="col-span-3">Date</div>
                              <div className="col-span-3 text-right">Principal Repaid</div>
                              <div className="col-span-3 text-right">Interest (Expense)</div>
                              <div className="col-span-3 text-right">Mode</div>
                            </div>
                            {l.repayments.map((rep) => (
                              <div key={rep.id} className="grid grid-cols-12 p-2 items-center">
                                <div className="col-span-3 text-text-muted">
                                  {formatDate(rep.repayment_date)}
                                </div>
                                <div className="col-span-3 text-right font-medium text-success">
                                  {formatINR(rep.principal)}
                                </div>
                                <div className="col-span-3 text-right font-medium text-amber-700">
                                  {formatINR(rep.interest)}
                                </div>
                                <div className="col-span-3 text-right text-text-muted">
                                  {rep.mode}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Receive Payment Sheet */}
      <ReceivePaymentSheet
        open={isReceivePaymentOpen}
        onOpenChange={setIsReceivePaymentOpen}
        prefillCustomer={receivePrefillCustomer}
        onSuccess={() => {
          fetchDues();
          fetchReceipts();
        }}
        onViewReceipt={(receiptId) => setSelectedReceiptDetailId(receiptId)}
      />

      {/* Receipt Detail & PDF Modal */}
      <ReceiptDetailModal
        open={Boolean(selectedReceiptDetailId)}
        onOpenChange={(v) => !v && setSelectedReceiptDetailId(null)}
        receiptId={selectedReceiptDetailId}
      />

      {/* Other Income Modal */}
      <OtherIncomeModal
        open={isOtherIncomeOpen}
        onOpenChange={setIsOtherIncomeOpen}
        onSuccess={() => {
          fetchReceipts();
        }}
      />

      {/* Remind All Drawer */}
      <RemindAllDrawer
        open={isRemindAllOpen}
        onOpenChange={setIsRemindAllOpen}
        customers={customerDues}
      />

      {/* Customer Ledger Modal */}
      <CustomerLedgerModal
        open={Boolean(ledgerCustomerId)}
        onOpenChange={(v) => !v && setLedgerCustomerId(null)}
        customerId={ledgerCustomerId}
        onReceivePayment={(c) => {
          setLedgerCustomerId(null);
          handleOpenReceive(c);
        }}
      />

      {/* New Payment Modal */}
      <NewPaymentModal
        open={isNewPaymentOpen}
        onOpenChange={setIsNewPaymentOpen}
        onSuccess={() => {
          fetchPayments();
        }}
      />

      {/* Vendor Detail Modal */}
      <VendorDetailModal
        open={Boolean(selectedVendorDetailId)}
        onOpenChange={(v) => !v && setSelectedVendorDetailId(null)}
        vendorId={selectedVendorDetailId}
        onRecordPayment={() => {
          setSelectedVendorDetailId(null);
          setIsNewPaymentOpen(true);
        }}
      />

      {/* New Expense Modal */}
      <NewExpenseModal
        open={isNewExpenseOpen}
        onOpenChange={setIsNewExpenseOpen}
        onSuccess={() => {
          fetchExpenses();
        }}
      />

      {/* New Loan Modal */}
      <NewLoanModal
        open={isNewLoanOpen}
        onOpenChange={setIsNewLoanOpen}
        onSuccess={() => {
          fetchLoans();
        }}
      />

      {/* Record Repayment Modal */}
      <RecordRepaymentModal
        open={Boolean(repaymentLoan)}
        onOpenChange={(v) => !v && setRepaymentLoan(null)}
        loan={repaymentLoan}
        onSuccess={() => {
          fetchLoans();
        }}
      />

      {/* Delete Receipt Confirmation Dialog */}
      <Dialog
        open={isDeleteConfirmOpen}
        onOpenChange={setIsDeleteConfirmOpen}
        title="Delete Receipt"
        description="Deleting this receipt will reverse all allocations, and the balance on linked bills will be reopened. Are you sure?"
      >
        <div className="flex gap-2 pt-3">
          <Button
            variant="outline"
            size="md"
            className="flex-1"
            onClick={() => setIsDeleteConfirmOpen(false)}
          >
            Cancel
          </Button>
          <Button
            variant="danger"
            size="md"
            className="flex-1"
            loading={deleting}
            onClick={handleConfirmDeleteReceipt}
          >
            Delete & Reopen Bills
          </Button>
        </div>
      </Dialog>
    </div>
  );
};
