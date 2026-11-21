import React from 'react';
import { formatINR } from '../../lib/money';
import { format, parseISO, isValid } from 'date-fns';
import {
  Building2,
  ArrowDownLeft,
  ArrowUpRight,
  Repeat,
  Landmark,
} from 'lucide-react';

export interface BankStatementPrintDocumentProps {
  business: any;
  activeSubView: 'LEDGER' | 'TRANSFERS';
  periodLabel: string;
  selectedBank: any | null;
  bankBal: number;
  cashBal: number;
  liquidFunds: number;
  totalIn: number;
  totalOut: number;
  netFlow: number;
  entries: any[];
  transfers: any[];
  formatAccountDisplay: (bankAccountId?: string | null, fallbackLabel?: string | null) => string;
  getEntryParticulars: (e: any) => { title: string; subtitle: string };
}

/**
 * Dedicated Full-Page A4 Bank Passbook & Transfers Accounting Statement
 * Formatted consistently with Customer Statement, Staff Statement, and Official Reports.
 */
export const BankStatementPrintDocument: React.FC<BankStatementPrintDocumentProps> = ({
  business,
  activeSubView,
  periodLabel,
  selectedBank,
  bankBal,
  totalIn,
  totalOut,
  netFlow,
  entries,
  transfers,
  formatAccountDisplay,
  getEntryParticulars,
}) => {
  // Format short readable date
  const formatTxnDate = (dateStr: string) => {
    if (!dateStr) return '—';
    try {
      const d = typeof dateStr === 'string' ? parseISO(dateStr) : dateStr;
      return isValid(d) ? format(d, 'dd MMM yyyy') : dateStr;
    } catch {
      return dateStr;
    }
  };

  // Calculations for Transfers sub-view
  const totalTransferAmt = transfers.reduce((acc, t) => acc + Number(t.amount || 0), 0);
  const cashToBankAmt = transfers
    .filter((t) => t.transfer_type === 'CASH_TO_BANK')
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);
  const bankToCashAmt = transfers
    .filter((t) => t.transfer_type === 'BANK_TO_CASH')
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);
  const bankToBankAmt = transfers
    .filter((t) => t.transfer_type === 'BANK_TO_BANK')
    .reduce((acc, t) => acc + Number(t.amount || 0), 0);

  const isLedger = activeSubView === 'LEDGER';
  const accountTitle = selectedBank
    ? `${selectedBank.bank_name}${
        selectedBank.account_number
          ? ` (A/C ••${selectedBank.account_number.slice(-4)})`
          : ''
      }`
    : 'All Bank Accounts (Consolidated)';

  return (
    <div className="w-[210mm] min-h-0 p-6 bg-white text-slate-900 font-sans text-xs leading-tight space-y-4">
      {/* 1. Official Business & Bank Branding Header */}
      <div className="p-4 bg-[#EEF0F3] rounded-2xl flex justify-between items-center text-xs">
        <div className="flex items-start gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-white text-accent flex items-center justify-center shrink-0 shadow-2xs">
            <Building2 className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-slate-900 uppercase">
              {business?.name || 'Simplify Business'}
            </h1>
            {business?.address && (
              <p className="text-[11px] text-slate-500 mt-0.5 max-w-sm whitespace-pre-line">
                {business.address}
              </p>
            )}
            <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-3">
              {business?.mobile && <span>Phone: {business.mobile}</span>}
              {business?.email && <span>Email: {business.email}</span>}
            </div>
            {business?.upi_id && (
              <div className="text-[10px] font-semibold text-[#0F766E] mt-0.5">
                UPI ID: {business.upi_id}
              </div>
            )}
          </div>
        </div>

        <div className="text-right">
          <div className="flex items-center justify-end gap-2 mb-1">
            <img src="/simplify-logo.png" alt="Simplify" className="h-4 w-auto object-contain opacity-90" />
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white text-slate-700 shadow-2xs">
              {isLedger ? 'Bank Passbook Statement' : 'Contra Transfers Statement'}
            </span>
          </div>
          <div className="text-xs font-bold text-slate-900 mt-1">{accountTitle}</div>
          <div className="text-[11px] text-slate-500">
            {selectedBank?.ifsc_code ? `IFSC: ${selectedBank.ifsc_code} · ` : ''}
            Scope: {periodLabel}
          </div>
          <div className="text-[10px] font-medium text-slate-400 mt-0.5">
            Generated: {format(new Date(), 'dd MMM yyyy, hh:mm a')}
          </div>
        </div>
      </div>

      {/* 2. Four Luxury Summary Metric Cards */}
      {isLedger ? (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-[10px] text-slate-500">
                Total Money In
              </span>
              <div className="w-6 h-6 rounded-md bg-teal-50 flex items-center justify-center text-[#0F766E]">
                <ArrowDownLeft className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <div className="text-lg font-black text-emerald-600 tabular-nums">
                +₹{formatINR(totalIn).replace('₹', '')}
              </div>
              <span className="text-[10px] font-medium text-slate-400 mt-0.5 block">
                Total bank credits
              </span>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-[10px] text-slate-500">
                Total Money Out
              </span>
              <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center text-slate-700">
                <ArrowUpRight className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <div className="text-lg font-black text-slate-900 tabular-nums">
                -₹{formatINR(totalOut).replace('₹', '')}
              </div>
              <span className="text-[10px] font-medium text-slate-400 mt-0.5 block">
                Total bank debits
              </span>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-[10px] text-slate-500">
                Net Cash Flow
              </span>
              <div className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center text-slate-700">
                <Repeat className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <div
                className={`text-lg font-black tabular-nums ${
                  netFlow >= 0 ? 'text-emerald-600' : 'text-rose-600'
                }`}
              >
                {netFlow >= 0 ? '+' : '-'}₹{formatINR(Math.abs(netFlow)).replace('₹', '')}
              </div>
              <span className="text-[10px] font-medium text-slate-400 mt-0.5 block">
                Net period movement
              </span>
            </div>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-[10px] text-slate-500">
                {selectedBank ? 'Account Balance' : 'Total Bank Balance'}
              </span>
              <div className="w-6 h-6 rounded-md bg-teal-50 flex items-center justify-center text-[#0F766E]">
                <Landmark className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <div className="text-lg font-black text-slate-900 tabular-nums">
                ₹{formatINR(selectedBank ? selectedBank.current_balance : bankBal).replace('₹', '')}
              </div>
              <span className="text-[10px] font-medium text-slate-400 mt-0.5 block">
                Available liquid balance
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-1">
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Total Transferred</span>
            <div className="text-lg font-black text-slate-900 tabular-nums">
              ₹{formatINR(totalTransferAmt).replace('₹', '')}
            </div>
            <span className="text-[10px] text-slate-400 block">{transfers.length} transfers recorded</span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-1">
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Cash Deposits</span>
            <div className="text-lg font-black text-[#0F766E] tabular-nums">
              ₹{formatINR(cashToBankAmt).replace('₹', '')}
            </div>
            <span className="text-[10px] text-slate-400 block">Cash &rarr; Bank</span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-1">
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Cash Withdrawals</span>
            <div className="text-lg font-black text-slate-900 tabular-nums">
              ₹{formatINR(bankToCashAmt).replace('₹', '')}
            </div>
            <span className="text-[10px] text-slate-400 block">Bank &rarr; Cash</span>
          </div>

          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-1">
            <span className="text-[10px] text-slate-500 uppercase font-bold block">Bank to Bank</span>
            <div className="text-lg font-black text-slate-900 tabular-nums">
              ₹{formatINR(bankToBankAmt).replace('₹', '')}
            </div>
            <span className="text-[10px] text-slate-400 block">Inter-account transfers</span>
          </div>
        </div>
      )}

      {/* 3. Official Accounting Table */}
      {isLedger ? (
        <div className="space-y-1.5 break-inside-avoid">
          <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between pb-1">
            <span>Passbook Transaction Records ({entries.length})</span>
            <span className="text-[10px] text-slate-500 font-normal">All amounts in INR (₹)</span>
          </div>

          <div className="border-0 rounded-2xl overflow-hidden bg-white shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-2.5 px-2 font-semibold w-8">#</th>
                  <th className="py-2.5 px-2.5 font-semibold w-24">Date</th>
                  <th className="py-2.5 px-3 font-semibold">Particulars / Details</th>
                  <th className="py-2.5 px-2.5 font-semibold">Account</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Money In (+)</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Money Out (-)</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[10.5px]">
                {entries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 italic">
                      No bank transactions recorded for this period.
                    </td>
                  </tr>
                ) : (
                  entries.map((e, idx) => {
                    const isIn = e.direction === 'IN';
                    const { title, subtitle } = getEntryParticulars(e);
                    const accountLabel = formatAccountDisplay(e.bank_account_id, e.bank_label);

                    return (
                      <tr key={e.id || idx} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-2 text-slate-400 tabular-nums">{idx + 1}</td>
                        <td className="py-2.5 px-2.5 text-slate-600 whitespace-nowrap">
                          {formatTxnDate(e.txn_date)}
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-slate-900">{title}</div>
                          {subtitle && <div className="text-[10px] text-slate-400">{subtitle}</div>}
                        </td>
                        <td className="py-2.5 px-2.5 text-slate-700 whitespace-nowrap">
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-medium text-slate-700">
                            {accountLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {isIn ? (
                            <span className="font-bold text-emerald-600">
                              +₹{formatINR(e.in_amount).replace('₹', '')}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {!isIn ? (
                            <span className="font-bold text-slate-900">
                              -₹{formatINR(e.out_amount).replace('₹', '')}
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-slate-900">
                          ₹{formatINR(e.running_balance).replace('₹', '')}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="border-t border-slate-200 font-bold bg-slate-50 text-xs">
                <tr>
                  <td colSpan={4} className="py-2.5 px-3 uppercase text-[10px] text-slate-700">
                    Total ({entries.length} transactions)
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-emerald-700 font-bold">
                    +₹{formatINR(totalIn).replace('₹', '')}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-slate-900 font-bold">
                    -₹{formatINR(totalOut).replace('₹', '')}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-black text-slate-900">
                    Net: {netFlow >= 0 ? '+' : '-'}₹{formatINR(Math.abs(netFlow)).replace('₹', '')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5 break-inside-avoid">
          <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between pb-1">
            <span>Contra Fund Transfers Log ({transfers.length})</span>
            <span className="text-[10px] text-slate-500 font-normal">All amounts in INR (₹)</span>
          </div>

          <div className="border-0 rounded-2xl overflow-hidden bg-white shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-2.5 px-2 font-semibold w-8">#</th>
                  <th className="py-2.5 px-2.5 font-semibold w-24">Date</th>
                  <th className="py-2.5 px-2.5 font-semibold">Transfer Type</th>
                  <th className="py-2.5 px-3 font-semibold">From Account</th>
                  <th className="py-2.5 px-3 font-semibold">To Account</th>
                  <th className="py-2.5 px-3 font-semibold">Notes / Reference</th>
                  <th className="py-2.5 px-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[10.5px]">
                {transfers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-400 italic">
                      No contra fund transfers recorded.
                    </td>
                  </tr>
                ) : (
                  transfers.map((t, idx) => {
                    const isCashToBank = t.transfer_type === 'CASH_TO_BANK';
                    const isBankToCash = t.transfer_type === 'BANK_TO_CASH';

                    return (
                      <tr key={t.id || idx} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-2 text-slate-400 tabular-nums">{idx + 1}</td>
                        <td className="py-2.5 px-2.5 text-slate-600 whitespace-nowrap">
                          {formatTxnDate(t.transfer_date)}
                        </td>
                        <td className="py-2.5 px-2.5">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                            {isCashToBank
                              ? 'Deposit (Cash → Bank)'
                              : isBankToCash
                              ? 'Withdrawal (Bank → Cash)'
                              : 'Bank → Bank'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-medium text-slate-800">{t.from_bank_name}</td>
                        <td className="py-2.5 px-3 font-medium text-slate-800">{t.to_bank_name}</td>
                        <td className="py-2.5 px-3 text-slate-500 italic">
                          {t.notes || t.reference || '—'}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold text-slate-900">
                          {formatINR(t.amount)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot className="border-t border-slate-200 font-bold bg-slate-50 text-xs">
                <tr>
                  <td colSpan={6} className="py-2.5 px-3 uppercase text-[10px] text-slate-700">
                    Total ({transfers.length} transfers)
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums text-slate-900 font-bold">
                    {formatINR(totalTransferAmt)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* 4. Signatures & Official Footer */}
      <div className="pt-6 flex justify-between items-end break-inside-avoid">
        <div className="text-center w-48">
          <div className="border-t border-slate-300 pt-1 text-xs font-semibold text-slate-700">
            Accountant / Cashier
          </div>
          <div className="text-[10px] text-slate-400">Verified Cash &amp; Bank</div>
        </div>

        <div className="text-center w-48">
          <div className="border-t border-slate-300 pt-1 text-xs font-semibold text-slate-700">
            Authorized Signatory
          </div>
          <div className="text-[10px] text-slate-400">{business?.name || 'Simplify'}</div>
        </div>
      </div>

      {/* Official Marketing Footer */}
      <div
        data-no-border
        className="pdf-footer pt-3 border-t border-slate-200/80 flex justify-between items-center text-[10px] text-slate-400 break-inside-avoid"
      >
        <div className="flex items-center gap-1.5">
          <span>Powered by</span>
          <img src="/simplify-logo.png" alt="Simplify" className="h-3.5 w-auto object-contain inline-block" />
          <span>Business Management &amp; Billing Software</span>
        </div>
        <div>Verified Bank Records · Confidential</div>
      </div>
    </div>
  );
};
