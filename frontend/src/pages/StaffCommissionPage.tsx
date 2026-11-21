import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate, formatInputDate } from '../lib/dates';
import { getErrorMessage } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { PayStaffModal } from '../components/staff/PayStaffModal';
import { ConfigurePayTypeModal } from '../components/staff/ConfigurePayTypeModal';
import { JobDetailModal } from '../components/jobs/JobDetailModal';
import { StaffEarningsStatement } from '../components/staff/StaffEarningsStatement';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { FilterChips } from '../components/mobile/FilterChips';
import {
  Calendar,
  User,
  Clock,
  ChevronRight,
  CreditCard,
  Settings,
  Search,
  BarChart3,
} from 'lucide-react';

type PeriodType = 'TODAY' | 'THIS_MONTH' | 'THIS_FY';

function getPeriodDateRange(period: PeriodType) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11

  if (period === 'TODAY') {
    const todayStr = formatInputDate(now);
    return { from: todayStr, to: todayStr };
  } else if (period === 'THIS_MONTH') {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    return { from: formatInputDate(firstDay), to: formatInputDate(lastDay) };
  } else {
    // THIS_FY (India: 1 Apr to 31 Mar)
    const m = month + 1; // 1-12
    const fyStartYear = m >= 4 ? year : year - 1;
    const firstDay = new Date(fyStartYear, 3, 1); // 1 Apr
    const lastDay = new Date(fyStartYear + 1, 2, 31); // 31 Mar
    return { from: formatInputDate(firstDay), to: formatInputDate(lastDay) };
  }
}

export const StaffCommissionPage: React.FC = () => {
  const navigate = useNavigate();
  const { role, member } = useAuth();
  const { showToast } = useToast();

  const isOwner = role === 'OWNER';
  const isStaff = role === 'STAFF';

  // Screen 1 & Screen 3 Period Toggle: default 'THIS_MONTH'
  const [period, setPeriod] = useState<PeriodType>('THIS_MONTH');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Overall summary
  const [summary, setSummary] = useState({
    total_earned: 0,
    total_paid: 0,
    balance_payable: 0,
    upcoming: 0,
    staff: [] as any[],
  });

  // For Staff's own screen (Screen 3)
  const [staffDrilldown, setStaffDrilldown] = useState<any>({
    entries: [],
    payouts: [],
    salary_months: [],
    total_due: 0,
    total_paid: 0,
    balance_payable: 0,
    upcoming: 0,
    compensation_type: 'COMMISSION',
    monthly_salary: 0,
  });
  const [staffActiveTab, setStaffActiveTab] = useState<'jobs' | 'salary_months' | 'payouts' | 'history'>('jobs');
  const [earningsHistory, setEarningsHistory] = useState<any>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [selectedStaffJobId, setSelectedStaffJobId] = useState<string | null>(null);
  const [staffJobModalOpen, setStaffJobModalOpen] = useState(false);

  // Modals for Owner
  const [targetStaffForPayout, setTargetStaffForPayout] = useState<any | null>(null);
  const [payStaffModalOpen, setPayStaffModalOpen] = useState(false);

  const [targetStaffForConfig, setTargetStaffForConfig] = useState<any | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);

  const periodRange = getPeriodDateRange(period);

  const loadData = async () => {
    setLoading(true);
    try {
      const targetId = isStaff && member?.id ? member.id : null;

      // 1. Load summary
      const { data: sumData, error: sumError } = await supabase.rpc('staff_summary', {
        p_staff_id: targetId,
        p_from: periodRange.from,
        p_to: periodRange.to,
      });

      if (sumError) throw sumError;
      if (sumData) {
        setSummary(sumData);
      }

      // 2. If Staff role, also load their drilldown
      if (isStaff && member?.id) {
        const { data: drillData, error: drillError } = await supabase.rpc('staff_commission', {
          p_staff_id: member.id,
          p_period: 'ALL',
          p_from: periodRange.from,
          p_to: periodRange.to,
        });
        if (drillError) throw drillError;
        if (drillData) {
          setStaffDrilldown(drillData);
          if (drillData.compensation_type === 'SALARY') {
            setStaffActiveTab('salary_months');
          }
        }

        // 3. Load full monthly & FY earnings history report
        setLoadingHistory(true);
        try {
          const { data: histData, error: histError } = await supabase.rpc('staff_earnings_history', {
            p_staff_id: member.id,
          });
          if (!histError && histData) {
            setEarningsHistory(histData);
          }
        } catch (hErr) {
          console.error('Failed to load earnings history:', hErr);
        } finally {
          setLoadingHistory(false);
        }
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [period]);

  const handleOpenPay = (st?: any) => {
    setTargetStaffForPayout(st || null);
    setPayStaffModalOpen(true);
  };

  const handleOpenDetail = (st: any) => {
    navigate(`/staff/${st.id}`);
  };

  const handleOpenConfig = (st: any) => {
    setTargetStaffForConfig(st);
    setConfigModalOpen(true);
  };

  // Filtered staff list (strictly STAFF, never Owner)
  const filteredStaff = summary.staff.filter((s) => {
    if (s.role !== 'STAFF') return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.mobile && s.mobile.includes(q))
    );
  });

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            {isStaff ? 'My Staff & Commission' : 'Staff & Commission'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {isStaff
              ? 'Track your completed jobs, salary accruals, and payouts'
              : 'Track staff performance, salary accruals, commissions, and payouts'}
          </p>
        </div>

        {/* Period Toggle & Actions: Desktop */}
        <div className="hidden sm:flex items-center gap-2">
          <SegmentedControl
            value={period}
            onChange={(val) => setPeriod(val as PeriodType)}
            options={[
              { label: 'Today', value: 'TODAY' },
              { label: 'This month', value: 'THIS_MONTH' },
              { label: 'This FY', value: 'THIS_FY' },
            ]}
          />

          {isOwner && (
            <button
              type="button"
              onClick={() => handleOpenPay()}
              className="h-9 px-3.5 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer ml-1 transition-all"
            >
              <CreditCard className="w-3.5 h-3.5" />
              <span>Pay Staff</span>
            </button>
          )}
        </div>
      </div>

      {/* Period Toggle & Actions: Mobile (sm:hidden) */}
      <div className="sm:hidden flex items-center justify-between gap-2">
        <FilterChips
          value={period}
          onChange={(val) => setPeriod(val as PeriodType)}
          options={[
            { label: 'Today', value: 'TODAY' },
            { label: 'This month', value: 'THIS_MONTH' },
            { label: 'This FY', value: 'THIS_FY' },
          ]}
        />

        {isOwner && (
          <button
            type="button"
            onClick={() => handleOpenPay()}
            className="h-9 px-3.5 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs flex items-center gap-1.5 cursor-pointer shrink-0 transition-all"
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Pay</span>
          </button>
        )}
      </div>

      {/* Mobile Top Summary (md:hidden) */}
      <div className="md:hidden space-y-2.5">
        {/* Number 3: Balance payable (Primary Highlight) */}
        <div className="bg-white border-0 rounded-2xl p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Balance Payable
            </span>
            <span className="text-[10px] text-slate-400">Net pending payout</span>
          </div>
          <div
            className={`text-2xl font-extrabold tabular-nums tracking-tight mt-1 ${
              summary.balance_payable > 0 ? 'text-rose-600' : 'text-slate-900'
            }`}
          >
            {formatINR(summary.balance_payable)}
          </div>
        </div>

        {/* Numbers 1 & 2: Total earned & Paid in 2-col grid */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="bg-white border-0 rounded-2xl p-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
              Total Earned
            </span>
            <div className="text-base font-bold text-slate-800 tabular-nums mt-0.5">
              {formatINR(
                filteredStaff.reduce((sum, s) => sum + Number(s.all_time_due ?? s.earned ?? 0), 0)
              )}
            </div>
            <span className="text-[9.5px] text-slate-400 block mt-0.5">All-time accrued</span>
          </div>

          <div className="bg-white border-0 rounded-2xl p-3.5 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
            <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider block">
              Paid
            </span>
            <div className="text-base font-bold text-slate-800 tabular-nums mt-0.5">
              {formatINR(
                filteredStaff.reduce((sum, s) => sum + Number(s.all_time_paid ?? s.paid ?? 0), 0)
              )}
            </div>
            <span className="text-[9.5px] text-slate-400 block mt-0.5">Disbursed payouts</span>
          </div>
        </div>
      </div>

      {/* Desktop Top Summary (hidden md:block) */}
      <div className="hidden md:block bg-white border-0 rounded-2xl p-4 sm:p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
        <div className="grid grid-cols-3 gap-2 sm:gap-6 divide-x divide-slate-100">
          {/* Number 1: Total earned / due */}
          <div className="pr-2 sm:pr-4">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
              Total earned
            </span>
            <div className="text-lg sm:text-2xl font-bold text-slate-800 tabular-nums mt-1">
              {formatINR(
                filteredStaff.reduce((sum, s) => sum + Number(s.all_time_due ?? s.earned ?? 0), 0)
              )}
            </div>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              All-time accrued
            </span>
          </div>

          {/* Number 2: Paid */}
          <div className="px-3 sm:px-6">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
              Paid
            </span>
            <div className="text-lg sm:text-2xl font-bold text-slate-800 tabular-nums mt-1">
              {formatINR(
                filteredStaff.reduce((sum, s) => sum + Number(s.all_time_paid ?? s.paid ?? 0), 0)
              )}
            </div>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              Disbursed payouts
            </span>
          </div>

          {/* Number 3: Balance payable (SABSE BADA NUMBER) */}
          <div className="pl-3 sm:pl-6">
            <span className="text-[11px] font-semibold text-slate-600 uppercase tracking-wider block">
              Balance payable
            </span>
            <div
              className={`text-2xl sm:text-3xl font-extrabold tabular-nums tracking-tight mt-0.5 ${
                summary.balance_payable > 0
                  ? 'text-rose-600'
                  : 'text-slate-900'
              }`}
            >
              {formatINR(summary.balance_payable)}
            </div>
            <span className="text-[10px] text-slate-400 block mt-0.5">
              Net pending payout
            </span>
          </div>
        </div>
      </div>

      {/* ============================================================== */}
      {/* SCREEN 1: Staff list for Owner */}
      {/* ============================================================== */}
      {!isStaff && (
        <div className="space-y-3">
          {/* Search bar & count */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search staff by name or mobile..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-11 pl-10 pr-3.5 text-xs sm:text-sm bg-white border-0 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#0F766E]/20 text-slate-800 placeholder:text-slate-400 font-medium focus:outline-none transition-all"
              />
            </div>
            <span className="text-xs text-slate-500 font-medium">
              {filteredStaff.length} {filteredStaff.length === 1 ? 'member' : 'members'}
            </span>
          </div>

          {loading ? (
            <div className="py-16 text-center text-xs text-slate-400">
              Loading staff accounts...
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="p-10 text-center space-y-2 bg-white rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <User className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="text-sm font-semibold text-slate-700">No staff members found</div>
              <p className="text-xs text-slate-400">
                Active staff members will appear here with their completed jobs, earned commissions or salaries.
              </p>
            </div>
          ) : (
            <div>
              {/* Mobile Staff Cards (md:hidden) */}
              <div className="md:hidden space-y-3">
                {filteredStaff.map((st) => {
                  const isSal = st.compensation_type === 'SALARY';
                  return (
                    <div
                      key={st.id}
                      onClick={() => handleOpenDetail(st)}
                      className="bg-white rounded-2xl p-3.5 space-y-2.5 shadow-2xs border border-border/70 cursor-pointer active:scale-[0.99] transition-all"
                    >
                      {/* Row 1: Name + Role / Badge & Balance */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center font-bold text-xs shrink-0">
                            {st.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-[15px] truncate">
                                {st.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span
                                className={`inline-flex items-center text-[10.5px] font-semibold px-2 py-0.5 rounded-full ${
                                  isSal ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
                                }`}
                              >
                                {isSal
                                  ? `Salary ₹${Number(st.monthly_salary || 0).toLocaleString('en-IN')}/mo`
                                  : 'Commission'}
                              </span>
                              {st.mobile && (
                                <span className="text-[12px] text-slate-400 font-mono">
                                  &middot; {st.mobile}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <div
                            className={`text-[16px] font-bold tabular-nums ${
                              st.balance > 0
                                ? 'text-rose-600'
                                : st.balance < 0
                                ? 'text-blue-600'
                                : 'text-slate-900'
                            }`}
                          >
                            {st.balance < 0
                              ? `Adv ₹${Math.abs(st.balance).toLocaleString('en-IN')}`
                              : formatINR(st.balance)}
                          </div>
                          <span className="text-[11px] text-slate-400 font-medium">Balance</span>
                        </div>
                      </div>

                      {/* Row 2: Stats Breakdown (Due, Paid, Jobs, Upcoming) */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[12px] text-slate-600">
                        <span>{isSal ? 'Due' : 'Earned'}: <strong className="font-semibold text-slate-900 tabular-nums">{formatINR(st.all_time_due ?? st.earned ?? 0)}</strong></span>
                        <span>Paid: <strong className="font-semibold text-slate-900 tabular-nums">{formatINR(st.all_time_paid ?? st.paid ?? 0)}</strong></span>
                        <span>Jobs: <strong className="font-semibold text-slate-900 tabular-nums">{st.jobs_done ?? st.jobs_done_total ?? 0}</strong></span>
                        {!isSal && st.upcoming > 0 && (
                          <span className="text-amber-600 font-medium">Up: <strong>{formatINR(st.upcoming)}</strong></span>
                        )}
                      </div>

                      {/* Row 3: Action Buttons (Owner only) */}
                      {isOwner && (
                        <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenConfig(st);
                            }}
                            className="h-9 px-3 rounded-xl bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <Settings className="w-3.5 h-3.5 text-slate-500" />
                            <span>Configure</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenPay(st);
                            }}
                            className="h-9 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors shadow-2xs"
                          >
                            <CreditCard className="w-3.5 h-3.5" />
                            <span>Pay Staff</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Desktop Staff List (hidden md:block) */}
              <div className="hidden md:block space-y-2.5">
                {filteredStaff.map((st) => {
                  const isSal = st.compensation_type === 'SALARY';
                  return (
                    <div
                      key={st.id}
                      onClick={() => handleOpenDetail(st)}
                      className="p-3.5 sm:p-4 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 transition-all cursor-pointer bg-white group"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        {/* Left Column: Staff Name & Subtitle label */}
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-slate-100 border-0 text-slate-800 flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
                            {st.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-sm truncate group-hover:text-[#0F766E] transition-colors">
                                {st.name}
                              </span>
                              <span
                                className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border-0 ${
                                  isSal
                                    ? 'bg-blue-50 text-blue-700'
                                    : 'bg-emerald-50 text-emerald-700'
                                }`}
                              >
                                {isSal
                                  ? `Salary ₹${Number(st.monthly_salary || 0).toLocaleString('en-IN')}/mo`
                                  : 'Commission'}
                              </span>
                            </div>
                            <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
                              {st.mobile && <span className="font-mono">{st.mobile}</span>}
                              <span>•</span>
                              <span>{st.role}</span>
                            </div>
                          </div>
                        </div>

                        {/* Middle Stats Columns: Jobs done · Earned/Due · Paid · Balance */}
                        <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-100">
                          {/* Jobs done */}
                          <div className="text-left sm:text-right">
                            <span className="text-[10px] text-slate-400 block uppercase font-medium">
                              Jobs done
                            </span>
                            <span className="font-bold text-slate-800 text-xs sm:text-sm tabular-nums">
                              {st.jobs_done ?? st.jobs_done_total ?? 0}
                            </span>
                          </div>

                          {/* Earned / Due */}
                          <div className="text-left sm:text-right">
                            <span className="text-[10px] text-slate-400 block uppercase font-medium">
                              {isSal ? 'Due' : 'Earned'}
                            </span>
                            <span className="font-bold text-slate-800 text-xs sm:text-sm tabular-nums">
                              {formatINR(st.all_time_due ?? st.earned ?? 0)}
                            </span>
                          </div>

                          {/* Paid */}
                          <div className="text-left sm:text-right">
                            <span className="text-[10px] text-slate-400 block uppercase font-medium">
                              Paid
                            </span>
                            <span className="font-bold text-slate-800 text-xs sm:text-sm tabular-nums">
                              {formatINR(st.all_time_paid ?? st.paid ?? 0)}
                            </span>
                          </div>

                          {/* Balance (Earned - Paid, bold) */}
                          <div className="text-left sm:text-right min-w-[70px]">
                            <span className="text-[10px] text-slate-500 block uppercase font-semibold">
                              Balance
                            </span>
                            <span
                              className={`font-extrabold text-xs sm:text-sm tabular-nums ${
                                st.balance > 0
                                  ? 'text-rose-600'
                                  : st.balance < 0
                                  ? 'text-blue-600'
                                  : 'text-slate-700'
                              }`}
                            >
                              {st.balance < 0
                                ? `Adv ₹${Math.abs(st.balance).toLocaleString('en-IN')}`
                                : formatINR(st.balance)}
                            </span>
                          </div>

                          {/* Upcoming (after Balance, amount in yellow/amber text) */}
                          {!isSal && (
                            <div className="text-left sm:text-right min-w-[65px]">
                              <span className="text-[10px] text-slate-400 block uppercase font-medium">
                                Upcoming
                              </span>
                              <span className="font-bold text-amber-500 text-xs sm:text-sm tabular-nums">
                                {formatINR(st.upcoming || 0)}
                              </span>
                            </div>
                          )}

                          {/* Action buttons (Owner only) */}
                          {isOwner && (
                            <div className="flex items-center gap-1.5 shrink-0 pl-1">
                              <button
                                type="button"
                                title="Configure Pay Type"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenConfig(st);
                                }}
                                className="p-1.5 rounded-lg border-0 bg-slate-100 text-slate-600 hover:text-slate-900 hover:bg-slate-200 transition-colors cursor-pointer"
                              >
                                <Settings className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleOpenPay(st);
                                }}
                                className="h-8 text-xs font-semibold px-3 rounded-lg border-0 bg-slate-900 hover:bg-slate-800 text-white cursor-pointer transition-all shadow-2xs"
                              >
                                Pay
                              </button>
                            </div>
                          )}

                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-600 transition-colors shrink-0 hidden sm:block" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ============================================================== */}
      {/* SCREEN 3: Staff's own view (when logged in as STAFF) */}
      {/* ============================================================== */}
      {isStaff && (
        <div className="space-y-4">
          {/* Staff Info Banner */}
          <div className="p-4 bg-white border-0 rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-900 text-base">
                  {member?.name || 'Staff Member'}
                </span>
                <span
                  className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full border-0 ${
                    staffDrilldown.compensation_type === 'SALARY'
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {staffDrilldown.compensation_type === 'SALARY'
                    ? `Fixed Salary: ₹${Number(staffDrilldown.monthly_salary || 0).toLocaleString('en-IN')}/mo`
                    : 'Commission Based'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {staffDrilldown.compensation_type === 'SALARY'
                  ? 'Salaried staff · monthly fixed salary. No commission on jobs.'
                  : 'Commission earned when assigned jobs are completed.'}
              </p>
            </div>

            {staffDrilldown.compensation_type !== 'SALARY' && staffDrilldown.upcoming > 0 && (
              <div className="p-2.5 bg-amber-50 border-0 shadow-2xs rounded-xl text-xs text-amber-800 flex items-center gap-2 self-start sm:self-auto">
                <Clock className="w-4 h-4 text-amber-600 shrink-0" />
                <span>
                  Upcoming: <strong>{formatINR(staffDrilldown.upcoming)}</strong> on ongoing jobs
                </span>
              </div>
            )}
          </div>

          {/* Subtabs for Staff: Mobile (md:hidden) */}
          <div className="md:hidden">
            <FilterChips
              value={staffActiveTab}
              onChange={(val) => setStaffActiveTab(val as any)}
              options={[
                ...(staffDrilldown.compensation_type === 'SALARY'
                  ? [{ value: 'salary_months', label: `My Salary (${staffDrilldown.salary_months?.length || 0})` }]
                  : []),
                { value: 'jobs', label: `My Jobs (${staffDrilldown.entries?.length || 0})` },
                { value: 'payouts', label: `Payments (${staffDrilldown.payouts?.length || 0})` },
                { value: 'history', label: 'Statement' },
              ]}
            />
          </div>

          {/* Subtabs for Staff: Desktop (hidden md:flex) */}
          <div className="hidden md:flex gap-4 border-b border-slate-100 pb-2">
            {staffDrilldown.compensation_type === 'SALARY' ? (
              <button
                type="button"
                onClick={() => setStaffActiveTab('salary_months')}
                className={`text-xs font-semibold pb-1 border-b-2 transition-all cursor-pointer ${
                  staffActiveTab === 'salary_months'
                    ? 'border-slate-900 text-slate-900 font-bold'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                My Salary ({staffDrilldown.salary_months?.length || 0})
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setStaffActiveTab('jobs')}
              className={`text-xs font-semibold pb-1 border-b-2 transition-all cursor-pointer ${
                staffActiveTab === 'jobs'
                  ? 'border-slate-900 text-slate-900 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              My Completed Jobs ({staffDrilldown.entries?.length || 0})
            </button>

            <button
              type="button"
              onClick={() => setStaffActiveTab('payouts')}
              className={`text-xs font-semibold pb-1 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                staffActiveTab === 'payouts'
                  ? 'border-slate-900 text-slate-900 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Payments Received ({staffDrilldown.payouts?.length || 0})
            </button>

            <button
              type="button"
              onClick={() => setStaffActiveTab('history')}
              className={`text-xs font-semibold pb-1 border-b-2 transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                staffActiveTab === 'history'
                  ? 'border-slate-900 text-slate-900 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Monthly & FY Statement</span>
            </button>
          </div>

          {/* Tab 1: Salary Months (for Salaried Staff) */}
          {staffActiveTab === 'salary_months' && (
            <div className="space-y-2">
              {(!staffDrilldown.salary_months || staffDrilldown.salary_months.length === 0) ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No salary months recorded yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] rounded-2xl overflow-hidden bg-white">
                  {staffDrilldown.salary_months.map((m: any, idx: number) => (
                    <div
                      key={idx}
                      className="p-3.5 flex items-center justify-between text-xs hover:bg-slate-50/50"
                    >
                      <div className="flex items-center gap-2.5">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <span className="font-semibold text-slate-800 text-[13px]">
                          {m.month_label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-900 tabular-nums text-sm">
                          {formatINR(m.salary_amount)}
                        </span>
                        <span
                          className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border-0 ${
                            m.status === 'PAID'
                              ? 'bg-emerald-50 text-emerald-700'
                              : m.status === 'ADVANCE'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {m.status || 'DUE'}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Completed Jobs */}
          {staffActiveTab === 'jobs' && (
            <div className="space-y-2">
              {(!staffDrilldown.entries || staffDrilldown.entries.length === 0) ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No completed jobs found for this period.
                </div>
              ) : (
                <div className="space-y-2">
                  {staffDrilldown.entries.map((job: any) => (
                    <div
                      key={job.job_id || job.commission_id}
                      onClick={() => {
                        setSelectedStaffJobId(job.job_id);
                        setStaffJobModalOpen(true);
                      }}
                      className="p-3.5 bg-white border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 rounded-2xl transition-all cursor-pointer flex items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-[11px] font-semibold text-slate-600 bg-slate-100 border-0 px-1.5 py-0.5 rounded">
                            {job.invoice_number}
                          </span>
                          <span className="text-xs text-slate-400">
                            {formatDate(job.completed_at || job.invoice_date)}
                          </span>
                        </div>
                        <div className="font-semibold text-slate-900 text-sm">
                          {job.job_type_name}
                          {job.applicant_name && (
                            <span className="text-xs text-slate-500 font-normal ml-1.5">
                              ({job.applicant_name})
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Party: <span className="text-slate-700">{job.party_name}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        {staffDrilldown.compensation_type !== 'SALARY' ? (
                          <>
                            <div className="font-bold text-slate-900 text-sm tabular-nums">
                              {formatINR(job.commission_amount)}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {formatINR(job.job_amount)} × {job.commission_percent}%
                            </div>
                          </>
                        ) : (
                          <div className="text-right">
                            <span className="text-xs font-semibold text-slate-700">
                              {formatINR(job.job_amount)}
                            </span>
                            <span className="block text-[10px] text-slate-400">
                              Salaried
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Payments received */}
          {staffActiveTab === 'payouts' && (
            <div className="space-y-2">
              {(!staffDrilldown.payouts || staffDrilldown.payouts.length === 0) ? (
                <div className="py-12 text-center text-xs text-slate-400">
                  No payments received yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] rounded-2xl overflow-hidden bg-white">
                  {staffDrilldown.payouts.map((p: any) => (
                    <div
                      key={p.id}
                      className="p-3.5 flex items-center justify-between text-xs hover:bg-slate-50/50"
                    >
                      <div>
                        <div className="font-semibold text-slate-800 text-[13px]">
                          {formatINR(p.amount)}
                        </div>
                        <div className="text-slate-500 text-xs mt-0.5 flex items-center gap-2">
                          <span>{formatDate(p.payout_date)}</span>
                          <span>•</span>
                          <span>Mode: {p.mode}</span>
                          {p.notes && <span>• "{p.notes}"</span>}
                        </div>
                      </div>
                      <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border-0">
                        Paid
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 4: Monthly & FY Earnings Statement */}
          {staffActiveTab === 'history' && (
            <StaffEarningsStatement
              earningsHistory={earningsHistory}
              loading={loadingHistory}
            />
          )}
        </div>
      )}

      {/* Pay Staff Bottom Sheet / Modal */}
      <PayStaffModal
        open={payStaffModalOpen}
        onOpenChange={(op) => {
          setPayStaffModalOpen(op);
          if (!op) setTargetStaffForPayout(null);
        }}
        staffMember={targetStaffForPayout}
        onSuccess={() => {
          loadData();
        }}
      />

      {/* Configure Pay Type Modal */}
      <ConfigurePayTypeModal
        open={configModalOpen}
        onOpenChange={(op) => {
          setConfigModalOpen(op);
          if (!op) setTargetStaffForConfig(null);
        }}
        staffMember={targetStaffForConfig}
        onSuccess={() => {
          loadData();
        }}
      />

      {/* Staff Screen Job Detail Modal */}
      <JobDetailModal
        open={staffJobModalOpen}
        onOpenChange={(op) => {
          setStaffJobModalOpen(op);
          if (!op) setSelectedStaffJobId(null);
        }}
        jobId={selectedStaffJobId}
        onJobUpdated={() => {
          loadData();
        }}
      />
    </div>
  );
};
