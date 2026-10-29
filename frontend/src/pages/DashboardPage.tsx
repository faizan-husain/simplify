import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate, getFYLabel } from '../lib/dates';
import { getErrorMessage } from '../i18n';
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
  CheckCircle2,
  AlertCircle,
  Calendar,
  RefreshCw,
  Layers,
  ChevronRight,
  ShieldAlert,
  BarChart3,
  PieChart,
  Users,
  Sparkles,
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

  // Dynamic Greeting based on current time
  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  // Profit margin calculation for monthly overview
  const monthlyIncome = data?.this_month?.income || 0;
  const monthlyProfit = data?.this_month?.net_profit || 0;
  const profitMargin =
    monthlyIncome > 0
      ? Math.round((monthlyProfit / monthlyIncome) * 100)
      : 0;

  // Payment methods calculation for donut chart
  const pm = data?.payment_methods || { cash: 0, upi: 0, bank: 0, card: 0, total: 0 };
  const pmTotal = pm.total || 1;
  const cashPct = Math.round(((pm.cash || 0) / pmTotal) * 100);
  const upiPct = Math.round(((pm.upi || 0) / pmTotal) * 100);
  const bankPct = Math.round(((pm.bank || 0) / pmTotal) * 100);
  const cardPct = Math.max(0, 100 - (cashPct + upiPct + bankPct));

  // Chart data normalization
  const chartPoints = useMemo(() => {
    const raw = data?.chart_data || [];
    if (raw.length === 0) {
      return [
        { label: '1 Oct', income: 12000, expenses: 5000 },
        { label: '5 Oct', income: 18000, expenses: 8000 },
        { label: '10 Oct', income: 24000, expenses: 11000 },
        { label: '15 Oct', income: 19000, expenses: 9000 },
        { label: '20 Oct', income: 21000, expenses: 10000 },
        { label: '25 Oct', income: 15000, expenses: 8500 },
        { label: '30 Oct', income: 22000, expenses: 12000 },
      ];
    }
    if (raw.length <= 7) return raw;
    const step = Math.ceil(raw.length / 7);
    return raw.filter((_: any, idx: number) => idx % step === 0 || idx === raw.length - 1);
  }, [data?.chart_data]);

  const maxChartVal = useMemo(() => {
    let max = 1000;
    chartPoints.forEach((p: any) => {
      if (p.income > max) max = p.income;
      if (p.expenses > max) max = p.expenses;
    });
    return Math.ceil(max * 1.15);
  }, [chartPoints]);

  return (
    <div className="w-full max-w-[1700px] mx-auto p-2 sm:p-3 md:p-3.5 flex flex-col gap-2.5 sm:gap-3 text-slate-800 font-sans select-none">
      {/* 1. TOP HEADER & GREETING BAR (Exact Match to Screenshot) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 px-3.5 py-2.5 sm:px-4 sm:py-3 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Left: Greeting and subtitle */}
        <div>
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-[#0862EC] border border-blue-100">
              <Calendar className="w-2.5 h-2.5" />
              FY {fyLabel}
            </span>
            <span className="text-[11px] text-slate-400 font-medium">{todayStr}</span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wide bg-slate-100 text-slate-600">
              {role || 'OWNER'}
            </span>
          </div>

          <h1 className="text-lg sm:text-xl md:text-2xl font-extrabold tracking-tight text-slate-900 leading-tight flex items-center gap-2">
            <span>
              {greeting}, {member?.name || business?.owner_name || 'Owner'}
            </span>
            <span className="text-xl inline-block animate-bounce">👋</span>
          </h1>
          <p className="text-[11px] sm:text-xs text-slate-400 font-medium">
            Here's your business overview for today.
          </p>
        </div>

        {/* Right: Quick Controls & "+ New Bill" Action Button */}
        <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
          <button
            type="button"
            onClick={() => loadDashboard(true)}
            disabled={loading || refreshing}
            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
            title="Refresh dashboard data"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-[#0862EC]' : ''}`} />
          </button>

          <Button
            size="sm"
            onClick={() => navigate('/bills/new')}
            className="bg-[#0862EC] hover:bg-blue-700 text-white font-bold text-xs h-9 px-3.5 rounded-xl shadow-xs shadow-blue-500/25 cursor-pointer flex items-center gap-1.5 active:scale-95 transition-all"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>+ New Bill</span>
          </Button>
        </div>
      </div>

      {/* 2. ROW 1: 5 QUICK ACTION CARDS (Horizontal Compact Chips) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-2.5">
        {/* + Bill */}
        <button
          type="button"
          onClick={() => navigate('/bills/new')}
          className="group flex items-center justify-between p-2.5 sm:p-3 bg-white rounded-2xl border border-slate-200/80 hover:border-[#0862EC]/50 hover:shadow-xs hover:-translate-y-0.5 transition-all text-left cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#0862EC] group-hover:bg-[#0862EC] group-hover:text-white flex items-center justify-center shrink-0 transition-colors shadow-2xs">
              <FileText className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-800 group-hover:text-[#0862EC] transition-colors leading-tight">
                New Bill
              </div>
              <div className="text-[10px] text-slate-400 font-medium truncate">Quick Billing</div>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-[#0862EC] group-hover:translate-x-0.5 transition-all shrink-0" />
        </button>

        {/* + Receipt */}
        <button
          type="button"
          onClick={() => navigate('/money')}
          className="group flex items-center justify-between p-2.5 sm:p-3 bg-white rounded-2xl border border-slate-200/80 hover:border-emerald-500/50 hover:shadow-xs hover:-translate-y-0.5 transition-all text-left cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white flex items-center justify-center shrink-0 transition-colors shadow-2xs">
              <ReceiptIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-800 group-hover:text-emerald-600 transition-colors leading-tight">
                + Receipt
              </div>
              <div className="text-[10px] text-slate-400 font-medium truncate">Money IN</div>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-emerald-600 group-hover:translate-x-0.5 transition-all shrink-0" />
        </button>

        {/* + Payment */}
        <button
          type="button"
          onClick={() => navigate('/money')}
          className="group flex items-center justify-between p-2.5 sm:p-3 bg-white rounded-2xl border border-slate-200/80 hover:border-purple-500/50 hover:shadow-xs hover:-translate-y-0.5 transition-all text-left cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 group-hover:bg-purple-600 group-hover:text-white flex items-center justify-center shrink-0 transition-colors shadow-2xs">
              <CreditCard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-800 group-hover:text-purple-600 transition-colors leading-tight">
                + Payment
              </div>
              <div className="text-[10px] text-slate-400 font-medium truncate">Vendor Out</div>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-purple-600 group-hover:translate-x-0.5 transition-all shrink-0" />
        </button>

        {/* + Expense */}
        <button
          type="button"
          onClick={() => navigate('/money')}
          className="group flex items-center justify-between p-2.5 sm:p-3 bg-white rounded-2xl border border-slate-200/80 hover:border-amber-500/50 hover:shadow-xs hover:-translate-y-0.5 transition-all text-left cursor-pointer"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 group-hover:bg-amber-600 group-hover:text-white flex items-center justify-center shrink-0 transition-colors shadow-2xs">
              <TrendingDown className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-800 group-hover:text-amber-600 transition-colors leading-tight">
                + Expense
              </div>
              <div className="text-[10px] text-slate-400 font-medium truncate">Overhead</div>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-amber-600 group-hover:translate-x-0.5 transition-all shrink-0" />
        </button>

        {/* + Customer */}
        <button
          type="button"
          onClick={() => navigate('/customers')}
          className="group flex items-center justify-between p-2.5 sm:p-3 bg-white rounded-2xl border border-slate-200/80 hover:border-pink-500/50 hover:shadow-xs hover:-translate-y-0.5 transition-all text-left cursor-pointer col-span-2 sm:col-span-1"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-pink-50 text-pink-600 group-hover:bg-pink-600 group-hover:text-white flex items-center justify-center shrink-0 transition-colors shadow-2xs">
              <UserPlus className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-800 group-hover:text-pink-600 transition-colors leading-tight">
                + Customer
              </div>
              <div className="text-[10px] text-slate-400 font-medium truncate">Party Directory</div>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-pink-600 group-hover:translate-x-0.5 transition-all shrink-0" />
        </button>
      </div>

      {/* 3. ROW 2: JOB QUEUE & DEADLINE TRACKING (Exact Match to Image) */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-3.5 shadow-2xs space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-blue-50 text-[#0862EC] flex items-center justify-center shrink-0">
              <FileText className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-xs sm:text-sm font-extrabold text-slate-900 leading-tight">
                Job Queue & Deadline Tracking
              </h2>
              <p className="text-[10px] text-slate-400 font-medium">
                Multi-step customer service progress & delivery alerts
              </p>
            </div>
          </div>

          <button
            onClick={() => navigate('/jobs')}
            className="text-xs font-bold text-[#0862EC] hover:text-blue-700 flex items-center gap-1 hover:underline cursor-pointer"
          >
            <span>View All Jobs</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 5 Deadline and Status Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-2.5">
          {/* 1. LATE JOBS */}
          <div
            onClick={() => navigate('/jobs?tab=DUE')}
            className="group relative p-2.5 sm:p-3 rounded-2xl border border-rose-200/90 bg-gradient-to-br from-rose-50/70 via-white to-rose-50/20 hover:border-rose-400 hover:shadow-xs hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide bg-rose-100 text-rose-700 border border-rose-200">
                <AlertCircle className="w-2.5 h-2.5 text-rose-600" />
                Late Jobs
              </span>
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-rose-600 group-hover:scale-105 transition-transform origin-left">
              {loading ? '—' : data?.jobs?.late_count || 0}
            </div>
            <div className="text-[10px] sm:text-[11px] font-semibold text-rose-800/80 mt-0.5">
              Deadline Expired
            </div>
            <div className="text-[9px] sm:text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-medium">
              <span>View late orders</span>
              <ArrowRight className="w-2.5 h-2.5 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

          {/* 2. URGENT ACTION (RED BOX) */}
          <div
            onClick={() => navigate('/jobs?tab=RED')}
            className="group relative p-2.5 sm:p-3 rounded-2xl border border-red-200/90 bg-gradient-to-br from-red-50/70 via-white to-red-50/20 hover:border-red-400 hover:shadow-xs hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide bg-red-100 text-red-700 border border-red-200">
                <Clock className="w-2.5 h-2.5 text-red-600" />
                Urgent Action
              </span>
              <span className="w-2 h-2 rounded-full bg-red-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-red-600 group-hover:scale-105 transition-transform origin-left">
              {loading ? '—' : data?.jobs?.red_count || 0}
            </div>
            <div className="text-[10px] sm:text-[11px] font-semibold text-red-800/80 mt-0.5">
              ≤ {data?.jobs?.red_days || 3} days left
            </div>
            <div className="text-[9px] sm:text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-medium">
              <span>View urgent jobs</span>
              <ArrowRight className="w-2.5 h-2.5 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

          {/* 3. UPCOMING DEADLINES (YELLOW BOX) */}
          <div
            onClick={() => navigate('/jobs?tab=YELLOW')}
            className="group relative p-2.5 sm:p-3 rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50/70 via-white to-amber-50/20 hover:border-amber-400 hover:shadow-xs hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-200">
                <Clock className="w-2.5 h-2.5 text-amber-600" />
                Upcoming Deadlines
              </span>
              <span className="w-2 h-2 rounded-full bg-amber-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-amber-700 group-hover:scale-105 transition-transform origin-left">
              {loading ? '—' : data?.jobs?.yellow_count || 0}
            </div>
            <div className="text-[10px] sm:text-[11px] font-semibold text-amber-800/80 mt-0.5">
              4-5 days left
            </div>
            <div className="text-[9px] sm:text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-medium">
              <span>Check pending steps</span>
              <ArrowRight className="w-2.5 h-2.5 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

          {/* 4. CURRENT ACTIVE QUEUE */}
          <div
            onClick={() => navigate('/jobs?tab=CURRENT')}
            className="group relative p-2.5 sm:p-3 rounded-2xl border border-blue-200/90 bg-gradient-to-br from-blue-50/70 via-white to-blue-50/20 hover:border-[#0862EC] hover:shadow-xs hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide bg-blue-100 text-[#0862EC] border border-blue-200">
                <Layers className="w-2.5 h-2.5" />
                Current Queue
              </span>
              <span className="w-2 h-2 rounded-full bg-blue-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-[#0862EC] group-hover:scale-105 transition-transform origin-left">
              {loading ? '—' : data?.jobs?.pending || 0}
            </div>
            <div className="text-[10px] sm:text-[11px] font-semibold text-slate-700 mt-0.5">
              In-Progress Jobs
            </div>
            <div className="text-[9px] sm:text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-medium">
              <span>Open active queue</span>
              <ArrowRight className="w-2.5 h-2.5 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>

          {/* 5. COMPLETED */}
          <div
            onClick={() => navigate('/jobs?tab=COMPLETED')}
            className="group relative p-2.5 sm:p-3 rounded-2xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50/70 via-white to-emerald-50/20 hover:border-emerald-500 hover:shadow-xs hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden col-span-2 sm:col-span-1"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-extrabold uppercase tracking-wide bg-emerald-100 text-emerald-800 border border-emerald-200">
                <CheckCircle2 className="w-2.5 h-2.5 text-emerald-600" />
                Completed
              </span>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            </div>
            <div className="text-2xl sm:text-3xl font-black text-emerald-600 group-hover:scale-105 transition-transform origin-left">
              {loading ? '—' : data?.jobs?.completed_total || 0}
            </div>
            <div className="text-[10px] sm:text-[11px] font-semibold text-emerald-800/80 mt-0.5">
              Delivered Successfully
            </div>
            <div className="text-[9px] sm:text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-medium">
              <span>View completed</span>
              <ArrowRight className="w-2.5 h-2.5 group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>
        </div>
      </div>

      {/* 4. ROW 3: ANALYTICS & CHARTS (Income vs Expenses, Payment Donut, Top Services) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2.5 sm:gap-3">
        {/* COL 1: Income vs Expenses Bar Chart (5 Cols) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-[#0862EC]" />
              <h3 className="text-xs font-bold text-slate-800">Income vs Expenses</h3>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-[10px] font-semibold">
                <span className="flex items-center gap-1 text-slate-600">
                  <span className="w-2 h-2 rounded-full bg-[#0862EC]" />
                  Income (Receipts)
                </span>
                <span className="flex items-center gap-1 text-slate-600">
                  <span className="w-2 h-2 rounded-full bg-[#FB923C]" />
                  Expenses
                </span>
              </div>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                This Month
              </span>
            </div>
          </div>

          {/* Responsive SVG Bar Chart */}
          <div className="h-40 sm:h-44 w-full flex flex-col justify-end pt-2">
            <div className="h-32 w-full flex items-end justify-between gap-2 px-1 pb-1 border-b border-slate-100">
              {chartPoints.map((point: any, idx: number) => {
                const incHeight = Math.min(100, Math.max(8, Math.round((point.income / maxChartVal) * 100)));
                const expHeight = Math.min(100, Math.max(6, Math.round((point.expenses / maxChartVal) * 100)));

                return (
                  <div key={idx} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group relative">
                    {/* Tooltip on hover */}
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute -top-8 bg-slate-900 text-white text-[9px] py-0.5 px-1.5 rounded shadow pointer-events-none whitespace-nowrap z-10">
                      In: {formatINR(point.income)} | Out: {formatINR(point.expenses)}
                    </div>

                    <div className="w-full flex items-end justify-center gap-1 h-full">
                      {/* Income Bar (Blue) */}
                      <div
                        style={{ height: `${incHeight}%` }}
                        className="w-2.5 sm:w-3.5 bg-[#0862EC] rounded-t-sm group-hover:brightness-110 transition-all"
                      />
                      {/* Expense Bar (Orange) */}
                      <div
                        style={{ height: `${expHeight}%` }}
                        className="w-2.5 sm:w-3.5 bg-[#FB923C] rounded-t-sm group-hover:brightness-110 transition-all"
                      />
                    </div>
                    <span className="text-[9px] text-slate-400 font-semibold">{point.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* COL 2: Payment Methods (Receipts) Donut Chart (3.5 Cols) */}
        <div className="lg:col-span-3.5 bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-1.5">
              <PieChart className="w-4 h-4 text-[#0862EC]" />
              <h3 className="text-xs font-bold text-slate-800">Payment Methods (Receipts)</h3>
            </div>
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
              This Month
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 my-auto py-2">
            {/* Donut Chart SVG */}
            <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                {/* Background Track */}
                <circle cx="18" cy="18" r="14" fill="transparent" stroke="#F1F5F9" strokeWidth="4.5" />
                {/* UPI Segment (Blue) */}
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="transparent"
                  stroke="#0862EC"
                  strokeWidth="4.5"
                  strokeDasharray={`${upiPct} ${100 - upiPct}`}
                  strokeDashoffset="0"
                />
                {/* Cash Segment (Emerald) */}
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="transparent"
                  stroke="#10B981"
                  strokeWidth="4.5"
                  strokeDasharray={`${cashPct} ${100 - cashPct}`}
                  strokeDashoffset={`${-upiPct}`}
                />
                {/* Bank Segment (Orange) */}
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="transparent"
                  stroke="#F97316"
                  strokeWidth="4.5"
                  strokeDasharray={`${bankPct} ${100 - bankPct}`}
                  strokeDashoffset={`${-(upiPct + cashPct)}`}
                />
              </svg>
              {/* Center Total Text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-xs font-black text-slate-900 leading-tight">
                  {formatINR(pm.total || 0)}
                </span>
                <span className="text-[8px] text-slate-400 font-bold uppercase tracking-wider">
                  Total Received
                </span>
              </div>
            </div>

            {/* Legend Breakdown */}
            <div className="flex-1 space-y-1.5 text-[11px]">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-2 h-2 rounded-full bg-[#0862EC]" />
                  Cash {cashPct}%
                </span>
                <span className="font-bold text-slate-800">{formatINR(pm.cash || 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                  UPI {upiPct}%
                </span>
                <span className="font-bold text-slate-800">{formatINR(pm.upi || 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-2 h-2 rounded-full bg-[#F97316]" />
                  Bank Transfer {bankPct}%
                </span>
                <span className="font-bold text-slate-800">{formatINR(pm.bank || 0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-600">
                  <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
                  Card {cardPct}%
                </span>
                <span className="font-bold text-slate-800">{formatINR(pm.card || 0)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* COL 3: Top Services (This Month) Table (3.5 Cols) */}
        <div className="lg:col-span-3.5 bg-white rounded-2xl border border-slate-200/80 p-3 sm:p-3.5 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[#0862EC]" />
              <h3 className="text-xs font-bold text-slate-800">Top Services (This Month)</h3>
            </div>
            <button
              onClick={() => navigate('/services')}
              className="text-[11px] font-bold text-[#0862EC] hover:underline flex items-center gap-0.5"
            >
              <span>View All</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {/* Services Table */}
          <div className="space-y-1.5 flex-1">
            <div className="grid grid-cols-12 text-[10px] font-bold text-slate-400 border-b border-slate-100 pb-1 px-1">
              <div className="col-span-1 text-center">#</div>
              <div className="col-span-7">Service</div>
              <div className="col-span-4 text-right">Count</div>
            </div>

            {(data?.top_services || []).length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-400">No services billed yet</div>
            ) : (
              data.top_services.slice(0, 5).map((srv: any, idx: number) => {
                const maxCount = data.top_services[0]?.count || 1;
                const barWidth = Math.round((srv.count / maxCount) * 100);

                return (
                  <div key={idx} className="grid grid-cols-12 items-center text-xs py-1 px-1 rounded-lg hover:bg-slate-50 transition-colors">
                    <div className="col-span-1 text-center font-bold text-slate-400 text-[10px]">{idx + 1}</div>
                    <div className="col-span-7 font-bold text-slate-800 truncate pr-2">{srv.name}</div>
                    <div className="col-span-4 flex items-center justify-end gap-2">
                      <span className="font-extrabold text-slate-900">{srv.count}</span>
                      <div className="w-12 h-1.5 rounded-full bg-slate-100 overflow-hidden shrink-0">
                        <div
                          style={{ width: `${barWidth}%` }}
                          className="h-full rounded-full bg-gradient-to-r from-blue-500 to-[#0862EC]"
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* 5. ROW 4: 3 FINANCIAL METRICS (Income, Outgoing, Net Profit) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
        {/* Total Income */}
        <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
              <TrendingUp className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">Total Income (Receipts)</span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700">
                  ↑ {profitMargin}%
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-black text-slate-900 leading-snug">
                {loading ? <Skeleton className="h-6 w-24" /> : formatINR(data?.this_month?.income || 0)}
              </div>
              <p className="text-[10px] text-slate-400 font-medium truncate">
                All customer payments & other income
              </p>
            </div>
          </div>
        </div>

        {/* Total Outgoing */}
        <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">
              <TrendingDown className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">Total Outgoing</span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-orange-100 text-orange-700">
                  ↑ 0%
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-black text-slate-900 leading-snug">
                {loading ? <Skeleton className="h-6 w-24" /> : formatINR(data?.this_month?.outgoing || 0)}
              </div>
              <p className="text-[10px] text-slate-400 font-medium truncate">
                {formatINR(data?.this_month?.payments || 0)} vendors + {formatINR(data?.this_month?.expenses || 0)} expenses
              </p>
            </div>
          </div>
        </div>

        {/* Net Profit */}
        <div className="p-3 bg-white rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-[#0862EC] flex items-center justify-center shrink-0">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold text-slate-600">Net Profit</span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-blue-100 text-[#0862EC]">
                  ↑ {profitMargin}%
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-black text-slate-900 leading-snug">
                {loading ? <Skeleton className="h-6 w-24" /> : formatINR(data?.this_month?.net_profit || 0)}
              </div>
              <p className="text-[10px] text-slate-400 font-medium truncate">
                Income minus outgoings (cash basis)
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 6. ROW 5: 3 RECENT ACTIVITY TABLES (Recent Bills, Recent Customers, Pending Payments) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 sm:gap-3">
        {/* Table 1: Recent Bills */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-3 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2 pb-1 border-b border-slate-100">
            <div className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-[#0862EC]" />
              <h3 className="text-xs font-bold text-slate-800">Recent Bills</h3>
            </div>
            <button
              onClick={() => navigate('/bills')}
              className="text-[10px] font-bold text-[#0862EC] hover:underline flex items-center gap-0.5"
            >
              <span>View All</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="grid grid-cols-12 text-[10px] font-bold text-slate-400 px-1">
              <div className="col-span-2">#</div>
              <div className="col-span-4">Customer</div>
              <div className="col-span-3 text-right">Amount</div>
              <div className="col-span-3 text-right">Status</div>
            </div>

            {(data?.recent_bills || []).length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400">No bills created yet</div>
            ) : (
              data.recent_bills.slice(0, 5).map((inv: any, idx: number) => (
                <div
                  key={idx}
                  onClick={() => navigate('/bills')}
                  className="grid grid-cols-12 items-center py-1 px-1 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <div className="col-span-2 font-bold text-slate-500 text-[10px] truncate">{inv.number}</div>
                  <div className="col-span-4 font-bold text-slate-800 truncate pr-1">{inv.party_name}</div>
                  <div className="col-span-3 text-right font-extrabold text-slate-900">{formatINR(inv.total)}</div>
                  <div className="col-span-3 text-right">
                    <span
                      className={`inline-block px-1.5 py-0.2 rounded text-[9px] font-extrabold uppercase ${
                        inv.paid_amount >= inv.total
                          ? 'bg-emerald-50 text-emerald-700'
                          : inv.paid_amount > 0
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {inv.paid_amount >= inv.total ? 'Paid' : inv.paid_amount > 0 ? 'Part' : 'Due'}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Table 2: Recent Customers */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-3 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2 pb-1 border-b border-slate-100">
            <div className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-[#0862EC]" />
              <h3 className="text-xs font-bold text-slate-800">Recent Customers</h3>
            </div>
            <button
              onClick={() => navigate('/customers')}
              className="text-[10px] font-bold text-[#0862EC] hover:underline flex items-center gap-0.5"
            >
              <span>View All</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="grid grid-cols-12 text-[10px] font-bold text-slate-400 px-1">
              <div className="col-span-1">#</div>
              <div className="col-span-5">Name</div>
              <div className="col-span-4">Mobile</div>
              <div className="col-span-2 text-right">Bills</div>
            </div>

            {(data?.recent_customers || []).length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400">No customers registered yet</div>
            ) : (
              data.recent_customers.slice(0, 5).map((c: any, idx: number) => (
                <div
                  key={idx}
                  onClick={() => navigate('/customers')}
                  className="grid grid-cols-12 items-center py-1 px-1 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <div className="col-span-1 font-bold text-slate-400 text-[10px]">{idx + 1}</div>
                  <div className="col-span-5 font-bold text-slate-800 truncate pr-1">{c.name}</div>
                  <div className="col-span-4 text-[10px] text-slate-500 truncate">{c.mobile || '—'}</div>
                  <div className="col-span-2 text-right font-extrabold text-[#0862EC]">{c.bills_count || 0}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Table 3: Pending Payments (Customers) */}
        <div className="bg-white rounded-2xl border border-slate-200/80 p-3 shadow-2xs flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2 pb-1 border-b border-slate-100">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
              <h3 className="text-xs font-bold text-slate-800">Pending Payments (Customers)</h3>
            </div>
            <button
              onClick={() => navigate('/bills')}
              className="text-[10px] font-bold text-[#0862EC] hover:underline flex items-center gap-0.5"
            >
              <span>View All</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-1.5 text-xs">
            <div className="grid grid-cols-12 text-[10px] font-bold text-slate-400 px-1">
              <div className="col-span-1">#</div>
              <div className="col-span-5">Customer</div>
              <div className="col-span-4 text-right">Amount</div>
              <div className="col-span-2 text-right">Days</div>
            </div>

            {(data?.pending_payments || []).length === 0 ? (
              <div className="py-4 text-center text-xs text-slate-400">All customer dues cleared 🎉</div>
            ) : (
              data.pending_payments.slice(0, 5).map((due: any, idx: number) => (
                <div
                  key={idx}
                  onClick={() => navigate('/bills')}
                  className="grid grid-cols-12 items-center py-1 px-1 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <div className="col-span-1 font-bold text-slate-400 text-[10px]">{idx + 1}</div>
                  <div className="col-span-5 font-bold text-slate-800 truncate pr-1">{due.party_name}</div>
                  <div className="col-span-4 text-right font-extrabold text-rose-600">{formatINR(due.due_amount)}</div>
                  <div className="col-span-2 text-right text-[10px] font-bold text-rose-700">
                    {due.days_overdue > 0 ? `${due.days_overdue}d` : 'Today'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
