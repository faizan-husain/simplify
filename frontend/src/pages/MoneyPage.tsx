import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate } from '../lib/dates';
import { getWhatsAppUrl } from '../lib/auth';
import { getErrorMessage, t } from '../i18n';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { ReceivePaymentSheet } from '../components/receipts/ReceivePaymentSheet';
import { ReceiptDetailModal } from '../components/receipts/ReceiptDetailModal';
import { OtherIncomeModal } from '../components/receipts/OtherIncomeModal';
import { EditReceiptModal } from '../components/receipts/EditReceiptModal';
import { CustomerLedgerModal } from '../components/customers/CustomerLedgerModal';
import { RemindAllDrawer } from '../components/dues/RemindAllDrawer';
import { NewPaymentModal } from '../components/payments/NewPaymentModal';
import { VendorDetailModal } from '../components/payments/VendorDetailModal';
import { NewExpenseModal } from '../components/expenses/NewExpenseModal';
import { NewLoanModal } from '../components/loans/NewLoanModal';
import { RecordRepaymentModal } from '../components/loans/RecordRepaymentModal';
import { BankLedgerTab } from '../components/banks/BankLedgerTab';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { TabBar, FilterChips, SearchField, DuesCard, MoneyRow, Stat, StatGrid } from '../components/mobile';
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
  Pencil,
} from 'lucide-react';
import { Database } from '../types/supabase';

type Receipt = Database['public']['Tables']['receipts']['Row'] & {
  customer?: { name: string; mobile: string | null } | null;
  bank_name?: string | null;
  allocations?: Array<{
    amount: number;
    invoice_number?: string;
    bill_no?: string;
    invoice?: { number: string; party_name: string; party_mobile: string | null };
  }>;
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

  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<MoneyTab>(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'receipts' || tabParam === 'payments' || tabParam === 'expenses' || tabParam === 'loans' || tabParam === 'bank' || tabParam === 'dues') {
      return tabParam as MoneyTab;
    }
    return 'dues';
  });

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && (tabParam === 'receipts' || tabParam === 'payments' || tabParam === 'expenses' || tabParam === 'loans' || tabParam === 'bank' || tabParam === 'dues')) {
      setActiveTab(tabParam as MoneyTab);
    }
    const actionParam = searchParams.get('action');
    if (actionParam === 'new') {
      if (tabParam === 'receipts') setIsReceivePaymentOpen(true);
      else if (tabParam === 'payments') setIsNewPaymentOpen(true);
      else if (tabParam === 'expenses') setIsNewExpenseOpen(true);
    }
  }, [searchParams]);

  const handleTabChange = (newTab: MoneyTab) => {
    setActiveTab(newTab);
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', newTab);
    setSearchParams(newParams, { replace: true });
  };

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
  const [receiptToEdit, setReceiptToEdit] = useState<Receipt | null>(null);

  // Edit & Delete modal states for Payments, Expenses, and Loans
  const [paymentToEdit, setPaymentToEdit] = useState<any | null>(null);
  const [paymentToDelete, setPaymentToDelete] = useState<any | null>(null);
  const [deletingPayment, setDeletingPayment] = useState(false);

  const [expenseToEdit, setExpenseToEdit] = useState<any | null>(null);
  const [expenseToDelete, setExpenseToDelete] = useState<any | null>(null);
  const [deletingExpense, setDeletingExpense] = useState(false);

  const [loanToEdit, setLoanToEdit] = useState<any | null>(null);
  const [loanToDelete, setLoanToDelete] = useState<any | null>(null);
  const [deletingLoan, setDeletingLoan] = useState(false);

  const [repaymentToDelete, setRepaymentToDelete] = useState<any | null>(null);
  const [deletingRepayment, setDeletingRepayment] = useState(false);

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

  // Fetch receipts with customer resolution & allocations
  const fetchReceipts = async () => {
    setLoadingReceipts(true);
    try {
      // 1. Try receipts_list RPC with full customer resolution & allocations
      const { data, error } = await supabase.rpc('receipts_list', {
        p_search: receiptsSearch.trim() || null,
        p_mode: modeFilter,
        p_limit: 100,
        p_offset: 0,
      });

      if (!error && Array.isArray(data)) {
        setReceipts(data as Receipt[]);
      } else {
        // Fallback to table query
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

        const { data: fbData, error: fbErr } = await query;
        if (fbErr) throw fbErr;
        setReceipts((fbData as Receipt[]) || []);
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoadingReceipts(false);
    }
  };

  const getReceiptDisplayInfo = (r: Receipt) => {
    let name = 'Walk-in Customer';
    let mobile: string | null = null;
    const isOther = r.kind === 'OTHER_INCOME';

    if (isOther) {
      name = r.income_category || 'Other Income';
    } else if (r.customer?.name) {
      name = r.customer.name;
      mobile = r.customer.mobile || null;
    } else if (r.allocations && r.allocations.length > 0) {
      const firstAlloc = r.allocations[0];
      const invPartyName = firstAlloc.invoice?.party_name || (firstAlloc as any).party_name;
      const invPartyMobile = firstAlloc.invoice?.party_mobile || (firstAlloc as any).party_mobile;
      if (invPartyName) {
        name = invPartyName;
        mobile = invPartyMobile || null;
      }
    }

    const billNumbers: string[] = [];
    if (r.allocations && r.allocations.length > 0) {
      for (const a of r.allocations) {
        const invNum = a.invoice?.number || a.invoice_number || a.bill_no;
        if (invNum) {
          billNumbers.push(invNum);
        }
      }
    }

    let billsText: string | null = null;
    if (billNumbers.length === 1) {
      billsText = `Bill #${billNumbers[0]}`;
    } else if (billNumbers.length > 1) {
      billsText = `${billNumbers.length} Bills (#${billNumbers.join(', #')})`;
    }

    return { name, mobile, isOther, billsText, billNumbers };
  };

  const filteredReceipts = React.useMemo(() => {
    return receipts.filter((r) => {
      // Mode filter
      if (modeFilter === 'CASH' && r.mode !== 'CASH') return false;
      if (modeFilter === 'BANK_UPI' && !['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(r.mode)) return false;

      // Real-time search filter across Customer Name, Phone, Receipt #, Reference, Bills, Category, Notes
      if (receiptsSearch.trim()) {
        const term = receiptsSearch.toLowerCase().trim();
        const info = getReceiptDisplayInfo(r);
        const nameMatch = info.name.toLowerCase().includes(term);
        const mobileMatch = (info.mobile || '').toLowerCase().includes(term);
        const numMatch = (r.number || '').toLowerCase().includes(term);
        const refMatch = (r.reference || '').toLowerCase().includes(term);
        const notesMatch = (r.notes || '').toLowerCase().includes(term);
        const billsMatch = (info.billsText || '').toLowerCase().includes(term);
        const bankMatch = (r.bank_name || '').toLowerCase().includes(term);

        if (!nameMatch && !mobileMatch && !numMatch && !refMatch && !notesMatch && !billsMatch && !bankMatch) {
          return false;
        }
      }
      return true;
    });
  }, [receipts, modeFilter, receiptsSearch]);

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

  // Enterprise Multi-Device Realtime sync: automatically refresh active financial tab on remote device changes
  useEffect(() => {
    const handleSync = () => {
      if (activeTab === 'dues') fetchDues();
      else if (activeTab === 'receipts') fetchReceipts();
      else if (activeTab === 'payments') fetchPayments();
      else if (activeTab === 'expenses') fetchExpenses();
      else if (activeTab === 'loans') fetchLoans();
    };
    window.addEventListener('simplify:sync', handleSync);
    return () => window.removeEventListener('simplify:sync', handleSync);
  }, [activeTab]);

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

  const handleConfirmDeletePayment = async () => {
    if (!paymentToDelete) return;
    setDeletingPayment(true);
    try {
      const { error } = await supabase.rpc('soft_delete', {
        p_table: 'payments',
        p_id: paymentToDelete.id,
      });
      if (error) throw error;
      showToast('Payment deleted successfully', 'success');
      setPaymentToDelete(null);
      fetchPayments();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setDeletingPayment(false);
    }
  };

  const handleConfirmDeleteExpense = async () => {
    if (!expenseToDelete) return;
    setDeletingExpense(true);
    try {
      const { error } = await supabase.rpc('soft_delete', {
        p_table: 'expenses',
        p_id: expenseToDelete.id,
      });
      if (error) throw error;
      showToast('Expense deleted successfully', 'success');
      setExpenseToDelete(null);
      fetchExpenses();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setDeletingExpense(false);
    }
  };

  const handleConfirmDeleteLoan = async () => {
    if (!loanToDelete) return;
    setDeletingLoan(true);
    try {
      const { error } = await supabase.rpc('soft_delete', {
        p_table: 'loans',
        p_id: loanToDelete.loan_id || loanToDelete.id,
      });
      if (error) throw error;
      showToast('Loan deleted successfully', 'success');
      setLoanToDelete(null);
      fetchLoans();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setDeletingLoan(false);
    }
  };

  const handleConfirmDeleteRepayment = async () => {
    if (!repaymentToDelete) return;
    setDeletingRepayment(true);
    try {
      const { error } = await supabase.rpc('delete_loan_repayment', {
        repayment_id: repaymentToDelete.id,
      });
      if (error) throw error;
      showToast('Repayment deleted and loan balance restored', 'success');
      setRepaymentToDelete(null);
      fetchLoans();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setDeletingRepayment(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4 pb-12">
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
              <button
                type="button"
                onClick={() => setIsOtherIncomeOpen(true)}
                className="h-9 px-3.5 rounded-xl border-0 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-slate-500" />
                <span>Other Income</span>
              </button>
              <button
                type="button"
                onClick={() => handleOpenReceive()}
                className="h-9 px-4 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Receive Payment</span>
              </button>
            </>
          ) : activeTab === 'payments' ? (
            <button
              type="button"
              onClick={() => setIsNewPaymentOpen(true)}
              className="h-9 px-4 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Vendor Payment</span>
            </button>
          ) : activeTab === 'expenses' ? (
            <button
              type="button"
              onClick={() => setIsNewExpenseOpen(true)}
              className="h-9 px-4 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Expense</span>
            </button>
          ) : activeTab === 'loans' ? (
            <button
              type="button"
              onClick={() => setIsNewLoanOpen(true)}
              className="h-9 px-4 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Record Loan Received</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Mobile TabBar (scrollable, sticky under header, 44px) */}
      <div className="md:hidden -mx-4 -mt-4 mb-4">
        <TabBar
          tabs={[
            { value: 'dues', label: 'Dues', count: duesSummary.total_bills_due },
            { value: 'receipts', label: 'Receipts (IN)' },
            { value: 'payments', label: 'Payments (OUT)' },
            { value: 'bank', label: 'Cash & Bank' },
            { value: 'expenses', label: 'Expenses' },
            { value: 'loans', label: 'Loans' },
          ]}
          value={activeTab}
          onChange={(v) => handleTabChange(v as MoneyTab)}
          sticky
        />
      </div>

      {/* Desktop TabsList (unchanged desktop UI) */}
      <div className="hidden md:block">
        <Tabs value={activeTab} onValueChange={(v) => handleTabChange(v as MoneyTab)}>
          <TabsList className="w-full">
            <TabsTrigger value="dues" count={duesSummary.total_bills_due}>
              Dues
            </TabsTrigger>
            <TabsTrigger value="receipts">
              Receipts (IN)
            </TabsTrigger>
            <TabsTrigger value="payments">
              Payments (OUT)
            </TabsTrigger>
            <TabsTrigger value="bank">
              Cash & Bank
            </TabsTrigger>
            <TabsTrigger value="expenses">
              Expenses
            </TabsTrigger>
            <TabsTrigger value="loans">
              Loans
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* TAB 1: DUES */}
      {activeTab === 'dues' && (
        <div className="space-y-4">
          {/* 4 Prominent Stat Cards: 2x2 grid on mobile, 4-across on desktop */}
          <StatGrid>
            <Stat
              label="Total Outstanding"
              value={formatINR(duesSummary.total_outstanding)}
              variant={duesSummary.total_outstanding > 0 ? 'danger' : 'default'}
            />
            <Stat
              label="Overdue Amount"
              value={formatINR(duesSummary.total_overdue)}
              variant={duesSummary.total_overdue > 0 ? 'danger' : 'default'}
            />
            <Stat
              label="Unpaid Bills"
              value={duesSummary.total_bills_due}
            />
            <Stat
              label="Customers with Dues"
              value={duesSummary.customer_count}
            />
          </StatGrid>

          {/* Mobile FilterChips & Single SearchField */}
          <div className="md:hidden space-y-2.5">
            <FilterChips
              value={duesFilter}
              onChange={(v) => setDuesFilter(v as any)}
              options={[
                { value: 'ALL', label: 'All Dues' },
                { value: 'OVERDUE', label: 'Overdue Only' },
                { value: 'REGULAR', label: 'Regular' },
                { value: 'WALK_IN', label: 'Walk-in' },
              ]}
            />
            <SearchField
              value={duesSearch}
              onChange={(val) => {
                setDuesSearch(val);
              }}
              placeholder="Search customer or bill..."
              rightAction={
                customerDues.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setIsRemindAllOpen(true)}
                    className="h-[34px] px-3 rounded-lg bg-surface-2 text-text font-medium text-xs flex items-center gap-1.5 active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
                  >
                    <Share2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Remind All</span>
                  </button>
                ) : undefined
              }
            />
          </div>

          {/* Desktop Filter Segmented Control & Search & Remind All (unchanged) */}
          <div className="hidden md:flex flex-row items-center justify-between gap-3">
            <div className="overflow-x-auto pb-0.5">
              <SegmentedControl
                value={duesFilter}
                onChange={(v) => setDuesFilter(v as any)}
                options={[
                  { value: 'ALL', label: 'All Dues' },
                  { value: 'OVERDUE', label: 'Overdue Only' },
                  { value: 'REGULAR', label: 'Regular' },
                  { value: 'WALK_IN', label: 'Walk-in' },
                ]}
              />
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search customer / bill #..."
                  value={duesSearch}
                  onChange={(e) => setDuesSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && fetchDues()}
                  className="w-full h-11 pl-9 pr-3 text-xs bg-white border-0 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#0F766E]/20 text-slate-800 placeholder:text-slate-400 font-medium focus:outline-none transition-all"
                />
              </div>

              {customerDues.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsRemindAllOpen(true)}
                  className="h-11 px-4 rounded-xl border-0 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 font-medium text-xs flex items-center gap-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] transition-all shrink-0 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5 text-slate-500" />
                  <span>Remind All</span>
                </button>
              )}
            </div>
          </div>

          {/* Customer Dues List */}
          {loadingDues ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-2xl" />
              ))}
            </div>
          ) : customerDues.length === 0 ? (
            <div className="bg-white border-0 rounded-2xl p-8 text-center shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <EmptyState message="No outstanding dues. All bills have been collected, or no customers match the current filter." />
            </div>
          ) : (
            <>
              {/* Mobile Card Anatomy (§5.2 DuesCard Reference Fix) */}
              <div className="md:hidden space-y-3">
                {customerDues.map((c) => (
                  <DuesCard
                    key={c.customer_id}
                    customerName={c.customer_name}
                    totalDue={c.total_due}
                    mobile={c.customer_mobile}
                    customerType={c.customer_type}
                    billCount={c.bill_count}
                    oldestDate={c.oldest_bill_date}
                    maxDaysOverdue={c.max_days_overdue}
                    onRemindWhatsApp={c.customer_mobile ? () => handleRemindCustomer(c) : undefined}
                    onReceivePayment={() =>
                      handleOpenReceive({
                        id: c.customer_id,
                        name: c.customer_name,
                        mobile: c.customer_mobile,
                      })
                    }
                    onOpenLedger={() => setLedgerCustomerId(c.customer_id)}
                  />
                ))}
              </div>

              {/* Desktop Expandable Table Cards (unchanged desktop UI) */}
              <div className="hidden md:block space-y-3">
                {customerDues.map((c) => {
                  const isExpanded = Boolean(expandedCustomers[c.customer_id]);
                  return (
                    <div
                      key={c.customer_id}
                      className="bg-white border-0 rounded-2xl overflow-hidden transition-all duration-200 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)]"
                    >
                      {/* Customer Row Header */}
                      <div className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 flex-1 min-w-0">
                          <button
                            type="button"
                            onClick={() => toggleCustomerExpand(c.customer_id)}
                            className="w-7 h-7 flex items-center justify-center hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer shrink-0 transition-colors"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4" />
                            ) : (
                              <ChevronRight className="w-4 h-4" />
                            )}
                          </button>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setLedgerCustomerId(c.customer_id)}
                                className="font-bold text-slate-900 hover:text-[#0F766E] text-sm sm:text-base text-left flex items-center gap-1 group cursor-pointer truncate transition-colors"
                              >
                                <span className="truncate">{c.customer_name}</span>
                                <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-[#0F766E] shrink-0" />
                              </button>
                              <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-100 border-0 text-slate-600 font-semibold tracking-wide uppercase shrink-0">
                                {c.customer_type}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5 truncate">
                              {c.customer_mobile || 'No mobile'} · {c.bill_count} unpaid bill
                              {c.bill_count > 1 ? 's' : ''} · Oldest: {formatDate(c.oldest_bill_date)}
                              {c.max_days_overdue > 0 && (
                                <span className="text-danger font-semibold ml-1.5">
                                  ({c.max_days_overdue}d overdue)
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Right: Balance & Actions */}
                        <div className="flex items-center justify-between sm:justify-end gap-3 pl-8 sm:pl-0 shrink-0">
                          <div className="w-[125px] text-right shrink-0">
                            <div className="text-base sm:text-lg font-bold text-danger tabular-nums truncate">
                              {formatINR(c.total_due)}
                            </div>
                            {c.overdue_balance > 0 && (
                              <div className="text-[11.5px] text-danger font-medium tabular-nums truncate">
                                Overdue: {formatINR(c.overdue_balance)}
                              </div>
                            )}
                          </div>

                          <div className="w-[120px] shrink-0 flex items-center justify-end gap-1.5">
                            {c.customer_mobile && (
                              <button
                                type="button"
                                onClick={() => handleRemindCustomer(c)}
                                title="Send WhatsApp Reminder"
                                className="w-8 h-8 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-700 flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                              >
                                <Share2 className="w-4 h-4" />
                              </button>
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
                              className="px-3.5 h-8 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs transition-all cursor-pointer"
                            >
                              Receive
                            </Button>
                          </div>
                        </div>
                      </div>

                      {/* Expandable Unpaid Bills Table */}
                      {isExpanded && (
                        <div className="border-t border-slate-100 bg-slate-50/70 p-3.5">
                          <div className="border-0 rounded-xl overflow-hidden bg-white text-xs shadow-2xs">
                            <div className="bg-slate-50 grid grid-cols-12 p-2.5 font-semibold text-slate-500 border-b border-slate-100">
                              <div className="col-span-3">Bill #</div>
                              <div className="col-span-3">Date / Due</div>
                              <div className="col-span-2 text-right">Total</div>
                              <div className="col-span-2 text-right">Paid</div>
                              <div className="col-span-2 text-right">Balance</div>
                            </div>

                            <div className="divide-y divide-slate-100">
                              {c.invoices.map((inv) => (
                                <div key={inv.id} className="grid grid-cols-12 p-2.5 items-center hover:bg-slate-50/50 transition-colors">
                                  <div className="col-span-3 font-semibold text-slate-900">
                                    #{inv.number}
                                  </div>
                                  <div className="col-span-3 text-slate-500 text-[11px]">
                                    {formatDate(inv.invoice_date)}
                                    {inv.is_overdue && (
                                      <span className="text-danger font-bold ml-1">
                                        ({inv.days_overdue}d late)
                                      </span>
                                    )}
                                  </div>
                                  <div className="col-span-2 text-right text-slate-500 tabular-nums">
                                    {formatINR(inv.total)}
                                  </div>
                                  <div className="col-span-2 text-right text-emerald-600 font-medium tabular-nums">
                                    {formatINR(inv.paid_amount)}
                                  </div>
                                  <div className="col-span-2 text-right font-bold text-danger tabular-nums">
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
            </>
          )}
        </div>
      )}

      {/* TAB 2: RECEIPTS */}
      {activeTab === 'receipts' && (
        <div className="space-y-4">
          {/* Mobile StatGrid (md:hidden) */}
          <div className="md:hidden">
            <StatGrid>
              <Stat label="Total Income (IN)" value={`+${formatINR(receiptStats.total)}`} />
              <Stat label="Bank & UPI" value={`+${formatINR(receiptStats.bankUpi)}`} />
              <Stat label="Cash in Hand" value={`+${formatINR(receiptStats.cash)}`} />
              <Stat label="Total Receipts" value={String(receipts.length)} />
            </StatGrid>
          </div>

          {/* Desktop Summary Banner (hidden md:grid) */}
          <div className="hidden md:grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border-0 rounded-2xl p-5 flex flex-col justify-between min-h-[105px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all">
              <span className="text-[13px] font-medium text-[#64748B]">
                Total Income (IN)
              </span>
              <div className="text-[26px] font-bold text-emerald-600 tabular-nums mt-2 tracking-tight leading-tight">
                +{formatINR(receiptStats.total)}
              </div>
            </div>

            <div className="bg-white border-0 rounded-2xl p-5 flex flex-col justify-between min-h-[105px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#64748B]">
                <Building className="w-3.5 h-3.5 text-blue-600" />
                <span>Bank & UPI (Online)</span>
              </div>
              <div className="text-[26px] font-bold text-[#0F172A] tabular-nums mt-2 tracking-tight leading-tight">
                +{formatINR(receiptStats.bankUpi)}
              </div>
            </div>

            <div className="bg-white border-0 rounded-2xl p-5 flex flex-col justify-between min-h-[105px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#64748B]">
                <Banknote className="w-3.5 h-3.5 text-slate-500" />
                <span>Cash in Hand</span>
              </div>
              <div className="text-[26px] font-bold text-[#0F172A] tabular-nums mt-2 tracking-tight leading-tight">
                +{formatINR(receiptStats.cash)}
              </div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="space-y-3 md:space-y-0 md:flex md:items-center md:justify-between md:gap-3">
            {/* Mobile Filter Chips */}
            <div className="md:hidden">
              <FilterChips
                options={[
                  { value: 'ALL', label: `All (${receipts.length})` },
                  { value: 'BANK_UPI', label: 'Bank & UPI' },
                  { value: 'CASH', label: 'Cash Only' },
                ]}
                value={modeFilter}
                onChange={(v) => setModeFilter(v as any)}
              />
            </div>

            {/* Desktop Mode Filter Segmented Control */}
            <div className="hidden md:block overflow-x-auto pb-0.5">
              <SegmentedControl
                value={modeFilter}
                onChange={(v) => setModeFilter(v as any)}
                options={[
                  { value: 'ALL', label: `All Receipts (${receipts.length})` },
                  { value: 'BANK_UPI', label: 'Bank & UPI' },
                  { value: 'CASH', label: 'Cash Only' },
                ]}
              />
            </div>

            {/* Mobile SearchField */}
            <div className="md:hidden">
              <SearchField
                placeholder="Search customer, mobile, receipt #..."
                value={receiptsSearch}
                onChange={(val) => setReceiptsSearch(val)}
              />
            </div>

            {/* Desktop Search */}
            <div className="hidden md:block relative flex-1 sm:w-80">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search customer, mobile, receipt #, bill #..."
                value={receiptsSearch}
                onChange={(e) => setReceiptsSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchReceipts()}
                className="w-full h-11 pl-9 pr-3 text-xs bg-white border-0 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#0F766E]/20 text-slate-800 placeholder:text-slate-400 font-medium focus:outline-none transition-all"
              />
            </div>
          </div>

          {loadingReceipts ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full rounded-2xl" />
              ))}
            </div>
          ) : filteredReceipts.length === 0 ? (
            <div className="bg-white border-0 rounded-2xl p-8 text-center shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <EmptyState
                message={
                  receiptsSearch.trim()
                    ? `No receipts matching "${receiptsSearch}".`
                    : 'No receipts recorded. Customer payments and other income receipts will appear here.'
                }
              />
            </div>
          ) : (
            <>
              {/* Mobile Native MoneyRow Cards (md:hidden) */}
              <div className="md:hidden space-y-3">
                {filteredReceipts.map((r) => {
                  const info = getReceiptDisplayInfo(r);
                  const modeLabel = r.mode === 'BANK' ? 'Bank' : r.mode === 'UPI' ? 'UPI' : r.mode === 'CASH' ? 'Cash' : r.mode;
                  const refLabel = r.reference ? `Ref: ${r.reference}` : info.billsText ? info.billsText : `#${r.number}`;
                  return (
                    <MoneyRow
                      key={r.id}
                      title={info.name}
                      amount={r.amount}
                      isMoneyIn={true}
                      mode={modeLabel}
                      reference={refLabel}
                      date={r.receipt_date}
                      onClick={() => setSelectedReceiptDetailId(r.id)}
                    />
                  );
                })}
              </div>

              {/* Desktop Receipts List (hidden md:block) */}
              <div className="hidden md:block space-y-3">
                {filteredReceipts.map((r) => {
                  const info = getReceiptDisplayInfo(r);
                  return (
                    <div
                      key={r.id}
                      className="bg-white border-0 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all"
                    >
                      {/* Left: Customer Avatar + Details */}
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        {/* Avatar */}
                        <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-xs shrink-0 select-none bg-teal-50 text-[#0F766E] border-0">
                          {info.isOther ? '₹' : (info.name.charAt(0).toUpperCase() || 'C')}
                        </div>

                        <div className="space-y-1 min-w-0 flex-1">
                          {/* Primary: Customer Name & Key Badges */}
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-bold text-slate-900 text-sm sm:text-base tracking-tight truncate">
                              {info.name}
                            </span>

                            {info.mobile && (
                              <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2.5 py-0.5 rounded-full border-0">
                                {info.mobile}
                              </span>
                            )}

                            {/* Mode Badge */}
                            <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-700 border-0">
                              {r.mode === 'BANK'
                                ? 'Bank'
                                : r.mode === 'UPI'
                                  ? 'UPI'
                                  : r.mode === 'CASH'
                                    ? 'Cash'
                                    : r.mode}
                            </span>

                            {/* Bank Name */}
                            {r.bank_name && (
                              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600 border-0">
                                {r.bank_name}
                              </span>
                            )}

                            {/* Other Income Category */}
                            {r.kind === 'OTHER_INCOME' && (
                              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600 border-0">
                                {r.income_category || 'Other Income'}
                              </span>
                            )}
                          </div>

                          {/* Secondary: Receipt Number, Date, Linked Bills, Advance, Ref, Notes */}
                          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                            <span className="font-mono font-semibold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded text-[11px] border-0">
                              #{r.number}
                            </span>

                            <span>{formatDate(r.receipt_date)}</span>

                            {/* Linked Bills */}
                            {info.billsText && (
                              <span className="text-[#0F766E] font-medium bg-[#EAF2F1] px-2 py-0.5 rounded text-[11px] inline-flex items-center gap-1 border-0">
                                <FileText className="w-3 h-3" />
                                <span>{info.billsText}</span>
                              </span>
                            )}

                            {/* Advance Balance */}
                            {parseFloat(String(r.unallocated_amount || '0')) > 0 && (
                              <span className="text-[#0F766E] font-medium bg-[#EAF2F1] px-2 py-0.5 rounded text-[11px] border-0">
                                Advance: {formatINR(r.unallocated_amount)}
                              </span>
                            )}

                            {/* Reference */}
                            {r.reference && (
                              <span className="font-mono text-slate-500 font-medium">
                                Ref: {r.reference}
                              </span>
                            )}

                            {/* Notes */}
                            {r.notes && (
                              <span className="italic text-slate-500">
                                · "{r.notes}"
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Amount & Actions (Fixed column widths for clean vertical alignment) */}
                      <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                        <div className="w-[125px] text-right shrink-0">
                          <div className="text-[11px] font-medium text-slate-400">
                            Received
                          </div>
                          <div className="font-bold text-slate-900 text-base sm:text-lg leading-tight tabular-nums truncate">
                            +{formatINR(r.amount)}
                          </div>
                        </div>

                        <div className="w-[150px] shrink-0 flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setReceiptToEdit(r)}
                            title="Edit Receipt Details"
                            className="w-8 h-8 rounded-xl bg-slate-100/90 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setSelectedReceiptDetailId(r.id)}
                            title="Print Receipt"
                            className="w-8 h-8 rounded-xl bg-slate-100/90 hover:bg-slate-200/90 text-slate-700 hover:text-slate-900 flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                          >
                            <Printer className="w-3.5 h-3.5" />
                          </button>

                          {info.mobile && (
                            <button
                              type="button"
                              onClick={() => {
                                const message = `Hello ${info.name}, payment receipt #${r.number} of ${formatINR(r.amount)} received on ${formatDate(r.receipt_date)} via ${r.mode}. Thank you! - ${business?.name || 'SIMPLIFY'}`;
                                const url = getWhatsAppUrl(info.mobile!, message);
                                window.open(url, '_blank');
                              }}
                              title="WhatsApp Receipt to Customer"
                              className="w-8 h-8 rounded-xl bg-emerald-50 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-700 flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => handleDeleteReceiptClick(r.id)}
                            title="Delete Receipt (Reverses Allocations)"
                            className="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 3: VENDOR PAYMENTS */}
      {activeTab === 'payments' && (
        <div className="space-y-4">
          {/* Mobile StatGrid (md:hidden) */}
          <div className="md:hidden">
            <StatGrid>
              <Stat label="Total Payments (OUT)" value={`-${formatINR(paymentStats.total)}`} />
              <Stat label="Bank & UPI Paid" value={`-${formatINR(paymentStats.bankUpi)}`} />
              <Stat label="Cash Paid" value={`-${formatINR(paymentStats.cash)}`} />
              <Stat label="Total Payments" value={String(payments.length)} />
            </StatGrid>
          </div>

          {/* Desktop Summary Banner (hidden md:grid) */}
          <div className="hidden md:grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border-0 rounded-2xl p-5 flex flex-col justify-between min-h-[105px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all">
              <span className="text-[13px] font-medium text-[#64748B]">
                Total Payments (OUT)
              </span>
              <div className="text-[26px] font-bold text-rose-600 tabular-nums mt-2 tracking-tight leading-tight">
                -{formatINR(paymentStats.total)}
              </div>
            </div>

            <div className="bg-white border-0 rounded-2xl p-5 flex flex-col justify-between min-h-[105px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#64748B]">
                <Building className="w-3.5 h-3.5 text-blue-600" />
                <span>Bank & UPI Paid</span>
              </div>
              <div className="text-[26px] font-bold text-[#0F172A] tabular-nums mt-2 tracking-tight leading-tight">
                -{formatINR(paymentStats.bankUpi)}
              </div>
            </div>

            <div className="bg-white border-0 rounded-2xl p-5 flex flex-col justify-between min-h-[105px] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#64748B]">
                <Banknote className="w-3.5 h-3.5 text-slate-500" />
                <span>Cash Paid</span>
              </div>
              <div className="text-[26px] font-bold text-[#0F172A] tabular-nums mt-2 tracking-tight leading-tight">
                -{formatINR(paymentStats.cash)}
              </div>
            </div>
          </div>

          {/* Filter & Search Bar */}
          <div className="space-y-3 md:space-y-0 md:flex md:items-center md:justify-between md:gap-3">
            {/* Mobile Filter Chips */}
            <div className="md:hidden">
              <FilterChips
                options={[
                  { value: 'ALL', label: `All (${payments.length})` },
                  { value: 'BANK_UPI', label: 'Bank & UPI' },
                  { value: 'CASH', label: 'Cash Only' },
                ]}
                value={modeFilter}
                onChange={(v) => setModeFilter(v as any)}
              />
            </div>

            {/* Desktop Mode Filter Segmented Control */}
            <div className="hidden md:block overflow-x-auto pb-0.5">
              <SegmentedControl
                value={modeFilter}
                onChange={(v) => setModeFilter(v as any)}
                options={[
                  { value: 'ALL', label: `All Payments (${payments.length})` },
                  { value: 'BANK_UPI', label: 'Bank & UPI' },
                  { value: 'CASH', label: 'Cash Only' },
                ]}
              />
            </div>

            {/* Mobile SearchField */}
            <div className="md:hidden">
              <SearchField
                placeholder="Search payments by description..."
                value={paymentsSearch}
                onChange={(val) => setPaymentsSearch(val)}
              />
            </div>

            {/* Desktop Search */}
            <div className="hidden md:block relative flex-1 sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search payments by description..."
                value={paymentsSearch}
                onChange={(e) => setPaymentsSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchPayments()}
                className="w-full h-11 pl-9 pr-3 text-xs bg-white border-0 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#0F766E]/20 text-slate-800 placeholder:text-slate-400 font-medium focus:outline-none transition-all"
              />
            </div>
          </div>

          {loadingPayments ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-2xl" />
              ))}
            </div>
          ) : payments.length === 0 ? (
            <div className="bg-white border-0 rounded-2xl p-8 text-center shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <EmptyState message="No vendor payments recorded yet." />
            </div>
          ) : (
            <>
              {/* Mobile Native MoneyRow Cards (md:hidden) */}
              <div className="md:hidden space-y-3">
                {payments
                  .filter((p) => {
                    if (modeFilter === 'ALL') return true;
                    if (modeFilter === 'CASH') return p.mode === 'CASH';
                    if (modeFilter === 'BANK_UPI') return ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(p.mode);
                    return true;
                  })
                  .map((p) => {
                    const modeLabel = p.mode === 'BANK' ? 'Bank' : p.mode === 'UPI' ? 'UPI' : p.mode === 'CASH' ? 'Cash' : p.mode;
                    return (
                      <MoneyRow
                        key={p.id}
                        title={p.vendors?.name || 'Vendor'}
                        amount={p.amount}
                        isMoneyIn={false}
                        mode={modeLabel}
                        reference={p.description}
                        date={p.payment_date}
                        onClick={() => setSelectedVendorDetailId(p.vendor_id)}
                      />
                    );
                  })}
              </div>

              {/* Desktop Payments List (hidden md:block) */}
              <div className="hidden md:block space-y-3">
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
                      className="bg-white border-0 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all"
                    >
                      <div className="space-y-1 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedVendorDetailId(p.vendor_id)}
                            className="font-bold text-slate-900 text-sm sm:text-base hover:text-[#0F766E] flex items-center gap-1 group cursor-pointer truncate transition-colors"
                          >
                            <Building className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate">{p.vendors?.name || 'Vendor'}</span>
                            <ArrowUpRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-[#0F766E] shrink-0" />
                          </button>
                          <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-700 border-0 shrink-0">
                            {p.mode === 'BANK' ? 'Bank' : p.mode === 'UPI' ? 'UPI' : p.mode === 'CASH' ? 'Cash' : p.mode}
                          </span>
                        </div>

                        <div className="text-xs text-slate-500 truncate">
                          {formatDate(p.payment_date)} · {p.description} {p.notes && `· ${p.notes}`}
                        </div>
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                        <div className="w-[125px] text-right font-bold text-danger text-base sm:text-lg tabular-nums shrink-0 truncate">
                          -{formatINR(p.amount)}
                        </div>

                        <div className="w-[76px] shrink-0 flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setPaymentToEdit(p);
                              setIsNewPaymentOpen(true);
                            }}
                            className="w-8 h-8 rounded-xl bg-slate-100/90 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                            title="Edit Payment Details"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setPaymentToDelete(p)}
                            title="Delete payment"
                            className="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </>
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
          {/* Mobile StatGrid (md:hidden) */}
          <div className="md:hidden">
            <StatGrid>
              <Stat label="Total Expenses (OUT)" value={`-${formatINR(expenseStats.total)}`} />
              <Stat label="Bank & UPI Paid" value={`-${formatINR(expenseStats.bankUpi)}`} />
              <Stat label="Cash Paid" value={`-${formatINR(expenseStats.cash)}`} />
              <Stat label="Total Expenses" value={String(expenses.length)} />
            </StatGrid>
          </div>

          {/* Desktop Summary Banner (hidden md:grid) */}
          <div className="hidden md:grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card className="p-5 flex flex-col justify-between min-h-[105px] border-0 rounded-2xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <span className="text-[13px] font-medium text-[#64748B]">
                Total Expenses (OUT)
              </span>
              <div className="text-[26px] font-bold text-rose-600 tabular-nums mt-2 tracking-tight leading-tight">
                -{formatINR(expenseStats.total)}
              </div>
            </Card>

            <Card className="p-5 flex flex-col justify-between min-h-[105px] border-0 rounded-2xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#64748B]">
                <Building className="w-3.5 h-3.5 text-blue-600" />
                <span>Bank & UPI Paid</span>
              </div>
              <div className="text-[26px] font-bold text-[#0F172A] tabular-nums mt-2 tracking-tight leading-tight">
                -{formatINR(expenseStats.bankUpi)}
              </div>
            </Card>

            <Card className="p-5 flex flex-col justify-between min-h-[105px] border-0 rounded-2xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <div className="flex items-center gap-1.5 text-[13px] font-medium text-[#64748B]">
                <Banknote className="w-3.5 h-3.5 text-slate-500" />
                <span>Cash Paid</span>
              </div>
              <div className="text-[26px] font-bold text-[#0F172A] tabular-nums mt-2 tracking-tight leading-tight">
                -{formatINR(expenseStats.cash)}
              </div>
            </Card>
          </div>

          {/* Filter & Search Bar */}
          <div className="space-y-3 md:space-y-0 md:flex md:items-center md:justify-between md:gap-3">
            {/* Mobile Filter Chips */}
            <div className="md:hidden">
              <FilterChips
                options={[
                  { value: 'ALL', label: `All (${expenses.length})` },
                  { value: 'BANK_UPI', label: 'Bank & UPI' },
                  { value: 'CASH', label: 'Cash Only' },
                ]}
                value={modeFilter}
                onChange={(v) => setModeFilter(v as any)}
              />
            </div>

            {/* Desktop Mode Filter Segmented Control */}
            <div className="hidden md:block overflow-x-auto pb-0.5">
              <SegmentedControl
                value={modeFilter}
                onChange={(v) => setModeFilter(v as any)}
                options={[
                  { value: 'ALL', label: `All Expenses (${expenses.length})` },
                  { value: 'BANK_UPI', label: 'Bank & UPI' },
                  { value: 'CASH', label: 'Cash Only' },
                ]}
              />
            </div>

            {/* Mobile SearchField */}
            <div className="md:hidden">
              <SearchField
                placeholder="Search expenses by description..."
                value={expensesSearch}
                onChange={(val) => setExpensesSearch(val)}
              />
            </div>

            {/* Desktop Search */}
            <div className="hidden md:block relative flex-1 sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search expenses by description..."
                value={expensesSearch}
                onChange={(e) => setExpensesSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && fetchExpenses()}
                className="w-full h-11 pl-9 pr-3 text-xs bg-white border-0 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#0F766E]/20 text-slate-800 placeholder:text-slate-400 font-medium focus:outline-none transition-all"
              />
            </div>
          </div>

          {loadingExpenses ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full rounded-2xl" />
              ))}
            </div>
          ) : expenses.length === 0 ? (
            <div className="bg-white border-0 rounded-2xl p-8 text-center shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <EmptyState message="No business overhead expenses recorded yet." />
            </div>
          ) : (
            <>
              {/* Mobile Native MoneyRow Cards (md:hidden) */}
              <div className="md:hidden space-y-3">
                {expenses
                  .filter((e) => {
                    if (modeFilter === 'ALL') return true;
                    if (modeFilter === 'CASH') return e.mode === 'CASH';
                    if (modeFilter === 'BANK_UPI') return ['BANK', 'UPI', 'CARD', 'CHEQUE'].includes(e.mode);
                    return true;
                  })
                  .map((e) => {
                    const isSystemGen = Boolean(e.loan_repayment_id || e.staff_id);
                    const modeLabel = e.mode === 'BANK' ? 'Bank' : e.mode === 'UPI' ? 'UPI' : e.mode === 'CASH' ? 'Cash' : e.mode;
                    const catName = e.expense_categories?.name || 'Overhead';
                    return (
                      <MoneyRow
                        key={e.id}
                        title={e.description}
                        amount={e.amount}
                        isMoneyIn={false}
                        mode={`${catName} · ${modeLabel}`}
                        reference={e.payee ? `Payee: ${e.payee}` : undefined}
                        date={e.expense_date}
                        onClick={!isSystemGen ? () => {
                          setExpenseToEdit(e);
                          setIsNewExpenseOpen(true);
                        } : undefined}
                      />
                    );
                  })}
              </div>

              {/* Desktop Expenses List (hidden md:block) */}
              <div className="hidden md:block space-y-3">
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
                        className="bg-white border-0 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all"
                      >
                        <div className="space-y-1 flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900 text-sm truncate">{e.description}</span>
                            <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600 border-0 shrink-0">
                              {e.expense_categories?.name || 'Overhead'}
                            </span>
                            <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-700 border-0 shrink-0">
                              {e.mode === 'BANK' ? 'Bank' : e.mode === 'UPI' ? 'UPI' : e.mode === 'CASH' ? 'Cash' : e.mode}
                            </span>
                            {e.loan_repayment_id && (
                              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-slate-100 text-slate-600 border-0 shrink-0">
                                Loan Interest
                              </span>
                            )}
                            {e.staff_id && (
                              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-[#EAF2F1] text-[#0F766E] border-0 shrink-0">
                                Commission Payout
                              </span>
                            )}
                          </div>

                          <div className="text-xs text-slate-500 truncate">
                            {formatDate(e.expense_date)} · Mode: {e.mode}{' '}
                            {e.payee && `· Payee: ${e.payee}`} {e.notes && `· ${e.notes}`}
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100 shrink-0">
                          <div className="w-[125px] text-right font-bold text-danger text-base sm:text-lg tabular-nums shrink-0 truncate">
                            -{formatINR(e.amount)}
                          </div>

                          <div className="w-[76px] shrink-0 flex items-center justify-end gap-1.5">
                            {!isSystemGen ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpenseToEdit(e);
                                    setIsNewExpenseOpen(true);
                                  }}
                                  className="w-8 h-8 rounded-xl bg-slate-100/90 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                                  title="Edit Expense"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>

                                <button
                                  type="button"
                                  onClick={() => setExpenseToDelete(e)}
                                  title="Delete expense"
                                  className="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic px-2">Auto</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 5: CAPITAL LEDGER (LOANS) */}
      {activeTab === 'loans' && (
        <div className="space-y-4">
          {/* Mobile StatGrid (lg:hidden) */}
          {loansData && (
            <div className="lg:hidden">
              <StatGrid>
                <Stat label="Total Taken" value={formatINR(loansData.summary.total_taken)} />
                <Stat label="Principal Repaid" value={formatINR(loansData.summary.total_principal_repaid)} />
                <Stat label="Loan Outstanding" value={formatINR(loansData.summary.total_outstanding)} />
                <Stat label="Interest Paid" value={formatINR(loansData.summary.total_interest_paid)} />
              </StatGrid>
            </div>
          )}

          {/* Desktop 4 Prominent Loan Stat Cards (hidden lg:grid) */}
          {loansData && (
            <div className="hidden lg:grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="p-5 flex flex-col justify-between min-h-[105px] border-0 rounded-2xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
                <span className="text-[13px] font-medium text-[#64748B]">Total Taken</span>
                <div className="text-[26px] font-bold text-[#0F172A] tabular-nums mt-2 tracking-tight leading-tight">
                  {formatINR(loansData.summary.total_taken)}
                </div>
              </Card>

              <Card className="p-5 flex flex-col justify-between min-h-[105px] border-0 rounded-2xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
                <span className="text-[13px] font-medium text-[#64748B]">Principal Repaid</span>
                <div className="text-[26px] font-bold text-[#0F172A] tabular-nums mt-2 tracking-tight leading-tight">
                  {formatINR(loansData.summary.total_principal_repaid)}
                </div>
              </Card>

              <Card className="p-5 flex flex-col justify-between min-h-[105px] border-0 rounded-2xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
                <span className="text-[13px] font-medium text-[#64748B]">Loan Outstanding</span>
                <div className={`text-[26px] font-bold tabular-nums mt-2 tracking-tight leading-tight ${loansData.summary.total_outstanding > 0 ? 'text-[#DC2626]' : 'text-[#0F172A]'}`}>
                  {formatINR(loansData.summary.total_outstanding)}
                </div>
              </Card>

              <Card className="p-5 flex flex-col justify-between min-h-[105px] border-0 rounded-2xl bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
                <span className="text-[13px] font-medium text-[#64748B]">Interest Paid</span>
                <div className="text-[26px] font-bold text-[#0F172A] tabular-nums mt-2 tracking-tight leading-tight">
                  {formatINR(loansData.summary.total_interest_paid)}
                </div>
              </Card>
            </div>
          )}

          {loadingLoans ? (
            <div className="space-y-3">
              {[1, 2].map((i) => (
                <Skeleton key={i} className="h-24 w-full rounded-2xl" />
              ))}
            </div>
          ) : !loansData || loansData.loans.length === 0 ? (
            <div className="bg-white border-0 rounded-2xl p-8 text-center shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <EmptyState message="No outside loans or udhar recorded in the Capital Ledger." />
            </div>
          ) : (
            <div className="space-y-3">
              {loansData.loans.map((l) => {
                const isExpanded = Boolean(expandedLoans[l.loan_id]);
                return (
                  <div
                    key={l.loan_id}
                    className="bg-white border-0 rounded-2xl overflow-hidden shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all"
                  >
                    {/* Mobile Native Loan Card (lg:hidden) */}
                    <div className="lg:hidden p-4 space-y-2.5">
                      {/* Row 1: Lender Name · Due Outstanding */}
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="font-bold text-slate-900 text-[16px] truncate flex-1 min-w-0">
                          {l.lender_name}
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-[18px] font-bold tabular-nums whitespace-nowrap ${l.outstanding > 0 ? 'text-danger' : 'text-slate-900'}`}>
                            {formatINR(l.outstanding)}
                          </div>
                          <span className="text-[11px] text-slate-400 font-medium">Due</span>
                        </div>
                      </div>

                      {/* Row 2: Taken · Repaid · Date */}
                      <div className="text-[13px] text-slate-500 truncate">
                        Taken: <strong className="text-slate-700">{formatINR(l.taken_amount)}</strong> · Repaid: {formatINR(l.principal_repaid)}
                        {l.interest_rate ? ` · ${l.interest_rate}% p.a.` : ''}
                      </div>

                      <div className="text-[12px] text-slate-400">
                        Date: {formatDate(l.loan_date)} {l.notes ? `· ${l.notes}` : ''}
                      </div>

                      {/* Row 3: Action Buttons */}
                      <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                        {l.outstanding > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              setRepaymentLoan({
                                loan_id: l.loan_id,
                                lender_name: l.lender_name,
                                taken_amount: l.taken_amount,
                                outstanding: l.outstanding,
                              })
                            }
                            className="flex-1 min-w-[90px] h-[44px] rounded-xl bg-slate-900 hover:bg-black text-white font-medium text-[14px] flex items-center justify-center gap-1.5 shadow-xs cursor-pointer active:scale-[0.98] transition-all"
                          >
                            Repay
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setLoanToEdit({
                              id: l.loan_id,
                              lender_name: l.lender_name,
                              amount: l.taken_amount,
                              loan_date: l.loan_date,
                              interest_rate: l.interest_rate,
                              notes: l.notes,
                            });
                            setIsNewLoanOpen(true);
                          }}
                          className="h-[44px] w-[44px] shrink-0 rounded-xl bg-slate-100 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] flex items-center justify-center transition-all cursor-pointer shadow-2xs"
                          title="Edit Loan"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>

                        {l.principal_repaid === 0 && (
                          <button
                            type="button"
                            onClick={() => setLoanToDelete(l)}
                            className="h-[44px] w-[44px] shrink-0 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 flex items-center justify-center transition-all cursor-pointer shadow-2xs"
                            title="Delete Loan"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleLoanExpand(l.loan_id)}
                          className="h-[44px] px-3 shrink-0 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-600 flex items-center gap-1 text-xs font-semibold cursor-pointer ml-auto"
                        >
                          <span>{l.repayments?.length || 0} Repayments</span>
                          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Desktop Loan Card Header (hidden lg:flex) */}
                    <div className="hidden lg:flex p-3.5 sm:p-4 sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 flex-1 min-w-0">
                        <button
                          type="button"
                          onClick={() => toggleLoanExpand(l.loan_id)}
                          className="w-7 h-7 flex items-center justify-center hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer shrink-0 transition-colors"
                        >
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </button>

                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-900 text-sm sm:text-base truncate">{l.lender_name}</div>
                          <div className="text-xs text-slate-500 mt-0.5 truncate">
                            Date: {formatDate(l.loan_date)}{' '}
                            {l.interest_rate ? `· Interest: ${l.interest_rate}% p.a.` : ''}{' '}
                            {l.notes && `· ${l.notes}`}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-3 pl-4 shrink-0">
                        <div className="text-right">
                          <div className="text-xs text-slate-500 truncate">
                            Taken: {formatINR(l.taken_amount)} · Repaid: {formatINR(l.principal_repaid)}
                          </div>
                          <div className="text-base sm:text-lg font-bold text-danger truncate tabular-nums">
                            Due: {formatINR(l.outstanding)}
                          </div>
                        </div>

                        <div className="flex items-center justify-end gap-1.5 shrink-0">
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
                              className="px-3.5 h-8 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs transition-all cursor-pointer whitespace-nowrap"
                            >
                              Repay
                            </Button>
                          )}
                          <button
                            type="button"
                            className="w-8 h-8 rounded-xl bg-slate-100/90 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105 shrink-0"
                            title="Edit Loan"
                            onClick={() => {
                              setLoanToEdit({
                                id: l.loan_id,
                                lender_name: l.lender_name,
                                amount: l.taken_amount,
                                loan_date: l.loan_date,
                                interest_rate: l.interest_rate,
                                notes: l.notes,
                              });
                              setIsNewLoanOpen(true);
                            }}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {l.principal_repaid === 0 && (
                            <button
                              type="button"
                              className="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105 shrink-0"
                              title="Delete Loan"
                              onClick={() => setLoanToDelete(l)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Expandable Repayments Timeline */}
                    {isExpanded && (
                      <div className="border-t border-slate-100 bg-slate-50/70 p-3 sm:p-3.5">
                        {!l.repayments || l.repayments.length === 0 ? (
                          <div className="text-xs text-slate-500 text-center py-2">
                            No repayments recorded yet for this loan.
                          </div>
                        ) : (
                          <>
                            {/* Mobile Repayments List (lg:hidden) */}
                            <div className="lg:hidden space-y-2">
                              {l.repayments.map((rep) => (
                                <div key={rep.id} className="p-3 bg-white rounded-xl shadow-2xs border-0 space-y-1">
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="font-semibold text-slate-800">{formatDate(rep.repayment_date)}</span>
                                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-medium">{rep.mode}</span>
                                  </div>
                                  <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-50">
                                    <span className="text-slate-500">Principal: <strong className="text-emerald-600 font-semibold">{formatINR(rep.principal)}</strong></span>
                                    <span className="text-slate-500">Interest: <strong className="text-amber-700 font-semibold">{formatINR(rep.interest)}</strong></span>
                                    <button
                                      type="button"
                                      onClick={() => setRepaymentToDelete(rep)}
                                      className="p-1 text-slate-400 hover:text-rose-600 rounded cursor-pointer"
                                      title="Delete repayment"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Desktop Repayments Table (hidden lg:block) */}
                            <div className="hidden lg:block border-0 rounded-xl overflow-hidden bg-white text-xs divide-y divide-slate-100 shadow-2xs">
                              <div className="bg-slate-50 grid grid-cols-12 p-2.5 font-semibold text-slate-500 border-b border-slate-100">
                                <div className="col-span-3">Date</div>
                                <div className="col-span-3 text-right">Principal Repaid</div>
                                <div className="col-span-3 text-right">Interest (Expense)</div>
                                <div className="col-span-2 text-right">Mode</div>
                                <div className="col-span-1 text-right">Action</div>
                              </div>
                              {l.repayments.map((rep) => (
                                <div key={rep.id} className="grid grid-cols-12 p-2.5 items-center hover:bg-slate-50/50 transition-colors">
                                  <div className="col-span-3 text-slate-500">
                                    {formatDate(rep.repayment_date)}
                                  </div>
                                  <div className="col-span-3 text-right font-medium text-emerald-600">
                                    {formatINR(rep.principal)}
                                  </div>
                                  <div className="col-span-3 text-right font-medium text-amber-700">
                                    {formatINR(rep.interest)}
                                  </div>
                                  <div className="col-span-2 text-right text-slate-500">
                                    {rep.mode}
                                  </div>
                                  <div className="col-span-1 text-right">
                                    <button
                                      type="button"
                                      onClick={() => setRepaymentToDelete(rep)}
                                      className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors"
                                      title="Delete repayment"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </>
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

      {/* Edit Receipt Modal */}
      <EditReceiptModal
        open={Boolean(receiptToEdit)}
        onOpenChange={(v) => !v && setReceiptToEdit(null)}
        receipt={receiptToEdit}
        onSuccess={() => {
          fetchReceipts();
          fetchDues();
        }}
      />

      {/* New Payment Modal */}
      <NewPaymentModal
        open={isNewPaymentOpen}
        paymentToEdit={paymentToEdit}
        onOpenChange={(open) => {
          setIsNewPaymentOpen(open);
          if (!open) setPaymentToEdit(null);
        }}
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
        onVendorUpdated={() => {
          fetchPayments();
        }}
      />

      {/* New Expense Modal */}
      <NewExpenseModal
        open={isNewExpenseOpen}
        expenseToEdit={expenseToEdit}
        onOpenChange={(open) => {
          setIsNewExpenseOpen(open);
          if (!open) setExpenseToEdit(null);
        }}
        onSuccess={() => {
          fetchExpenses();
        }}
      />

      {/* New Loan Modal */}
      <NewLoanModal
        open={isNewLoanOpen}
        loanToEdit={loanToEdit}
        onOpenChange={(open) => {
          setIsNewLoanOpen(open);
          if (!open) setLoanToEdit(null);
        }}
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
      <ConfirmDialog
        open={isDeleteConfirmOpen}
        onOpenChange={setIsDeleteConfirmOpen}
        title="Delete Receipt"
        description="Deleting this receipt will reverse all allocations, and the balance on linked bills will be reopened. Are you sure?"
        confirmLabel="Delete & Reopen Bills"
        variant="danger"
        loading={deleting}
        onConfirm={handleConfirmDeleteReceipt}
      />

      {/* Delete Payment Confirm */}
      <ConfirmDialog
        open={Boolean(paymentToDelete)}
        onOpenChange={(open) => !open && setPaymentToDelete(null)}
        title="Delete Payment"
        description={`Are you sure you want to delete payment of ${paymentToDelete ? formatINR(paymentToDelete.amount) : ''}? This will remove it from vendor history.`}
        confirmLabel="Delete Payment"
        variant="danger"
        loading={deletingPayment}
        onConfirm={handleConfirmDeletePayment}
      />

      {/* Delete Expense Confirm */}
      <ConfirmDialog
        open={Boolean(expenseToDelete)}
        onOpenChange={(open) => !open && setExpenseToDelete(null)}
        title="Delete Expense"
        description={`Are you sure you want to delete this expense of ${expenseToDelete ? formatINR(expenseToDelete.amount) : ''}? It will be removed from accounts and profit/loss calculations.`}
        confirmLabel="Delete Expense"
        variant="danger"
        loading={deletingExpense}
        onConfirm={handleConfirmDeleteExpense}
      />

      {/* Delete Loan Confirm */}
      <ConfirmDialog
        open={Boolean(loanToDelete)}
        onOpenChange={(open) => !open && setLoanToDelete(null)}
        title="Delete Loan"
        description={`Are you sure you want to delete this loan from ${loanToDelete?.lender_name}? This action cannot be undone.`}
        confirmLabel="Delete Loan"
        variant="danger"
        loading={deletingLoan}
        onConfirm={handleConfirmDeleteLoan}
      />

      {/* Delete Repayment Confirm */}
      <ConfirmDialog
        open={Boolean(repaymentToDelete)}
        onOpenChange={(open) => !open && setRepaymentToDelete(null)}
        title="Delete Loan Repayment"
        description={`Are you sure you want to delete this repayment of ${repaymentToDelete ? formatINR(repaymentToDelete.principal) : ''}? This will restore the loan's outstanding balance and automatically delete any linked interest expense.`}
        confirmLabel="Delete & Restore Balance"
        variant="danger"
        loading={deletingRepayment}
        onConfirm={handleConfirmDeleteRepayment}
      />
    </div>
  );
};
