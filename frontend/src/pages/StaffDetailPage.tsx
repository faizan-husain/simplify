import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate, formatInputDate } from '../lib/dates';
import { getWhatsAppUrl } from '../lib/auth';
import { getErrorMessage } from '../i18n';
import { Button } from '../components/ui/Button';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { JobDetailModal } from '../components/jobs/JobDetailModal';
import { ConfigurePayTypeModal } from '../components/staff/ConfigurePayTypeModal';
import { PayStaffModal } from '../components/staff/PayStaffModal';
import { StaffEarningsStatement } from '../components/staff/StaffEarningsStatement';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { FilterChips } from '../components/mobile/FilterChips';
import { exportDocumentPDF } from '../components/documents/pdfExport';
import {
  ArrowLeft,
  Calendar,
  Clock,
  Settings,
  CreditCard,
  AlertCircle,
  MessageCircle,
  Printer,
  Download,
  Building2,
  Search,
  FileText,
  ChevronLeft,
  ChevronRight,
  Phone,
  BarChart3,
} from 'lucide-react';

const PAGE_SIZE = 30;

type PeriodOption = 'TODAY' | 'THIS_MONTH' | 'THIS_FY' | 'ALL';

function getPeriodDates(period: PeriodOption) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();

  if (period === 'TODAY') {
    const todayStr = formatInputDate(now);
    return { from: todayStr, to: todayStr };
  } else if (period === 'THIS_MONTH') {
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    return { from: formatInputDate(firstDay), to: formatInputDate(lastDay) };
  } else if (period === 'THIS_FY') {
    const m = month + 1;
    const fyStartYear = m >= 4 ? year : year - 1;
    const firstDay = new Date(fyStartYear, 3, 1);
    const lastDay = new Date(fyStartYear + 1, 2, 31);
    return { from: formatInputDate(firstDay), to: formatInputDate(lastDay) };
  } else {
    return { from: null, to: null };
  }
}

export const StaffDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { business, role } = useAuth();
  const { showToast } = useToast();
  const isOwner = role === 'OWNER';

  const [period, setPeriod] = useState<PeriodOption>('ALL');
  const [activeTab, setActiveTab] = useState<'jobs' | 'salary_months' | 'payments' | 'history'>('jobs');
  const [loading, setLoading] = useState(true);
  const [earningsHistory, setEarningsHistory] = useState<any>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Search & Pagination for large entries datasets
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Staff member info & drill-down
  const [staffInfo, setStaffInfo] = useState<{
    id: string;
    name: string;
    mobile?: string;
    role?: string;
    compensation_type?: string;
    monthly_salary?: number;
    salary_start_date?: string;
  } | null>(null);

  const [commissionData, setCommissionData] = useState<{
    entries: any[];
    payouts: any[];
    salary_months: any[];
    total_due: number;
    total_earned?: number;
    total_paid: number;
    balance_payable: number;
    upcoming: number;
    compensation_type?: string;
    monthly_salary?: number;
    salary_start_date?: string;
  }>({
    entries: [],
    payouts: [],
    salary_months: [],
    total_due: 0,
    total_paid: 0,
    balance_payable: 0,
    upcoming: 0,
  });

  // Modals
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [configModalOpen, setConfigModalOpen] = useState(false);

  // Load basic staff details
  const loadStaffInfo = async () => {
    if (!id) return;
    try {
      const { data, error } = await supabase
        .from('members')
        .select('id, name, mobile, role, compensation_type, monthly_salary, salary_start_date')
        .eq('id', id)
        .single();
      if (error) throw error;
      if (data) {
        setStaffInfo(data);
        if (data.compensation_type === 'SALARY') {
          setActiveTab('salary_months');
        }
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    }
  };

  // Load full entries, payouts, and salary months
  const loadDrilldown = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const dateRange = getPeriodDates(period);
      const { data, error } = await supabase.rpc('staff_commission', {
        p_staff_id: id,
        p_period: period,
        p_from: dateRange.from,
        p_to: dateRange.to,
      });

      if (error) throw error;
      if (data) {
        setCommissionData(data);
      }

      // Load full monthly & FY earnings history statement
      setLoadingHistory(true);
      try {
        const { data: histData, error: histError } = await supabase.rpc('staff_earnings_history', {
          p_staff_id: id,
        });
        if (!histError && histData) {
          setEarningsHistory(histData);
        }
      } catch (hErr) {
        console.error('Failed to load staff earnings history:', hErr);
      } finally {
        setLoadingHistory(false);
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStaffInfo();
  }, [id]);

  useEffect(() => {
    loadDrilldown();
  }, [id, period]);

  const compType = (
    commissionData.compensation_type ||
    staffInfo?.compensation_type ||
    'COMMISSION'
  ).toUpperCase() as 'COMMISSION' | 'SALARY';

  const isSalaried = compType === 'SALARY';
  const monthlySalary = Number(commissionData.monthly_salary ?? staffInfo?.monthly_salary ?? 0);
  const totalDue = Number(commissionData.total_earned ?? commissionData.total_due ?? 0);
  const totalPaid = Number(commissionData.total_paid ?? 0);
  const balancePayable = Number(commissionData.balance_payable ?? 0);
  const upcomingComm = Number(commissionData.upcoming ?? 0);

  // Filtered jobs list based on search query
  const filteredJobs = useMemo(() => {
    const list = commissionData.entries || [];
    if (!searchQuery.trim()) return list;
    const q = searchQuery.toLowerCase();
    return list.filter((job) => {
      return (
        (job.invoice_number && job.invoice_number.toLowerCase().includes(q)) ||
        (job.job_type_name && job.job_type_name.toLowerCase().includes(q)) ||
        (job.party_name && job.party_name.toLowerCase().includes(q)) ||
        (job.applicant_name && job.applicant_name.toLowerCase().includes(q)) ||
        (job.party_mobile && job.party_mobile.includes(q))
      );
    });
  }, [commissionData.entries, searchQuery]);

  // Paginated jobs for performance with lakhs of entries
  const totalPages = Math.max(1, Math.ceil(filteredJobs.length / PAGE_SIZE));
  const paginatedJobs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredJobs.slice(start, start + PAGE_SIZE);
  }, [filteredJobs, currentPage]);

  // Reset page when search or tab changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeTab, period]);

  // WhatsApp Statement share
  const handleShareWhatsApp = () => {
    if (!staffInfo) return;
    const bizName = business?.name || 'Simplify';
    const periodName =
      period === 'TODAY'
        ? 'Today'
        : period === 'THIS_MONTH'
        ? 'This Month'
        : period === 'THIS_FY'
        ? 'This Financial Year'
        : 'All Time';

    let msg = `*Staff Statement · ${bizName}*\n`;
    msg += `Staff: *${staffInfo.name}*\n`;
    msg += `Pay Type: ${isSalaried ? `Fixed Salary (₹${monthlySalary.toLocaleString('en-IN')}/mo)` : 'Commission'}\n`;
    msg += `Period: ${periodName}\n`;
    msg += `─────────────────\n`;
    msg += `Total Due / Earned: *${formatINR(totalDue)}*\n`;
    msg += `Total Paid: *${formatINR(totalPaid)}*\n`;
    if (balancePayable >= 0) {
      msg += `Balance Payable: *${formatINR(balancePayable)}*\n`;
    } else {
      msg += `Advance Given: *${formatINR(Math.abs(balancePayable))}*\n`;
    }
    if (!isSalaried && upcomingComm > 0) {
      msg += `Upcoming (Jobs in progress): ${formatINR(upcomingComm)}\n`;
    }
    msg += `Jobs Completed: ${commissionData.entries.length}\n`;
    msg += `─────────────────\n`;
    msg += `Generated on: ${formatDate(new Date().toISOString().slice(0, 10))}`;

    const waUrl = getWhatsAppUrl(staffInfo.mobile || '', msg);
    window.open(waUrl, '_blank');
  };

  const [exportingPDF, setExportingPDF] = useState(false);

  const handleExportPDF = async () => {
    setExportingPDF(true);
    try {
      const cleanName = (staffInfo?.name || 'Staff').replace(/\s+/g, '-');
      if (activeTab === 'history') {
        const fyEl = document.getElementById('print-staff-fy-statement');
        if (fyEl) {
          await exportDocumentPDF(fyEl, `Staff-Statement-${cleanName}-FY.pdf`);
          showToast('Staff statement PDF exported successfully', 'success');
          return;
        }
      }
      const printEl = document.getElementById('print-staff-statement-root');
      if (!printEl) return;
      const filename = `Staff-Statement-${cleanName}-${period}.pdf`;
      await exportDocumentPDF(printEl, filename);
      showToast('Staff statement PDF exported successfully', 'success');
    } catch (err: any) {
      showToast('Failed to export PDF: ' + (err?.message || 'Unknown error'), 'error');
    } finally {
      setExportingPDF(false);
    }
  };

  const handlePrint = () => {
    if (activeTab === 'history') {
      document.body.classList.add('printing-staff-fy-active');
      const cleanup = () => {
        document.body.classList.remove('printing-staff-fy-active');
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
      return;
    }

    document.body.classList.add('printing-portal-active');
    const cleanup = () => {
      document.body.classList.remove('printing-portal-active');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12 print:p-0 print:m-0 print:max-w-none print:space-y-0">
      {/* Back button & Breadcrumbs */}
      <div className="flex items-center justify-between gap-3 print:hidden no-print">
        <button
          type="button"
          onClick={() => navigate('/staff')}
          className="inline-flex items-center text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border-0 px-3.5 py-2 rounded-xl transition-all shadow-2xs hover:shadow-xs cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
          Back to Staff
        </button>

        <span className="text-xs text-slate-400 font-medium">
          Staff Account / {staffInfo?.name || 'Details'}
        </span>
      </div>

      {/* Header Card (Quiet Luxury Aesthetic) */}
      <div className="bg-white border-0 rounded-2xl p-5 sm:p-6 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-5 print:hidden no-print">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-bold text-lg shrink-0 shadow-xs">
              {staffInfo?.name?.charAt(0).toUpperCase() || 'S'}
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  {staffInfo?.name}
                </h1>
                <span
                  className={`inline-flex items-center text-[11px] font-semibold px-2.5 py-0.5 rounded-full border-0 ${
                    isSalaried
                      ? 'bg-blue-50 text-blue-700'
                      : 'bg-emerald-50 text-emerald-700'
                  }`}
                >
                  {isSalaried
                    ? `Fixed Salary ₹${monthlySalary.toLocaleString('en-IN')}/mo`
                    : 'Commission Based'}
                </span>
              </div>
              <div className="text-xs text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                {staffInfo?.mobile && (
                  <span className="font-mono text-slate-700 font-medium">{staffInfo.mobile}</span>
                )}
                <span>Role: {staffInfo?.role || 'STAFF'}</span>
                {isSalaried && staffInfo?.salary_start_date && (
                  <span>Since: {formatDate(staffInfo.salary_start_date)}</span>
                )}
              </div>
            </div>
          </div>

          {/* Mobile Action Buttons (sm:hidden) */}
          <div className="sm:hidden w-full space-y-2 pt-2 border-t border-slate-100">
            <div className="flex items-center gap-2">
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setPayModalOpen(true)}
                  className="flex-1 h-11 px-4 text-xs font-semibold rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Pay Staff</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleShareWhatsApp}
                className="flex-1 h-11 px-3.5 text-xs font-semibold rounded-xl border-0 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
              >
                <MessageCircle className="w-4 h-4 text-emerald-600" />
                <span>Share</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              {isOwner && (
                <button
                  type="button"
                  onClick={() => setConfigModalOpen(true)}
                  className="flex-1 h-9 px-2 text-xs font-semibold rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
                >
                  <Settings className="w-3.5 h-3.5 text-slate-500" />
                  <span>Configure Pay</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleExportPDF}
                disabled={exportingPDF}
                className="h-9 px-3 text-xs font-semibold rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>{exportingPDF ? '...' : 'PDF'}</span>
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="h-9 px-3 text-xs font-semibold rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
              >
                <Printer className="w-3.5 h-3.5 text-slate-500" />
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* Desktop Action Buttons (hidden sm:flex) */}
          <div className="hidden sm:flex items-center gap-2 self-start sm:self-auto flex-wrap">
            {isOwner && (
              <button
                type="button"
                onClick={() => setConfigModalOpen(true)}
                className="h-9 px-3.5 text-xs font-semibold rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
              >
                <Settings className="w-3.5 h-3.5 text-slate-500" />
                <span>Configure Pay</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleShareWhatsApp}
              className="h-9 px-3.5 text-xs font-semibold rounded-xl border-0 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
            >
              <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
              <span>Share Statement</span>
            </button>

            <button
              type="button"
              onClick={handleExportPDF}
              disabled={exportingPDF}
              className="h-9 px-3.5 text-xs font-semibold rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>{exportingPDF ? 'Generating...' : 'PDF'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="h-9 px-3.5 text-xs font-semibold rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-slate-700 transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs"
            >
              <Printer className="w-3.5 h-3.5 text-slate-500" />
              <span>Print</span>
            </button>

            {isOwner && (
              <button
                type="button"
                onClick={() => setPayModalOpen(true)}
                className="h-9 px-4 text-xs font-semibold rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Pay Staff</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile 3 Numbers (sm:hidden) */}
        <div className="sm:hidden space-y-2">
          {/* Primary Highlight Card: Balance Payable / Advance Given */}
          <div className="p-4 bg-[#EEF0F3] rounded-2xl border-0 shadow-2xs space-y-1">
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
              {balancePayable < 0 ? 'Advance Given' : 'Balance Payable'}
            </span>
            <div
              className={`text-2xl font-black tabular-nums tracking-tight ${
                balancePayable > 0
                  ? 'text-rose-600'
                  : balancePayable < 0
                  ? 'text-blue-600'
                  : 'text-slate-900'
              }`}
            >
              {balancePayable < 0
                ? `Adv ₹${Math.abs(balancePayable).toLocaleString('en-IN')}`
                : formatINR(balancePayable)}
            </div>
            <span className="text-[11px] text-slate-500 font-medium block">
              {balancePayable < 0 ? 'Will offset next salary' : 'Pending payment'}
            </span>
          </div>

          {/* 2-Col Grid: Total Salary/Earned + Total Paid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3.5 bg-[#EEF0F3] rounded-2xl border-0 shadow-2xs space-y-1">
              <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider block truncate">
                {isSalaried ? 'Total Salary' : 'Total Earned'}
              </span>
              <div className="text-lg font-extrabold text-slate-900 tabular-nums">
                {formatINR(totalDue)}
              </div>
              <span className="text-[10px] text-slate-500 font-medium block truncate">
                {period === 'ALL' ? 'All-time accrued' : 'In period'}
              </span>
            </div>

            <div className="p-3.5 bg-[#EEF0F3] rounded-2xl border-0 shadow-2xs space-y-1">
              <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider block truncate">
                Total Paid
              </span>
              <div className="text-lg font-extrabold text-slate-900 tabular-nums">
                {formatINR(totalPaid)}
              </div>
              <span className="text-[10px] text-slate-500 font-medium block truncate">
                Disbursed
              </span>
            </div>
          </div>
        </div>

        {/* Desktop 3 Core Numbers Banner (hidden sm:grid) */}
        <div className="hidden sm:grid grid-cols-3 gap-2 sm:gap-6 p-4 sm:p-5 bg-[#EEF0F3] rounded-2xl border-0 shadow-2xs">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              {isSalaried ? 'Total Salary' : 'Total Earned'}
            </span>
            <div className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-slate-900 tabular-nums mt-1">
              {formatINR(totalDue)}
            </div>
            <span className="text-[11px] text-slate-500 font-medium block mt-0.5">
              {period === 'ALL' ? 'All-time accrued' : 'In selected period'}
            </span>
          </div>

          <div className="border-l border-slate-200/90 pl-3 sm:pl-6">
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block">
              Total Paid
            </span>
            <div className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-slate-900 tabular-nums mt-1">
              {formatINR(totalPaid)}
            </div>
            <span className="text-[11px] text-slate-500 font-medium block mt-0.5">
              Disbursed payouts
            </span>
          </div>

          <div className="border-l border-slate-200/90 pl-3 sm:pl-6">
            <span className="text-[11px] font-bold text-slate-600 uppercase tracking-wider block">
              {balancePayable < 0 ? 'Advance Given' : 'Balance Payable'}
            </span>
            <div
              className={`text-2xl sm:text-3xl lg:text-4xl font-black tabular-nums tracking-tight mt-0.5 ${
                balancePayable > 0
                  ? 'text-rose-600'
                  : balancePayable < 0
                  ? 'text-blue-600'
                  : 'text-slate-900'
              }`}
            >
              {balancePayable < 0
                ? `Adv ₹${Math.abs(balancePayable).toLocaleString('en-IN')}`
                : formatINR(balancePayable)}
            </div>
            <span className="text-[11px] text-slate-500 font-medium block mt-0.5">
              {balancePayable < 0 ? 'Will offset next salary' : 'Pending payment'}
            </span>
          </div>
        </div>

        {/* Upcoming jobs banner for commission staff (Consistent Green Message Alert) */}
        {!isSalaried && upcomingComm > 0 && (
          <div className="flex items-center justify-between p-3.5 px-4 bg-[#EAF2F1] text-[#0F766E] border-0 rounded-xl text-xs font-medium shadow-[0_1px_4px_rgba(15,118,110,0.06)] animate-in fade-in">
            <div className="flex items-center gap-2.5">
              <Clock className="w-4 h-4 text-[#0F766E] shrink-0" />
              <span>
                Upcoming commission: <strong className="font-bold text-[#0F766E]">{formatINR(upcomingComm)}</strong> (jobs in progress, will be counted upon completion)
              </span>
            </div>
            <span className="text-[11.5px] text-[#0F766E]/80 font-medium hidden sm:inline">
              Not added to balance until completed
            </span>
          </div>
        )}
      </div>

      {/* Mobile Tabs & Period Bar (md:hidden) */}
      <div className="md:hidden space-y-2.5 pt-2 print:hidden no-print">
        <FilterChips
          options={
            isSalaried
              ? [
                  {
                    value: 'salary_months',
                    label: 'Salary',
                    count: commissionData.salary_months?.length || 0,
                  },
                  {
                    value: 'jobs',
                    label: 'Jobs',
                    count: commissionData.entries?.length || 0,
                  },
                  {
                    value: 'payments',
                    label: 'Payments',
                    count: commissionData.payouts?.length || 0,
                  },
                  {
                    value: 'history',
                    label: 'Statement',
                  },
                ]
              : [
                  {
                    value: 'jobs',
                    label: 'Jobs',
                    count: commissionData.entries?.length || 0,
                  },
                  {
                    value: 'payments',
                    label: 'Payments',
                    count: commissionData.payouts?.length || 0,
                  },
                  {
                    value: 'history',
                    label: 'Statement',
                  },
                ]
          }
          value={activeTab}
          onChange={(val: string) => {
            setActiveTab(val as any);
            setCurrentPage(1);
          }}
        />

        {activeTab !== 'history' && (
          <FilterChips<PeriodOption>
            options={[
              { value: 'TODAY', label: 'Today' },
              { value: 'THIS_MONTH', label: 'This Month' },
              { value: 'THIS_FY', label: 'This FY' },
              { value: 'ALL', label: 'All Time' },
            ]}
            value={period}
            onChange={(val: PeriodOption) => setPeriod(val)}
          />
        )}
      </div>

      {/* Desktop Tabs & Period Controls Bar (hidden md:flex) */}
      <div className="hidden md:flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-2 print:hidden no-print">
        {/* Navigation Tabs */}
        <div className="overflow-x-auto max-w-full pb-1 sm:pb-0">
          <SegmentedControl
            value={activeTab}
            onChange={(val) => setActiveTab(val as any)}
            options={
              isSalaried
                ? [
                    {
                      value: 'salary_months',
                      label: `Salary Months (${commissionData.salary_months?.length || 0})`,
                    },
                    {
                      value: 'jobs',
                      label: `Jobs Done (${commissionData.entries?.length || 0})`,
                    },
                    {
                      value: 'payments',
                      label: `Payments History (${commissionData.payouts?.length || 0})`,
                    },
                    {
                      value: 'history',
                      label: 'Monthly & FY Statement',
                      icon: <BarChart3 className="w-3.5 h-3.5" />,
                    },
                  ]
                : [
                    {
                      value: 'jobs',
                      label: `Completed Jobs (${commissionData.entries?.length || 0})`,
                    },
                    {
                      value: 'payments',
                      label: `Payments History (${commissionData.payouts?.length || 0})`,
                    },
                    {
                      value: 'history',
                      label: 'Monthly & FY Statement',
                      icon: <BarChart3 className="w-3.5 h-3.5" />,
                    },
                  ]
            }
          />
        </div>

        {/* Period Filter Toggle (Hidden for Statement tab which has its own Year filter) */}
        {activeTab !== 'history' && (
          <div className="self-start sm:self-auto">
            <SegmentedControl
              value={period}
              onChange={(val) => setPeriod(val as PeriodOption)}
              options={[
                { label: 'Today', value: 'TODAY' },
                { label: 'This month', value: 'THIS_MONTH' },
                { label: 'This FY', value: 'THIS_FY' },
                { label: 'All Time', value: 'ALL' },
              ]}
            />
          </div>
        )}
      </div>

      {/* Tab 1: Completed Jobs (Built for large entry volumes) */}
      {activeTab === 'jobs' && (
        <div className="space-y-3 print:hidden no-print">
          {/* Search bar & summary */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search by Bill #, Customer, Job Type..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-11 pl-10 pr-3.5 text-xs sm:text-sm bg-white border-0 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#0F766E]/20 text-slate-800 placeholder:text-slate-400 font-medium focus:outline-none transition-all"
              />
            </div>

            <div className="text-xs text-slate-500 font-medium">
              Showing {filteredJobs.length} {filteredJobs.length === 1 ? 'job' : 'jobs'}
              {searchQuery && ` matching "${searchQuery}"`}
            </div>
          </div>

          {loading ? (
            <div className="py-16 text-center text-xs text-slate-400">
              Loading jobs...
            </div>
          ) : filteredJobs.length === 0 ? (
            <div className="p-10 text-center space-y-2 bg-white rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <FileText className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="text-sm font-semibold text-slate-700">No completed jobs found</div>
              <p className="text-xs text-slate-400">
                Jobs assigned to this staff member will appear here as soon as all workflow steps are ticked.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile Jobs List (md:hidden) */}
              <div className="md:hidden space-y-2">
                {paginatedJobs.map((job) => (
                  <div
                    key={job.job_id || job.commission_id}
                    onClick={() => {
                      setSelectedJobId(job.job_id);
                      setJobModalOpen(true);
                    }}
                    className="p-3.5 bg-white border-0 shadow-2xs rounded-2xl space-y-2 active:scale-[0.99] transition-all cursor-pointer"
                  >
                    {/* Row 1: Bill # · Status Badge · Chevron */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                          <FileText className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-xs font-bold font-mono text-slate-900">
                          {job.invoice_number || 'INV'}
                        </span>
                        <span className="px-2 py-0.5 text-[10.5px] font-bold rounded-md bg-emerald-50 text-emerald-700">
                          Completed
                        </span>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </div>

                    {/* Row 2: Particulars / Job Type */}
                    <div className="text-xs font-semibold text-slate-800 truncate">
                      {job.job_type_name}
                      {job.applicant_name && (
                        <span className="text-slate-500 font-normal ml-1">
                          ({job.applicant_name})
                        </span>
                      )}
                    </div>

                    {/* Row 3: Customer & Date */}
                    <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-50">
                      <div className="flex items-center gap-1.5 truncate flex-1 min-w-0">
                        <span className="truncate">{job.party_name}</span>
                        {job.party_mobile && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              window.open(getWhatsAppUrl(job.party_mobile, `Hi ${job.party_name}`), '_blank');
                            }}
                            className="text-emerald-600 p-0.5 hover:bg-emerald-50 rounded"
                            title="Chat on WhatsApp"
                          >
                            <Phone className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                      <span className="text-slate-400 shrink-0 text-[11px]">
                        {formatDate(job.completed_at || job.invoice_date)}
                      </span>
                    </div>

                    {/* Row 4: Amount & Commission */}
                    <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-50">
                      <span className="text-slate-500">
                        Amount: <strong className="text-slate-700">{formatINR(job.job_amount)}</strong>
                      </span>
                      <div>
                        {!isSalaried ? (
                          <span className="font-bold text-emerald-700">
                            +{formatINR(job.commission_amount)}{' '}
                            <span className="text-[11px] font-normal text-slate-400">
                              ({job.commission_percent}%)
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium">Salaried</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Jobs Table (hidden md:block) */}
              <div className="hidden md:block overflow-x-auto pb-2">
              <div className="min-w-[760px] md:min-w-0 space-y-1.5">
                {paginatedJobs.map((job) => (
                <div
                  key={job.job_id || job.commission_id}
                  onClick={() => {
                    setSelectedJobId(job.job_id);
                    setJobModalOpen(true);
                  }}
                  className="flex items-center gap-2 sm:gap-2.5 px-3 py-2 bg-white border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 rounded-xl transition-all cursor-pointer group select-none"
                >
                  {/* 1. Bill Icon */}
                  <div className="w-6 h-6 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <FileText className="w-3.5 h-3.5" />
                  </div>

                  {/* 2. Bill Number */}
                  <div className="w-[72px] shrink-0">
                    <span className="text-xs sm:text-sm font-bold font-mono text-slate-900 block truncate">
                      {job.invoice_number || 'INV'}
                    </span>
                  </div>

                  {/* 3. Completed Badge */}
                  <div className="w-[74px] shrink-0 flex items-center justify-center">
                    <span className="inline-flex items-center justify-center w-[74px] py-0.5 text-[10.5px] font-bold rounded-md bg-emerald-50 text-emerald-700 shrink-0">
                      Completed
                    </span>
                  </div>

                  {/* 4. Divider */}
                  <div className="h-3.5 w-px bg-slate-200/90 shrink-0" />

                  {/* 5. Particulars: Job Type & Applicant Name (flex-1 expands to fill space) */}
                  <div
                    className="text-xs sm:text-sm font-normal text-slate-500 truncate flex-1 min-w-0"
                    title={`${job.job_type_name}${job.applicant_name ? ` (${job.applicant_name})` : ''}`}
                  >
                    <span>{job.job_type_name}</span>
                    {job.applicant_name && (
                      <span className="ml-1">
                        ({job.applicant_name})
                      </span>
                    )}
                  </div>

                  {/* 6. Divider before Date */}
                  <div className="h-3.5 w-px bg-slate-200/90 shrink-0 hidden sm:block" />

                  {/* 7. Date Column (Strict fixed width) */}
                  <div className="w-[92px] shrink-0 hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
                    <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                    <span>{formatDate(job.completed_at || job.invoice_date)}</span>
                  </div>

                  {/* 8. Divider before Customer */}
                  <div className="h-3.5 w-px bg-slate-200/90 shrink-0 hidden md:block" />

                  {/* 9. Customer Name & WhatsApp Mobile (Strict fixed width) */}
                  <div className="w-[130px] shrink-0 hidden md:flex items-center justify-between gap-1.5 min-w-0">
                    <span className="text-xs font-medium text-slate-700 truncate flex-1 min-w-0" title={job.party_name}>
                      {job.party_name}
                    </span>
                    {job.party_mobile && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(getWhatsAppUrl(job.party_mobile, `Hi ${job.party_name}`), '_blank');
                        }}
                        className="inline-flex items-center text-slate-400 hover:text-emerald-700 transition-colors cursor-pointer shrink-0 p-0.5 rounded hover:bg-emerald-50"
                        title="Chat on WhatsApp"
                      >
                        <Phone className="w-3 h-3 text-slate-400 hover:text-emerald-600" />
                      </button>
                    )}
                  </div>

                  {/* 10. Divider before Job Amount */}
                  <div className="h-3.5 w-px bg-slate-200/90 shrink-0" />

                  {/* 11. Job Amount (Strict fixed width) */}
                  <div className="w-[60px] text-right text-xs sm:text-sm font-medium text-slate-600 tabular-nums shrink-0 truncate">
                    {formatINR(job.job_amount)}
                  </div>

                  {/* 12. Divider before Commission */}
                  <div className="h-3.5 w-px bg-slate-200/90 shrink-0" />

                  {/* 13. Commission Earned (Strict fixed width) */}
                  <div className="w-[90px] shrink-0 flex items-center justify-end gap-1 tabular-nums">
                    {!isSalaried ? (
                      <>
                        <span className="text-xs sm:text-sm font-extrabold text-emerald-700 whitespace-nowrap">
                          +{formatINR(job.commission_amount)}
                        </span>
                        <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">
                          ({job.commission_percent}%)
                        </span>
                      </>
                    ) : (
                      <span className="text-xs font-semibold text-slate-400">
                        Salaried
                      </span>
                    )}
                  </div>

                  {/* 14. View Chevron */}
                  <ChevronRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-600 transition-colors shrink-0" />
                </div>
              ))}
            </div>
          </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                  <span className="text-xs text-slate-500 font-medium">
                    Page {currentPage} of {totalPages}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="h-8 text-xs cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5 mr-1" />
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage >= totalPages}
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      className="h-8 text-xs cursor-pointer"
                    >
                      Next
                      <ChevronRight className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Tab 2: Salary Months (for Salaried Staff) */}
      {activeTab === 'salary_months' && (
        <div className="space-y-3 print:hidden no-print">
          <div className="p-3.5 bg-blue-50/70 border-0 shadow-2xs rounded-2xl text-xs text-blue-900 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Fixed monthly salary. Salary automatically accrues at the end of each calendar month.</span>
            </div>
            <span className="font-bold text-blue-900 shrink-0">
              ₹{monthlySalary.toLocaleString('en-IN')}/month
            </span>
          </div>

          {(!commissionData.salary_months || commissionData.salary_months.length === 0) ? (
            <div className="p-10 text-center space-y-2 bg-white rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <Calendar className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="text-sm font-semibold text-slate-700">No salary accrual months found</div>
              <p className="text-xs text-slate-400">
                Salary months will accrue automatically from the configured start date.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border-0 rounded-2xl overflow-hidden bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              {commissionData.salary_months.map((m: any, idx: number) => (
                <div
                  key={idx}
                  className="p-4 flex items-center justify-between text-xs hover:bg-slate-50/60 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <div>
                      <span className="font-bold text-slate-900 text-sm block">
                        {m.month_label}
                      </span>
                      {m.paid_in_month > 0 && (
                        <span className="text-[11px] text-slate-500">
                          Paid in month: {formatINR(m.paid_in_month)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3.5">
                    <span className="font-extrabold text-slate-900 tabular-nums text-sm sm:text-base">
                      {formatINR(m.amount)}
                    </span>
                    <span
                      className={`text-[10px] font-semibold uppercase px-2.5 py-0.5 rounded-full border-0 ${
                        m.paid_in_month >= m.amount
                          ? 'bg-emerald-50 text-emerald-700'
                          : m.paid_in_month > 0
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {m.paid_in_month >= m.amount
                        ? 'PAID'
                        : m.paid_in_month > 0
                        ? 'PARTIAL'
                        : 'DUE'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Payments / Payouts History */}
      {activeTab === 'payments' && (
        <div className="space-y-3 print:hidden no-print">
          {(!commissionData.payouts || commissionData.payouts.length === 0) ? (
            <div className="p-10 text-center space-y-2 bg-white rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <CreditCard className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="text-sm font-semibold text-slate-700">No payments recorded yet</div>
              <p className="text-xs text-slate-400">
                Salary and commission payouts recorded for this staff member will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border-0 rounded-2xl overflow-hidden bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              {commissionData.payouts.map((payout: any) => (
                <div
                  key={payout.id}
                  className="p-4 flex items-center justify-between text-xs hover:bg-slate-50/60 transition-colors"
                >
                  <div>
                    <div className="font-extrabold text-slate-900 text-sm sm:text-base tabular-nums">
                      {formatINR(payout.amount)}
                    </div>
                    <div className="text-slate-500 text-xs mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{formatDate(payout.payout_date)}</span>
                      <span>•</span>
                      <span className="font-medium text-slate-700">Mode: {payout.mode}</span>
                      {payout.notes && (
                        <>
                          <span>•</span>
                          <span className="italic">"{payout.notes}"</span>
                        </>
                      )}
                    </div>
                  </div>

                  <span className="text-[10px] font-semibold uppercase px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border-0">
                    Paid
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Monthly & FY Earnings Statement */}
      {activeTab === 'history' && (
        <StaffEarningsStatement
          earningsHistory={earningsHistory}
          loading={loadingHistory}
          staffInfo={staffInfo}
        />
      )}

      {/* Linked Job Detail Modal */}
      <JobDetailModal
        open={jobModalOpen}
        onOpenChange={(op) => {
          setJobModalOpen(op);
          if (!op) setSelectedJobId(null);
        }}
        jobId={selectedJobId}
        onJobUpdated={() => {
          loadDrilldown();
        }}
      />

      {/* Pay Staff Bottom Sheet / Modal */}
      <PayStaffModal
        open={payModalOpen}
        onOpenChange={(op) => {
          setPayModalOpen(op);
          if (!op) loadDrilldown();
        }}
        staffMember={staffInfo ? { id: staffInfo.id, name: staffInfo.name, balance: balancePayable } : null}
        onSuccess={() => {
          loadDrilldown();
        }}
      />

      {/* Configure Pay Type Modal */}
      <ConfigurePayTypeModal
        open={configModalOpen}
        onOpenChange={(op) => {
          setConfigModalOpen(op);
          if (!op) {
            loadStaffInfo();
            loadDrilldown();
          }
        }}
        staffMember={staffInfo ? {
          id: staffInfo.id,
          name: staffInfo.name,
          compensation_type: compType,
          monthly_salary: monthlySalary,
          salary_start_date: staffInfo.salary_start_date,
        } : null}
        onSuccess={() => {
          loadStaffInfo();
          loadDrilldown();
        }}
      />

      {/* Official A4 Printable Staff Account Statement (Mounted to body via Portal) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <div id="print-staff-statement-root" className="hidden print:flex">
            <StaffStatementPrintDocument
              business={business}
              staffInfo={staffInfo}
              periodLabel={
                period === 'TODAY'
                  ? 'Today'
                  : period === 'THIS_MONTH'
                  ? 'This Month'
                  : period === 'THIS_FY'
                  ? 'This Financial Year'
                  : 'All Time'
              }
              totalDue={totalDue}
              totalPaid={totalPaid}
              balancePayable={balancePayable}
              upcomingComm={upcomingComm}
              isSalaried={isSalaried}
              monthlySalary={monthlySalary}
              entries={commissionData.entries || []}
              payouts={commissionData.payouts || []}
              salaryMonths={commissionData.salary_months || []}
            />
          </div>,
          document.body
        )}
    </div>
  );
};

/**
 * Dedicated Full-Page A4 Staff Statement Report for Printing
 * Replaces screen captures with an official, complete accounting document.
 */
const StaffStatementPrintDocument: React.FC<{
  business: any;
  staffInfo: any;
  periodLabel: string;
  totalDue: number;
  totalPaid: number;
  balancePayable: number;
  upcomingComm: number;
  isSalaried: boolean;
  monthlySalary: number;
  entries: any[];
  payouts: any[];
  salaryMonths: any[];
}> = ({
  business,
  staffInfo,
  periodLabel,
  totalDue,
  totalPaid,
  balancePayable,
  upcomingComm,
  isSalaried,
  monthlySalary,
  entries,
  payouts,
  salaryMonths,
}) => {
  const totalJobAmt = entries.reduce((acc, j) => acc + Number(j.job_amount || 0), 0);
  const totalCommAmt = entries.reduce((acc, j) => acc + Number(j.commission_amount || 0), 0);
  const totalPayoutAmt = payouts.reduce((acc, p) => acc + Number(p.amount || 0), 0);

  return (
    <div className="w-[210mm] min-h-0 p-6 bg-white text-slate-900 font-sans text-xs leading-tight space-y-4">
      {/* 1. Modern Branding Header */}
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
          </div>
        </div>

        <div className="text-right">
          <div className="flex items-center justify-end gap-2 mb-1">
            <img src="/simplify-logo.png" alt="Simplify" className="h-4 w-auto object-contain opacity-90" />
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-white text-slate-700 shadow-2xs">
              Staff Statement
            </span>
          </div>
          <div className="text-xs font-bold text-slate-900 mt-1">{staffInfo?.name}</div>
          <div className="text-[11px] text-slate-500">
            {staffInfo?.mobile ? `Mobile: ${staffInfo.mobile}` : 'Verified Staff Member'}
            {isSalaried ? ` · Fixed Salary (₹${monthlySalary.toLocaleString('en-IN')}/mo)` : ' · Commission Based'}
          </div>
          <div className="text-[10px] font-semibold text-slate-500 mt-0.5">Scope: {periodLabel}</div>
        </div>
      </div>

      {/* 2. Three Luxury Summary Metric Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] text-slate-500 uppercase font-bold block">
            {isSalaried ? 'Total Salary Accrued' : 'Total Commission Earned'}
          </span>
          <div className="text-lg font-black text-slate-900 mt-1 tabular-nums">
            {formatINR(totalDue)}
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] text-slate-500 uppercase font-bold block">
            Total Payouts Disbursed
          </span>
          <div className="text-lg font-black text-slate-900 mt-1 tabular-nums">
            {formatINR(totalPaid)}
          </div>
        </div>

        <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
          <span className="text-[10px] text-slate-500 uppercase font-bold block">
            {balancePayable < 0 ? 'Advance Given' : 'Net Balance Payable'}
          </span>
          <div className={`text-lg font-black mt-1 tabular-nums ${balancePayable > 0 ? 'text-rose-600' : balancePayable < 0 ? 'text-blue-600' : 'text-slate-900'}`}>
            {balancePayable < 0 ? `Adv ${formatINR(Math.abs(balancePayable))}` : formatINR(balancePayable)}
          </div>
        </div>
      </div>

      {/* Upcoming note if active - Yellow Borderless */}
      {!isSalaried && upcomingComm > 0 && (
        <div className="text-[10.5px] text-amber-800 bg-amber-50/70 border-0 shadow-2xs px-3 py-1.5 rounded-xl flex items-center justify-between">
          <span>Upcoming Commission (Jobs in progress): <strong>{formatINR(upcomingComm)}</strong></span>
          <span className="text-slate-500 italic">Accrues upon workflow completion</span>
        </div>
      )}

      {/* Monthly Salary Accruals Table for Salaried Staff */}
      {isSalaried && salaryMonths.length > 0 && (
        <div className="space-y-1.5 break-inside-avoid">
          <div className="text-xs font-bold text-slate-800 uppercase tracking-wider pb-1">
            Monthly Salary Accruals ({salaryMonths.length})
          </div>
          <div className="border-0 rounded-2xl overflow-hidden bg-white shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-2 px-3 font-semibold">Month</th>
                  <th className="py-2 px-3 text-right font-semibold">Salary Amount</th>
                  <th className="py-2 px-3 text-right font-semibold">Paid In Month</th>
                  <th className="py-2 px-3 text-right font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[10.5px]">
                {salaryMonths.map((m: any, idx: number) => (
                  <tr key={idx}>
                    <td className="py-2 px-3 font-semibold text-slate-800">{m.month_label}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-900 font-bold">{formatINR(m.amount)}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-700">{formatINR(m.paid_in_month || 0)}</td>
                    <td className="py-2 px-3 text-right font-bold uppercase text-[10px]">
                      {m.paid_in_month >= m.amount ? 'PAID' : m.paid_in_month > 0 ? 'PARTIAL' : 'DUE'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 4. Completed Jobs Table */}
      {entries.length > 0 && (
        <div className="space-y-1.5 break-inside-avoid">
          <div className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center justify-between pb-1">
            <span>Completed Jobs & Commission Log ({entries.length})</span>
            <span className="text-[10px] text-slate-500 font-normal">All amounts in INR (₹)</span>
          </div>

          <div className="border-0 rounded-2xl overflow-hidden bg-white shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-2 px-2 font-semibold w-8">#</th>
                  <th className="py-2 px-2.5 font-semibold">Bill #</th>
                  <th className="py-2 px-2.5 font-semibold">Date</th>
                  <th className="py-2 px-2.5 font-semibold">Job Type / Applicant</th>
                  <th className="py-2 px-2.5 font-semibold">Customer</th>
                  <th className="py-2 px-2.5 text-right font-semibold">Job Amt</th>
                  {!isSalaried && <th className="py-2 px-2 text-right font-semibold">%</th>}
                  <th className="py-2 px-2.5 text-right font-semibold">Earned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[10.5px]">
                {entries.map((job, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/50">
                    <td className="py-2 px-2 text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className="py-2 px-2.5 font-mono font-bold text-slate-800">{job.invoice_number}</td>
                    <td className="py-2 px-2.5 text-slate-600 whitespace-nowrap">
                      {formatDate(job.completed_at || job.invoice_date)}
                    </td>
                    <td className="py-2 px-2.5 font-medium text-slate-900">
                      {job.job_type_name}
                      {job.applicant_name && <span className="text-slate-500 ml-1">({job.applicant_name})</span>}
                    </td>
                    <td className="py-2 px-2.5 text-slate-600">
                      {job.party_name}
                      {job.party_mobile && <span className="text-[10px] text-slate-400 block font-mono">{job.party_mobile}</span>}
                    </td>
                    <td className="py-2 px-2.5 text-right tabular-nums text-slate-700">{formatINR(job.job_amount)}</td>
                    {!isSalaried && <td className="py-2 px-2 text-right tabular-nums text-slate-500">{job.commission_percent}%</td>}
                    <td className="py-2 px-2.5 text-right tabular-nums font-bold text-slate-900">
                      {!isSalaried ? formatINR(job.commission_amount) : 'Salaried'}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 font-bold bg-slate-50 text-xs">
                  <td colSpan={5} className="py-2 px-2.5 text-right uppercase text-[10px]">Total</td>
                  <td className="py-2 px-2.5 text-right tabular-nums text-slate-900">{formatINR(totalJobAmt)}</td>
                  {!isSalaried && <td></td>}
                  <td className="py-2 px-2.5 text-right tabular-nums text-slate-900">{!isSalaried ? formatINR(totalCommAmt) : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Payouts History Table */}
      {payouts.length > 0 && (
        <div className="space-y-1.5 break-inside-avoid">
          <div className="text-xs font-bold text-slate-800 uppercase tracking-wider pb-1">
            Payouts / Disbursements Log ({payouts.length})
          </div>

          <div className="border-0 rounded-2xl overflow-hidden bg-white shadow-2xs">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold tracking-wider border-b border-slate-100">
                <tr>
                  <th className="py-2 px-2 font-semibold w-8">#</th>
                  <th className="py-2 px-2.5 font-semibold">Date</th>
                  <th className="py-2 px-2.5 font-semibold">Payment Mode</th>
                  <th className="py-2 px-2.5 font-semibold">Notes / Reference</th>
                  <th className="py-2 px-2.5 text-right font-semibold">Amount Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[10.5px]">
                {payouts.map((p, idx) => (
                  <tr key={idx}>
                    <td className="py-2 px-2 text-slate-400 tabular-nums">{idx + 1}</td>
                    <td className="py-2 px-2.5 text-slate-700 whitespace-nowrap">{formatDate(p.payout_date)}</td>
                    <td className="py-2 px-2.5 font-semibold text-slate-800">{p.mode}</td>
                    <td className="py-2 px-2.5 text-slate-600 italic">{p.notes || '—'}</td>
                    <td className="py-2 px-2.5 text-right tabular-nums font-bold text-slate-900">{formatINR(p.amount)}</td>
                  </tr>
                ))}
                <tr className="border-t border-slate-200 font-bold bg-slate-50 text-xs">
                  <td colSpan={4} className="py-2 px-2.5 text-right uppercase text-[10px]">Total Paid</td>
                  <td className="py-2 px-2.5 text-right tabular-nums text-slate-900">{formatINR(totalPayoutAmt)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 6. Signatures & Footer */}
      <div className="pt-6 flex justify-between items-end break-inside-avoid">
        <div className="text-center w-48">
          <div className="border-t border-slate-300 pt-1 text-xs font-semibold text-slate-700">
            Staff Signature
          </div>
          <div className="text-[10px] text-slate-400">{staffInfo?.name}</div>
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
        className="pdf-footer pt-3 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400 break-inside-avoid"
      >
        <div className="flex items-center gap-1.5">
          <span>Powered by</span>
          <img src="/simplify-logo.png" alt="Simplify" className="h-3.5 w-auto object-contain inline-block" />
          <span>Business Management &amp; Billing Software</span>
        </div>
        <div>Verified Staff Records · Confidential</div>
      </div>
    </div>
  );
};
