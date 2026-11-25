import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { getFYLabel } from '../../lib/dates';
import { getErrorMessage } from '../../i18n';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../context/AuthContext';
import { NewBankAccountModal } from './NewBankAccountModal';
import { TransferMoneyModal, TransferType } from './TransferMoneyModal';
import { setPrintPageSize, exportDocumentPDF } from '../documents/pdfExport';
import { BankStatementPrintDocument } from './BankStatementPrintDocument';
import {
  Building2,
  ArrowDownLeft,
  ArrowUpRight,
  Repeat,
  Plus,
  Printer,
  Download,
  Search,
  Wallet,
  Banknote,
  Trash2,
  Pencil,
  Compass,
} from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { format, parseISO, isValid } from 'date-fns';

export interface BankLedgerTabProps {
  onRecordIncome?: () => void;
  onRecordPayment?: () => void;
}

export const BankLedgerTab: React.FC<BankLedgerTabProps> = () => {
  const { business } = useAuth();
  const { showToast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [activeSubView, setActiveSubView] = useState<'LEDGER' | 'TRANSFERS'>('LEDGER');

  // Cash & Bank Summary State
  const [summaryData, setSummaryData] = useState<{
    cash_in_hand: {
      opening_balance: number;
      total_in: number;
      total_out: number;
      current_balance: number;
      receipts: number;
      withdrawals: number;
      payments: number;
      expenses: number;
      deposits: number;
    };
    bank_summary: {
      total_bank_balance: number;
      account_count: number;
    };
    total_liquid_funds: number;
    bank_accounts: any[];
    recent_transfers: any[];
  } | null>(null);

  // Bank Passbook Ledger State
  const [ledgerData, setLedgerData] = useState<{
    bank_accounts: any[];
    summary: { total_in: number; total_out: number; net_flow: number };
    entries: any[];
  } | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const bankIdParam = searchParams.get('bankId');
  const [selectedBankId, setSelectedBankId] = useState<string | null>(bankIdParam || null);

  useEffect(() => {
    const bId = searchParams.get('bankId');
    if (bId !== null && bId !== selectedBankId) {
      setSelectedBankId(bId || null);
    }
  }, [searchParams]);

  const handleSelectBank = (id: string | null) => {
    setSelectedBankId(id);
    const newParams = new URLSearchParams(searchParams);
    if (id) {
      newParams.set('bankId', id);
    } else {
      newParams.delete('bankId');
    }
    setSearchParams(newParams, { replace: true });
  };
  const [period, setPeriod] = useState<'TODAY' | 'MONTH' | 'YEAR'>('YEAR');
  const [search, setSearch] = useState('');
  const [transferTypeFilter, setTransferTypeFilter] = useState<'ALL' | TransferType>('ALL');
  const [displayCount, setDisplayCount] = useState(15);

  // Modals state
  const [isNewBankOpen, setIsNewBankOpen] = useState(false);
  const [bankAccountToEdit, setBankAccountToEdit] = useState<any | null>(null);
  const [bankAccountToDelete, setBankAccountToDelete] = useState<any | null>(null);
  const [deletingBankAccount, setDeletingBankAccount] = useState(false);

  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferInitialType, setTransferInitialType] = useState<TransferType>('CASH_TO_BANK');
  const [transferToDelete, setTransferToDelete] = useState<any | null>(null);
  const [deletingTransfer, setDeletingTransfer] = useState(false);

  const currentFY = getFYLabel();

  const fetchData = async () => {
    setLoading(true);
    try {
      const now = new Date();
      let fromDate: string | null = null;
      let toDate: string | null = null;

      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

      if (period === 'TODAY') {
        fromDate = todayStr;
        toDate = todayStr;
      } else if (period === 'MONTH') {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        fromDate = `${firstDay.getFullYear()}-${String(firstDay.getMonth() + 1).padStart(2, '0')}-01`;
        toDate = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;
      } else if (period === 'YEAR') {
        const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        fromDate = `${year}-04-01`;
        toDate = `${year + 1}-03-31`;
      }

      // 1. Fetch cash & bank overall summary
      const { data: summaryRes, error: summaryErr } = await supabase.rpc('cash_bank_summary', {
        p_from_date: fromDate,
        p_to_date: toDate,
      });
      if (summaryErr) throw summaryErr;
      setSummaryData(summaryRes as any);

      // 2. Fetch detailed bank passbook ledger
      const { data: ledgerRes, error: ledgerErr } = await supabase.rpc('bank_ledger', {
        p_bank_account_id: selectedBankId,
        p_from_date: fromDate,
        p_to_date: toDate,
      });
      if (ledgerErr) throw ledgerErr;
      setLedgerData(ledgerRes as any);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedBankId, period]);

  const handleOpenTransfer = (t: TransferType) => {
    setTransferInitialType(t);
    setIsTransferOpen(true);
  };

  const handleConfirmDeleteTransfer = async () => {
    if (!transferToDelete) return;
    setDeletingTransfer(true);
    try {
      const { error } = await supabase.rpc('soft_delete', {
        p_table: 'money_transfers',
        p_id: transferToDelete.id,
      });
      if (error) throw error;
      showToast('Transfer removed. Account balances updated.', 'success');
      setTransferToDelete(null);
      fetchData();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setDeletingTransfer(false);
    }
  };

  const handleConfirmDeleteBankAccount = async () => {
    if (!bankAccountToDelete) return;
    setDeletingBankAccount(true);
    try {
      const { error } = await supabase.rpc('soft_delete', {
        p_table: 'bank_accounts',
        p_id: bankAccountToDelete.id,
      });
      if (error) throw error;
      showToast('Bank account removed.', 'success');
      if (selectedBankId === bankAccountToDelete.id) {
        setSelectedBankId(null);
      }
      setBankAccountToDelete(null);
      fetchData();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setDeletingBankAccount(false);
    }
  };

  const handlePrint = () => {
    setPrintPageSize('a4', 8);
    document.body.classList.add('printing-portal-active');
    const cleanup = () => {
      document.body.classList.remove('printing-portal-active');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  const handleExportPDF = async () => {
    const el = document.getElementById('print-bank-statement-root') || printRef.current;
    if (!el) return;
    try {
      showToast('Generating bank statement PDF...', 'info');
      const filename = `Bank_Statement_${selectedBank ? selectedBank.bank_name.replace(/\s+/g, '_') : 'Consolidated'}.pdf`;
      await exportDocumentPDF(el, filename);
      showToast('Bank statement downloaded', 'success');
    } catch {
      // Fallback handled automatically
    }
  };

  // Helper to format short date like "2 Nov"
  const formatShortDate = (dateStr: string) => {
    if (!dateStr) return '';
    const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
    if (!isValid(d)) return '';
    return format(d, 'd MMM');
  };

  // Format account label e.g. "HDFC ••4821"
  const formatAccountDisplay = (bankAccountId?: string | null, fallbackLabel?: string | null) => {
    const allAccounts = summaryData?.bank_accounts || ledgerData?.bank_accounts || [];
    const acc = allAccounts.find((b: any) => b.id === bankAccountId);
    if (acc) {
      const num = acc.account_number || '';
      const clean = num.replace(/\D/g, '');
      const last4 = clean.length >= 4 ? clean.slice(-4) : clean || (num.length >= 4 ? num.slice(-4) : num);
      return last4 ? `${acc.bank_name} ••${last4}` : acc.bank_name;
    }
    return fallbackLabel || 'Bank';
  };

  // Helper for entry particulars title & subtitle
  const getEntryParticulars = (e: any) => {
    let title = '';
    let subtitle = '';
    const modeDisplay = e.mode === 'BANK' ? 'Bank transfer' : (e.mode || 'Bank');

    if (e.txn_type === 'RECEIPT') {
      title = `Receipt · ${e.party_name || 'Customer'}`;
      subtitle = e.ref_no ? `${e.ref_no} · ${modeDisplay}` : modeDisplay;
    } else if (e.txn_type === 'PAYMENT') {
      title = `Vendor payment · ${e.party_name || 'Vendor'}`;
      const desc = e.description || e.ref_no || '';
      subtitle = desc ? `${desc} · ${modeDisplay}` : modeDisplay;
    } else if (e.txn_type === 'EXPENSE') {
      title = `Expense · ${e.party_name || e.description || 'Expense'}`;
      const desc = e.description && e.description !== e.party_name ? e.description : (e.ref_no || '');
      subtitle = desc ? `${desc} · ${modeDisplay}` : modeDisplay;
    } else if (e.txn_type === 'LOAN_REPAYMENT') {
      title = `Loan repayment · ${e.party_name || 'Lender'}`;
      subtitle = `${e.ref_no || 'Principal + Interest'} · ${modeDisplay}`;
    } else if (e.txn_type === 'TRANSFER_IN') {
      if (
        e.description?.toLowerCase().includes('deposit') ||
        e.party_name?.toLowerCase().includes('deposit') ||
        e.mode === 'CASH'
      ) {
        title = 'Cash deposited to bank';
        subtitle = `Contra · ${e.ref_no || 'DEP'}`;
      } else {
        title = e.party_name || 'Transfer from bank';
        subtitle = `Contra · ${e.ref_no || 'Transfer'}`;
      }
    } else if (e.txn_type === 'TRANSFER_OUT') {
      if (
        e.description?.toLowerCase().includes('withdraw') ||
        e.party_name?.toLowerCase().includes('withdraw') ||
        e.mode === 'CASH'
      ) {
        title = 'Cash withdrawn from bank';
        subtitle = `Contra · ${e.ref_no || 'WDL'}`;
      } else {
        title = e.party_name || 'Transfer to bank';
        subtitle = `Contra · ${e.ref_no || 'Transfer'}`;
      }
    } else {
      title = e.party_name || e.description || 'Bank Transaction';
      subtitle = `${e.ref_no || ''} · ${modeDisplay}`;
    }

    return { title, subtitle };
  };

  // Filtered Passbook Entries
  const filteredEntries = (ledgerData?.entries || []).filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.party_name?.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.ref_no?.toLowerCase().includes(q) ||
      e.bank_label?.toLowerCase().includes(q)
    );
  });

  const displayedEntries = filteredEntries.slice(0, displayCount);

  // Filtered Transfers
  const filteredTransfers = (summaryData?.recent_transfers || []).filter((t) => {
    if (transferTypeFilter !== 'ALL' && t.transfer_type !== transferTypeFilter) {
      return false;
    }
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      t.from_bank_name?.toLowerCase().includes(q) ||
      t.to_bank_name?.toLowerCase().includes(q) ||
      t.reference?.toLowerCase().includes(q) ||
      t.notes?.toLowerCase().includes(q)
    );
  });

  const cashBal = summaryData?.cash_in_hand?.current_balance || 0;
  const bankBal = summaryData?.bank_summary?.total_bank_balance || 0;
  const liquidFunds = summaryData?.total_liquid_funds || 0;
  const netFlow = ledgerData?.summary?.net_flow || 0;

  // Percentage ratio of cash to liquid funds
  const cashRatio = liquidFunds > 0 ? Math.min(100, Math.max(0, Math.round((cashBal / liquidFunds) * 100))) : 0;

  const selectedBank = (summaryData?.bank_accounts || []).find((b) => b.id === selectedBankId);

  return (
    <div className="space-y-5">
      {/* 1. Top Header Row: Title, Subtitle, Period Pill Track & Export Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Cash &amp; bank</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Where your money is right now · FY {currentFY}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Period Pills in #EEF0F3 Track */}
          <div className="inline-flex items-center p-1 bg-[#EEF0F3] rounded-xl text-xs font-medium">
            <button
              type="button"
              onClick={() => {
                setPeriod('TODAY');
                setDisplayCount(15);
              }}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                period === 'TODAY'
                  ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                setPeriod('MONTH');
                setDisplayCount(15);
              }}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                period === 'MONTH'
                  ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              This month
            </button>
            <button
              type="button"
              onClick={() => {
                setPeriod('YEAR');
                setDisplayCount(15);
              }}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                period === 'YEAR'
                  ? 'bg-white text-slate-900 font-semibold shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              FY {currentFY}
            </button>
          </div>

          {/* Action icon buttons */}
          <div className="flex items-center gap-2 no-print">
            <button
              type="button"
              onClick={handlePrint}
              title="Print statement"
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200/90 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 shadow-2xs transition-colors"
            >
              <Printer className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleExportPDF}
              title="Download PDF"
              className="w-9 h-9 flex items-center justify-center rounded-xl border border-slate-200/90 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50 shadow-2xs transition-colors disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Three Hero Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Cash in hand */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-2xs hover:shadow-xs flex flex-col justify-between transition-all">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-teal-50 border border-teal-100/60 flex items-center justify-center text-[#0F766E] shrink-0">
                  <Banknote className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-semibold text-slate-700">Cash in hand</span>
              </div>
              <span className="text-xs text-slate-400">Live drawer</span>
            </div>
            <div className="text-3xl font-bold tracking-tight text-slate-900 mt-3 tabular-nums">
              {formatINR(cashBal)}
            </div>
            <div className="text-xs font-medium text-slate-400 mt-1 flex items-center gap-1.5">
              <span className="text-emerald-600 font-semibold">
                +{formatINR(summaryData?.cash_in_hand?.total_in || 0)} in
              </span>
              <span>·</span>
              <span>-{formatINR(summaryData?.cash_in_hand?.total_out || 0)} out</span>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-4 mt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => handleOpenTransfer('CASH_TO_BANK')}
              className="flex-1 py-2 px-2.5 rounded-xl border-0 bg-slate-100/80 hover:bg-[#EAF2F1] hover:text-[#0F766E] text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
            >
              <ArrowDownLeft className="w-3.5 h-3.5 text-[#0F766E]" />
              <span>Deposit to bank</span>
            </button>
            <button
              type="button"
              onClick={() => handleOpenTransfer('BANK_TO_CASH')}
              className="flex-1 py-2 px-2.5 rounded-xl border-0 bg-slate-100/80 hover:bg-[#EAF2F1] hover:text-[#0F766E] text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
            >
              <ArrowUpRight className="w-3.5 h-3.5 text-slate-500" />
              <span>Withdraw cash</span>
            </button>
          </div>
        </div>

        {/* Card 2: Bank balance */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-2xs hover:shadow-xs flex flex-col justify-between transition-all">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-teal-50 border border-teal-100/60 flex items-center justify-center text-[#0F766E] shrink-0">
                  <Building2 className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-semibold text-slate-700">Bank balance</span>
              </div>
              <span className="text-xs text-slate-400">
                {summaryData?.bank_accounts?.length || 0} accounts
              </span>
            </div>
            <div className="text-3xl font-bold tracking-tight text-slate-900 mt-3 tabular-nums">
              {formatINR(bankBal)}
            </div>
            <div className="text-xs font-normal text-slate-400 mt-1">
              Across all verified accounts
            </div>
          </div>

          <div className="flex items-center gap-2 pt-4 mt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => handleOpenTransfer('BANK_TO_BANK')}
              className="flex-1 py-2 px-2.5 rounded-xl border-0 bg-slate-100/80 hover:bg-[#EAF2F1] hover:text-[#0F766E] text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
            >
              <Repeat className="w-3.5 h-3.5 text-slate-500" />
              <span>Bank to bank</span>
            </button>
            <button
              type="button"
              onClick={() => setIsNewBankOpen(true)}
              className="flex-1 py-2 px-2.5 rounded-xl border-0 bg-slate-100/80 hover:bg-[#EAF2F1] hover:text-[#0F766E] text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 shadow-2xs transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5 text-slate-500" />
              <span>Add bank</span>
            </button>
          </div>
        </div>

        {/* Card 3: Total liquid funds */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-2xs hover:shadow-xs flex flex-col justify-between transition-all">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center text-slate-700 shrink-0">
                  <Wallet className="w-3.5 h-3.5" />
                </div>
                <span className="text-xs font-semibold text-slate-700">Total liquid funds</span>
              </div>
              <span className="text-xs text-slate-400">Cash + banks</span>
            </div>
            <div className="text-3xl font-bold tracking-tight text-slate-900 mt-3 tabular-nums">
              {formatINR(liquidFunds)}
            </div>
            <div className="text-xs font-normal text-slate-400 mt-1">
              Available for day-to-day needs
            </div>
          </div>

          <div className="mt-3">
            {/* Dual-color Progress Bar */}
            <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-100">
              <div
                style={{ width: `${cashRatio}%` }}
                className="h-full bg-slate-900 transition-all duration-300"
              />
              <div
                style={{ width: `${100 - cashRatio}%` }}
                className="h-full bg-[#0F766E] transition-all duration-300"
              />
            </div>
            {/* Legend */}
            <div className="flex items-center justify-between mt-2.5 text-xs text-slate-700 font-medium">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-900 inline-block" />
                <span>Cash {formatINR(cashBal)}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#0F766E] inline-block" />
                <span>Banks {formatINR(bankBal)}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Bank Account Filter Pills Row */}
      <div className="flex items-center gap-2 overflow-x-auto py-2 px-1 no-scrollbar">
        {/* All accounts pill */}
        <button
          type="button"
          onClick={() => handleSelectBank(null)}
          className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-2 border-0 shadow-2xs whitespace-nowrap cursor-pointer ml-0.5 ${
            selectedBankId === null
              ? 'bg-[#EAF2F1] text-[#0F766E] font-semibold'
              : 'bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Compass className="w-3.5 h-3.5 text-[#0F766E]" />
          <span>All accounts</span>
          <span className="tabular-nums font-semibold ml-0.5">{formatINR(bankBal)}</span>
        </button>

        {/* Bank accounts list */}
        {(summaryData?.bank_accounts || []).map((acc) => {
          const isSelected = selectedBankId === acc.id;
          const num = acc.account_number || '';
          const clean = num.replace(/\D/g, '');
          const last4 = clean.length >= 4 ? clean.slice(-4) : clean || (num.length >= 4 ? num.slice(-4) : num);

          return (
            <button
              key={acc.id}
              type="button"
              onClick={() => handleSelectBank(acc.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-2 border-0 shadow-2xs whitespace-nowrap cursor-pointer ${
                isSelected
                  ? 'bg-[#EAF2F1] text-[#0F766E] font-semibold'
                  : 'bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Building2 className={`w-3.5 h-3.5 ${isSelected ? 'text-[#0F766E]' : 'text-slate-500'}`} />
              <span>
                {acc.bank_name} {last4 ? `••${last4}` : ''}
              </span>
              <span className="tabular-nums font-semibold ml-0.5">
                {formatINR(acc.current_balance || 0)}
              </span>
            </button>
          );
        })}

        {/* Edit / Delete actions when an individual account is active */}
        {selectedBank && (
          <div className="flex items-center gap-1.5 pl-2 border-l border-slate-200 shrink-0">
            <button
              type="button"
              onClick={() => {
                setBankAccountToEdit(selectedBank);
                setIsNewBankOpen(true);
              }}
              title="Edit Bank Account"
              className="w-8 h-8 rounded-xl bg-slate-100/90 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setBankAccountToDelete(selectedBank)}
              title="Delete Bank Account"
              className="w-8 h-8 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* 4. Sub-Navigation Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200/60 pb-1">
        {/* Left: Passbook & Transfers Tabs */}
        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={() => setActiveSubView('LEDGER')}
            className={`pb-2 text-xs transition-all flex items-center gap-1.5 relative ${
              activeSubView === 'LEDGER'
                ? 'text-[#0F766E] font-bold border-b-2 border-[#0F766E]'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <span>Passbook</span>
            <span
              className={`text-[11px] font-semibold ${
                activeSubView === 'LEDGER' ? 'text-slate-600' : 'text-slate-400'
              }`}
            >
              {filteredEntries.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubView('TRANSFERS')}
            className={`pb-2 text-xs transition-all flex items-center gap-1.5 relative ${
              activeSubView === 'TRANSFERS'
                ? 'text-[#0F766E] font-bold border-b-2 border-[#0F766E]'
                : 'text-slate-500 hover:text-slate-800 font-medium'
            }`}
          >
            <span>Transfers</span>
            <span
              className={`text-[11px] font-semibold ${
                activeSubView === 'TRANSFERS' ? 'text-slate-600' : 'text-slate-400'
              }`}
            >
              {(summaryData?.recent_transfers || []).length}
            </span>
          </button>
        </div>

        {/* Right: Search box */}
        <div className="flex items-center gap-2">
          {activeSubView === 'TRANSFERS' && (
            <div className="w-[140px]">
              <Select
                value={transferTypeFilter}
                onChange={(val) => setTransferTypeFilter(val as any)}
                size="sm"
                options={[
                  { value: 'ALL', label: 'All types' },
                  { value: 'CASH_TO_BANK', label: 'Cash → Bank' },
                  { value: 'BANK_TO_CASH', label: 'Bank → Cash' },
                  { value: 'BANK_TO_BANK', label: 'Bank → Bank' },
                ]}
              />
            </div>
          )}

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by party, reference or note"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-8 pr-3 text-xs bg-white border-0 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#0F766E]/20 text-slate-800 placeholder:text-slate-400 font-medium focus:outline-none transition-all"
            />
          </div>
        </div>
      </div>

      {/* 5. Sub-View Content */}
      {activeSubView === 'LEDGER' ? (
        /* Consolidated Bank Passbook Table Card */
        <div
          ref={printRef}
          className="bg-white rounded-2xl p-6 border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]"
        >
          {/* Card Header with Metrics */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight">
                {selectedBank ? `${selectedBank.bank_name} passbook` : 'Consolidated bank passbook'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {filteredEntries.length} transactions · FY {currentFY} ·{' '}
                {selectedBank ? selectedBank.bank_name : 'all accounts'}
              </p>
            </div>

            <div className="flex items-center gap-6 text-right">
              <div>
                <div className="text-[11px] font-medium text-slate-400">Money in</div>
                <div className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                  ₹{formatINR(ledgerData?.summary?.total_in || 0).replace('₹', '')}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-400">Money out</div>
                <div className="text-sm font-bold text-slate-900 tabular-nums mt-0.5">
                  ₹{formatINR(ledgerData?.summary?.total_out || 0).replace('₹', '')}
                </div>
              </div>
              <div>
                <div className="text-[11px] font-medium text-slate-400">Net flow</div>
                <div
                  className={`text-sm font-bold tabular-nums mt-0.5 ${
                    netFlow >= 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {netFlow >= 0 ? '+' : '-'}₹{formatINR(Math.abs(netFlow)).replace('₹', '')}
                </div>
              </div>
            </div>
          </div>

          {/* Table or States */}
          {loading ? (
            <div className="py-6 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="py-12 text-center">
              <EmptyState message="No bank transactions found for this period. Receipts, payments, and contra transfers linked to Bank accounts will appear here." />
            </div>
          ) : (
            <div>
              {/* Mobile Passbook Cards (md:hidden) */}
              <div className="md:hidden space-y-3 pb-2">
                {displayedEntries.map((e) => {
                  const isIn = e.direction === 'IN';
                  const isContra = e.txn_type === 'TRANSFER_IN' || e.txn_type === 'TRANSFER_OUT';
                  const { title, subtitle } = getEntryParticulars(e);
                  const accountLabel = formatAccountDisplay(e.bank_account_id, e.bank_label);

                  return (
                    <div
                      key={e.id}
                      className="bg-white border-0 rounded-2xl p-3.5 space-y-2 shadow-2xs"
                    >
                      {/* Row 1: Particulars title + Amount */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                              isIn && !isContra
                                ? 'bg-teal-50 text-[#0F766E]'
                                : isContra
                                ? 'bg-slate-100 text-slate-600'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {isIn && !isContra ? (
                              <ArrowDownLeft className="w-3.5 h-3.5" />
                            ) : isContra ? (
                              <Repeat className="w-3.5 h-3.5" />
                            ) : (
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-900 truncate">
                              {title}
                            </div>
                            {subtitle && (
                              <div className="text-[11px] text-slate-400 truncate">
                                {subtitle}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          {isIn ? (
                            <span className="text-[15px] font-bold text-emerald-600 tabular-nums">
                              +₹{formatINR(e.in_amount).replace('₹', '')}
                            </span>
                          ) : (
                            <span className="text-[15px] font-bold text-slate-900 tabular-nums">
                              -₹{formatINR(e.out_amount).replace('₹', '')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Row 2: Account Badge & Running Balance */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                        <div className="flex items-center gap-2">
                          <span>{formatShortDate(e.txn_date)}</span>
                          <span>&middot;</span>
                          <span className="font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                            {accountLabel}
                          </span>
                        </div>
                        <div className="text-right font-medium text-slate-600 tabular-nums">
                          Bal: <span className="font-bold text-slate-900">{formatINR(e.running_balance)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Passbook Table (hidden md:block) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-semibold text-slate-400">
                      <th className="py-3 px-2 font-semibold">Date</th>
                      <th className="py-3 px-3 font-semibold">Particulars</th>
                      <th className="py-3 px-3 font-semibold">Account</th>
                      <th className="py-3 px-3 text-right font-semibold">Money in</th>
                      <th className="py-3 px-3 text-right font-semibold">Money out</th>
                      <th className="py-3 px-2 text-right font-semibold">Balance</th>
                    </tr>
                  </thead>
                <tbody className="divide-y divide-slate-100/80">
                  {displayedEntries.map((e) => {
                    const isIn = e.direction === 'IN';
                    const isContra = e.txn_type === 'TRANSFER_IN' || e.txn_type === 'TRANSFER_OUT';
                    const { title, subtitle } = getEntryParticulars(e);
                    const accountLabel = formatAccountDisplay(e.bank_account_id, e.bank_label);

                    return (
                      <tr
                        key={e.id}
                        className="hover:bg-slate-50/50 transition-colors group"
                      >
                        {/* Date */}
                        <td className="py-3.5 px-2 text-xs font-medium text-slate-600 whitespace-nowrap">
                          {formatShortDate(e.txn_date)}
                        </td>

                        {/* Particulars with Direction Icon */}
                        <td className="py-3.5 px-3">
                          <div className="flex items-center gap-3">
                            {/* Direction Badge Icon */}
                            <div
                              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                                isIn && !isContra
                                  ? 'bg-teal-50 text-[#0F766E]'
                                  : isContra
                                  ? 'bg-slate-100 text-slate-600'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {isIn && !isContra ? (
                                <ArrowDownLeft className="w-3.5 h-3.5" />
                              ) : isContra ? (
                                <Repeat className="w-3.5 h-3.5" />
                              ) : (
                                <ArrowUpRight className="w-3.5 h-3.5" />
                              )}
                            </div>

                            {/* Text lines */}
                            <div>
                              <div className="text-xs font-semibold text-slate-900 leading-tight">
                                {title}
                              </div>
                              <div className="text-[11px] text-slate-400 mt-0.5 leading-tight">
                                {subtitle}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Account */}
                        <td className="py-3.5 px-3 text-xs font-medium text-slate-600 whitespace-nowrap">
                          {accountLabel}
                        </td>

                        {/* Money in */}
                        <td className="py-3.5 px-3 text-right text-xs font-semibold whitespace-nowrap tabular-nums">
                          {isIn ? (
                            <span className="text-emerald-600 font-semibold">
                              +₹{formatINR(e.in_amount).replace('₹', '')}
                            </span>
                          ) : (
                            <span className="text-slate-300 font-normal">—</span>
                          )}
                        </td>

                        {/* Money out */}
                        <td className="py-3.5 px-3 text-right text-xs font-semibold whitespace-nowrap tabular-nums">
                          {!isIn ? (
                            <span className="text-slate-700 font-semibold">
                              -₹{formatINR(e.out_amount).replace('₹', '')}
                            </span>
                          ) : (
                            <span className="text-slate-300 font-normal">—</span>
                          )}
                        </td>

                        {/* Running Balance */}
                        <td className="py-3.5 px-2 text-right text-xs font-semibold text-slate-900 whitespace-nowrap tabular-nums">
                          {formatINR(e.running_balance)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>

              {/* Table Footer with Pagination & Load More */}
              <div className="flex items-center justify-between pt-5 mt-2 border-t border-slate-100">
                <span className="text-xs text-slate-400">
                  Showing {displayedEntries.length} of {filteredEntries.length}
                </span>

                {filteredEntries.length > displayedEntries.length && (
                  <button
                    type="button"
                    onClick={() => setDisplayCount((prev) => prev + 15)}
                    className="px-3.5 py-1.5 rounded-lg border border-slate-200/90 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 shadow-2xs transition-colors"
                  >
                    Load more
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Transfers History Table Card */
        <div
          ref={printRef}
          className="bg-white rounded-2xl p-6 border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]"
        >
          {/* Card Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
            <div>
              <h3 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Repeat className="w-4 h-4 text-[#0F766E]" />
                <span>Internal money transfers (Contra vouchers)</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {filteredTransfers.length} recorded transfers · Transfers maintain balance parity with zero effect on Net Profit
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleOpenTransfer('CASH_TO_BANK')}
              className="py-2 px-3 rounded-xl bg-[#0F766E] hover:bg-[#0D655E] text-white text-xs font-semibold flex items-center gap-1.5 shadow-2xs transition-colors self-start sm:self-auto"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New transfer</span>
            </button>
          </div>

          {loading ? (
            <div className="py-6 space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : filteredTransfers.length === 0 ? (
            <div className="py-12 text-center">
              <EmptyState message="No internal transfers recorded. Use 'Deposit to bank' or 'Withdraw cash' to move money without affecting Net Profit." />
            </div>
          ) : (
            <div>
              {/* Mobile Transfers Cards (md:hidden) */}
              <div className="md:hidden space-y-3 pb-2">
                {filteredTransfers.map((t) => {
                  const isCashToBank = t.transfer_type === 'CASH_TO_BANK';
                  const isBankToCash = t.transfer_type === 'BANK_TO_CASH';

                  return (
                    <div
                      key={t.id}
                      className="bg-white border-0 rounded-2xl p-3.5 space-y-2 shadow-2xs"
                    >
                      {/* Row 1: Transfer Badge & Amount */}
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold border border-slate-200/90 bg-slate-50 text-slate-700 inline-flex items-center gap-1">
                          {isCashToBank ? (
                            <>
                              <ArrowDownLeft className="w-3 h-3 text-[#0F766E]" />
                              <span>Deposit (Cash &rarr; Bank)</span>
                            </>
                          ) : isBankToCash ? (
                            <>
                              <ArrowUpRight className="w-3 h-3 text-slate-500" />
                              <span>Withdrawal (Bank &rarr; Cash)</span>
                            </>
                          ) : (
                            <>
                              <Repeat className="w-3 h-3 text-[#0F766E]" />
                              <span>Bank &rarr; Bank</span>
                            </>
                          )}
                        </span>

                        <div className="text-[16px] font-bold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatINR(t.amount)}
                        </div>
                      </div>

                      {/* Row 2: Accounts flow */}
                      <div className="text-xs text-slate-600 flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-slate-800">{t.from_bank_name}</span>
                        <span className="text-slate-400">&rarr;</span>
                        <span className="font-semibold text-slate-800">{t.to_bank_name}</span>
                      </div>

                      {/* Row 3: Date, Reference & Delete */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{formatShortDate(t.transfer_date)} {t.reference ? `· Ref: ${t.reference}` : ''}</span>
                        <button
                          type="button"
                          onClick={() => setTransferToDelete(t)}
                          title="Delete transfer & restore balances"
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Transfers Table (hidden md:block) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] font-semibold text-slate-400">
                      <th className="py-3 px-2 font-semibold">Date</th>
                      <th className="py-3 px-3 font-semibold">Transfer type</th>
                      <th className="py-3 px-3 font-semibold">From account</th>
                      <th className="py-3 px-3 font-semibold">To account</th>
                      <th className="py-3 px-3 text-right font-semibold">Amount</th>
                      <th className="py-3 px-3 font-semibold">Reference / Notes</th>
                      <th className="py-3 px-2 text-center font-semibold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/80">
                  {filteredTransfers.map((t) => {
                    const isCashToBank = t.transfer_type === 'CASH_TO_BANK';
                    const isBankToCash = t.transfer_type === 'BANK_TO_CASH';

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="py-3.5 px-2 text-xs font-medium text-slate-600 whitespace-nowrap">
                          {formatShortDate(t.transfer_date)}
                        </td>
                        <td className="py-3.5 px-3 whitespace-nowrap">
                          <span className="text-[10px] px-2.5 py-0.5 rounded-full font-semibold border border-slate-200/90 bg-white text-slate-700 inline-flex items-center gap-1 shadow-2xs">
                            {isCashToBank ? (
                              <>
                                <ArrowDownLeft className="w-3 h-3 text-[#0F766E]" />
                                <span>Cash &rarr; Bank (Deposit)</span>
                              </>
                            ) : isBankToCash ? (
                              <>
                                <ArrowUpRight className="w-3 h-3 text-slate-500" />
                                <span>Bank &rarr; Cash (Withdrawal)</span>
                              </>
                            ) : (
                              <>
                                <Repeat className="w-3 h-3 text-[#0F766E]" />
                                <span>Bank &rarr; Bank (Transfer)</span>
                              </>
                            )}
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
                            {isCashToBank ? (
                              <Banknote className="w-3.5 h-3.5 text-[#0F766E]" />
                            ) : (
                              <Building2 className="w-3.5 h-3.5 text-[#0F766E]" />
                            )}
                            <span>{t.from_bank_name}</span>
                          </div>
                          {t.from_account_name && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {t.from_account_name}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-3">
                          <div className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
                            {isBankToCash ? (
                              <Banknote className="w-3.5 h-3.5 text-[#0F766E]" />
                            ) : (
                              <Building2 className="w-3.5 h-3.5 text-[#0F766E]" />
                            )}
                            <span>{t.to_bank_name}</span>
                          </div>
                          {t.to_account_name && (
                            <div className="text-[10px] text-slate-400 mt-0.5">
                              {t.to_account_name}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-right font-bold text-slate-900 text-xs whitespace-nowrap tabular-nums">
                          {formatINR(t.amount)}
                        </td>
                        <td className="py-3.5 px-3">
                          {t.reference && (
                            <div className="font-mono text-[10px] text-slate-600">
                              Ref: {t.reference}
                            </div>
                          )}
                          {t.notes && (
                            <div className="text-[11px] text-slate-400 truncate max-w-xs">
                              {t.notes}
                            </div>
                          )}
                          {!t.reference && !t.notes && <span className="text-slate-300">—</span>}
                        </td>
                        <td className="py-3.5 px-2 text-center whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setTransferToDelete(t)}
                            title="Delete transfer & restore balances"
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Bank Account Modal */}
      <NewBankAccountModal
        open={isNewBankOpen}
        accountToEdit={bankAccountToEdit}
        onOpenChange={(open) => {
          setIsNewBankOpen(open);
          if (!open) setBankAccountToEdit(null);
        }}
        onSuccess={fetchData}
      />

      {/* Transfer Money Modal */}
      <TransferMoneyModal
        open={isTransferOpen}
        onOpenChange={setIsTransferOpen}
        bankAccounts={summaryData?.bank_accounts || []}
        cashBalance={cashBal}
        initialType={transferInitialType}
        onSuccess={fetchData}
      />

      {/* Delete Transfer Confirmation */}
      <ConfirmDialog
        open={Boolean(transferToDelete)}
        onOpenChange={(open) => !open && setTransferToDelete(null)}
        title="Delete Transfer"
        description="Are you sure you want to delete this transfer? Balances will be restored automatically."
        confirmLabel="Delete Transfer"
        variant="danger"
        loading={deletingTransfer}
        onConfirm={handleConfirmDeleteTransfer}
      />

      {/* Delete Bank Account Confirmation */}
      <ConfirmDialog
        open={Boolean(bankAccountToDelete)}
        onOpenChange={(open) => !open && setBankAccountToDelete(null)}
        title="Delete Bank Account"
        description={`Are you sure you want to delete "${bankAccountToDelete?.bank_name} (${bankAccountToDelete?.account_name})"? It will be hidden from selection.`}
        confirmLabel="Delete Account"
        variant="danger"
        loading={deletingBankAccount}
        onConfirm={handleConfirmDeleteBankAccount}
      />

      {/* Official A4 Printable Bank Statement (Mounted to body via Portal) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <div id="print-bank-statement-root" className="hidden print:flex">
            <BankStatementPrintDocument
              business={business}
              activeSubView={activeSubView}
              periodLabel={
                period === 'TODAY'
                  ? 'Today'
                  : period === 'MONTH'
                  ? 'This Month'
                  : `Financial Year ${currentFY}`
              }
              selectedBank={selectedBank}
              bankBal={bankBal}
              cashBal={cashBal}
              liquidFunds={liquidFunds}
              totalIn={ledgerData?.summary?.total_in || 0}
              totalOut={ledgerData?.summary?.total_out || 0}
              netFlow={netFlow}
              entries={filteredEntries}
              transfers={filteredTransfers}
              formatAccountDisplay={formatAccountDisplay}
              getEntryParticulars={getEntryParticulars}
            />
          </div>,
          document.body
        )}
    </div>
  );
};
