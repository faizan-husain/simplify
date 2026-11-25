import React, { useState, useMemo, useRef } from 'react';
import { formatINR } from '../../lib/money';
import { Select } from '../ui/Select';
import { useAuth } from '../../context/AuthContext';
import { setPrintPageSize, exportDocumentPDF } from '../documents/pdfExport';
import {
  BarChart3,
  Calendar,
  Filter,
  Briefcase,
  TrendingUp,
  CreditCard,
  Wallet,
  Download,
  Printer,
  Building2,
} from 'lucide-react';

export interface StaffEarningsStatementProps {
  earningsHistory: {
    staff_id?: string;
    staff_name?: string;
    compensation_type?: string;
    monthly_salary?: number;
    monthly?: Array<{
      month_key: string;
      month_label: string;
      fy_label: string;
      jobs_count: number;
      earned: number;
      paid: number;
      balance: number;
      m_start?: string;
    }>;
    yearly?: Array<{
      fy_label: string;
      jobs_count: number;
      earned: number;
      paid: number;
      balance: number;
    }>;
    overall?: {
      all_time_earned: number;
      all_time_paid: number;
      all_time_balance: number;
      total_jobs: number;
    };
  } | null;
  loading?: boolean;
  staffInfo?: {
    id?: string;
    name?: string;
    mobile?: string;
    role?: string;
    compensation_type?: string;
    monthly_salary?: number;
    salary_start_date?: string;
  } | null;
}

export const StaffEarningsStatement: React.FC<StaffEarningsStatementProps> = ({
  earningsHistory,
  loading = false,
  staffInfo,
}) => {
  const { business } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);

  // Default to FY 2026-27
  const [selectedFY, setSelectedFY] = useState<string>('2026-27');

  // List of all unique Financial Years available in data (Strictly Year-wise only, no 'ALL')
  const availableFYs = useMemo(() => {
    const list = earningsHistory?.yearly ? earningsHistory.yearly.map((y) => y.fy_label) : [];
    if (!list.includes('2026-27')) {
      return ['2026-27', ...list];
    }
    return list;
  }, [earningsHistory]);

  // Months filtered by selected Financial Year and sorted strictly ASCENDING (top to bottom: Apr -> ... -> Mar)
  const sortedMonths = useMemo(() => {
    if (!earningsHistory?.monthly) return [];
    const list = earningsHistory.monthly.filter((m) => m.fy_label === selectedFY);

    // Sort ascending top to bottom by month_key (e.g., 2026-04, 2026-05, ..., 2026-11)
    return [...list].sort((a, b) => (a.month_key || '').localeCompare(b.month_key || ''));
  }, [earningsHistory, selectedFY]);

  // Aggregate totals for the currently selected Year
  const currentFYData = useMemo(() => {
    const fyObj = earningsHistory?.yearly?.find((y) => y.fy_label === selectedFY);
    if (fyObj) {
      return {
        jobs_count: fyObj.jobs_count,
        earned: fyObj.earned,
        paid: fyObj.paid,
        balance: fyObj.balance,
      };
    }
    // Fallback if not found in yearly summary: aggregate from months
    const totalJobs = sortedMonths.reduce((acc, m) => acc + (m.jobs_count || 0), 0);
    const totalEarned = sortedMonths.reduce((acc, m) => acc + Number(m.earned || 0), 0);
    const totalPaid = sortedMonths.reduce((acc, m) => acc + Number(m.paid || 0), 0);
    return {
      jobs_count: totalJobs,
      earned: totalEarned,
      paid: totalPaid,
      balance: totalEarned - totalPaid,
    };
  }, [earningsHistory, selectedFY, sortedMonths]);

  const staffName = staffInfo?.name || earningsHistory?.staff_name || 'Staff Member';
  const staffMobile = staffInfo?.mobile || '';
  const isSalaried = (staffInfo?.compensation_type || earningsHistory?.compensation_type) === 'SALARY';
  const monthlySalary = staffInfo?.monthly_salary || earningsHistory?.monthly_salary || 0;
  const compensationModel = isSalaried
    ? `Fixed Salary (₹${monthlySalary.toLocaleString('en-IN')}/mo)`
    : 'Commission Based';

  const handleExportPDF = async () => {
    if (!printRef.current) return;
    try {
      const filename = `Staff_Statement_${staffName.replace(/\s+/g, '_')}_${selectedFY}.pdf`;
      await exportDocumentPDF(printRef.current, filename);
    } catch {
      // Fallback handled automatically
    }
  };

  const handlePrint = () => {
    setPrintPageSize('a4', 8);
    document.body.classList.add('printing-staff-fy-active');
    const cleanup = () => {
      document.body.classList.remove('printing-staff-fy-active');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-xs text-slate-400 bg-white border-0 rounded-2xl shadow-2xs">
        Loading earnings history statement...
      </div>
    );
  }

  if (!earningsHistory || (!earningsHistory.monthly?.length && !earningsHistory.yearly?.length)) {
    return (
      <div className="py-14 text-center text-xs text-slate-400 bg-white border-0 rounded-2xl p-6 shadow-2xs">
        <BarChart3 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <div className="font-semibold text-slate-700 text-sm">No Earnings History Available</div>
        <p className="text-slate-400 mt-1">
          Completed jobs and payments recorded for this staff member will appear here in chronological order.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 1. Interactive Control Toolbar (Hidden during Print/PDF) */}
      <div
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/90 shadow-2xs print:hidden no-print"
        data-pdf-hidden
      >
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-accent" />
            <span>Financial Year Statement</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Annual performance, commission earned, and payout breakdown for FY {selectedFY}
          </p>
        </div>

        {/* Action Buttons Toolbar: Year Selector + PDF + Print */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          {/* Year Selection Dropdown */}
          <div className="flex items-center gap-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600 whitespace-nowrap">Year:</span>
            <div className="w-[125px]">
              <Select
                id="fy-select"
                value={selectedFY}
                onChange={setSelectedFY}
                size="sm"
                options={availableFYs.map((fy) => ({
                  value: fy,
                  label: `FY ${fy}`,
                }))}
              />
            </div>
          </div>

          {/* Export PDF Button */}
          <button
            type="button"
            onClick={handleExportPDF}
            title="Download Statement PDF"
            className="h-8 px-2.5 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-semibold shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-slate-500" />
            <span>PDF</span>
          </button>

          {/* Print Button */}
          <button
            type="button"
            onClick={handlePrint}
            title="Print Statement"
            className="h-8 px-2.5 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-semibold shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* 2. Printable Statement Container (Captured by PDF engine & Print dialog) */}
      <div ref={printRef} id="print-staff-fy-statement" className="space-y-4 print:p-0">
        {/* Printable Business & Staff Branding Header */}
        <div className="p-3.5 sm:p-4 bg-[#EEF0F3] rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white text-accent flex items-center justify-center shrink-0 shadow-2xs">
              <Building2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-sm">{business?.name || 'Simplify Business'}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {business?.address || 'Document & Business Solutions'}
                {business?.mobile && ` · Phone: ${business.mobile}`}
              </p>
              {business?.email && (
                <p className="text-[10px] text-slate-400 mt-0.5">{business.email}</p>
              )}
            </div>
          </div>

          <div className="sm:text-right pt-2 sm:pt-0">
            <div className="flex items-center sm:justify-end gap-2 mb-1">
              <img src="/simplify-logo.png" alt="Simplify" className="h-4 w-auto object-contain opacity-90" />
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white text-slate-700 shadow-2xs">
                Staff Statement
              </span>
            </div>
            <div className="text-slate-900 font-bold text-xs mt-1">
              {staffName}
            </div>
            <div className="text-[11px] text-slate-500">
              {staffMobile ? `Mobile: ${staffMobile}` : 'Verified Staff Member'}
              {compensationModel && ` · ${compensationModel}`}
            </div>
            <div className="text-[10px] font-semibold text-slate-500 mt-0.5">
              Scope: Financial Year {selectedFY}
            </div>
          </div>
        </div>

        {/* Four Luxury White Summary Metric Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* 1. Jobs Completed */}
          <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-[10.5px] text-slate-500">Jobs Completed</span>
              <div className="w-7 h-7 rounded-lg bg-teal-50 border-0 flex items-center justify-center text-[#0F766E] shadow-2xs">
                <Briefcase className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 tabular-nums">
                {currentFYData.jobs_count}
              </div>
              <span className="text-[11px] font-medium text-slate-400 mt-0.5 block">
                Work orders closed in FY {selectedFY}
              </span>
            </div>
          </div>

          {/* 2. Total Earned */}
          <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-[10.5px] text-slate-500">
                {isSalaried ? 'Total Salary' : 'Commission Earned'}
              </span>
              <div className="w-7 h-7 rounded-lg bg-emerald-50 border-0 flex items-center justify-center text-emerald-700 shadow-2xs">
                <TrendingUp className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-black text-emerald-600 tabular-nums">
                {formatINR(currentFYData.earned)}
              </div>
              <span className="text-[11px] font-medium text-slate-400 mt-0.5 block">
                Accrued in FY {selectedFY}
              </span>
            </div>
          </div>

          {/* 3. Total Paid */}
          <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-[10.5px] text-slate-500">Total Paid</span>
              <div className="w-7 h-7 rounded-lg bg-slate-100 border-0 flex items-center justify-center text-slate-700 shadow-2xs">
                <CreditCard className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 tabular-nums">
                {formatINR(currentFYData.paid)}
              </div>
              <span className="text-[11px] font-medium text-slate-400 mt-0.5 block">
                Disbursed payouts
              </span>
            </div>
          </div>

          {/* 4. Net Balance */}
          <div className="bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs flex flex-col justify-between space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold uppercase tracking-wider text-[10.5px] text-slate-500">Net Balance</span>
              <div className="w-7 h-7 rounded-lg bg-slate-100 border-0 flex items-center justify-center text-slate-700 shadow-2xs">
                <Wallet className="w-3.5 h-3.5" />
              </div>
            </div>
            <div>
              <div
                className={`text-2xl sm:text-3xl font-black tabular-nums ${
                  currentFYData.balance > 0
                    ? 'text-rose-600'
                    : currentFYData.balance < 0
                    ? 'text-blue-600'
                    : 'text-slate-900'
                }`}
              >
                {currentFYData.balance < 0
                  ? `Adv ₹${Math.abs(currentFYData.balance).toLocaleString('en-IN')}`
                  : formatINR(currentFYData.balance)}
              </div>
              <span className="text-[11px] font-medium text-slate-400 mt-0.5 block">
                {currentFYData.balance > 0
                  ? 'Pending payable'
                  : currentFYData.balance < 0
                  ? 'Advance payment'
                  : 'Fully settled'}
              </span>
            </div>
          </div>
        </div>

        {/* 3. Month-by-Month Statement Table */}
        <div className="bg-white border-0 rounded-2xl overflow-hidden shadow-2xs">
          <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-50/80 via-white to-slate-50/80 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-teal-50 border-0 flex items-center justify-center text-[#0F766E] shrink-0 shadow-2xs">
                <Calendar className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                  <span>Month-by-Month Statement</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chronological order (Apr → Mar) • Financial Year {selectedFY}
                </p>
              </div>
            </div>

            <div className="text-xs text-slate-700 font-bold bg-white px-3 py-1.5 rounded-xl self-start sm:self-auto border-0 shadow-2xs">
              {sortedMonths.length} {sortedMonths.length === 1 ? 'Month recorded' : 'Months recorded'}
            </div>
          </div>

          {sortedMonths.length === 0 ? (
            <div className="py-14 text-center text-xs text-slate-400">
              No monthly records found for FY {selectedFY}.
            </div>
          ) : (
            <>
              {/* Mobile Month Cards (md:hidden print:hidden) */}
              <div className="md:hidden divide-y divide-slate-100 print:hidden">
                {sortedMonths.map((row) => (
                  <div key={row.month_key} className="p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 text-sm">
                        {row.month_label}
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-[11px] tabular-nums">
                        {row.jobs_count} {row.jobs_count === 1 ? 'job' : 'jobs'}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 uppercase font-semibold block">Earned</span>
                        <span className="font-bold text-emerald-600 tabular-nums">
                          {formatINR(row.earned)}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 uppercase font-semibold block">Paid</span>
                        <span className="font-bold text-slate-800 tabular-nums">
                          {formatINR(row.paid)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 uppercase font-semibold block">Balance</span>
                        <span
                          className={`font-bold tabular-nums ${
                            row.balance > 0
                              ? 'text-rose-600'
                              : row.balance < 0
                              ? 'text-blue-600'
                              : 'text-slate-900'
                          }`}
                        >
                          {row.balance < 0
                            ? `Adv ₹${Math.abs(row.balance).toLocaleString('en-IN')}`
                            : formatINR(row.balance)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Mobile Total Footer */}
                <div className="p-3.5 bg-slate-50 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-sm">
                      Total (FY {selectedFY})
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 font-bold text-[11px] tabular-nums">
                      {currentFYData.jobs_count} jobs
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 pt-1 text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block">Earned</span>
                      <span className="font-bold text-emerald-700 tabular-nums">
                        {formatINR(currentFYData.earned)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block">Paid</span>
                      <span className="font-bold text-slate-900 tabular-nums">
                        {formatINR(currentFYData.paid)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block">Net Balance</span>
                      <span
                        className={`font-black tabular-nums ${
                          currentFYData.balance > 0
                            ? 'text-rose-600'
                            : currentFYData.balance < 0
                            ? 'text-blue-600'
                            : 'text-slate-900'
                        }`}
                      >
                        {currentFYData.balance < 0
                          ? `Adv ₹${Math.abs(currentFYData.balance).toLocaleString('en-IN')}`
                          : formatINR(currentFYData.balance)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Desktop & Print Table (hidden md:block print:block) */}
              <div className="hidden md:block print:block overflow-x-auto">
                <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] font-semibold border-b border-slate-100">
                  <tr>
                    <th className="py-2.5 px-4 font-semibold">Month</th>
                    <th className="py-2.5 px-3 font-semibold text-center">Jobs Done</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Commission Earned</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Commission Paid</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Net Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedMonths.map((row) => (
                    <tr key={row.month_key} className="hover:bg-slate-50/50 transition-colors">
                      <td className="py-2.5 px-4 font-semibold text-slate-900 text-xs">
                        {row.month_label}
                      </td>
                      <td className="py-2.5 px-3 text-center tabular-nums">
                        <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold text-[11px]">
                          {row.jobs_count}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-medium text-emerald-600 tabular-nums">
                        {formatINR(row.earned)}
                      </td>
                      <td className="py-2.5 px-4 text-right font-medium text-slate-900 tabular-nums">
                        {formatINR(row.paid)}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums">
                        <span
                          className={`font-semibold ${
                            row.balance > 0
                              ? 'text-rose-600'
                              : row.balance < 0
                              ? 'text-blue-600'
                              : 'text-slate-900'
                          }`}
                        >
                          {row.balance < 0
                            ? `Adv ₹${Math.abs(row.balance).toLocaleString('en-IN')}`
                            : formatINR(row.balance)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-white border-t border-slate-200 font-bold text-xs text-slate-900">
                  <tr>
                    <td className="py-3 px-4 font-bold text-slate-900">
                      Total (FY {selectedFY})
                    </td>
                    <td className="py-3 px-3 text-center tabular-nums">
                      <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-900 font-bold text-[11px]">
                        {currentFYData.jobs_count}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-emerald-700 font-bold">
                      {formatINR(currentFYData.earned)}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums text-slate-900 font-bold">
                      {formatINR(currentFYData.paid)}
                    </td>
                    <td className="py-3 px-4 text-right tabular-nums">
                      <span
                        className={`font-black ${
                          currentFYData.balance > 0
                            ? 'text-rose-600'
                            : currentFYData.balance < 0
                            ? 'text-blue-600'
                            : 'text-slate-900'
                        }`}
                      >
                        {currentFYData.balance < 0
                          ? `Adv ₹${Math.abs(currentFYData.balance).toLocaleString('en-IN')}`
                          : formatINR(currentFYData.balance)}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            </>
          )}

          {/* Official Document Footer (Captured in PDF & Print) - Clean Borderless */}
          <div
            data-no-border
            className="pdf-footer pt-3 pb-1 px-4 border-0 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-1 text-[10px] text-slate-400 break-inside-avoid"
          >
            <div className="flex items-center gap-1.5">
              <span>Powered by</span>
              <img src="/simplify-logo.png" alt="Simplify" className="h-3.5 w-auto object-contain inline-block" />
              <span>Business Management &amp; Billing Software</span>
            </div>
            <div>Verified Staff Records · Confidential</div>
          </div>
        </div>
      </div>
    </div>
  );
};
