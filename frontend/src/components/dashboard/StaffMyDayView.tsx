import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText,
  Banknote,
  Coins,
  CheckCircle2,
  ChevronRight,
  QrCode,
  CreditCard,
  Building,
  Plus,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Card } from '../ui/Card';
import { StatCard } from '../ui/StatCard';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { CompactJobCard } from '../jobs/CompactJobCard';

interface StaffMyDayViewProps {
  data: any;
  loading?: boolean;
  onRefresh: () => void;
  period: 'TODAY' | 'THIS_MONTH';
  business: any;
  member?: any;
  onSelectBill: (billId: string) => void;
  onSelectJob: (jobId: string) => void;
}

export const StaffMyDayView: React.FC<StaffMyDayViewProps> = ({
  data,
  period,
  onSelectBill,
  onSelectJob,
}) => {
  const navigate = useNavigate();

  const myBills = data?.my_bills || { count: 0, total_amount: 0 };
  const myCollection = data?.my_collection || { total: 0, cash: 0, upi: 0, bank: 0, card: 0 };
  const myEarnings = data?.my_earnings || {
    compensation_type: 'COMMISSION',
    monthly_salary: 0,
    total_earned: 0,
    total_paid: 0,
    balance_payable: 0,
    upcoming: 0,
  };
  const jobsData = data?.jobs || {
    enabled: false,
    pending_count: 0,
    completed_today_count: 0,
    completed_period_count: 0,
    late_count: 0,
    red_count: 0,
    yellow_count: 0,
    urgent_jobs: [],
  };
  // For staff UI, limit recent bills to strictly 5 (owner dashboard keeps 8)
  const recentBills = (data?.my_recent_bills || []).slice(0, 5);
  const billsPerDay = data?.my_bills_per_day || [];

  const isSalaried = myEarnings.compensation_type === 'SALARY';
  const collectionTotal = Number(myCollection.total || 0);
  const cashAmt = Number(myCollection.cash || 0);
  const upiAmt = Number(myCollection.upi || 0);
  const bankAmt = Number(myCollection.bank || 0);
  const cardAmt = Number(myCollection.card || 0);

  const modePcts = useMemo(() => {
    if (collectionTotal <= 0) {
      return { cash: 0, upi: 0, bank: 0, card: 0 };
    }
    return {
      cash: Math.round((cashAmt / collectionTotal) * 100),
      upi: Math.round((upiAmt / collectionTotal) * 100),
      bank: Math.round((bankAmt / collectionTotal) * 100),
      card: Math.round((cardAmt / collectionTotal) * 100),
    };
  }, [collectionTotal, cashAmt, upiAmt, bankAmt, cardAmt]);

  const [hoveredDayIndex, setHoveredDayIndex] = useState<number>(() =>
    billsPerDay.length > 0 ? billsPerDay.length - 1 : 0
  );

  const maxBillsCount = useMemo(() => {
    if (!billsPerDay || billsPerDay.length === 0) return 1;
    return Math.max(1, ...billsPerDay.map((b: any) => Number(b.bills_count || 0)));
  }, [billsPerDay]);

  const totalMonthBills = useMemo(() => {
    if (!billsPerDay || billsPerDay.length === 0) return 0;
    return billsPerDay.reduce((acc: number, b: any) => acc + Number(b.bills_count || 0), 0);
  }, [billsPerDay]);

  return (
    <div className="space-y-5">
      {/* ======================================================== */}
      {/* ROW 1: 3 STAT CARDS MATCHING MAIN DASHBOARD EXACTLY */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: My Bills */}
        <StatCard
          label={period === 'THIS_MONTH' ? 'My Bills This Month' : 'My Bills Today'}
          value={myBills.count}
          secondaryLine={
            <div className="flex items-center justify-between gap-3 text-xs text-[#6B7280] w-full pt-1.5 border-t border-[#F1F5F9]">
              <span>Total bill value</span>
              <span className="font-semibold text-[#111827] tabular-nums ml-auto">
                {formatINR(myBills.total_amount)}
              </span>
            </div>
          }
          icon={
            <div className="w-7 h-7 rounded-full bg-white text-[#111827] shadow-2xs flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
          }
          onClick={() => navigate('/bills')}
        />

        {/* Card 2: My Collection */}
        <StatCard
          label={period === 'THIS_MONTH' ? 'My Collection This Month' : 'My Collection Today'}
          value={formatINR(myCollection.total)}
          onClick={() => navigate('/money?tab=receipts')}
          secondaryLine={
            <div className="flex items-center justify-between gap-3 text-xs text-[#6B7280] w-full pt-1.5 border-t border-[#F1F5F9]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span>Cash in hand</span>
              </span>
              <span className="font-bold text-emerald-700 tabular-nums ml-auto">
                {formatINR(myCollection.cash)}
              </span>
            </div>
          }
          icon={
            <div className="w-7 h-7 rounded-full bg-white text-emerald-600 shadow-2xs flex items-center justify-center shrink-0">
              <Banknote className="w-4 h-4" />
            </div>
          }
        />

        {/* Card 3: My Earnings */}
        <StatCard
          label={isSalaried ? 'Salary Payable' : 'Commission Balance'}
          value={formatINR(myEarnings.balance_payable)}
          delta={{
            value: isSalaried ? 'Fixed Salary' : 'Payable',
            isPositive: true,
            label: isSalaried
              ? `₹${Number(myEarnings.monthly_salary || 0).toLocaleString('en-IN')}/mo`
              : `· Earned ${formatINR(myEarnings.total_earned)}`,
          }}
          secondaryLine={
            <div className="flex items-center justify-between gap-3 text-xs text-[#6B7280] w-full pt-1.5 border-t border-[#F1F5F9]">
              <span>{isSalaried ? 'Monthly compensation' : 'Earned this period'}</span>
              <span className="font-semibold text-[#111827] tabular-nums ml-auto">
                {isSalaried
                  ? `₹${Number(myEarnings.monthly_salary || 0).toLocaleString('en-IN')}/mo`
                  : formatINR(myEarnings.total_earned)}
              </span>
            </div>
          }
          icon={
            <div className="w-7 h-7 rounded-full bg-white text-amber-600 shadow-2xs flex items-center justify-center shrink-0">
              <Coins className="w-4 h-4" />
            </div>
          }
          onClick={() => navigate('/earnings')}
        />
      </div>

      {/* ======================================================== */}
      {/* ROW 2: JOBS QUEUE (LEFT 8 COLS) & COLLECTION BY MODE (RIGHT 4 COLS) */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Jobs Queue Card (8 Columns) */}
        <Card className="lg:col-span-8 p-5 sm:p-6 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between h-full">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#F1F5F9]">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
                    Jobs queue
                  </h2>
                  <span className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 tabular-nums">
                    {jobsData.pending_count} pending
                  </span>
                </div>
                <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
                  Track steps and dispatch WhatsApp updates to customers
                </p>
              </div>

              {/* Status Counts matching Jobs Page squircle badges */}
              <div className="flex items-center gap-2 flex-wrap">
                {jobsData.late_count > 0 && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-md bg-rose-50 text-rose-800 border-0">
                    {jobsData.late_count} Late
                  </span>
                )}
                {jobsData.red_count > 0 && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-md bg-red-50 text-red-700 border-0">
                    {jobsData.red_count} Red
                  </span>
                )}
                {jobsData.yellow_count > 0 && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border-0">
                    {jobsData.yellow_count} Yellow
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => navigate('/jobs')}
                  className="text-[12.5px] sm:text-[13px] font-semibold text-[#0F766E] hover:text-[#0D655E] hover:underline flex items-center gap-0.5 cursor-pointer ml-1"
                >
                  <span>View all</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Urgent Jobs List with CompactJobCard */}
            <div className="py-2.5 flex-1 min-h-0">
              {jobsData.urgent_jobs?.length === 0 ? (
                <div className="py-12 text-center bg-slate-50/50 rounded-xl border border-dashed border-slate-200">
                  <CheckCircle2 className="w-8 h-8 text-[#0F766E] mx-auto mb-2 opacity-80" />
                  <div className="text-[14px] font-bold text-[#111827]">All jobs completed!</div>
                  <p className="text-[12px] text-[#6B7280] mt-0.5">
                    No pending job steps assigned to you right now.
                  </p>
                </div>
              ) : (
                <div className="max-h-[380px] overflow-y-auto pr-1 space-y-2.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">
                  {jobsData.urgent_jobs.map((job: any, idx: number) => (
                    <CompactJobCard
                      key={job.id || idx}
                      job={job}
                      rankIndex={idx}
                      isWide={true}
                      onClick={() => onSelectJob(job.id)}
                      onTickSteps={() => onSelectJob(job.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Footer reassurance */}
          <div className="border-t border-[#F1F5F9] pt-3 mt-auto flex items-center justify-between text-[11px] text-[#64748B]">
            <span>
              {jobsData.completed_today_count > 0
                ? `${jobsData.completed_today_count} job${jobsData.completed_today_count > 1 ? 's' : ''} completed today`
                : 'Keep tracking steps to complete jobs on time'}
            </span>
            <button
              type="button"
              onClick={() => navigate('/jobs')}
              className="text-[#0F766E] font-semibold hover:underline cursor-pointer"
            >
              Open Jobs manager
            </button>
          </div>
        </Card>

        {/* Collection by Mode Card (4 Columns) */}
        <Card className="lg:col-span-4 p-5 sm:p-6 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between h-full">
          <div className="flex-1 flex flex-col space-y-3.5">
            <div className="flex items-center justify-between mb-1">
              <div>
                <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
                  Collection by mode
                </h2>
                <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
                  {period === 'THIS_MONTH' ? 'Summary for this month' : 'Shift-end cash handover summary'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/money?tab=receipts')}
                className="text-[12.5px] font-semibold text-[#0F766E] hover:underline cursor-pointer"
              >
                View receipts
              </button>
            </div>

            {/* Executive Cash Handover Box */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9] border-0 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#0F766E] uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Physical cash in hand
                </span>
                <span className="text-[10.5px] text-slate-500 font-medium bg-white px-2 py-0.5 rounded-md border-0 shadow-2xs">
                  Shift end
                </span>
              </div>
              <div className="text-[26px] sm:text-[28px] font-extrabold text-[#0F172A] tracking-tight tabular-nums">
                {formatINR(myCollection.cash)}
              </div>
              <p className="text-[11.5px] text-[#64748B] leading-snug">
                Hand over physical cash to the owner at the end of your shift.
              </p>
            </div>

            {/* Segmented Pill Bar matching Dashboard Receipts by mode */}
            <div className="h-2 flex w-full gap-1.5 mt-2 rounded-full overflow-hidden">
              {collectionTotal === 0 ? (
                <div className="h-full w-full bg-[#F1F5F9] rounded-full" />
              ) : (
                <>
                  {modePcts.cash > 0 && (
                    <div
                      className="h-full bg-[#111827] rounded-full transition-all duration-300"
                      style={{ flex: `${modePcts.cash} 0 0%`, minWidth: '6px' }}
                      title={`Cash: ${modePcts.cash}%`}
                    />
                  )}
                  {modePcts.upi > 0 && (
                    <div
                      className="h-full bg-[#0F766E] rounded-full transition-all duration-300"
                      style={{ flex: `${modePcts.upi} 0 0%`, minWidth: '6px' }}
                      title={`UPI: ${modePcts.upi}%`}
                    />
                  )}
                  {modePcts.bank > 0 && (
                    <div
                      className="h-full bg-[#3B82F6] rounded-full transition-all duration-300"
                      style={{ flex: `${modePcts.bank} 0 0%`, minWidth: '6px' }}
                      title={`Bank: ${modePcts.bank}%`}
                    />
                  )}
                  {modePcts.card > 0 && (
                    <div
                      className="h-full bg-[#8B5CF6] rounded-full transition-all duration-300"
                      style={{ flex: `${modePcts.card} 0 0%`, minWidth: '6px' }}
                      title={`Card: ${modePcts.card}%`}
                    />
                  )}
                </>
              )}
            </div>

            {/* Detailed Mode Breakdown List with Clean Borderless Tiles */}
            <div className="space-y-2.5 pt-1 text-[12.5px]">
              {/* Cash */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/70 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#111827]" />
                  <span className="text-[#374151] font-semibold flex items-center gap-1.5 text-xs">
                    <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                    Cash
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#64748B] tabular-nums font-medium bg-white px-1.5 py-0.5 rounded shadow-2xs">
                    {modePcts.cash}%
                  </span>
                  <span className="font-bold text-[#111827] tabular-nums text-xs">
                    {formatINR(myCollection.cash)}
                  </span>
                </div>
              </div>

              {/* UPI */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/70 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#0F766E]" />
                  <span className="text-[#374151] font-semibold flex items-center gap-1.5 text-xs">
                    <QrCode className="w-3.5 h-3.5 text-[#0F766E]" />
                    UPI / QR
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#64748B] tabular-nums font-medium bg-white px-1.5 py-0.5 rounded shadow-2xs">
                    {modePcts.upi}%
                  </span>
                  <span className="font-bold text-[#111827] tabular-nums text-xs">
                    {formatINR(myCollection.upi)}
                  </span>
                </div>
              </div>

              {/* Bank */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/70 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#3B82F6]" />
                  <span className="text-[#374151] font-semibold flex items-center gap-1.5 text-xs">
                    <Building className="w-3.5 h-3.5 text-blue-600" />
                    Bank / Cheque
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#64748B] tabular-nums font-medium bg-white px-1.5 py-0.5 rounded shadow-2xs">
                    {modePcts.bank}%
                  </span>
                  <span className="font-bold text-[#111827] tabular-nums text-xs">
                    {formatINR(myCollection.bank)}
                  </span>
                </div>
              </div>

              {/* Card */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/70 hover:bg-slate-50 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
                  <span className="text-[#374151] font-semibold flex items-center gap-1.5 text-xs">
                    <CreditCard className="w-3.5 h-3.5 text-purple-600" />
                    Card
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#64748B] tabular-nums font-medium bg-white px-1.5 py-0.5 rounded shadow-2xs">
                    {modePcts.card}%
                  </span>
                  <span className="font-bold text-[#111827] tabular-nums text-xs">
                    {formatINR(myCollection.card)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Total Row Footer */}
          <div className="border-t border-[#F1F5F9] pt-3 mt-auto flex items-center justify-between text-xs">
            <span className="font-semibold text-[#111827]">Total Collected</span>
            <span className="font-bold text-[#111827] text-sm tabular-nums">
              {formatINR(myCollection.total)}
            </span>
          </div>
        </Card>
      </div>

      {/* ======================================================== */}
      {/* ROW 3: RECENT BILLS (LEFT 8 COLS) & BILLS ACTIVITY (RIGHT 4 COLS) */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Recent Bills Card (8 Columns) */}
        <Card className="lg:col-span-8 p-5 sm:p-6 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between h-full">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9]">
              <div>
                <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
                  My recent bills
                </h2>
                <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
                  Bills created by you in SIMPLIFY
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/bills')}
                className="text-[12.5px] sm:text-[13px] font-semibold text-[#0F766E] hover:text-[#0D655E] hover:underline flex items-center gap-0.5 cursor-pointer"
              >
                <span>View all</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {recentBills.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#6B7280]">
                No bills created yet. Click "+ New bill" to create your first bill.
              </div>
            ) : (
              <div className="overflow-x-auto pt-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#F1F5F9] text-[11.5px] font-medium text-[#64748B] uppercase tracking-wider">
                      <th className="py-2.5 font-medium">Bill</th>
                      <th className="py-2.5 font-medium">Customer</th>
                      <th className="py-2.5 font-medium text-right">Amount</th>
                      <th className="py-2.5 font-medium text-left pl-6">Status</th>
                      <th className="py-2.5 font-medium text-right">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#F8FAFC] text-[13px]">
                    {recentBills.map((bill: any, idx: number) => {
                      const bal = Number(bill.balance || 0);
                      const isPaid = bill.status === 'ACTIVE' && bal <= 0;
                      const isPartial = bill.status === 'ACTIVE' && bal > 0 && Number(bill.paid_amount || 0) > 0;
                      const isCancelled = bill.status === 'CANCELLED';

                      return (
                        <tr
                          key={bill.id || idx}
                          onClick={() => onSelectBill(bill.id)}
                          className="hover:bg-[#F8FAFC] transition-colors cursor-pointer group"
                        >
                          <td className="py-2.5 font-mono font-medium text-[#111827] group-hover:text-[#0F766E] transition-colors">
                            #{bill.number}
                          </td>
                          <td className="py-2.5 text-[#334155] max-w-[150px] truncate">
                            {bill.party_name || 'Walk-in'}
                          </td>
                          <td className="py-2.5 text-right font-semibold text-[#0F172A] tabular-nums">
                            {formatINR(bill.total)}
                          </td>
                          <td className="py-2.5 pl-6">
                            <div className="flex items-center gap-1.5">
                              <span
                                className={clsx(
                                  'w-1.5 h-1.5 rounded-full shrink-0',
                                  isCancelled
                                    ? 'bg-[#9CA3AF]'
                                    : isPaid
                                    ? 'bg-[#16A34A]'
                                    : isPartial
                                    ? 'bg-[#D97706]'
                                    : 'bg-[#64748B]'
                                )}
                              />
                              <span
                                className={clsx(
                                  'text-[12px] font-medium',
                                  isCancelled
                                    ? 'text-[#9CA3AF]'
                                    : isPaid
                                    ? 'text-[#16A34A]'
                                    : isPartial
                                    ? 'text-[#D97706]'
                                    : 'text-[#64748B]'
                                )}
                              >
                                {isCancelled
                                  ? 'Cancelled'
                                  : isPaid
                                  ? 'Paid'
                                  : isPartial
                                  ? `Due ${formatINR(bal)}`
                                  : 'Unpaid'}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 text-right text-[12px] text-[#64748B] tabular-nums">
                            {formatDate(bill.invoice_date)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Footer reassurance */}
          <div className="border-t border-[#F1F5F9] pt-3 mt-auto flex items-center justify-between text-[11px] text-[#64748B]">
            <span>
              {recentBills.length > 0
                ? `Showing your recent ${recentBills.length} bill${recentBills.length !== 1 ? 's' : ''}`
                : 'Fast billing for walk-in and regular customers'}
            </span>
            <button
              type="button"
              onClick={() => navigate('/bills/new')}
              className="text-[#0F766E] font-semibold hover:underline flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>New bill</span>
            </button>
          </div>
        </Card>

        {/* Bills Per Day Activity Card (4 Columns) */}
        <Card className="lg:col-span-4 p-5 sm:p-6 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between h-full">
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
                  My daily activity
                </h2>
                <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
                  Bills created by you per day this month
                </p>
              </div>
              <span className="text-[11.5px] font-semibold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full">
                {totalMonthBills} bills
              </span>
            </div>

            {billsPerDay.length === 0 ? (
              <div className="py-12 text-center text-xs text-[#6B7280]">
                No activity recorded for this month yet.
              </div>
            ) : (
              <div className="pt-6 pb-1">
                <div className="relative px-2">
                  {/* Floating Tooltip Pill for hovered day */}
                  {billsPerDay[hoveredDayIndex] && (
                    <div
                      className="absolute -top-7 -translate-x-1/2 bg-[#0F172A] text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-md shadow-md pointer-events-none transition-all duration-150 z-20 whitespace-nowrap"
                      style={{
                        left: `${Math.max(
                          16,
                          Math.min(
                            84,
                            ((hoveredDayIndex + 0.5) / billsPerDay.length) * 100
                          )
                        )}%`,
                      }}
                    >
                      {billsPerDay[hoveredDayIndex].date_label} ·{' '}
                      {billsPerDay[hoveredDayIndex].bills_count} bill
                      {billsPerDay[hoveredDayIndex].bills_count !== 1 ? 's' : ''} (
                      {formatINR(billsPerDay[hoveredDayIndex].bills_amount)})
                    </div>
                  )}

                  {/* Slim Vertical Bars */}
                  <div className="h-[145px] w-full flex items-end justify-between border-b border-[#F1F5F9] pb-0.5 gap-[3px]">
                    {billsPerDay.map((d: any, idx: number) => {
                      const count = Number(d.bills_count || 0);
                      const heightPercent = Math.max(
                        8,
                        Math.round((count / maxBillsCount) * 100)
                      );
                      const isHovered = hoveredDayIndex === idx;

                      return (
                        <div
                          key={idx}
                          onMouseEnter={() => setHoveredDayIndex(idx)}
                          className="flex-1 min-w-[6px] h-full flex items-end justify-center cursor-pointer group py-0.5"
                        >
                          <div
                            className={clsx(
                              'w-full max-w-[8px] rounded-full transition-all duration-150',
                              isHovered
                                ? 'bg-[#0F766E]'
                                : count > 0
                                ? 'bg-[#0F766E] shadow-[0_0_6px_rgba(15,118,110,0.3)]'
                                : 'bg-[#E2E8F0] group-hover:bg-[#CBD5E1]'
                            )}
                            style={{ height: `${heightPercent}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>

                  {/* X Axis Labels */}
                  <div className="flex items-center justify-between text-[11px] text-[#64748B] mt-2.5">
                    <span>{billsPerDay[0]?.date_label}</span>
                    <span>
                      {billsPerDay[Math.floor(billsPerDay.length / 2)]?.date_label}
                    </span>
                    <span>{billsPerDay[billsPerDay.length - 1]?.date_label}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer reassurance */}
          <div className="border-t border-[#F1F5F9] pt-3 mt-auto flex items-center justify-between text-[11px] text-[#64748B]">
            <span>Activity across past {billsPerDay.length} days</span>
            <span className="font-semibold text-[#111827]">
              {totalMonthBills} bills this month
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
};
