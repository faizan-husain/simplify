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
import { ThreeDPieChart, ThreeDPieSlice } from '../ui/ThreeDPieChart';

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
  const recentBills = data?.my_recent_bills || [];
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

  const [hoveredServiceIdx, setHoveredServiceIdx] = useState<number | null>(null);

  const topServicesData = useMemo(() => {
    const raw = data?.top_services;
    const palette = ['#0F766E', '#0284C7', '#0F172A', '#E11D48', '#D97706'];

    if (raw && Array.isArray(raw) && raw.length > 0 && raw.some((item: any) => Number(item.count || 0) > 0)) {
      const validItems = raw.filter((item: any) => Number(item.count || 0) > 0);
      const totalCount = validItems.reduce((sum: number, item: any) => sum + Number(item.count || 0), 0);

      if (totalCount === 0) {
        return {
          hasData: false,
          totalBills: 0,
          services: [],
        };
      }

      const services: ThreeDPieSlice[] = validItems.slice(0, 5).map((item: any, idx: number) => {
        const count = Number(item.count || 0);
        const percentage = Math.round((count / totalCount) * 100);
        return {
          name: item.name || 'Service',
          count,
          color: palette[idx % palette.length],
          percentage,
        };
      });

      return {
        hasData: true,
        totalBills: totalCount,
        services,
      };
    }

    return {
      hasData: false,
      totalBills: 0,
      services: [
        { name: 'No services billed yet', count: 0, color: '#E2E8F0', percentage: 0 },
      ],
    };
  }, [data?.top_services]);

  return (
    <div className="space-y-5">
      {/* ======================================================== */}
      {/* ROW 1: 3 STAT CARDS MATCHING MAIN DASHBOARD EXACTLY */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Bills */}
        <StatCard
          label={period === 'THIS_MONTH' ? 'Bills This Month' : 'Bills Today'}
          value={myBills.count}
          secondaryLine={
            <div className="flex items-center justify-between text-xs text-[#6B7280] w-full pt-1.5 border-t border-[#F1F5F9]">
              <span>Total bill value</span>
              <span className="font-semibold text-[#111827] tabular-nums">
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
          secondaryLine={
            <div className="flex items-center justify-between text-xs text-[#6B7280] w-full pt-1.5 border-t border-[#F1F5F9]">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                <span>Cash in hand</span>
              </span>
              <span className="font-bold text-emerald-700 tabular-nums">
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
              : `Earned ${formatINR(myEarnings.total_earned)}`,
          }}
          secondaryLine={
            <div className="flex items-center justify-between text-xs text-[#6B7280] w-full pt-1.5 border-t border-[#F1F5F9]">
              <span>{isSalaried ? 'Monthly compensation' : 'Earned this period'}</span>
              <span className="font-semibold text-[#111827] tabular-nums">
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
        <Card className="lg:col-span-8 p-5 sm:p-6 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between">
          <div>
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
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-200/80">
                    {jobsData.late_count} Overdue
                  </span>
                )}
                {jobsData.red_count > 0 && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-md bg-red-50 text-red-700 border border-red-200/80">
                    {jobsData.red_count} Red
                  </span>
                )}
                {jobsData.yellow_count > 0 && (
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200/80">
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
          <div className="border-t border-[#F1F5F9] pt-2.5 mt-2 flex items-center justify-between text-[11px] text-[#64748B]">
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
        <Card className="lg:col-span-4 p-5 sm:p-6 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
                  Collection by mode
                </h2>
                <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
                  {period === 'THIS_MONTH' ? 'Summary for this month' : 'Shift-end cash handover summary'}
                </p>
              </div>
              <span className="text-[11.5px] font-semibold text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-full">
                {period === 'THIS_MONTH' ? 'This month' : 'Today'}
              </span>
            </div>

            {/* Executive Cash Handover Box */}
            <div className="p-4 rounded-xl bg-gradient-to-br from-[#F8FAFC] to-[#F1F5F9] border border-[#E2E8F0] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#0F766E] uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Physical cash in hand
                </span>
                <span className="text-[10.5px] text-slate-500 font-medium bg-white px-2 py-0.5 rounded-md border border-slate-200/80">
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
            <div className="h-2 flex w-full gap-1.5 mt-3.5 rounded-full overflow-hidden">
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

            {/* Detailed Mode Breakdown List */}
            <div className="space-y-2.5 pt-3 text-[12.5px]">
              {/* Cash */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#111827]" />
                  <span className="text-[#374151] font-medium flex items-center gap-1.5">
                    <Banknote className="w-3.5 h-3.5 text-emerald-600" />
                    Cash
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-[#64748B] tabular-nums">
                    {modePcts.cash}%
                  </span>
                  <span className="font-semibold text-[#111827] tabular-nums">
                    {formatINR(myCollection.cash)}
                  </span>
                </div>
              </div>

              {/* UPI */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#0F766E]" />
                  <span className="text-[#374151] font-medium flex items-center gap-1.5">
                    <QrCode className="w-3.5 h-3.5 text-[#0F766E]" />
                    UPI / QR
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-[#64748B] tabular-nums">
                    {modePcts.upi}%
                  </span>
                  <span className="font-semibold text-[#111827] tabular-nums">
                    {formatINR(myCollection.upi)}
                  </span>
                </div>
              </div>

              {/* Bank */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#3B82F6]" />
                  <span className="text-[#374151] font-medium flex items-center gap-1.5">
                    <Building className="w-3.5 h-3.5 text-blue-600" />
                    Bank / Cheque
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-[#64748B] tabular-nums">
                    {modePcts.bank}%
                  </span>
                  <span className="font-semibold text-[#111827] tabular-nums">
                    {formatINR(myCollection.bank)}
                  </span>
                </div>
              </div>

              {/* Card */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
                  <span className="text-[#374151] font-medium flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5 text-purple-600" />
                    Card
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] text-[#64748B] tabular-nums">
                    {modePcts.card}%
                  </span>
                  <span className="font-semibold text-[#111827] tabular-nums">
                    {formatINR(myCollection.card)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Total Row Footer */}
          <div className="border-t border-[#F1F5F9] pt-2.5 mt-3 flex items-center justify-between text-xs">
            <span className="font-semibold text-[#111827]">Total Collected</span>
            <span className="font-bold text-[#111827] text-sm tabular-nums">
              {formatINR(myCollection.total)}
            </span>
          </div>
        </Card>
      </div>

      {/* ======================================================== */}
      {/* ROW 3: TOP SERVICES (LEFT 6 COLS) & BILLS ACTIVITY (RIGHT 6 COLS) */}
      {/* ======================================================== */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Top Services Card (6 Columns) */}
        <Card className="lg:col-span-6 p-5 sm:p-6 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
                  Top services
                </h2>
                <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
                  By bills · {period === 'THIS_MONTH' ? 'This month' : 'Today'}
                </p>
              </div>
              <span
                className={clsx(
                  'text-[12px] font-semibold px-2.5 py-0.5 rounded-full',
                  topServicesData.hasData
                    ? 'text-[#0F766E] bg-[#E6F4F2]'
                    : 'text-[#64748B] bg-[#F1F5F9]'
                )}
              >
                {topServicesData.totalBills} total
              </span>
            </div>

            {/* 3D Isometric Pie Chart + Top Services List */}
            <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 pt-1">
              {/* Left Column: 3D Pie Chart */}
              <div className="w-[140px] sm:w-[155px] flex flex-col items-center shrink-0">
                <ThreeDPieChart
                  data={topServicesData.services}
                  totalBills={topServicesData.totalBills}
                  hoveredIdx={hoveredServiceIdx}
                  onHover={setHoveredServiceIdx}
                  className="w-full h-[98px] sm:h-[108px]"
                />

                {/* Outside Underneath 3D Chart: Service Name Pill Badge */}
                <div className="mt-1 h-[26px] w-[140px] sm:w-[155px] flex items-center justify-center">
                  {hoveredServiceIdx !== null && topServicesData.hasData ? (
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold truncate transition-all duration-400 ease-out max-w-full shadow-xs border"
                      style={{
                        backgroundColor: `${topServicesData.services[hoveredServiceIdx].color}14`,
                        borderColor: `${topServicesData.services[hoveredServiceIdx].color}30`,
                        color: topServicesData.services[hoveredServiceIdx].color,
                      }}
                      title={topServicesData.services[hoveredServiceIdx].name}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0 shadow-xs"
                        style={{ backgroundColor: topServicesData.services[hoveredServiceIdx].color }}
                      />
                      <span className="truncate">
                        {topServicesData.services[hoveredServiceIdx].name}
                      </span>
                    </span>
                  ) : topServicesData.hasData ? (
                    <span className="text-[10px] text-[#94A3B8] font-medium tracking-wide transition-opacity duration-400">
                      Hover slice to inspect
                    </span>
                  ) : (
                    <span className="text-[10px] text-[#94A3B8] font-medium">
                      No bills
                    </span>
                  )}
                </div>
              </div>

              {/* Right Column: Services List */}
              <div className="flex-1 min-w-0 space-y-1 w-full">
                {topServicesData.services.map((item, idx) => {
                  const isHovered = hoveredServiceIdx === idx;
                  const isAnyHovered = hoveredServiceIdx !== null;
                  return (
                    <div
                      key={idx}
                      onMouseEnter={() => topServicesData.hasData && setHoveredServiceIdx(idx)}
                      onMouseLeave={() => topServicesData.hasData && setHoveredServiceIdx(null)}
                      className={clsx(
                        'px-2 py-1 rounded-lg transition-all duration-500 ease-out border',
                        topServicesData.hasData ? 'cursor-pointer' : 'cursor-default',
                        isHovered && topServicesData.hasData
                          ? 'bg-[#F1F5F9]/80 border-slate-200/60 shadow-xs'
                          : isAnyHovered && topServicesData.hasData
                          ? 'opacity-40 border-transparent'
                          : 'border-transparent hover:bg-[#F8FAFC]'
                      )}
                    >
                      <div className="flex items-center justify-between text-[11.5px] sm:text-[12px] gap-2">
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span
                            className={clsx(
                              'w-2 h-2 rounded-full shrink-0 transition-transform duration-500',
                              isHovered ? 'scale-125 shadow-xs' : 'scale-100'
                            )}
                            style={{
                              backgroundColor: topServicesData.hasData ? item.color : '#CBD5E1',
                            }}
                          />
                          <span className="font-semibold text-[#0F172A] truncate" title={item.name}>
                            {item.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-right shrink-0">
                          <span className="text-[10.5px] sm:text-[11px] text-[#64748B] tabular-nums whitespace-nowrap">
                            {item.count} bill{item.count !== 1 ? 's' : ''}
                          </span>
                          <span className="font-bold text-[#0F172A] tabular-nums w-8 text-right">
                            {item.percentage}%
                          </span>
                        </div>
                      </div>

                      {/* Micro Progress Bar */}
                      <div className="h-1 w-full bg-[#F1F5F9] rounded-full overflow-hidden mt-1">
                        <div
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{
                            width: `${item.percentage}%`,
                            backgroundColor: topServicesData.hasData ? item.color : '#E2E8F0',
                            opacity: !isAnyHovered || isHovered ? 1 : 0.35,
                            boxShadow: isHovered ? `0 0 6px ${item.color}80` : 'none',
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Footer reassurance */}
          <div className="border-t border-[#F1F5F9] pt-2.5 mt-2 flex items-center justify-between text-[11px] text-[#64748B]">
            <span>Demand share calculated from bills</span>
            <button
              type="button"
              onClick={() => navigate('/services')}
              className="text-[#0F766E] font-semibold hover:underline cursor-pointer"
            >
              View services
            </button>
          </div>
        </Card>

        {/* Bills Per Day Activity Card (6 Columns) */}
        <Card className="lg:col-span-6 p-5 sm:p-6 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
                  Daily billing activity
                </h2>
                <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
                  Bills created across this month
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
          <div className="border-t border-[#F1F5F9] pt-2.5 mt-2 flex items-center justify-between text-[11px] text-[#64748B]">
            <span>Activity across past {billsPerDay.length} days</span>
            <span className="font-semibold text-[#111827]">
              {totalMonthBills} bills this month
            </span>
          </div>
        </Card>
      </div>

      {/* ======================================================== */}
      {/* ROW 4: RECENT BILLS TABLE (FULL-WIDTH 12 COLS) */}
      {/* ======================================================== */}
      <Card className="p-5 sm:p-6 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between pb-3 border-b border-[#F1F5F9]">
            <div>
              <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
                Recent bills
              </h2>
              <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
                Latest bills created in SIMPLIFY
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
        <div className="border-t border-[#F1F5F9] pt-2.5 mt-2 flex items-center justify-between text-[11px] text-[#64748B]">
          <span>
            {recentBills.length > 0
              ? `Showing latest ${recentBills.length} bill${recentBills.length !== 1 ? 's' : ''}`
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
    </div>
  );
};
