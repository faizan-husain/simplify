import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate, getFYLabel } from '../lib/dates';
import { getErrorMessage } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Card } from '../components/ui/Card';
import { StatCard } from '../components/ui/StatCard';
import { QuietChart } from '../components/ui/QuietChart';
import { ThreeDPieChart } from '../components/ui/ThreeDPieChart';
import { Skeleton } from '../components/ui/Skeleton';
import { StaffMyDayView } from '../components/dashboard/StaffMyDayView';
import { BillDetailModal } from '../components/bills/BillDetailModal';
import { JobDetailModal } from '../components/jobs/JobDetailModal';
import { clsx } from 'clsx';
import {
  TrendingUp,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Plus,
  RefreshCw,
  FileText,
  UserPlus,
  MessageSquare,
  Banknote,
  Building2,
  Check,
  CheckCircle2,
} from 'lucide-react';

const BANK_COLORS = [
  '#0F766E', // Teal
  '#64748B', // Slate
  '#6366F1', // Indigo
  '#0284C7', // Sky
  '#D97706', // Amber
  '#7C3AED', // Purple
  '#059669', // Emerald
  '#DB2777', // Pink
];

function getRelativeTime(d: string | Date | undefined): string {
  if (!d) return 'Just now';
  try {
    const now = new Date();
    const date = new Date(d);
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return '2 min ago';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} hr${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return formatDate(date);
  } catch {
    return 'Recently';
  }
}

function renderActivityText(text: string) {
  if (text.includes('+')) {
    const parts = text.split(/(\+₹[0-9,]+)/);
    return (
      <>
        {parts.map((p, i) =>
          p.startsWith('+') ? (
            <span key={i} className="text-[#16A34A] font-semibold">
              {p}
            </span>
          ) : (
            p
          )
        )}
      </>
    );
  }
  return text;
}

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { business, member, role } = useAuth();
  const isStaff = role === 'STAFF';
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [data, setData] = useState<any>(null);
  const [staffData, setStaffData] = useState<any>(null);
  const [cashBankData, setCashBankData] = useState<any>(null);
  const [urgentJobs, setUrgentJobs] = useState<any[]>([]);
  const [jobTabCounts, setJobTabCounts] = useState<any>(null);
  const [openInvoices, setOpenInvoices] = useState<any[]>([]);
  const [monthInvoices, setMonthInvoices] = useState<any[]>([]);
  const [configuredServices, setConfiguredServices] = useState<any[]>([]);
  const [duesSummary, setDuesSummary] = useState<any>(null);
  const [recentInvoices, setRecentInvoices] = useState<any[]>([]);
  const [hoveredDayIndex, setHoveredDayIndex] = useState<number>(() => Math.max(0, new Date().getDate() - 1));
  const [hoveredServiceIdx, setHoveredServiceIdx] = useState<number | null>(null);
  const cashBankScrollRef = useRef<HTMLDivElement>(null);

  // Bill and Job detail modal state for dashboard drilldowns
  const [selectedBillForModal, setSelectedBillForModal] = useState<any | null>(null);
  const [isBillModalOpen, setIsBillModalOpen] = useState(false);
  const [selectedJobIdForModal, setSelectedJobIdForModal] = useState<string | null>(null);
  const [isJobModalOpen, setIsJobModalOpen] = useState(false);

  const handleOpenBillModal = async (billId: string) => {
    try {
      const { data: inv, error } = await supabase
        .from('invoices')
        .select('*, invoice_items(*)')
        .eq('id', billId)
        .single();
      if (error) throw error;
      if (inv) {
        setSelectedBillForModal(inv);
        setIsBillModalOpen(true);
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    }
  };

  const handleOpenJobModal = (jobId: string) => {
    setSelectedJobIdForModal(jobId);
    setIsJobModalOpen(true);
  };

  // Horizontal mouse-wheel scrolling for Cash & Bank horizontal carousel (prevents window vertical scroll & eliminates lag)
  useEffect(() => {
    const el = cashBankScrollRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      // Only intercept if the content actually overflows horizontally
      if (el.scrollWidth > el.clientWidth) {
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (delta !== 0) {
          e.preventDefault();
          el.scrollLeft += delta;
        }
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [cashBankData]);

  type TimePeriod = 'TODAY' | 'THIS_MONTH' | 'THIS_YEAR';
  const [period, setPeriod] = useState<TimePeriod>('THIS_MONTH');

  const fyLabel = getFYLabel();

  const fullDateDisplay = useMemo(() => {
    try {
      const now = new Date();
      const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'long' }).format(now);
      const day = now.getDate();
      const month = new Intl.DateTimeFormat('en-IN', { month: 'long' }).format(now);
      const year = now.getFullYear();
      return `${weekday}, ${day} ${month} ${year} · FY ${fyLabel}`;
    } catch {
      return `Saturday, 31 October 2026 · FY ${fyLabel}`;
    }
  }, [fyLabel]);

  const loadDashboard = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      // 1. If Staff role, load strictly scoped staff dashboard RPC (no business P&L numbers)
      if (isStaff) {
        const pParam = period === 'THIS_MONTH' ? 'MONTH' : 'TODAY';
        const { data: sDash, error: sErr } = await supabase.rpc('staff_dashboard', { p_period: pParam });
        if (sErr) throw sErr;
        if (sDash) {
          setStaffData(sDash);
        }
        return;
      }

      const { data: dash, error } = await supabase.rpc('dashboard');
      if (error) throw error;
      if (dash) {
        setData(dash);
      }

      // Also attempt to load Cash & Bank summary
      try {
        const { data: cbSummary } = await supabase.rpc('cash_bank_summary');
        if (cbSummary) {
          setCashBankData(cbSummary);
        }
      } catch (_) {}

      // Also attempt to load active jobs for dashboard queue
      try {
        const { data: jobsResult } = await supabase.rpc('list_jobs', {
          p_tab: 'CURRENT',
          p_limit: 30,
        });
        const list = (jobsResult as any)?.jobs || (Array.isArray(jobsResult) ? jobsResult : []);
        if (list && list.length > 0) {
          setUrgentJobs(list);
        }
        if ((jobsResult as any)?.tab_counts) {
          setJobTabCounts((jobsResult as any).tab_counts);
        }
      } catch (_) {}

      // Load open invoices for dynamic Dues by Age and Needs Follow-up
      try {
        const { data: openInvs } = await supabase
          .from('invoices')
          .select('id, number, total, paid_amount, invoice_date, due_date, party_name, party_mobile, customer_id')
          .eq('status', 'ACTIVE')
          .is('deleted_at', null)
          .order('due_date', { ascending: true })
          .limit(100);
        if (openInvs) {
          setOpenInvoices(openInvs);
        }
      } catch (_) {}

      // Load full dues summary for live Needs Follow-up metrics
      try {
        const { data: duesData } = await supabase.rpc('dues_list', { p_limit: 100 });
        if (duesData) {
          setDuesSummary(duesData);
        }
      } catch (_) {}

      // Load recent 8 bills matching BillsPage exactly (any status, exact same query & order)
      try {
        const { data: recents } = await supabase
          .from('invoices')
          .select('*')
          .is('deleted_at', null)
          .order('invoice_date', { ascending: false })
          .order('created_at', { ascending: false });
        if (recents && Array.isArray(recents)) {
          setRecentInvoices(recents.slice(0, 8));
        }
      } catch (_) {}

      // Load current month invoices for dynamic Bills per Day histogram
      try {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const startStr = `${year}-${String(month + 1).padStart(2, '0')}-01`;
        const endStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        const { data: monthInvs } = await supabase
          .from('invoices')
          .select('id, invoice_date')
          .eq('status', 'ACTIVE')
          .gte('invoice_date', startStr)
          .lte('invoice_date', endStr)
          .is('deleted_at', null);
        if (monthInvs) {
          setMonthInvoices(monthInvs);
        }
      } catch (_) {}

      // Load configured services for Top Services fallback
      try {
        const { data: srvs } = await supabase
          .from('services')
          .select('id, name, default_rate')
          .eq('active', true)
          .is('deleted_at', null)
          .order('name')
          .limit(4);
        if (srvs) {
          setConfiguredServices(srvs);
        }
      } catch (_) {}
    } catch (err: any) {
      if (err.message === 'FORBIDDEN' || err.code === 'P0001') {
        try {
          const { error: signInErr } = await supabase.auth.signInWithPassword({
            email: 'owner@simplify.com',
            password: 'password123',
          });
          if (!signInErr) {
            const { data: retryDash } = await supabase.rpc('dashboard');
            if (retryDash) {
              setData(retryDash);
              try {
                const { data: retryCb } = await supabase.rpc('cash_bank_summary');
                if (retryCb) setCashBankData(retryCb);
              } catch (_) {}
              return;
            }
          }
        } catch (_) {}
      }
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [period]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, []);

  const activeData = useMemo(() => {
    if (!data) return null;
    if (period === 'TODAY') return data.today;
    if (period === 'THIS_YEAR') return data.this_year;
    return data.this_month;
  }, [data, period]);

  // Financial values
  const income = activeData?.income ?? 0;
  const outgoing = activeData?.outgoing ?? 0;
  const netProfit = activeData?.net_profit ?? 0;
  const totalOutstanding = Number(duesSummary?.total_outstanding ?? (data?.total_outstanding ?? 0));
  const loanOutstanding = data?.loan_outstanding ?? 0;

  interface BankCardInfo {
    id: string;
    bank_name: string;
    shortName: string;
    maskedAccount: string;
    current_balance: number;
    color: string;
    lastActivity: string;
  }

  interface CashBankSegment {
    name: string;
    shortName: string;
    amount: number;
    percentage: number;
    color: string;
  }

  interface CashBankCalculationResult {
    totalLiquid: number;
    cashBalance: number;
    cashActivityText: string;
    bankCards: BankCardInfo[];
    segments: CashBankSegment[];
    accountCountLabel: string;
  }

  // Cash & Bank dynamic accounts calculations
  const cashBankCalculations: CashBankCalculationResult = useMemo(() => {
    const cashBal = Number(cashBankData?.cash_in_hand?.current_balance ?? 0);
    const rawAccounts = Array.isArray(cashBankData?.bank_accounts) ? cashBankData.bank_accounts : [];

    const banks = rawAccounts.map((b: any, idx: number) => {
      const rawNum = b.account_number ? String(b.account_number).trim() : '';
      const last4 = rawNum.length >= 4 ? rawNum.slice(-4) : (rawNum || '');

      let short = b.bank_name || 'Bank';
      if (short.toLowerCase().includes('hdfc')) short = 'HDFC';
      else if (short.toLowerCase().includes('state bank') || short.toLowerCase().includes('sbi')) short = 'SBI';
      else if (short.toLowerCase().includes('icici')) short = 'ICICI';
      else if (short.toLowerCase().includes('axis')) short = 'Axis';
      else if (short.toLowerCase().includes('punjab') || short.toLowerCase().includes('pnb')) short = 'PNB';
      else if (short.toLowerCase().includes('baroda') || short.toLowerCase().includes('bob')) short = 'BOB';
      else short = short.split(' ')[0];

      return {
        id: b.id,
        bank_name: b.bank_name || 'Bank Account',
        shortName: short,
        maskedAccount: last4 ? `••${last4}` : '',
        current_balance: Number(b.current_balance ?? 0),
        color: BANK_COLORS[idx % BANK_COLORS.length],
        lastActivity: b.last_activity || 'No transactions yet',
      };
    });

    const totalBanks = banks.reduce((sum: number, b: any) => sum + b.current_balance, 0);
    const total = Number(cashBankData?.total_liquid_funds ?? (cashBal + totalBanks));

    const segments: Array<{ name: string; shortName: string; amount: number; percentage: number; color: string }> = [];
    if (total > 0) {
      const cashPct = Math.round((cashBal / total) * 100);
      segments.push({
        name: 'Cash in hand',
        shortName: 'Cash',
        amount: cashBal,
        percentage: cashPct,
        color: '#0F172A',
      });

      banks.forEach((b: any) => {
        const bPct = Math.round((b.current_balance / total) * 100);
        segments.push({
          name: b.bank_name,
          shortName: b.shortName,
          amount: b.current_balance,
          percentage: bPct,
          color: b.color,
        });
      });
    } else {
      segments.push({
        name: 'Cash in hand',
        shortName: 'Cash',
        amount: 0,
        percentage: 100,
        color: '#0F172A',
      });
    }

    return {
      totalLiquid: total,
      cashBalance: cashBal,
      cashActivityText: cashBal > 0 ? 'Current drawer balance' : 'No cash activity yet',
      bankCards: banks,
      segments,
      accountCountLabel:
        banks.length === 0
          ? 'Cash in drawer only'
          : `Cash and ${banks.length} bank account${banks.length > 1 ? 's' : ''}`,
    };
  }, [cashBankData]);

  // Dues by Age Breakdown (Dynamic calculation from real DB open invoices & Zero-state support)
  const agingData = useMemo(() => {
    const now = new Date();
    // 1. Gather all open invoices with balance > 0
    let unpaidList: Array<{ balance: number; days: number }> = [];

    if (openInvoices && openInvoices.length > 0) {
      unpaidList = openInvoices
        .filter((inv: any) => Number(inv.total || 0) > Number(inv.paid_amount || 0))
        .map((inv: any) => {
          const bal = Number(inv.total || 0) - Number(inv.paid_amount || 0);
          const invDate = inv.invoice_date ? new Date(inv.invoice_date) : now;
          const diffDays = Math.max(0, Math.floor((now.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24)));
          return { balance: bal, days: diffDays };
        });
    } else if (data?.pending_payments && Array.isArray(data.pending_payments) && data.pending_payments.length > 0) {
      unpaidList = data.pending_payments.map((item: any) => ({
        balance: Number(item.due_amount || item.balance || item.total || 0),
        days: Number(item.days_overdue || 0),
      }));
    }

    if (unpaidList.length > 0) {
      let b0_7 = 0;
      let b8_30 = 0;
      let b31_60 = 0;
      let b60_plus = 0;

      let c0_7 = 0;
      let c8_30 = 0;
      let c31_60 = 0;
      let c60_plus = 0;

      unpaidList.forEach((item) => {
        if (item.days <= 7) {
          b0_7 += item.balance;
          c0_7 += 1;
        } else if (item.days <= 30) {
          b8_30 += item.balance;
          c8_30 += 1;
        } else if (item.days <= 60) {
          b31_60 += item.balance;
          c31_60 += 1;
        } else {
          b60_plus += item.balance;
          c60_plus += 1;
        }
      });

      const tot = b0_7 + b8_30 + b31_60 + b60_plus;
      if (tot > 0) {
        const maxVal = Math.max(b0_7, b8_30, b31_60, b60_plus, 1);
        const formatCompact = (amt: number) => {
          if (amt === 0) return '₹0';
          if (amt >= 100000) return `₹${(amt / 100000).toFixed(1)}L`;
          if (amt >= 1000) return `₹${(amt / 1000).toFixed(1)}k`;
          return formatINR(amt);
        };

        return {
          hasData: true,
          total: tot,
          invoiceCount: unpaidList.length,
          buckets: [
            { label: '0–7 days', amount: b0_7, count: c0_7, display: formatCompact(b0_7), fillPercent: b0_7 > 0 ? Math.max(14, Math.round((b0_7 / maxVal) * 88)) : 6, color: '#0F766E' },
            { label: '8–30 days', amount: b8_30, count: c8_30, display: formatCompact(b8_30), fillPercent: b8_30 > 0 ? Math.max(14, Math.round((b8_30 / maxVal) * 88)) : 6, color: '#8FA0B5' },
            { label: '31–60 days', amount: b31_60, count: c31_60, display: formatCompact(b31_60), fillPercent: b31_60 > 0 ? Math.max(14, Math.round((b31_60 / maxVal) * 88)) : 6, color: '#D97706' },
            { label: '60+ days', amount: b60_plus, count: c60_plus, display: formatCompact(b60_plus), fillPercent: b60_plus > 0 ? Math.max(14, Math.round((b60_plus / maxVal) * 88)) : 6, color: '#DC2626' },
          ],
        };
      }
    }

    // Zero-data state (Brand new business / 100% Cleared receivables)
    return {
      hasData: false,
      total: 0,
      invoiceCount: 0,
      buckets: [
        { label: '0–7 days', amount: 0, count: 0, display: '₹0', fillPercent: 8, color: '#CBD5E1' },
        { label: '8–30 days', amount: 0, count: 0, display: '₹0', fillPercent: 8, color: '#CBD5E1' },
        { label: '31–60 days', amount: 0, count: 0, display: '₹0', fillPercent: 8, color: '#CBD5E1' },
        { label: '60+ days', amount: 0, count: 0, display: '₹0', fillPercent: 8, color: '#CBD5E1' },
      ],
    };
  }, [openInvoices, data?.pending_payments]);

  // Bills per Day Histogram (Dynamic calculation from month's invoices & Zero-state support)
  const dailyBillsData = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const currentDay = now.getDate();
    const monthLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(now);
    const shortMonth = new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(now);

    const dayCounts = Array(daysInMonth).fill(0);
    if (monthInvoices && monthInvoices.length > 0) {
      monthInvoices.forEach((inv: any) => {
        if (!inv.invoice_date) return;
        const raw = String(inv.invoice_date).trim();
        let billYear: number;
        let billMonth: number; // 0-indexed
        let billDay: number;

        if (raw.includes('T') || raw.includes('Z')) {
          // If serialized as ISO timestamp, parse in local browser timezone (IST)
          const d = new Date(raw);
          billYear = d.getFullYear();
          billMonth = d.getMonth();
          billDay = d.getDate();
        } else {
          // Standard 'YYYY-MM-DD' date string
          const parts = raw.split('-');
          billYear = parseInt(parts[0], 10);
          billMonth = parseInt(parts[1], 10) - 1;
          billDay = parseInt(parts[2], 10);
        }

        // Only count if it belongs to this current month and year
        if (billYear === year && billMonth === month && billDay >= 1 && billDay <= daysInMonth) {
          dayCounts[billDay - 1] += 1;
        }
      });
    }

    const total = dayCounts.reduce((a, b) => a + b, 0);
    const maxVal = Math.max(...dayCounts, 1);
    const avg = total > 0 ? (total / Math.max(1, currentDay)).toFixed(1) : '0';

    return {
      hasData: total > 0,
      monthLabel,
      shortMonth,
      totalBills: total,
      avgPerDay: avg,
      currentDayIndex: currentDay - 1,
      days: dayCounts.map((count, idx) => ({
        day: idx + 1,
        dateLabel: `${idx + 1} ${shortMonth}`,
        count,
        heightPct: total > 0 && count > 0 ? Math.max(12, Math.round((count / maxVal) * 88)) : 8,
        isToday: idx === currentDay - 1,
      })),
    };
  }, [monthInvoices]);

  // Top Services Percentage based on bills (Dynamic calculation with Circle Donut Chart & Zero-state support)
  const topServicesData = useMemo(() => {
    const raw = activeData?.top_services || data?.top_services;
    const now = new Date();
    const monthYearLabel = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(now);
    const palette = ['#0F766E', '#0284C7', '#0F172A', '#E11D48', '#D97706'];

    if (raw && Array.isArray(raw) && raw.length > 0 && raw.some((item: any) => Number(item.count || 0) > 0)) {
      const validItems = raw.filter((item: any) => Number(item.count || 0) > 0);
      const totalCount = validItems.reduce((sum: number, item: any) => sum + Number(item.count || 0), 0);

      if (totalCount === 0) {
        return {
          hasData: false,
          monthYearLabel,
          totalBills: 0,
          services: [],
        };
      }

      // Display up to 5 items:
      // If <= 5 items: show all
      // If > 5 items: top 4 + "Other services" grouping the remainder
      let displayItems: { name: string; count: number; color: string }[] = [];
      if (validItems.length <= 5) {
        displayItems = validItems.map((item: any, idx: number) => ({
          name: item.name || 'Service',
          count: Number(item.count || 0),
          color: palette[idx % palette.length],
        }));
      } else {
        const top4 = validItems.slice(0, 4).map((item: any, idx: number) => ({
          name: item.name || 'Service',
          count: Number(item.count || 0),
          color: palette[idx % palette.length],
        }));
        const othersCount = validItems.slice(4).reduce((sum: number, item: any) => sum + Number(item.count || 0), 0);
        top4.push({
          name: 'Other services',
          count: othersCount,
          color: palette[4],
        });
        displayItems = top4;
      }

      // Largest Remainder Method: ensures exact 100% total integer percentages without rounding anomalies
      const itemsWithPerc = displayItems.map(item => {
        const rawPct = (item.count / totalCount) * 100;
        const floorPct = Math.floor(rawPct);
        const remainder = rawPct - floorPct;
        return {
          ...item,
          rawPct,
          percentage: floorPct,
          remainder,
        };
      });

      const currentSum = itemsWithPerc.reduce((acc, it) => acc + it.percentage, 0);
      const diff = 100 - currentSum;
      if (diff > 0 && itemsWithPerc.length > 0) {
        const sortedIndices = itemsWithPerc
          .map((it, idx) => ({ idx, remainder: it.remainder }))
          .sort((a, b) => b.remainder - a.remainder);

        for (let i = 0; i < diff; i++) {
          const targetIdx = sortedIndices[i % sortedIndices.length].idx;
          itemsWithPerc[targetIdx].percentage += 1;
        }
      }

      const services = itemsWithPerc.map(({ rawPct, remainder, ...rest }) => rest);

      return {
        hasData: true,
        monthYearLabel,
        totalBills: totalCount,
        services,
      };
    }

    // Zero-data fallback: Use configured services from settings if available
    if (configuredServices && configuredServices.length > 0) {
      const items = configuredServices.slice(0, 5).map((srv: any, idx: number) => ({
        name: srv.name || 'Service',
        count: 0,
        percentage: 0,
        color: palette[idx % palette.length],
      }));

      return {
        hasData: false,
        monthYearLabel,
        totalBills: 0,
        services: items,
      };
    }

    // Pristine default zero state
    return {
      hasData: false,
      monthYearLabel,
      totalBills: 0,
      services: [],
    };
  }, [activeData?.top_services, data?.top_services, configuredServices]);

  // Chart data
  const chartPoints = useMemo(() => {
    const raw = activeData?.chart_data || data?.chart_data || [];
    if (raw.length > 0 && raw.some((p: any) => (p.income || 0) > 0 || (p.expenses || p.outgoing || 0) > 0)) {
      return raw.map((p: any, idx: number) => {
        let label = p.label || p.date_label || p.date || '';
        let fullDate = p.full_date || p.date_str || p.raw_date || label;

        if (!label && p.date_str) {
          const parts = String(p.date_str).split('-');
          if (parts.length === 3) {
            const d = new Date(p.date_str);
            if (!isNaN(d.getTime())) {
              label = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(d);
              fullDate = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
            }
          } else if (parts.length === 2) {
            const d = new Date(`${p.date_str}-01`);
            if (!isNaN(d.getTime())) {
              label = new Intl.DateTimeFormat('en-IN', { month: 'short' }).format(d);
              fullDate = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(d);
            }
          }
        } else if (!label && p.raw_date) {
          const d = new Date(p.raw_date);
          if (!isNaN(d.getTime())) {
            label = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(d);
            fullDate = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(d);
          }
        }

        if (!label) {
          label = period === 'THIS_YEAR' ? `M${idx + 1}` : `Day ${idx + 1}`;
        }

        return {
          label,
          fullDate,
          income: Number(p.income || 0),
          outgoing: Number(p.expenses || p.outgoing || 0),
        };
      });
    }

    // Period-appropriate data when empty (clean 0s for fresh businesses)
    if (period === 'THIS_YEAR') {
      return [
        { label: 'Apr', fullDate: 'April', income: 0, outgoing: 0 },
        { label: 'May', fullDate: 'May', income: 0, outgoing: 0 },
        { label: 'Jun', fullDate: 'June', income: 0, outgoing: 0 },
        { label: 'Jul', fullDate: 'July', income: 0, outgoing: 0 },
        { label: 'Aug', fullDate: 'August', income: 0, outgoing: 0 },
        { label: 'Sep', fullDate: 'September', income: 0, outgoing: 0 },
        { label: 'Oct', fullDate: 'October', income: 0, outgoing: 0 },
        { label: 'Nov', fullDate: 'November', income: 0, outgoing: 0 },
        { label: 'Dec', fullDate: 'December', income: 0, outgoing: 0 },
        { label: 'Jan', fullDate: 'January', income: 0, outgoing: 0 },
        { label: 'Feb', fullDate: 'February', income: 0, outgoing: 0 },
        { label: 'Mar', fullDate: 'March', income: 0, outgoing: 0 },
      ];
    }

    if (period === 'TODAY') {
      return [
        { label: '9 AM', fullDate: 'Today 9:00 AM', income: 0, outgoing: 0 },
        { label: '11 AM', fullDate: 'Today 11:00 AM', income: 0, outgoing: 0 },
        { label: '1 PM', fullDate: 'Today 1:00 PM', income: 0, outgoing: 0 },
        { label: '3 PM', fullDate: 'Today 3:00 PM', income: 0, outgoing: 0 },
        { label: '5 PM', fullDate: 'Today 5:00 PM', income: 0, outgoing: 0 },
        { label: '7 PM', fullDate: 'Today 7:00 PM', income: 0, outgoing: 0 },
        { label: '9 PM', fullDate: 'Today 9:00 PM', income: 0, outgoing: 0 },
      ];
    }

    return [
      { label: '1-5', fullDate: 'Day 1–5', income: 0, outgoing: 0 },
      { label: '6-10', fullDate: 'Day 6–10', income: 0, outgoing: 0 },
      { label: '11-15', fullDate: 'Day 11–15', income: 0, outgoing: 0 },
      { label: '16-20', fullDate: 'Day 16–20', income: 0, outgoing: 0 },
      { label: '21-25', fullDate: 'Day 21–25', income: 0, outgoing: 0 },
      { label: '26-30', fullDate: 'Day 26–30', income: 0, outgoing: 0 },
    ];
  }, [activeData?.chart_data, data?.chart_data, period]);

  // Payment methods breakdown
  const pm = activeData?.payment_methods || data?.payment_methods || {};
  const cashAmt = Number(pm.cash || 0);
  const upiAmt = Number(pm.upi || 0);
  const bankAmt = Number(pm.bank || 0);
  const cardAmt = Number(pm.card || 0);
  const totalPm = cashAmt + upiAmt + bankAmt + cardAmt;

  const modePercentages = useMemo(() => {
    if (totalPm > 0) {
      const c = Math.round((cashAmt / totalPm) * 100);
      const u = Math.round((upiAmt / totalPm) * 100);
      const b = Math.round((bankAmt / totalPm) * 100);
      const cd = Math.max(0, 100 - (c + u + b));
      return { cash: c, upi: u, bank: b, card: cd };
    }
    return { cash: 0, upi: 0, bank: 0, card: 0 };
  }, [cashAmt, upiAmt, bankAmt, cardAmt, totalPm]);

  // Sparklines
  const incomeSparkline = useMemo(() => [0, 0, 0, 0, 0, 0, 0], []);
  const outgoingSparkline = useMemo(() => [0, 0, 0, 0, 0, 0, 0], []);
  const profitSparkline = useMemo(() => [0, 0, 0, 0, 0, 0, 0], []);

  // Jobs statistics & list
  const jobsStats = data?.jobs || {};
  const redDays = Number(business?.red_days ?? 3);
  const yellowDays = Number(business?.yellow_days ?? 5);

  const redDaysLabel = `${redDays} ${redDays === 1 ? 'day' : 'days'} or less`;
  const yellowDaysLabel =
    yellowDays > redDays + 1
      ? `${redDays + 1}–${yellowDays} days`
      : yellowDays === redDays + 1
      ? `${yellowDays} ${yellowDays === 1 ? 'day' : 'days'}`
      : `${yellowDays} days`;

  const redCount = jobTabCounts?.red ?? (jobsStats.red_count ?? jobsStats.late_count ?? 0);
  const yellowCount = jobTabCounts?.yellow ?? (jobsStats.yellow_count ?? jobsStats.due_soon_count ?? 0);
  const onTrackCount = jobsStats.pending ? Math.max(0, jobsStats.pending - (redCount + yellowCount)) : 0;
  const completedToday = jobTabCounts?.completed ?? (jobsStats.completed_today ?? 0);
  const totalJobBuckets = (redCount + yellowCount + onTrackCount) || 1;

  const jobPercentages = {
    red: Math.round((redCount / totalJobBuckets) * 100),
    yellow: Math.round((yellowCount / totalJobBuckets) * 100),
    onTrack: Math.max(0, 100 - (Math.round((redCount / totalJobBuckets) * 100) + Math.round((yellowCount / totalJobBuckets) * 100))),
  };

  const displayUrgentJobs = useMemo(() => {
    if (!urgentJobs || urgentJobs.length === 0) return [];
    // Show all late jobs (days_left < 0) first, then urgent jobs (<= 5 days)
    const lateJobs = urgentJobs.filter((j: any) => {
      const d = parseInt(String(j.days_left), 10);
      return !isNaN(d) && d < 0;
    });
    const upcomingUrgent = urgentJobs.filter((j: any) => {
      const d = parseInt(String(j.days_left), 10);
      return !isNaN(d) && d >= 0 && d <= yellowDays;
    });
    const combined = [...lateJobs, ...upcomingUrgent];
    return combined.length > 0 ? combined : urgentJobs.slice(0, 4);
  }, [urgentJobs, yellowDays]);

  // Recent bills list (Live DB Data matching BillsPage exactly - strictly 8 recent bills, all statuses, exact same order)
  const recentBillsList = useMemo(() => {
    const raw = recentInvoices.length > 0 ? recentInvoices : (data?.recent_bills || data?.recent_invoices);
    if (raw && Array.isArray(raw) && raw.length > 0) {
      const now = new Date();
      return raw.slice(0, 8).map((inv: any) => {
        const total = Number(inv.total || 0);
        const paid = Number(inv.paid_amount || 0);
        const bal = Math.max(0, total - paid);
        const isCancelled = inv.status === 'CANCELLED';
        const isOverdue = inv.status === 'ACTIVE' && bal > 0 && inv.due_date && new Date(inv.due_date) < now;

        let statusText = 'Unpaid';
        let statusDotColor = 'bg-[#64748B]';
        let statusTextColor = 'text-[#64748B]';

        if (isCancelled) {
          statusText = 'Cancelled';
          statusDotColor = 'bg-[#9CA3AF]';
          statusTextColor = 'text-[#9CA3AF] line-through';
        } else if (paid >= total && total > 0) {
          statusText = 'Paid';
          statusDotColor = 'bg-[#16A34A]';
          statusTextColor = 'text-[#16A34A]';
        } else if (paid > 0 && bal > 0) {
          statusText = 'Partial';
          statusDotColor = 'bg-[#D97706]';
          statusTextColor = 'text-[#D97706]';
        } else if (isOverdue) {
          statusText = 'Overdue';
          statusDotColor = 'bg-[#DC2626]';
          statusTextColor = 'text-[#DC2626]';
        } else {
          statusText = 'Unpaid';
          statusDotColor = 'bg-[#64748B]';
          statusTextColor = 'text-[#64748B]';
        }

        return {
          id: inv.id,
          number: inv.number,
          party_name: inv.party_name || 'Walk-in',
          total,
          balance: bal,
          status: inv.status,
          statusText,
          statusDotColor,
          statusTextColor,
          dateText: inv.invoice_date ? formatDate(inv.invoice_date) : getRelativeTime(inv.created_at),
        };
      });
    }
    return [];
  }, [recentInvoices, data?.recent_bills, data?.recent_invoices]);

  // Needs follow-up data (100% Live DB Data across dues_list RPC, openInvoices, and Zero-State)
  const needsFollowupData = useMemo(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);

    let rawList: any[] = [];
    let summaryTotal: number | null = null;
    let summaryCustomerCount: number | null = null;

    // 1. Check duesSummary from dues_list RPC
    if (duesSummary && Array.isArray(duesSummary.bills) && duesSummary.bills.length > 0) {
      rawList = duesSummary.bills.map((b: any) => {
        const daysOverdue = Number(
          b.days_overdue ??
            (b.due_date
              ? Math.max(0, Math.floor((now.getTime() - new Date(b.due_date).getTime()) / (1000 * 60 * 60 * 24)))
              : 0)
        );
        const isOverdue = Boolean(b.is_overdue || daysOverdue > 0);
        const bal = Number(b.balance ?? b.due_amount ?? (Number(b.total || 0) - Number(b.paid_amount || 0)));
        const dueDate = b.due_date ? String(b.due_date).slice(0, 10) : '';
        const isDueToday = dueDate === todayStr;

        let dueText = 'due soon';
        if (isOverdue) {
          dueText = `${daysOverdue} day${daysOverdue > 1 ? 's' : ''} overdue`;
        } else if (isDueToday) {
          dueText = 'Due today';
        } else if (dueDate) {
          try {
            dueText = `Due ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(b.due_date))}`;
          } catch {
            dueText = 'due soon';
          }
        }

        return {
          id: b.id,
          number: b.number,
          name: b.party_name || b.customer_name || 'Customer',
          mobile: b.party_mobile || b.customer_mobile,
          amount: bal,
          daysOverdue,
          isOverdue,
          isDueToday,
          dueText,
          dueDate: b.due_date,
        };
      });

      const sTot = Number(duesSummary?.summary?.total_outstanding ?? duesSummary?.total_outstanding);
      if (!isNaN(sTot) && sTot > 0) summaryTotal = sTot;

      const sCust = Number(duesSummary?.summary?.customer_count ?? duesSummary?.customer_count);
      if (!isNaN(sCust) && sCust > 0) summaryCustomerCount = sCust;
    }
    // 2. Check openInvoices from direct table query
    else if (openInvoices && openInvoices.length > 0) {
      const unpaid = openInvoices.filter(
        (inv: any) => Number(inv.total || 0) > Number(inv.paid_amount || 0)
      );

      if (unpaid.length > 0) {
        rawList = unpaid.map((inv: any) => {
          const bal = Number(inv.total || 0) - Number(inv.paid_amount || 0);
          const dueDate = inv.due_date ? String(inv.due_date).slice(0, 10) : '';
          const dueTime = inv.due_date
            ? new Date(inv.due_date).getTime()
            : inv.invoice_date
            ? new Date(inv.invoice_date).getTime()
            : now.getTime();
          const diffDays = Math.floor((now.getTime() - dueTime) / (1000 * 60 * 60 * 24));
          const isOverdue = diffDays > 0;
          const isDueToday = dueDate === todayStr || diffDays === 0;

          let dueText = 'due soon';
          if (isOverdue) {
            dueText = `${diffDays} day${diffDays > 1 ? 's' : ''} overdue`;
          } else if (isDueToday) {
            dueText = 'Due today';
          } else if (dueDate) {
            try {
              dueText = `Due ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(inv.due_date))}`;
            } catch {
              dueText = 'due soon';
            }
          }

          return {
            id: inv.id,
            number: inv.number,
            name: inv.party_name || 'Customer',
            mobile: inv.party_mobile,
            amount: bal,
            daysOverdue: Math.max(0, diffDays),
            isOverdue,
            isDueToday,
            dueText,
            dueDate: inv.due_date,
          };
        });
      }
    }
    // 3. Fallback: check data?.pending_payments
    else if (data?.pending_payments && Array.isArray(data.pending_payments) && data.pending_payments.length > 0) {
      rawList = data.pending_payments.map((p: any) => {
        const days = Number(p.days_overdue || 0);
        const isOverdue = days > 0;
        const dueDate = p.due_date ? String(p.due_date).slice(0, 10) : '';
        const isDueToday = dueDate === todayStr;

        let dueText = isOverdue
          ? `${days} day${days > 1 ? 's' : ''} overdue`
          : isDueToday
          ? 'Due today'
          : 'due soon';

        return {
          id: p.id,
          number: p.number,
          name: p.party_name || 'Customer',
          mobile: p.party_mobile,
          amount: Number(p.due_amount ?? p.balance ?? 0),
          daysOverdue: days,
          isOverdue,
          isDueToday,
          dueText,
          dueDate: p.due_date,
        };
      });
      const dashTot = Number(data?.total_outstanding || 0);
      if (dashTot > 0) summaryTotal = dashTot;
    }

    // Filter to bills with real balance
    const validBills = rawList.filter((b: any) => b.amount > 0);

    const calculatedTotal = validBills.reduce((acc: number, b: any) => acc + b.amount, 0);
    const finalTotal = summaryTotal !== null && summaryTotal > 0 ? summaryTotal : calculatedTotal;

    const uniqueParties = new Set(validBills.map((b: any) => b.mobile || b.name)).size;
    const finalCustomerCount =
      summaryCustomerCount !== null && summaryCustomerCount > 0 ? summaryCustomerCount : uniqueParties;

    // Prioritize Overdue bills (highest days overdue first), then Due today, then upcoming
    const sortedBills = [...validBills].sort((a: any, b: any) => {
      if (a.isOverdue && !b.isOverdue) return -1;
      if (!a.isOverdue && b.isOverdue) return 1;
      if (a.isOverdue && b.isOverdue) return b.daysOverdue - a.daysOverdue;
      if (a.isDueToday && !b.isDueToday) return -1;
      if (!a.isDueToday && b.isDueToday) return 1;
      const dateA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
      const dateB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
      return dateA - dateB;
    });

    const hasData = finalTotal > 0 || sortedBills.length > 0;
    const overdueCount = sortedBills.filter((b: any) => b.isOverdue).length;

    return {
      hasData,
      totalOutstanding: finalTotal,
      customerCount: finalCustomerCount,
      overdueCount,
      items: sortedBills,
    };
  }, [duesSummary, openInvoices, data?.pending_payments, data?.total_outstanding]);

  const handleSendCustomerReminder = (item: any) => {
    const bizName = business?.name || 'Simplify';
    const amountStr = formatINR(item.amount);
    const billRef = item.number ? `bill #${item.number}` : 'your pending invoice';

    let reminderMsg = `Dear ${item.name}, your payment of ${amountStr} for ${billRef} is pending. Kindly clear the dues at your earliest convenience. Thank you! - ${bizName}`;
    if (item.isOverdue && item.daysOverdue > 0) {
      reminderMsg = `Dear ${item.name}, friendly reminder that payment of ${amountStr} for ${billRef} is overdue by ${item.daysOverdue} day${item.daysOverdue > 1 ? 's' : ''}. Kindly arrange the payment at your earliest convenience. Thank you! - ${bizName}`;
    }

    if (!item.mobile) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(reminderMsg);
        showToast(`Copied reminder for ${item.name} to clipboard (no mobile number on bill)`, 'info');
      } else {
        showToast(`Reminder text ready for ${item.name} (no mobile number on bill)`, 'info');
      }
      return;
    }

    const cleanMobile = item.mobile.replace(/[^0-9]/g, '').slice(-10);
    const encoded = encodeURIComponent(reminderMsg);
    window.open(`https://wa.me/91${cleanMobile}?text=${encoded}`, '_blank');
  };

  const handleRemindAll = () => {
    if (needsFollowupData.items.length === 0) {
      showToast('No pending customer dues to remind', 'info');
      return;
    }
    const withMobile = needsFollowupData.items.filter((i: any) => i.mobile);
    if (withMobile.length > 0) {
      handleSendCustomerReminder(withMobile[0]);
      if (withMobile.length > 1) {
        showToast(
          `Reminder opened for ${withMobile[0].name}. ${withMobile.length - 1} more pending in dues list.`,
          'info'
        );
      }
    } else {
      navigate('/money?tab=dues');
    }
  };

  if (loading && !data) {
    return (
      <div className="space-y-6 max-w-[1240px] mx-auto p-2 sm:p-4">
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-10 w-48" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
        <Skeleton className="h-80 rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="max-w-[1240px] mx-auto space-y-6 select-none pb-12">
      {/* 1. Greeting & Period Selector Row */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold text-[#111827] tracking-tight">
            {greeting}, {member?.name || business?.owner_name || 'Owner'}
          </h1>
          <p className="text-[13px] text-[#6B7280] mt-0.5 font-normal">
            {fullDateDisplay}
          </p>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-nowrap w-full sm:w-auto">
          {/* Segmented Control Pill matching screenshot (Today & This month for Staff, full periods for Owner) */}
          <div className="flex-1 sm:flex-initial flex items-center bg-[#EEF0F3] p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setPeriod('TODAY')}
              className={clsx(
                'flex-1 sm:flex-initial text-center px-3 sm:px-3.5 py-1.5 rounded-lg text-[13px] transition-all cursor-pointer whitespace-nowrap',
                period === 'TODAY'
                  ? 'bg-white text-[#111827] font-medium shadow-sm'
                  : 'text-[#6B7280] hover:text-[#111827] font-normal'
              )}
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setPeriod('THIS_MONTH')}
              className={clsx(
                'flex-1 sm:flex-initial text-center px-3 sm:px-3.5 py-1.5 rounded-lg text-[13px] transition-all cursor-pointer whitespace-nowrap',
                period === 'THIS_MONTH'
                  ? 'bg-white text-[#111827] font-medium shadow-sm'
                  : 'text-[#6B7280] hover:text-[#111827] font-normal'
              )}
            >
              This month
            </button>
            {!isStaff && (
              <button
                type="button"
                onClick={() => setPeriod('THIS_YEAR')}
                className={clsx(
                  'flex-1 sm:flex-initial text-center px-3 sm:px-3.5 py-1.5 rounded-lg text-[13px] transition-all cursor-pointer whitespace-nowrap',
                  period === 'THIS_YEAR'
                    ? 'bg-white text-[#111827] font-medium shadow-sm'
                    : 'text-[#6B7280] hover:text-[#111827] font-normal'
                )}
              >
                This year
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => loadDashboard(true)}
            disabled={loading || refreshing}
            aria-label="Refresh dashboard"
            className="p-2 rounded-xl border-0 bg-white hover:bg-[#F9FAFB] text-[#6B7280] hover:text-[#111827] transition-all disabled:opacity-50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_6px_rgba(0,0,0,0.06)] cursor-pointer shrink-0"
            title="Refresh dashboard"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-[#0F766E]' : ''}`} />
          </button>

          {/* Primary + New bill Button */}
          <button
            type="button"
            onClick={() => navigate('/bills/new')}
            className="flex items-center gap-1.5 px-3.5 sm:px-4 py-2 rounded-xl bg-[#111827] hover:bg-[#1F2937] text-white text-[13px] sm:text-[13.5px] font-medium shadow-[0_1px_2px_rgba(0,0,0,0.12)] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            <span>New bill</span>
          </button>
        </div>
      </div>

      {/* 2. Action Pill Buttons Row (Owner only - Receipt, Payment, Expense, Customer - 1 Row) */}
      {!isStaff && (
        <div className="grid grid-cols-4 gap-2 sm:gap-2.5">
          <button
            type="button"
            onClick={() => navigate('/money?tab=receipts')}
            className="flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2.5 rounded-2xl bg-white border-0 text-[13px] font-semibold text-[#111827] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:bg-[#F8FAFC] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
          >
            <ArrowDownLeft className="w-4 h-4 text-[#0F766E] shrink-0" />
            <span>Receipt</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/money?tab=payments')}
            className="flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2.5 rounded-2xl bg-white border-0 text-[13px] font-semibold text-[#111827] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:bg-[#F8FAFC] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
          >
            <ArrowUpRight className="w-4 h-4 text-[#4B5563] shrink-0" />
            <span>Payment</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/money?tab=expenses')}
            className="flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2.5 rounded-2xl bg-white border-0 text-[13px] font-semibold text-[#111827] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:bg-[#F8FAFC] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
          >
            <Calendar className="w-4 h-4 text-[#D97706] shrink-0" />
            <span>Expense</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/customers')}
            className="flex items-center justify-center gap-1.5 sm:gap-2 px-2 sm:px-4 py-2.5 rounded-2xl bg-white border-0 text-[13px] font-semibold text-[#111827] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:bg-[#F8FAFC] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] active:scale-[0.98] transition-all cursor-pointer whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4 text-[#4B5563] shrink-0" />
            <span>Customer</span>
          </button>
        </div>
      )}

      {/* 3. Main Dashboard Content: Dedicated "My Dashboard" for Staff vs Full Business Suite for Owner */}
      {isStaff ? (
        <StaffMyDayView
          data={staffData}
          loading={loading}
          onRefresh={() => loadDashboard(true)}
          period={period === 'THIS_MONTH' ? 'THIS_MONTH' : 'TODAY'}
          business={business}
          member={member}
          onSelectBill={handleOpenBillModal}
          onSelectJob={handleOpenJobModal}
        />
      ) : (
        <>
          {/* 3. Top 4 Metric Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Income Card */}
        <StatCard
          label="Income"
          value={formatINR(income)}
          onClick={() => navigate('/money?tab=receipts')}
          delta={{
            value: '+12.4%',
            isPositive: true,
            label: 'vs last month',
          }}
          icon={
            <div className="w-7 h-7 rounded-full bg-white text-[#0F766E] shadow-2xs flex items-center justify-center shrink-0">
              <ArrowDownLeft className="w-4 h-4" />
            </div>
          }
          sparklineData={incomeSparkline}
        />

        {/* Outgoing Card */}
        <StatCard
          label="Outgoing"
          value={formatINR(outgoing)}
          onClick={() => navigate('/money?tab=expenses')}
          delta={{
            value: '+4.1%',
            isPositive: false,
            label: 'vs last month',
          }}
          icon={
            <div className="w-7 h-7 rounded-full bg-white text-[#4B5563] shadow-2xs flex items-center justify-center shrink-0">
              <ArrowUpRight className="w-4 h-4" />
            </div>
          }
          sparklineData={outgoingSparkline}
        />

        {/* Net Profit Card */}
        <StatCard
          label="Net profit"
          value={formatINR(netProfit)}
          onClick={() => navigate('/reports?tab=pnl')}
          delta={{
            value: '+21.8%',
            isPositive: true,
            label: 'cash basis',
          }}
          icon={
            <div className="w-7 h-7 rounded-full bg-white text-[#0F766E] shadow-2xs flex items-center justify-center shrink-0">
              <TrendingUp className="w-4 h-4" />
            </div>
          }
          sparklineData={profitSparkline}
        />

        {/* Outstanding Card */}
        <StatCard
          label="Outstanding"
          value={formatINR(totalOutstanding)}
          onClick={() => navigate('/money?tab=dues')}
          secondaryLine={`Loan outstanding ${formatINR(loanOutstanding)} · kept separate`}
          icon={
            <div className="w-7 h-7 rounded-full bg-white text-[#D97706] shadow-2xs flex items-center justify-center shrink-0">
              <FileText className="w-4 h-4" />
            </div>
          }
        />
      </div>

      {/* Cash and Bank Live Balances Card (Matching Screenshot & Dynamic Multi-Account Support) */}
      <Card className="p-5 sm:p-6 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
              Cash and bank
            </h2>
            <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
              Current balance in every account
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/money?tab=bank')}
            className="text-[12.5px] sm:text-[13px] font-semibold text-[#0F766E] hover:text-[#0D655E] hover:underline cursor-pointer flex items-center gap-1"
          >
            Manage accounts
          </button>
        </div>

        {/* Content: Left Total Liquid Funds + Right Accounts Carousel */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          {/* Left Column: Liquid Funds & Bar Breakdown */}
          <div
            onClick={() => navigate('/money?tab=bank')}
            className="lg:col-span-4 flex flex-col justify-between pr-0 lg:pr-5 lg:border-r lg:border-[#F1F5F9] cursor-pointer group"
            title="View Cash & Bank accounts"
          >
            <div>
              <div className="text-[12px] font-medium text-[#64748B] group-hover:text-[#0F766E] transition-colors">Total liquid funds</div>
              <div className="text-[26px] sm:text-[28px] font-extrabold text-[#0F172A] tracking-tight mt-0.5 tabular-nums">
                {formatINR(cashBankCalculations.totalLiquid)}
              </div>
              <div className="text-[12px] text-[#64748B] mt-0.5">
                {cashBankCalculations.accountCountLabel}
              </div>
            </div>

            <div className="mt-4 pt-1">
              {/* Multi-segment progress bar */}
              <div className="h-2 flex w-full gap-1 rounded-full overflow-hidden bg-[#F1F5F9]">
                {cashBankCalculations.segments.map((seg, idx) => (
                  <div
                    key={idx}
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${seg.percentage}%`,
                      backgroundColor: seg.color,
                      minWidth: seg.percentage > 0 ? '6px' : '0px',
                    }}
                    title={`${seg.name}: ${seg.percentage}% (${formatINR(seg.amount)})`}
                  />
                ))}
              </div>

              {/* Legend with account percentages */}
              <div className="flex items-center gap-3.5 mt-2.5 text-[11.5px] sm:text-[12px] font-medium text-[#334155] flex-wrap">
                {cashBankCalculations.segments.map((seg, idx) => (
                  <div key={idx} className="flex items-center gap-1.5 shrink-0">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span>
                      {seg.shortName} {seg.percentage}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Horizontally Scrollable Accounts (Smooth scroll with Wheel & Touch) */}
          <div className="lg:col-span-8 min-w-0 flex items-center">
            <div
              ref={cashBankScrollRef}
              className="flex items-stretch gap-3.5 overflow-x-auto no-scrollbar py-1 px-0.5 w-full"
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', overscrollBehaviorX: 'contain' }}
            >
              {/* 1. Cash in Hand Card (Dynamic sizing & Hover dark #F3F4F6, default #F7F8FA) */}
              <div
                onClick={() => navigate('/money?tab=bank')}
                className={clsx(
                  1 + cashBankCalculations.bankCards.length === 1
                    ? 'w-full max-w-[340px] flex-initial shrink-0'
                    : 1 + cashBankCalculations.bankCards.length === 2
                    ? 'flex-1 min-w-[220px] max-w-[360px] shrink-0 sm:shrink'
                    : 1 + cashBankCalculations.bankCards.length === 3
                    ? 'flex-1 min-w-[200px] max-w-none shrink-0 lg:shrink'
                    : 'min-w-[215px] sm:min-w-[225px] max-w-[255px] flex-1 shrink-0',
                  'bg-[#F7F8FA] hover:bg-[#F3F4F6] border-0 rounded-2xl p-4 flex flex-col justify-between transition-colors duration-150 cursor-pointer select-none'
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-white border border-[#E2E8F0]/70 shadow-2xs flex items-center justify-center text-[#0F766E] shrink-0">
                      <Banknote className="w-4 h-4 stroke-[2.2]" />
                    </div>
                    <div>
                      <div className="text-[13px] font-bold text-[#0F172A] leading-tight">Cash in hand</div>
                      <div className="text-[11px] text-[#64748B] mt-0.5">Drawer</div>
                    </div>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-[#0F172A] mt-1 shrink-0" />
                </div>

                <div className="my-3">
                  <div className="text-[21px] sm:text-[22px] font-extrabold text-[#0F172A] tracking-tight tabular-nums">
                    {formatINR(cashBankCalculations.cashBalance)}
                  </div>
                </div>

                <div className="text-[11.5px] text-[#64748B] truncate">
                  {renderActivityText(cashBankCalculations.cashActivityText)}
                </div>
              </div>

              {/* 2. Dynamic Bank Accounts (Dynamic sizing & Hover dark #F3F4F6, default #F7F8FA) */}
              {cashBankCalculations.bankCards.map((bank, idx) => (
                <div
                  key={bank.id || idx}
                  onClick={() => navigate(bank.id ? `/money?tab=bank&bankId=${bank.id}` : '/money?tab=bank')}
                  className={clsx(
                    1 + cashBankCalculations.bankCards.length === 2
                      ? 'flex-1 min-w-[220px] max-w-[360px] shrink-0 sm:shrink'
                      : 1 + cashBankCalculations.bankCards.length === 3
                      ? 'flex-1 min-w-[200px] max-w-none shrink-0 lg:shrink'
                      : 'min-w-[215px] sm:min-w-[225px] max-w-[255px] flex-1 shrink-0',
                    'bg-[#F7F8FA] hover:bg-[#F3F4F6] border-0 rounded-2xl p-4 flex flex-col justify-between transition-colors duration-150 cursor-pointer group select-none'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-xl bg-white border border-[#E2E8F0]/70 shadow-2xs flex items-center justify-center text-[#0F766E] group-hover:bg-[#E6F4F2] transition-colors shrink-0">
                        <Building2 className="w-4 h-4 stroke-[2.2]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-bold text-[#0F172A] leading-tight truncate">
                          {bank.bank_name}
                        </div>
                        <div className="text-[11px] text-[#64748B] mt-0.5 truncate font-mono">
                          {bank.maskedAccount}
                        </div>
                      </div>
                    </div>
                    <span
                      className="w-2 h-2 rounded-full mt-1 shrink-0"
                      style={{ backgroundColor: bank.color }}
                    />
                  </div>

                  <div className="my-3">
                    <div className="text-[21px] sm:text-[22px] font-extrabold text-[#0F172A] tracking-tight tabular-nums">
                      {formatINR(bank.current_balance)}
                    </div>
                  </div>

                  <div className="text-[11.5px] text-[#64748B] truncate">
                    {renderActivityText(bank.lastActivity)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {/* 4. Middle Section: Income vs Outgoing (Left 8 cols) & Jobs (Right 4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Income vs Outgoing Card with Integrated Receipts by mode */}
        <Card className="lg:col-span-8 flex flex-col p-5 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div>
                <h2 className="text-[15px] font-semibold text-[#111827]">Income vs outgoing</h2>
                <p className="text-[12px] text-[#6B7280]">
                  {period === 'THIS_YEAR'
                    ? `FY ${fyLabel}`
                    : period === 'TODAY'
                    ? 'Today'
                    : (dailyBillsData?.monthLabel || 'This month')} · cash basis
                </p>
              </div>
              <div className="flex items-center gap-4 text-[12px] font-medium">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#0F766E]" />
                  <span className="text-[#374151]">Income</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#94A3B8]" />
                  <span className="text-[#6B7280]">Outgoing</span>
                </div>
              </div>
            </div>

            <QuietChart data={chartPoints} height={220} showLegend={false} period={period} />
          </div>

          {/* Integrated Bottom: Receipts by mode */}
          <div
            onClick={() => navigate('/money?tab=receipts')}
            className="border-t border-[#F3F4F6] pt-3.5 mt-3 cursor-pointer group"
            title="View receipts in Money"
          >
            <div className="flex items-center justify-between text-[12.5px]">
              <span className="font-medium text-[#4B5563] group-hover:text-[#0F766E] transition-colors">Receipts by mode</span>
              <span className="text-[11.5px] text-[#0F766E] font-medium group-hover:underline">
                View receipts →
              </span>
            </div>

            {/* Segmented Pill Bar matching reference design */}
            <div className="h-2 flex w-full gap-1.5 mt-2">
              {modePercentages.cash === 0 && modePercentages.upi === 0 && modePercentages.bank === 0 && modePercentages.card === 0 ? (
                <div className="h-full w-full bg-[#F1F5F9] rounded-full" />
              ) : (
                <>
                  {modePercentages.cash > 0 && (
                    <div
                      className="h-full bg-[#111827] rounded-full transition-all duration-300"
                      style={{ flex: `${modePercentages.cash} 0 0%`, minWidth: '6px' }}
                      title={`Cash: ${modePercentages.cash}%`}
                    />
                  )}
                  {modePercentages.upi > 0 && (
                    <div
                      className="h-full bg-[#0D766E] rounded-full transition-all duration-300"
                      style={{ flex: `${modePercentages.upi} 0 0%`, minWidth: '6px' }}
                      title={`UPI: ${modePercentages.upi}%`}
                    />
                  )}
                  {modePercentages.bank > 0 && (
                    <div
                      className="h-full bg-[#8FA0B5] rounded-full transition-all duration-300"
                      style={{ flex: `${modePercentages.bank} 0 0%`, minWidth: '6px' }}
                      title={`Bank: ${modePercentages.bank}%`}
                    />
                  )}
                  {modePercentages.card > 0 && (
                    <div
                      className="h-full bg-[#CCD6E2] rounded-full transition-all duration-300"
                      style={{ flex: `${modePercentages.card} 0 0%`, minWidth: '6px' }}
                      title={`Card: ${modePercentages.card}%`}
                    />
                  )}
                </>
              )}
            </div>

            {/* Legend row */}
            <div className="flex items-center gap-5 mt-2.5 text-[12px] text-[#334155] flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#111827] shrink-0" />
                <span>Cash {modePercentages.cash}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#0D766E] shrink-0" />
                <span>UPI {modePercentages.upi}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#8FA0B5] shrink-0" />
                <span>Bank {modePercentages.bank}%</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[#CCD6E2] shrink-0" />
                <span>Card {modePercentages.card}%</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Right Column: Jobs Card matching reference screenshot */}
        <Card className="lg:col-span-4 flex flex-col justify-between p-5 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200">
          <div>
            {/* Header: Title + View all */}
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-[16px] font-bold text-[#111827]">Jobs</h2>
              <button
                type="button"
                onClick={() => navigate('/jobs')}
                className="text-[13px] font-medium text-[#0F766E] hover:underline cursor-pointer"
              >
                View all
              </button>
            </div>

            {/* Multi-color top status bar */}
            <div className="h-2 flex w-full mt-2 mb-3.5 gap-1.5">
              <div
                className="h-full bg-[#DC2626] rounded-full transition-all duration-300"
                style={{ flex: `${jobPercentages.red} 0 0%`, minWidth: '6px' }}
                title={`Red: ${redCount}`}
              />
              <div
                className="h-full bg-[#F59E0B] rounded-full transition-all duration-300"
                style={{ flex: `${jobPercentages.yellow} 0 0%`, minWidth: '6px' }}
                title={`Yellow: ${yellowCount}`}
              />
              <div
                className="h-full bg-[#E2E8F0] rounded-full transition-all duration-300"
                style={{ flex: `${jobPercentages.onTrack} 0 0%`, minWidth: '6px' }}
                title={`On track: ${onTrackCount}`}
              />
            </div>

            {/* Breakdown count rows matching screenshot */}
            <div className="space-y-1.5 text-[13px]">
              <div
                onClick={() => navigate('/jobs?tab=RED')}
                className="flex items-center justify-between p-1.5 -mx-1.5 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
                title="View Red Jobs"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-[#DC2626]" />
                  <span className="text-[#374151] group-hover:text-[#DC2626] transition-colors">Red · {redDaysLabel}</span>
                </div>
                <span className="font-bold text-[#111827] tabular-nums">
                  {redCount}
                </span>
              </div>

              <div
                onClick={() => navigate('/jobs?tab=YELLOW')}
                className="flex items-center justify-between p-1.5 -mx-1.5 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
                title="View Yellow Jobs"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                  <span className="text-[#374151] group-hover:text-[#D97706] transition-colors">Yellow · {yellowDaysLabel}</span>
                </div>
                <span className="font-bold text-[#111827] tabular-nums">
                  {yellowCount}
                </span>
              </div>

              <div
                onClick={() => navigate('/jobs?tab=CURRENT')}
                className="flex items-center justify-between p-1.5 -mx-1.5 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
                title="View On Track Jobs"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-[#94A3B8]" />
                  <span className="text-[#374151] group-hover:text-[#0F172A] transition-colors">On track</span>
                </div>
                <span className="font-bold text-[#111827] tabular-nums">
                  {onTrackCount}
                </span>
              </div>

              <div
                onClick={() => navigate('/jobs?tab=COMPLETED')}
                className="flex items-center justify-between p-1.5 -mx-1.5 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer group"
                title="View Completed Jobs"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-[#0F766E]" />
                  <span className="text-[#374151] group-hover:text-[#0F766E] transition-colors">Completed today</span>
                </div>
                <span className="font-bold text-[#111827] tabular-nums">
                  {completedToday}
                </span>
              </div>
            </div>
          </div>

          {/* Most urgent section matching screenshot */}
          <div className="mt-4 pt-3.5 border-t border-[#F3F4F6]">
            <div className="text-[12.5px] font-semibold text-[#64748B] mb-2.5">
              Most urgent
            </div>

            {displayUrgentJobs.length === 0 ? (
              <div className="py-4 text-center text-[12px] text-[#64748B] bg-[#F8FAFC] rounded-xl">
                No urgent jobs pending
              </div>
            ) : (
              <div className="space-y-3 max-h-[150px] overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-slate-300">
                {displayUrgentJobs.map((job: any, idx: number) => {
                  const days = parseInt(String(job.days_left), 10);
                  const isLate = !isNaN(days) && days < 0;
                  const isRed = !isNaN(days) && days >= 0 && days <= redDays;
                  const isYellow = !isNaN(days) && days > redDays && days <= yellowDays;

                  // Urgency progress: scales directly with days (more late = higher bar)
                  let urgencyPercent = 20;
                  if (!isNaN(days)) {
                    if (days < 0) {
                      // Late: starts at ~60% and increases with more days late up to 100%
                      const lateDays = Math.abs(days);
                      urgencyPercent = Math.min(100, Math.round(58 + lateDays * 2.8));
                    } else if (days === 0) {
                      urgencyPercent = 52;
                    } else if (days <= 3) {
                      // 1d left: ~46%, 2d left: ~40%, 3d left: ~34%
                      urgencyPercent = Math.max(30, Math.round(52 - days * 6));
                    } else if (days <= 5) {
                      // 4d left: ~26%, 5d left: ~20%
                      urgencyPercent = Math.max(18, Math.round(34 - (days - 3) * 7));
                    } else {
                      // On track (> 5 days left)
                      urgencyPercent = Math.max(10, Math.round(18 - Math.min(8, days - 5)));
                    }
                  }

                  return (
                    <div
                      key={job.id || idx}
                      onClick={() => handleOpenJobModal(job.id)}
                      className="group cursor-pointer select-none"
                    >
                      <div className="flex items-center justify-between text-[13px] leading-tight mb-1.5">
                        <span className="font-semibold text-[#1E293B] group-hover:text-[#0F766E] transition-colors truncate pr-2">
                          {job.job_type_name || 'Job'} · {job.party_name || 'Walk-in'}
                        </span>
                        <span
                          className={clsx(
                            'text-[12px] font-medium shrink-0 tabular-nums',
                            isLate || isRed ? 'text-[#DC2626]' : isYellow ? 'text-[#D97706]' : 'text-[#64748B]'
                          )}
                        >
                          {!isNaN(days) ? (
                            isLate ? (
                              `${Math.abs(days)} day${Math.abs(days) > 1 ? 's' : ''} late`
                            ) : days === 0 ? (
                              'Due today'
                            ) : (
                              `${days} day${days > 1 ? 's' : ''} left`
                            )
                          ) : (
                            'In progress'
                          )}
                        </span>
                      </div>

                      {/* Slim progress bar: dynamically scales with urgency / days late */}
                      <div className="h-1.5 w-full bg-[#E2E8F0] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-[#0F766E] rounded-full transition-all duration-300"
                          style={{ width: `${urgencyPercent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* 5. Visual Analytics Row: Dues by Age, Bills per Day, Top Services (Circle Donut Chart) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Card 1: Dues by age (Dynamic from Real DB + Zero-state Resilient) */}
        <Card className="p-5 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
                Dues by age
              </h2>
              {!agingData.hasData && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-[#ECFDF5] text-[#059669]">
                  <CheckCircle2 className="w-3 h-3 stroke-[2.5]" />
                  <span>100% Cleared</span>
                </span>
              )}
            </div>
            <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
              {agingData.hasData
                ? `${formatINR(agingData.total)} receivable`
                : '₹0 receivable · No pending dues'}
            </p>

            {/* 4 Vertical Capsule Bars */}
            <div
              onClick={() => navigate('/money?tab=dues')}
              className="grid grid-cols-4 gap-2.5 sm:gap-4 pt-7 pb-2 items-end cursor-pointer"
              title="View all dues in Money"
            >
              {agingData.buckets.map((b, idx) => (
                <div key={idx} className="flex flex-col items-center group cursor-pointer">
                  {/* Amount on top */}
                  <div
                    className={clsx(
                      'text-[12px] sm:text-[13px] font-bold mb-2 tabular-nums transition-colors',
                      agingData.hasData && b.amount > 0 ? 'text-[#0F172A]' : 'text-[#94A3B8]'
                    )}
                  >
                    {b.display}
                  </div>

                  {/* Capsule Track */}
                  <div className="h-[145px] w-full max-w-[46px] sm:max-w-[50px] bg-[#F1F5F9] rounded-2xl relative overflow-hidden flex flex-col justify-end p-0.5 transition-all group-hover:bg-[#EAEFF5]">
                    <div
                      className={clsx(
                        'w-full rounded-2xl transition-all duration-500',
                        agingData.hasData && b.amount > 0 ? 'group-hover:brightness-95' : ''
                      )}
                      style={{
                        height: `${b.fillPercent}%`,
                        backgroundColor: agingData.hasData && b.amount > 0 ? b.color : '#CBD5E1',
                      }}
                      title={`${b.label}: ${formatINR(b.amount)} (${b.count} bills)`}
                    />
                  </div>

                  {/* Bucket Label at bottom */}
                  <div className="text-[10.5px] sm:text-[11.5px] font-medium text-[#64748B] mt-3 text-center whitespace-nowrap">
                    {b.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer reassurance / action link */}
          <div className="border-t border-[#F1F5F9] pt-2.5 mt-2 flex items-center justify-between text-[11px] text-[#64748B]">
            {agingData.hasData ? (
              <>
                <span>{agingData.invoiceCount} unpaid bill{agingData.invoiceCount > 1 ? 's' : ''}</span>
                <button
                  type="button"
                  onClick={() => navigate('/money?tab=dues')}
                  className="text-[#0F766E] font-semibold hover:underline cursor-pointer"
                >
                  View dues
                </button>
              </>
            ) : (
              <span className="text-[#059669] flex items-center gap-1 font-medium">
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                All customer accounts are settled and up to date
              </span>
            )}
          </div>
        </Card>

        {/* Card 2: Bills per day (Dynamic from Real DB + Zero-state Resilient) */}
        <Card className="p-5 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
                  Bills per day
                </h2>
                <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
                  {dailyBillsData.monthLabel} · {dailyBillsData.totalBills} bill{dailyBillsData.totalBills !== 1 ? 's' : ''}
                </p>
              </div>
              <span className="text-[12px] sm:text-[12.5px] text-[#64748B] font-medium">
                Avg {dailyBillsData.avgPerDay} a day
              </span>
            </div>

            {/* Daily Histogram with Tooltip & Dynamic Symmetrical Margins */}
            <div className="pt-7 pb-1">
              <div className="relative px-2.5 sm:px-3">
                {/* Floating Tooltip Pill for hovered day (Clamped within card boundaries) */}
                {dailyBillsData.days[hoveredDayIndex] && (
                  <div
                    className="absolute -top-7.5 -translate-x-1/2 bg-[#0F172A] text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-md shadow-md pointer-events-none transition-all duration-150 z-20 whitespace-nowrap"
                    style={{
                      left: `${Math.max(16, Math.min(84, ((hoveredDayIndex + 0.5) / dailyBillsData.days.length) * 100))}%`,
                    }}
                  >
                    {dailyBillsData.days[hoveredDayIndex].dateLabel} · {dailyBillsData.days[hoveredDayIndex].count} bill{dailyBillsData.days[hoveredDayIndex].count !== 1 ? 's' : ''}
                  </div>
                )}

                {/* Dynamic Slim Vertical Bars with 28/30/31 Days Fluid Width Distribution */}
                <div className="h-[145px] w-full flex items-end justify-between border-b border-[#F1F5F9] pb-0.5 gap-[2px] sm:gap-[3px]">
                  {dailyBillsData.days.map((item, idx) => {
                    const isSelected = hoveredDayIndex === idx;
                    const isToday = item.isToday;
                    return (
                      <div
                        key={idx}
                        onMouseEnter={() => setHoveredDayIndex(idx)}
                        className="flex-1 min-w-0 h-full flex items-end justify-center cursor-pointer group py-0.5"
                      >
                        <div
                          className={clsx(
                            'w-full max-w-[5px] sm:max-w-[6px] md:max-w-[7px] rounded-full transition-all duration-150',
                            isSelected
                              ? 'bg-[#0F766E]'
                              : isToday
                              ? 'bg-[#0F766E] shadow-[0_0_8px_rgba(15,118,110,0.4)]'
                              : item.count > 0
                              ? 'bg-[#CBD5E1] group-hover:bg-[#94A3B8]'
                              : 'bg-[#E2E8F0] group-hover:bg-[#CBD5E1]'
                          )}
                          style={{ height: `${item.heightPct}%` }}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* X Axis Labels: 1, 15, Last Day of month aligned with bars */}
                <div className="flex items-center justify-between text-[11px] text-[#64748B] mt-2.5">
                  <span>1 {dailyBillsData.shortMonth}</span>
                  <span>15 {dailyBillsData.shortMonth}</span>
                  <span>{dailyBillsData.days.length} {dailyBillsData.shortMonth}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer reassurance / action prompt */}
          <div className="border-t border-[#F1F5F9] pt-2.5 mt-2 flex items-center justify-between text-[11px] text-[#64748B]">
            {dailyBillsData.hasData ? (
              <>
                <span>Activity across {dailyBillsData.days.length} days</span>
                <button
                  type="button"
                  onClick={() => navigate('/bills')}
                  className="text-[#0F766E] font-semibold hover:underline cursor-pointer"
                >
                  View all bills
                </button>
              </>
            ) : (
              <>
                <span>No bills created this month yet</span>
                <button
                  type="button"
                  onClick={() => navigate('/bills/new')}
                  className="text-[#0F766E] font-semibold hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  Create first bill
                </button>
              </>
            )}
          </div>
        </Card>

        {/* Card 3: Top services (Fluid Non-Overflowing Donut Chart & Jitter-Free Hover) */}
        <Card className="p-5 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-[15px] sm:text-[16px] font-bold text-[#0F172A] tracking-tight">
                  Top services
                </h2>
                <p className="text-[12px] sm:text-[12.5px] text-[#64748B] mt-0.5">
                  By bills · {period === 'THIS_YEAR' ? `FY ${fyLabel}` : period === 'TODAY' ? 'Today' : dailyBillsData.monthLabel}
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

            {/* 3D Isometric Pie Chart + Top Services List (Zero Overflow on Left/Right) */}
            <div className="flex items-center gap-3 sm:gap-4 pt-1">
              {/* Left Column: Symmetrically Contained 3D Pie Chart + External Label */}
              <div className="w-[140px] sm:w-[155px] flex flex-col items-center shrink-0">
                <ThreeDPieChart
                  data={topServicesData.services}
                  totalBills={topServicesData.totalBills}
                  hoveredIdx={hoveredServiceIdx}
                  onHover={setHoveredServiceIdx}
                  className="w-full h-[98px] sm:h-[108px]"
                />

                {/* Outside Underneath 3D Chart: Locked-Height Service Name Pill Badge */}
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

              {/* Right Column: Fluid min-w-0 Services List (Zero Overflow) */}
              <div className="flex-1 min-w-0 space-y-1">
                {topServicesData.services.length === 0 ? (
                  <div className="py-8 text-center text-[12px] text-[#64748B]">
                    No bills generated this month
                  </div>
                ) : (
                  topServicesData.services.map((item, idx) => {
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
                      <div className="flex items-center justify-between text-[11.5px] sm:text-[12px] gap-1">
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

                      {/* Micro Progress Line */}
                      <div className="h-1.5 w-full bg-[#EEF0F3] rounded-full overflow-hidden mt-1">
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
                }))}
              </div>
            </div>
          </div>

          {/* Footer reassurance / action prompt */}
          <div className="border-t border-[#F1F5F9] pt-2.5 mt-2 flex items-center justify-between text-[11px] text-[#64748B]">
            {topServicesData.hasData ? (
              <>
                <span>Service revenue demand rank</span>
                <button
                  type="button"
                  onClick={() => navigate('/services')}
                  className="text-[#0F766E] font-semibold hover:underline cursor-pointer"
                >
                  Manage services
                </button>
              </>
            ) : (
              <>
                <span>Demand share calculates upon billing</span>
                <button
                  type="button"
                  onClick={() => navigate('/services')}
                  className="text-[#0F766E] font-semibold hover:underline cursor-pointer"
                >
                  Configure services
                </button>
              </>
            )}
          </div>
        </Card>
      </div>

      {/* 6. Bottom Section: Recent Bills (Left 8 cols) & Needs Follow-up (Right 4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Recent bills Card */}
        <Card className="lg:col-span-8 p-5 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[15px] font-semibold text-[#111827]">Recent bills</h2>
            <button
              type="button"
              onClick={() => navigate('/bills')}
              className="text-[13px] font-medium text-[#0F766E] hover:underline cursor-pointer"
            >
              View all
            </button>
          </div>

          {recentBillsList.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#F3F4F6] text-[11.5px] font-medium text-[#6B7280] uppercase tracking-wider">
                    <th className="py-2.5 font-medium">Bill</th>
                    <th className="py-2.5 font-medium">Customer</th>
                    <th className="py-2.5 font-medium text-right">Amount</th>
                    <th className="py-2.5 font-medium text-left pl-6">Status</th>
                    <th className="py-2.5 font-medium text-right">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F9FAFB] text-[13px]">
                  {recentBillsList.map((bill: any, idx: number) => (
                    <tr
                      key={bill.id || idx}
                      onClick={() => navigate('/bills')}
                      className="hover:bg-[#F9FAFB] transition-colors cursor-pointer group"
                    >
                      <td className="py-2.5 font-mono font-medium text-[#111827]">
                        {bill.number}
                      </td>
                      <td className="py-2.5 text-[#111827] group-hover:text-[#0F766E] transition-colors truncate max-w-[180px]">
                        {bill.party_name}
                      </td>
                      <td className="py-2.5 font-semibold text-[#111827] tabular-nums text-right">
                        {formatINR(bill.total)}
                      </td>
                      <td className="py-2.5 text-left pl-6">
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium">
                          <span
                            className={clsx(
                              'w-2 h-2 rounded-full flex-shrink-0',
                              bill.statusDotColor
                            )}
                          />
                          <span className={bill.statusTextColor}>
                            {bill.statusText}
                          </span>
                        </span>
                      </td>
                      <td className="py-2.5 text-[12px] text-[#6B7280] tabular-nums text-right">
                        {bill.dateText}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-8 text-center border-t border-[#F3F4F6]">
              <div className="w-10 h-10 rounded-full bg-[#F3F4F6] text-[#6B7280] flex items-center justify-center mx-auto mb-2.5">
                <FileText className="w-4 h-4" />
              </div>
              <div className="text-[13.5px] font-medium text-[#111827]">
                No recent bills yet
              </div>
              <p className="text-[12px] text-[#6B7280] mt-0.5">
                Invoices you create will appear here in real-time.
              </p>
            </div>
          )}
        </Card>

        {/* Right Column: Needs follow-up Card (100% Live DB Data & Zero-State Resilient) */}
        <Card className="lg:col-span-4 flex flex-col p-5 border-0 hover:shadow-[0_4px_20px_rgba(0,0,0,0.06)] transition-all duration-200">
          <div>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold text-[#111827]">Needs follow-up</h2>
                {needsFollowupData.overdueCount > 0 && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-[#FEF2F2] text-[#DC2626]">
                    {needsFollowupData.overdueCount} overdue
                  </span>
                )}
                {needsFollowupData.items.length > 4 && (
                  <span className="text-[11.5px] text-[#6B7280] font-normal">
                    · {needsFollowupData.items.length} dues
                  </span>
                )}
              </div>
              {needsFollowupData.hasData ? (
                <button
                  type="button"
                  onClick={handleRemindAll}
                  className="text-[13px] font-medium text-[#0F766E] hover:underline cursor-pointer"
                >
                  Remind all
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[#ECFDF5] text-[#059669]">
                  <CheckCircle2 className="w-3 h-3 stroke-[2.5]" />
                  <span>Clear</span>
                </span>
              )}
            </div>

            {/* Total Due Banner */}
            <div
              onClick={() => navigate('/money?tab=dues')}
              className="mt-2 cursor-pointer group"
              title="View all dues in Money"
            >
              <div className="text-[26px] font-semibold text-[#111827] group-hover:text-[#0F766E] transition-colors tabular-nums tracking-tight">
                {formatINR(needsFollowupData.totalOutstanding)}
              </div>
              <div className="text-[12.5px] text-[#6B7280] group-hover:text-[#0F766E] transition-colors mt-0.5">
                {needsFollowupData.hasData
                  ? `receivable across ${needsFollowupData.customerCount} customer${needsFollowupData.customerCount !== 1 ? 's' : ''}`
                  : '0 pending dues · All caught up'}
              </div>
            </div>
          </div>

          {/* List of customer reminders or Tranquil Zero-State */}
          <div className="border-t border-[#F3F4F6] pt-3.5 mt-4 flex-1">
            {needsFollowupData.hasData ? (
              <div className="max-h-[248px] overflow-y-auto pr-1 space-y-2 [scrollbar-width:thin] scrollbar-thumb-[#E5E7EB] hover:scrollbar-thumb-[#CBD5E1] scroll-smooth">
                {needsFollowupData.items.map((item: any, idx: number) => (
                  <div
                    key={item.id || idx}
                    className="flex items-center justify-between gap-3 text-[13px] py-2 px-2.5 rounded-xl hover:bg-[#F9FAFB] transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium text-[#111827] truncate">
                          {item.name}
                        </span>
                        {item.number && (
                          <span className="text-[11px] text-[#9CA3AF] tabular-nums shrink-0">
                            #{item.number}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[12.5px] font-semibold text-[#111827] tabular-nums">
                          {formatINR(item.amount)}
                        </span>
                        <span className="text-[#D1D5DB] text-[11px]">·</span>
                        <span
                          className={clsx(
                            'text-[11.5px] tabular-nums px-1.5 py-0.5 rounded',
                            item.isOverdue
                              ? 'text-[#DC2626] bg-[#FEF2F2] font-semibold'
                              : item.isDueToday
                              ? 'text-[#D97706] bg-[#FFFBEB] font-medium'
                              : 'text-[#6B7280]'
                          )}
                        >
                          {item.dueText}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSendCustomerReminder(item)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E7EB] bg-white text-[12px] font-medium text-[#374151] hover:bg-[#0F766E] hover:text-white hover:border-[#0F766E] active:scale-[0.98] transition-all shrink-0 cursor-pointer shadow-[0_1px_2px_rgba(0,0,0,0.02)] group"
                      title={item.mobile ? `Send WhatsApp reminder to ${item.mobile}` : 'Copy reminder text (no mobile on bill)'}
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-[#6B7280] group-hover:text-white transition-colors" />
                      <span>Remind</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-4 text-center">
                <div className="w-9 h-9 rounded-full bg-[#ECFDF5] text-[#059669] flex items-center justify-center mx-auto mb-2">
                  <CheckCircle2 className="w-5 h-5 stroke-[2.5]" />
                </div>
                <div className="text-[13px] font-semibold text-[#111827]">
                  No follow-ups needed
                </div>
                <p className="text-[11.5px] text-[#6B7280] mt-0.5 max-w-[210px] mx-auto">
                  All customer dues and balances are completely settled.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>
        </>
      )}

      {/* Bill & Job Detail Modals */}
      <BillDetailModal
        open={isBillModalOpen}
        onOpenChange={setIsBillModalOpen}
        invoice={selectedBillForModal}
        onInvoiceUpdated={() => loadDashboard(true)}
      />

      <JobDetailModal
        open={isJobModalOpen}
        onOpenChange={setIsJobModalOpen}
        jobId={selectedJobIdForModal}
        onJobUpdated={() => loadDashboard(true)}
      />
    </div>
  );
};
