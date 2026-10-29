import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate, getFYLabel } from '../lib/dates';
import { t, getErrorMessage } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Skeleton } from '../components/ui/Skeleton';
import {
  FileText,
  Receipt as ReceiptIcon,
  CreditCard,
  TrendingDown,
  TrendingUp,
  UserPlus,
  Clock,
  ArrowRight,
  Building,
  CheckCircle2,
  AlertCircle,
  Calendar,
  RefreshCw,
  Briefcase,
  Layers,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { business, member, role } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<any>(null);

  const loadDashboard = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const { data: dash, error } = await supabase.rpc('dashboard');
      if (error) throw error;
      if (dash) {
        setData(dash);
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const todayStr = formatDate(new Date());
  const fyLabel = getFYLabel();

  // Profit margin calculation for monthly overview
  const monthlyIncome = data?.this_month?.income || 0;
  const monthlyProfit = data?.this_month?.net_profit || 0;
  const profitMargin =
    monthlyIncome > 0
      ? Math.round((monthlyProfit / monthlyIncome) * 100)
      : 0;

  return (
    <div className="p-3 sm:p-5 md:p-6 max-w-7xl mx-auto space-y-5 font-sans">
      {/* 1. TOP BUSINESS PROFILE & GREETING BAR */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-[#0862EC] to-blue-500 text-white flex items-center justify-center font-extrabold text-lg shadow-md shadow-blue-500/20 shrink-0">
            {business?.name ? business.name.slice(0, 2).toUpperCase() : 'SB'}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-[#0862EC] border border-blue-100">
                <Calendar className="w-3 h-3" />
                FY {fyLabel}
              </span>
              <span className="text-xs text-slate-400 font-medium">{todayStr}</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide bg-slate-100 text-slate-600">
                {role || 'STAFF'}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900 mt-1 leading-snug">
              {business?.name || 'SIMPLIFY'}
            </h1>
            <p className="text-xs text-slate-500 font-medium">
              Welcome back, <span className="font-semibold text-slate-700">{member?.name || 'User'}</span>
            </p>
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => loadDashboard(true)}
            disabled={loading || refreshing}
            className="p-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
            title="Refresh dashboard data"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[#0862EC]' : ''}`} />
          </button>

          <Button
            size="md"
            onClick={() => navigate('/bills/new')}
            className="bg-[#0862EC] hover:bg-blue-700 text-white font-bold text-xs h-10 px-4 rounded-xl shadow-md shadow-blue-500/20 cursor-pointer flex items-center gap-1.5"
          >
            <FileText className="w-4 h-4" />
            <span>{t('nav.new_bill') || 'Create Bill'}</span>
          </Button>
        </div>
      </div>

      {/* 2. TOUCH-FRIENDLY 1-TAP QUICK ACTION CHIPS */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <button
          type="button"
          onClick={() => navigate('/bills/new')}
          className="group flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-200/80 hover:border-[#0862EC]/50 hover:shadow-md hover:-translate-y-0.5 transition-all text-left cursor-pointer"
        >
          <div className="w-9 h-9 rounded-xl bg-blue-50 text-[#0862EC] group-hover:bg-[#0862EC] group-hover:text-white flex items-center justify-center shrink-0 transition-colors shadow-2xs">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-800 group-hover:text-[#0862EC] transition-colors">+ Bill</div>
            <div className="text-[10px] text-slate-400 font-medium truncate">Quick Billing</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate('/money')}
          className="group flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-200/80 hover:border-emerald-500/50 hover:shadow-md hover:-translate-y-0.5 transition-all text-left cursor-pointer"
        >
          <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white flex items-center justify-center shrink-0 transition-colors shadow-2xs">
            <ReceiptIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-800 group-hover:text-emerald-600 transition-colors">+ Receipt</div>
            <div className="text-[10px] text-slate-400 font-medium truncate">Money IN</div>
          </div>
        </button>

        {role !== 'STAFF' && (
          <button
            type="button"
            onClick={() => navigate('/money')}
            className="group flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-200/80 hover:border-indigo-500/50 hover:shadow-md hover:-translate-y-0.5 transition-all text-left cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white flex items-center justify-center shrink-0 transition-colors shadow-2xs">
              <CreditCard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">+ Payment</div>
              <div className="text-[10px] text-slate-400 font-medium truncate">Vendor Out</div>
            </div>
          </button>
        )}

        {role !== 'STAFF' && (
          <button
            type="button"
            onClick={() => navigate('/money')}
            className="group flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-200/80 hover:border-amber-500/50 hover:shadow-md hover:-translate-y-0.5 transition-all text-left cursor-pointer"
          >
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white flex items-center justify-center shrink-0 transition-colors shadow-2xs">
              <TrendingDown className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-800 group-hover:text-amber-600 transition-colors">+ Expense</div>
              <div className="text-[10px] text-slate-400 font-medium truncate">Overhead</div>
            </div>
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate('/customers')}
          className="group flex items-center gap-3 p-3 bg-white rounded-2xl border border-slate-200/80 hover:border-purple-500/50 hover:shadow-md hover:-translate-y-0.5 transition-all text-left cursor-pointer"
        >
          <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 group-hover:bg-purple-600 group-hover:text-white flex items-center justify-center shrink-0 transition-colors shadow-2xs">
            <UserPlus className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-800 group-hover:text-purple-600 transition-colors">+ Customer</div>
            <div className="text-[10px] text-slate-400 font-medium truncate">Party Directory</div>
          </div>
        </button>
      </div>

      {/* 3. URGENT ALERT BANNERS */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Overdue Payment Alert Banner */}
          {(data.alerts?.overdue_bills_count > 0 || data.alerts?.due_today_bills_count > 0) && (
            <div className="p-4 bg-gradient-to-r from-rose-50/90 to-red-50/70 border border-rose-200 rounded-2xl flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="text-xs">
                  <div className="font-bold text-rose-950 flex items-center gap-1.5">
                    <span>Payment Due Alerts</span>
                    <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  </div>
                  <div className="text-rose-700 mt-0.5 font-medium">
                    {data.alerts.overdue_bills_count > 0 && (
                      <span className="font-bold text-rose-800">
                        {data.alerts.overdue_bills_count} overdue bills
                      </span>
                    )}
                    {data.alerts.overdue_bills_count > 0 && data.alerts.due_today_bills_count > 0 && ' • '}
                    {data.alerts.due_today_bills_count > 0 && (
                      <span>{data.alerts.due_today_bills_count} bills due today</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate('/bills')}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition-all shadow-2xs shrink-0 cursor-pointer"
              >
                View Bills
              </button>
            </div>
          )}

          {/* Job Deadline Alert Banner (if any late or urgent red jobs) */}
          {data.jobs?.enabled && (data.jobs.late_count > 0 || data.jobs.red_count > 0) && (
            <div className="p-4 bg-gradient-to-r from-amber-50/90 to-orange-50/70 border border-amber-200 rounded-2xl flex items-center justify-between gap-3 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div className="text-xs">
                  <div className="font-bold text-amber-950 flex items-center gap-1.5">
                    <span>Urgent Job Deadlines</span>
                    <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  </div>
                  <div className="text-amber-800 mt-0.5 font-medium">
                    {data.jobs.late_count > 0 && (
                      <span className="font-bold text-rose-700">
                        {data.jobs.late_count} late jobs (passed)
                      </span>
                    )}
                    {data.jobs.late_count > 0 && data.jobs.red_count > 0 && ' • '}
                    {data.jobs.red_count > 0 && (
                      <span className="font-bold text-red-700">
                        {data.jobs.red_count} urgent in Red box
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => navigate(data.jobs.late_count > 0 ? '/jobs?tab=DUE' : '/jobs?tab=RED')}
                className="px-3 py-1.5 rounded-xl bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-bold transition-all shadow-2xs shrink-0 cursor-pointer"
              >
                Resolve Deadlines
              </button>
            </div>
          )}
        </div>
      )}

      {/* 4. JOB DEADLINES & QUEUE HUB (ULTRA-PREMIUM & EXACT DATA) */}
      {data?.jobs?.enabled && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-xs space-y-3.5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-blue-50 text-[#0862EC] flex items-center justify-center font-bold">
                <Briefcase className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900 tracking-tight">
                  Job Queue & Deadline Tracking
                </h2>
                <p className="text-[11px] text-slate-400 font-medium">
                  Multi-step customer service progress & delivery alerts
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => navigate('/jobs')}
              className="text-xs font-bold text-[#0862EC] hover:text-blue-700 flex items-center gap-1 hover:underline cursor-pointer"
            >
              <span>All Jobs</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Interactive Deadline & Queue Cards Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            {/* 1. LATE JOBS BOX (EXPIRED DEADLINE) */}
            <div
              onClick={() => navigate('/jobs?tab=DUE')}
              className="group relative p-4 rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50/80 via-white to-rose-50/30 hover:border-rose-400 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-rose-100 text-rose-700 border border-rose-200">
                  <AlertCircle className="w-3 h-3 text-rose-600" />
                  Late Jobs
                </span>
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
              </div>
              <div className="text-2xl sm:text-3xl font-black text-rose-600 group-hover:scale-105 transition-transform origin-left">
                {loading ? '—' : data?.jobs?.late_count || 0}
              </div>
              <div className="text-[11px] font-medium text-rose-800/80 mt-1">
                Deadline Expired
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                <span>View late orders</span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>

            {/* 2. RED BOX JOBS (URGENT ≤3 DAYS) */}
            <div
              onClick={() => navigate('/jobs?tab=RED')}
              className="group relative p-4 rounded-2xl border border-red-200 bg-gradient-to-br from-red-50/70 via-white to-red-50/30 hover:border-red-400 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-red-100 text-red-700 border border-red-200">
                  <Clock className="w-3 h-3 text-red-600" />
                  Red Box
                </span>
                <span className="text-[10px] font-bold text-red-600">≤ {data?.jobs?.red_days || 3}d left</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-red-600 group-hover:scale-105 transition-transform origin-left">
                {loading ? '—' : data?.jobs?.red_count || 0}
              </div>
              <div className="text-[11px] font-medium text-red-800/80 mt-1">
                Urgent Action Needed
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                <span>View urgent jobs</span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>

            {/* 3. YELLOW BOX JOBS (UPCOMING 4-5 DAYS) */}
            <div
              onClick={() => navigate('/jobs?tab=YELLOW')}
              className="group relative p-4 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50/70 via-white to-amber-50/30 hover:border-amber-400 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-200">
                  <Clock className="w-3 h-3 text-amber-600" />
                  Yellow Box
                </span>
                <span className="text-[10px] font-bold text-amber-700">4-5d left</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-amber-700 group-hover:scale-105 transition-transform origin-left">
                {loading ? '—' : data?.jobs?.yellow_count || 0}
              </div>
              <div className="text-[11px] font-medium text-amber-800/80 mt-1">
                Upcoming Deadlines
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                <span>Check pending steps</span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>

            {/* 4. CURRENT ACTIVE QUEUE */}
            <div
              onClick={() => navigate('/jobs?tab=CURRENT')}
              className="group relative p-4 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50/70 via-white to-blue-50/30 hover:border-[#0862EC] hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-blue-100 text-[#0862EC] border border-blue-200">
                  <Layers className="w-3 h-3" />
                  Current Queue
                </span>
                <span className="w-2 h-2 rounded-full bg-blue-500" />
              </div>
              <div className="text-2xl sm:text-3xl font-black text-[#0862EC] group-hover:scale-105 transition-transform origin-left">
                {loading ? '—' : data?.jobs?.pending || 0}
              </div>
              <div className="text-[11px] font-medium text-slate-600 mt-1">
                In-Progress Jobs
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                <span>Open active queue</span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>

            {/* 5. COMPLETED JOBS (TODAY & ALL-TIME) */}
            <div
              onClick={() => navigate('/jobs?tab=COMPLETED')}
              className="group relative p-4 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-white to-emerald-50/30 hover:border-emerald-500 hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden col-span-2 lg:col-span-1"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-emerald-100 text-emerald-800 border border-emerald-200">
                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                  Completed
                </span>
                <span className="text-[10px] font-bold text-emerald-700">
                  {data?.jobs?.completed_today || 0} today
                </span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-emerald-600 group-hover:scale-105 transition-transform origin-left">
                {loading ? '—' : data?.jobs?.completed_total || 0}
              </div>
              <div className="text-[11px] font-medium text-emerald-800/80 mt-1">
                Delivered Successfully
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-1">
                <span>Completed history</span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. TODAY'S COUNTER CASHFLOW */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-xs space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Today's Live Activity
            </h2>
          </div>
          <span className="text-xs font-semibold text-slate-500">{todayStr}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Bills Made Today */}
          <div
            onClick={() => navigate('/bills')}
            className="p-4 bg-slate-50/60 rounded-2xl border border-slate-200/60 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all cursor-pointer"
          >
            <div className="text-xs font-semibold text-slate-500 flex items-center justify-between">
              <span>Bills Made</span>
              <FileText className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-2">
              {loading ? <Skeleton className="h-8 w-16" /> : data?.today?.bills_count || 0}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">Today's sales count</div>
          </div>

          {/* Collection (IN) Today */}
          <div
            onClick={() => navigate('/money')}
            className="p-4 bg-emerald-50/40 rounded-2xl border border-emerald-200/70 hover:bg-white hover:border-emerald-300 hover:shadow-xs transition-all cursor-pointer"
          >
            <div className="text-xs font-semibold text-emerald-800 flex items-center justify-between">
              <span>Collection (IN)</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">
                + Inflow
              </span>
            </div>
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-600 mt-2">
              {loading ? <Skeleton className="h-8 w-24" /> : formatINR(data?.today?.collection || 0)}
            </div>
            <div className="text-[10px] text-emerald-700/80 mt-1">Customer receipts today</div>
          </div>

          {/* Vendor Payments (OUT) Today */}
          {role !== 'STAFF' && (
            <div
              onClick={() => navigate('/money')}
              className="p-4 bg-slate-50/60 rounded-2xl border border-slate-200/60 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all cursor-pointer"
            >
              <div className="text-xs font-semibold text-slate-500 flex items-center justify-between">
                <span>Vendor Payments</span>
                <CreditCard className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-2">
                {loading ? <Skeleton className="h-8 w-20" /> : formatINR(data?.today?.payments || 0)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">Paid to vendors today</div>
            </div>
          )}

          {/* Operating Expenses Today */}
          {role !== 'STAFF' && (
            <div
              onClick={() => navigate('/money')}
              className="p-4 bg-slate-50/60 rounded-2xl border border-slate-200/60 hover:bg-white hover:border-slate-300 hover:shadow-xs transition-all cursor-pointer"
            >
              <div className="text-xs font-semibold text-slate-500 flex items-center justify-between">
                <span>Shop Expenses</span>
                <TrendingDown className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-2">
                {loading ? <Skeleton className="h-8 w-20" /> : formatINR(data?.today?.expenses || 0)}
              </div>
              <div className="text-[10px] text-slate-400 mt-1">Rent, electricity, salary…</div>
            </div>
          )}
        </div>
      </div>

      {/* 6. THIS MONTH OVERVIEW (Cash-basis Profit, Dues & Capital Ledger) */}
      {role !== 'STAFF' && (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900 tracking-tight">
                This Month Overview (Cash Basis)
              </h2>
              <p className="text-[11px] text-slate-400 font-medium">
                Realised income, operating outgoings and net profit for current month
              </p>
            </div>
            <button
              onClick={() => navigate('/reports')}
              className="text-xs text-[#0862EC] hover:text-blue-700 font-bold flex items-center gap-1 hover:underline cursor-pointer"
            >
              <span>Full P&L Report</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* 3 Core Financial Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Monthly Realised Income */}
            <div className="p-4 bg-gradient-to-br from-emerald-50/50 via-white to-white rounded-2xl border border-slate-200/80 shadow-2xs">
              <div className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
                <span>Total Income (Receipts)</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">
                {loading ? <Skeleton className="h-8 w-28" /> : formatINR(data?.this_month?.income || 0)}
              </div>
              <p className="text-[10px] text-slate-400 mt-1 font-medium">
                All customer payments & other income
              </p>
            </div>

            {/* Monthly Outgoing */}
            <div className="p-4 bg-gradient-to-br from-slate-50 via-white to-white rounded-2xl border border-slate-200/80 shadow-2xs">
              <div className="text-xs font-bold text-slate-600 flex items-center gap-1.5">
                <TrendingDown className="w-4 h-4 text-slate-500" />
                <span>Total Outgoing</span>
              </div>
              <div className="text-2xl sm:text-3xl font-black text-slate-900 mt-2">
                {loading ? <Skeleton className="h-8 w-28" /> : formatINR(data?.this_month?.outgoing || 0)}
              </div>
              <p className="text-[10px] text-slate-400 mt-1 font-medium">
                {formatINR(data?.this_month?.payments || 0)} vendors + {formatINR(data?.this_month?.expenses || 0)} expenses
              </p>
            </div>

            {/* Monthly Net Profit */}
            <div className="p-4 bg-gradient-to-br from-blue-50/40 via-white to-white rounded-2xl border border-blue-200 shadow-2xs">
              <div className="text-xs font-bold text-[#0862EC] flex items-center justify-between">
                <span>Net Profit</span>
                {monthlyIncome > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-[#0862EC]">
                    {profitMargin}% margin
                  </span>
                )}
              </div>
              <div
                className={`text-2xl sm:text-3xl font-black mt-2 ${
                  monthlyProfit >= 0 ? 'text-[#0862EC]' : 'text-rose-600'
                }`}
              >
                {loading ? <Skeleton className="h-8 w-28" /> : formatINR(monthlyProfit)}
              </div>
              <p className="text-[10px] text-slate-400 mt-1 font-medium">
                Income minus outgoings (cash basis)
              </p>
            </div>
          </div>

          {/* Dues and Loans balances */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {/* Total Customer Receivables */}
            <div className="p-4 bg-rose-50/30 rounded-2xl border border-rose-200/80 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-rose-900 font-bold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  Total Customer Receivables (Dues)
                </div>
                <div className="text-xl sm:text-2xl font-black text-rose-600 mt-1">
                  {loading ? <Skeleton className="h-7 w-24" /> : formatINR(data?.this_month?.total_outstanding || 0)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Across all active unpaid bills
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/money')}
                className="text-xs h-8 px-3 rounded-xl border-rose-300 text-rose-700 hover:bg-rose-50 font-bold shrink-0 cursor-pointer"
              >
                View Dues
              </Button>
            </div>

            {/* Loan Outstanding (Capital Ledger - strictly isolated per BR-1 & BR-11) */}
            <div className="p-4 bg-slate-50/70 rounded-2xl border border-slate-200/80 flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-700 font-bold flex items-center gap-1.5">
                  <Building className="w-3.5 h-3.5 text-slate-500" />
                  Loan Outstanding (Capital Ledger)
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
                  {loading ? <Skeleton className="h-7 w-24" /> : formatINR(data?.this_month?.loan_outstanding || 0)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">
                  Taken minus principal repaid (non-operating)
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/money')}
                className="text-xs h-8 px-3 rounded-xl border-slate-300 text-slate-700 hover:bg-slate-100 font-bold shrink-0 cursor-pointer"
              >
                Capital Ledger
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
