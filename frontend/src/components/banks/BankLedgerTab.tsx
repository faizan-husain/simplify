import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getErrorMessage } from '../../i18n';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { EmptyState } from '../ui/EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { useToast } from '../ui/Toast';
import { NewBankAccountModal } from './NewBankAccountModal';
import { exportDocumentPDF } from '../documents/pdfExport';
import {
  Building2,
  ArrowDownLeft,
  ArrowUpRight,
  Plus,
  Printer,
  Download,
  Search,
  Wallet,
} from 'lucide-react';

export interface BankLedgerTabProps {
  onRecordIncome?: () => void;
  onRecordPayment?: () => void;
}

export const BankLedgerTab: React.FC<BankLedgerTabProps> = ({
  onRecordIncome,
  onRecordPayment,
}) => {
  const { showToast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<{
    bank_accounts: any[];
    summary: { total_in: number; total_out: number; net_flow: number };
    entries: any[];
  } | null>(null);

  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);
  const [period, setPeriod] = useState<'MONTH' | 'YEAR' | 'ALL'>('MONTH');
  const [search, setSearch] = useState('');
  const [isNewBankOpen, setIsNewBankOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchLedger = async () => {
    setLoading(true);
    try {
      const now = new Date();
      let fromDate: string | null = null;
      let toDate: string | null = null;

      if (period === 'MONTH') {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        fromDate = firstDay.toISOString().split('T')[0];
        toDate = lastDay.toISOString().split('T')[0];
      } else if (period === 'YEAR') {
        // Indian FY: 1 Apr to 31 Mar
        const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        fromDate = `${year}-04-01`;
        toDate = `${year + 1}-03-31`;
      }

      const { data: res, error } = await supabase.rpc('bank_ledger', {
        p_bank_account_id: selectedBankId,
        p_from_date: fromDate,
        p_to_date: toDate,
      });

      if (error) throw error;
      setData(res as any);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLedger();
  }, [selectedBankId, period]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportPDF = async () => {
    if (!printRef.current) return;
    setExporting(true);
    try {
      await exportDocumentPDF(printRef.current, `Bank-Statement-${period}.pdf`);
      showToast('Bank statement downloaded successfully', 'success');
    } catch (err: any) {
      showToast('Failed to export PDF: ' + err.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const filteredEntries = (data?.entries || []).filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.party_name?.toLowerCase().includes(q) ||
      e.description?.toLowerCase().includes(q) ||
      e.ref_no?.toLowerCase().includes(q) ||
      e.bank_label?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {/* 1. Header Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-4 rounded-xl border border-border shadow-2xs">
        <div className="p-3 bg-emerald-50/70 rounded-lg border border-emerald-100 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider flex items-center gap-1">
              <ArrowDownLeft className="w-3.5 h-3.5 text-success" />
              <span>Bank Deposits (Money IN)</span>
            </div>
            <div className="text-xl font-black text-success mt-1">
              +{formatINR(data?.summary.total_in || 0)}
            </div>
          </div>
          {onRecordIncome && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRecordIncome}
              className="border-emerald-300 text-emerald-800 hover:bg-emerald-100 text-xs shrink-0"
            >
              + Deposit
            </Button>
          )}
        </div>

        <div className="p-3 bg-rose-50/70 rounded-lg border border-rose-100 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1">
              <ArrowUpRight className="w-3.5 h-3.5 text-danger" />
              <span>Bank Withdrawals (Money OUT)</span>
            </div>
            <div className="text-xl font-black text-danger mt-1">
              -{formatINR(data?.summary.total_out || 0)}
            </div>
          </div>
          {onRecordPayment && (
            <Button
              variant="outline"
              size="sm"
              onClick={onRecordPayment}
              className="border-rose-300 text-rose-800 hover:bg-rose-100 text-xs shrink-0"
            >
              - Payout
            </Button>
          )}
        </div>

        <div className="p-3 bg-blue-50/70 rounded-lg border border-blue-100 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold text-primary uppercase tracking-wider flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5" />
              <span>Net Bank Position</span>
            </div>
            <div className="text-xl font-black text-slate-900 mt-1">
              {formatINR(data?.summary.net_flow || 0)}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsNewBankOpen(true)}
            className="border-blue-300 text-primary hover:bg-blue-100 text-xs shrink-0"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            + Bank A/c
          </Button>
        </div>
      </div>

      {/* 2. Bank Accounts Selector Bar */}
      <div className="bg-white p-3 rounded-xl border border-border shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setSelectedBankId(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
              selectedBankId === null
                ? 'bg-primary text-white shadow-2xs'
                : 'bg-surface text-slate-700 hover:bg-slate-200/60 border border-border'
            }`}
          >
            <Wallet className="w-3.5 h-3.5" />
            <span>All Bank Accounts</span>
          </button>

          {(data?.bank_accounts || []).map((acc) => {
            const isSelected = selectedBankId === acc.id;
            const netAcc =
              parseFloat(String(acc.opening_balance || 0)) +
              parseFloat(String(acc.total_in || 0)) -
              parseFloat(String(acc.total_out || 0));

            return (
              <button
                key={acc.id}
                type="button"
                onClick={() => setSelectedBankId(acc.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 border ${
                  isSelected
                    ? 'bg-primary text-white border-primary shadow-2xs'
                    : 'bg-white text-slate-800 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <Building2 className={`w-3.5 h-3.5 ${isSelected ? 'text-white' : 'text-primary'}`} />
                <span>{acc.bank_name}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
                  isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}>
                  {acc.account_number || acc.account_name}
                </span>
                <span className="font-extrabold pl-1">
                  {formatINR(netAcc)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Date Filter & Export */}
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50 text-xs">
            <button
              type="button"
              onClick={() => setPeriod('MONTH')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                period === 'MONTH' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => setPeriod('YEAR')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                period === 'YEAR' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              This FY
            </button>
            <button
              type="button"
              onClick={() => setPeriod('ALL')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                period === 'ALL' ? 'bg-white text-slate-900 shadow-2xs font-bold' : 'text-slate-500 hover:text-slate-900'
              }`}
            >
              All Time
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPDF}
            disabled={exporting || loading}
            title="Download Bank Statement PDF"
            className="h-8 text-xs"
          >
            <Download className="w-3.5 h-3.5 mr-1" />
            PDF
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            title="Print Bank Passbook"
            className="h-8 text-xs"
          >
            <Printer className="w-3.5 h-3.5 mr-1" />
            Print
          </Button>
        </div>
      </div>

      {/* 3. Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
        <Input
          type="text"
          placeholder="Search by party name, description, UTR/ref #, or bank..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9 text-xs"
        />
      </div>

      {/* 4. Bank Passbook Table */}
      <div ref={printRef} className="bg-white border border-border rounded-xl overflow-hidden shadow-2xs">
        <div className="p-3.5 bg-slate-50 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
              <Building2 className="w-4 h-4 text-primary" />
              <span>
                {selectedBankId
                  ? (data?.bank_accounts || []).find((b) => b.id === selectedBankId)?.bank_name + ' Ledger'
                  : 'Consolidated Bank Passbook & Statement'}
              </span>
            </h3>
            <p className="text-[11px] text-slate-500">
              {filteredEntries.length} recorded bank transactions · Period: {period === 'MONTH' ? 'This Month' : period === 'YEAR' ? 'Financial Year' : 'All Time'}
            </p>
          </div>

          <div className="text-right">
            <span className="text-xs text-slate-500">Net Flow: </span>
            <span className={`text-sm font-black ${
              (data?.summary.net_flow || 0) >= 0 ? 'text-success' : 'text-danger'
            }`}>
              {formatINR(data?.summary.net_flow || 0)}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="p-8 text-center">
            <EmptyState message="No bank transactions found for this period. Receipts and payments made via Bank or UPI will appear here." />
          </div>
        ) : (
          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left">
              <thead className="bg-slate-50/80 text-slate-600 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                <tr>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Party / Particulars</th>
                  <th className="py-2.5 px-3">Bank & Ref / UTR #</th>
                  <th className="py-2.5 px-3 text-right">Money IN (Deposit +)</th>
                  <th className="py-2.5 px-3 text-right">Money OUT (Payout -)</th>
                  <th className="py-2.5 px-3 text-right">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEntries.map((e) => {
                  const isIn = e.direction === 'IN';
                  return (
                    <tr key={e.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-2.5 px-3 font-medium text-slate-600 whitespace-nowrap">
                        {formatDate(e.txn_date)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                            e.txn_type === 'RECEIPT'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : e.txn_type === 'PAYMENT'
                              ? 'bg-purple-50 text-purple-800 border-purple-200'
                              : e.txn_type === 'EXPENSE'
                              ? 'bg-rose-50 text-rose-800 border-rose-200'
                              : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}
                        >
                          {e.txn_type === 'RECEIPT'
                            ? 'IN • Receipt'
                            : e.txn_type === 'PAYMENT'
                            ? 'OUT • Vendor'
                            : e.txn_type === 'EXPENSE'
                            ? 'OUT • Expense'
                            : 'OUT • Loan'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-slate-900">{e.party_name}</div>
                        <div className="text-[11px] text-slate-500 truncate max-w-xs">{e.description}</div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-semibold text-slate-800">{e.bank_label}</div>
                        <div className="text-[10px] text-slate-500 font-mono">Ref: {e.ref_no}</div>
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-success whitespace-nowrap">
                        {isIn ? `+${formatINR(e.in_amount)}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-danger whitespace-nowrap">
                        {!isIn ? `-${formatINR(e.out_amount)}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-bold text-slate-900 whitespace-nowrap">
                        {formatINR(e.running_balance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Bank Account Modal */}
      <NewBankAccountModal
        open={isNewBankOpen}
        onOpenChange={setIsNewBankOpen}
        onSuccess={fetchLedger}
      />
    </div>
  );
};
