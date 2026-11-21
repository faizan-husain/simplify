import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate, getFYLabel } from '../lib/dates';
import { getErrorMessage } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Select } from '../components/ui/Select';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { EmptyState } from '../components/ui/EmptyState';
import { PrivacyPinModal } from '../components/privacy/PrivacyPinModal';
import { CustomerLedgerModal } from '../components/customers/CustomerLedgerModal';
import { VendorDetailModal } from '../components/payments/VendorDetailModal';
import { exportDocumentPDF, setPrintPageSize } from '../components/documents/pdfExport';
import { exportReportExcel } from '../components/documents/excelExport';
import {
  Download,
  Printer,
  FileSpreadsheet,
  TrendingUp,
  TrendingDown,
  Building,
  Building2,
  Search,
  ExternalLink,
  Calendar,
  AlertCircle,
  Award,
  Briefcase,
  Users,
} from 'lucide-react';
import { clsx } from 'clsx';

import { SegmentedControl } from '../components/ui/SegmentedControl';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { TabBar } from '../components/mobile/TabBar';
import { FilterChips } from '../components/mobile/FilterChips';

type ReportTab =
  | 'pnl'
  | 'ledger'
  | 'invoices'
  | 'receipts'
  | 'payments'
  | 'expenses'
  | 'outstanding'
  | 'loans'
  | 'jobs'
  | 'commission';

type PnlPeriod = 'MONTH' | 'YEAR';
type RegisterPeriod = 'TODAY' | 'MONTH' | 'YEAR' | 'CUSTOM';
type LedgerSubTab = 'customer' | 'vendor';

export const ReportsPage: React.FC = () => {
  const { role } = useAuth();
  const { showToast } = useToast();
  const reportPrintRef = useRef<HTMLDivElement>(null);

  const currentFY = getFYLabel(new Date());

  // Navigation & filtering states
  const [activeTab, setActiveTab] = useState<ReportTab>('pnl');
  const [ledgerSubTab, setLedgerSubTab] = useState<LedgerSubTab>('customer');
  const [selectedFY, setSelectedFY] = useState(currentFY);

  // Period state per requirement:
  // 1. P&L -> This Month, This FY (Default: This FY)
  const [pnlPeriod, setPnlPeriod] = useState<PnlPeriod>('YEAR');

  // 2. Registers -> Today, This Month, This FY, Custom Range (Default: This FY)
  const [regPeriod, setRegPeriod] = useState<RegisterPeriod>('YEAR');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split('T')[0]);

  const [loading, setLoading] = useState(true);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [partySearch, setPartySearch] = useState('');

  // Selected party modals
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [vendorModalOpen, setVendorModalOpen] = useState(false);

  // Privacy PIN state
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingFY, setPendingFY] = useState<string | null>(null);
  const [totalOutstanding, setTotalOutstanding] = useState<number>(0);

  // Jobs and Commission filters
  const [jobStatusFilter, setJobStatusFilter] = useState<'ALL' | 'IN_PROGRESS' | 'COMPLETED'>('ALL');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<'ALL' | 'PAID' | 'UNPAID' | 'PARTIAL' | 'OVERDUE' | 'CANCELLED'>('ALL');
  const [staffMembers, setStaffMembers] = useState<{ id: string; name: string }[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('ALL');

  useEffect(() => {
    const fetchStaff = async () => {
      const { data } = await supabase
        .from('members')
        .select('id, name')
        .eq('role', 'STAFF')
        .eq('active', true)
        .is('deleted_at', null)
        .order('name');
      if (data) {
        setStaffMembers(data);
      }
    };
    fetchStaff();
  }, []);

  const availableFYs = [
    { label: `${currentFY} (Current)`, value: currentFY },
    { label: '2025-26', value: '2025-26' },
    { label: '2024-25', value: '2024-25' },
    { label: '2023-24', value: '2023-24' },
  ];

  const loadReport = async () => {
    setLoading(true);
    setReportData(null);
    try {
      let rpcType = activeTab as string;
      let rpcParams: Record<string, any> = {
        fy_label: selectedFY,
      };

      if (activeTab === 'pnl') {
        rpcParams.period = pnlPeriod;
      } else if (activeTab === 'ledger') {
        rpcType = ledgerSubTab === 'customer' ? 'customer_ledger' : 'vendor_ledger';
        rpcParams.period = 'ALL';
        if (partySearch.trim()) rpcParams.search = partySearch.trim();
      } else {
        // Register tabs (invoices, receipts, payments, expenses, outstanding, loans, jobs, commission)
        rpcParams.period = regPeriod;
        if (regPeriod === 'CUSTOM') {
          rpcParams.from = customFrom;
          rpcParams.to = customTo;
        }
        if (activeTab === 'invoices' && invoiceStatusFilter !== 'ALL') {
          rpcParams.status = invoiceStatusFilter;
        }
        if (activeTab === 'jobs' && jobStatusFilter !== 'ALL') {
          rpcParams.status = jobStatusFilter;
        }
        if (activeTab === 'commission' && selectedStaffId !== 'ALL') {
          rpcParams.staff_id = selectedStaffId;
        }
      }

      const { data, error } = await supabase.rpc('report', {
        type: rpcType,
        params: rpcParams,
      });

      if (error) throw error;
      setReportData(data);

      if (activeTab === 'pnl') {
        let outstandingVal = Number((data as any)?.total_outstanding);
        if (isNaN(outstandingVal) || (data as any)?.total_outstanding === undefined) {
          const { data: invRows } = await supabase
            .from('invoices')
            .select('total, paid_amount')
            .eq('status', 'ACTIVE')
            .is('deleted_at', null);
          if (invRows) {
            outstandingVal = invRows.reduce((sum, inv) => {
              const bal = Math.max(0, Number(inv.total || 0) - Number(inv.paid_amount || 0));
              return sum + bal;
            }, 0);
          }
        }
        setTotalOutstanding(outstandingVal || 0);
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [activeTab, ledgerSubTab, selectedFY, pnlPeriod, regPeriod, jobStatusFilter, selectedStaffId, invoiceStatusFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadReport();
  };

  const handleApplyCustomRange = () => {
    if (!customFrom || !customTo) {
      showToast('Please select both Start and End dates', 'error');
      return;
    }
    if (new Date(customFrom) > new Date(customTo)) {
      showToast('Start date cannot be after End date', 'error');
      return;
    }
    loadReport();
  };

  const handleFYChange = async (newFY: string) => {
    if (newFY === currentFY) {
      setSelectedFY(newFY);
      return;
    }

    const isUnlocked = Boolean(sessionStorage.getItem('privacy_pin_unlocked'));
    if (!isUnlocked) {
      const { data: hasPin } = await supabase.rpc('has_privacy_pin');
      if (hasPin) {
        setPendingFY(newFY);
        setPinModalOpen(true);
        return;
      }
    }

    setSelectedFY(newFY);
  };

  const handlePrint = () => {
    setPrintPageSize('a4', 8);
    document.body.classList.add('printing-report-active');
    const cleanup = () => {
      document.body.classList.remove('printing-report-active');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  const handleExportPDF = async () => {
    if (!reportPrintRef.current || !reportData || loading) return;
    setExportingPDF(true);
    try {
      const periodTag = activeTab === 'pnl' ? pnlPeriod : activeTab === 'ledger' ? ledgerSubTab : regPeriod;
      const statusSuffix = activeTab === 'invoices' && invoiceStatusFilter !== 'ALL' ? `-${invoiceStatusFilter.toLowerCase()}` : '';
      const filename = `Report-${activeTab}${statusSuffix}-${periodTag}-${selectedFY}.pdf`;
      await exportDocumentPDF(reportPrintRef.current, filename);
      showToast('Report PDF downloaded successfully', 'success');
    } catch (err: any) {
      showToast('Failed to export PDF: ' + err.message, 'error');
    } finally {
      setExportingPDF(false);
    }
  };

  const handleExportExcel = async () => {
    if (!reportData || loading) return;

    try {
      const periodTag =
        activeTab === 'pnl' ? pnlPeriod : activeTab === 'ledger' ? ledgerSubTab : regPeriod;
      const statusSuffix = activeTab === 'invoices' && invoiceStatusFilter !== 'ALL' ? `-${invoiceStatusFilter.toLowerCase()}` : '';
      const filename = `Report-${activeTab}${statusSuffix}-${periodTag}-${selectedFY}.xlsx`;

      const savedFile = await exportReportExcel({
        activeTab,
        ledgerSubTab,
        reportTitle: getReportTitle(),
        periodLabel: reportData.period_label || getActivePeriodBadge(),
        reportData,
        filename,
      });

      showToast(`Exported ${savedFile} successfully`, 'success');
    } catch (err: any) {
      showToast('Failed to export Excel sheet: ' + err.message, 'error');
    }
  };

  const getReportTitle = (): string => {
    switch (activeTab) {
      case 'pnl':
        return 'Profit & Loss Statement';
      case 'ledger':
        return ledgerSubTab === 'customer'
          ? 'Customer Ledger & Balances'
          : 'Vendor Ledger & Supplier Payments';
      case 'invoices':
        return invoiceStatusFilter === 'ALL'
          ? 'Bills & Invoices Register'
          : `Bills Register (${invoiceStatusFilter === 'OVERDUE' ? 'Overdue Bills' : invoiceStatusFilter.charAt(0) + invoiceStatusFilter.slice(1).toLowerCase() + ' Bills'})`;
      case 'receipts':
        return 'Receipts & Income Register';
      case 'payments':
        return 'Vendor Payments Register';
      case 'expenses':
        return 'Operating Expenses Register';
      case 'outstanding':
        return 'Accounts Receivable (Dues)';
      case 'loans':
        return 'Loans & Capital Ledger Statement';
      case 'jobs':
        return 'Job Tracking & Work Orders';
      case 'commission':
        return 'Staff Commission Audit';
    }
  };

  const getActivePeriodBadge = (): string => {
    let badge = '';
    if (activeTab === 'pnl') {
      badge = pnlPeriod === 'MONTH' ? `This Month · ${formatDate(new Date())}` : `Financial Year ${selectedFY}`;
    } else if (activeTab === 'ledger') {
      badge = 'All Active Accounts';
    } else if (regPeriod === 'TODAY') {
      badge = `Today · ${formatDate(new Date())}`;
    } else if (regPeriod === 'MONTH') {
      const now = new Date();
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      badge = `This Month · ${monthNames[now.getMonth()]} ${now.getFullYear()}`;
    } else if (regPeriod === 'YEAR') {
      badge = `Financial Year ${selectedFY}`;
    } else {
      badge = `${formatDate(customFrom)} – ${formatDate(customTo)}`;
    }

    if (activeTab === 'jobs' && jobStatusFilter !== 'ALL') {
      badge += ` · ${jobStatusFilter === 'COMPLETED' ? 'Completed' : 'In Progress'}`;
    }
    if (activeTab === 'commission' && selectedStaffId !== 'ALL') {
      const staff = staffMembers.find((s) => s.id === selectedStaffId);
      if (staff) badge += ` · ${staff.name}`;
    }
    return badge;
  };

  if (role === 'STAFF') {
    return (
      <div className="p-8 text-center text-text-muted">
        Reports are accessible only to Owners.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5 print:p-0 print:m-0 print:max-w-none print:space-y-3">
      {/* Top Header & Contextual Controls Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-0 pb-1 print:hidden">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Business Reports</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Financial Year statements, party ledgers, cash-basis profit, and audit registers
          </p>
        </div>

        {/* Dynamic Contextual Toolbar: Desktop */}
        <div className="hidden md:flex flex-wrap items-center gap-2.5">
          {/* 1. P&L Filters: Only 'This Month' and 'This FY' */}
          {activeTab === 'pnl' && (
            <div className="flex items-center gap-2">
              <SegmentedControl
                value={pnlPeriod}
                onChange={(val) => setPnlPeriod(val as PnlPeriod)}
                options={[
                  { label: 'This Month', value: 'MONTH' },
                  { label: 'This FY', value: 'YEAR' },
                ]}
              />

              {pnlPeriod === 'YEAR' && (
                <div className="w-[195px] sm:w-[205px]">
                  <Select
                    value={selectedFY}
                    onChange={handleFYChange}
                    options={availableFYs}
                    variant="card"
                    className="h-[42px] min-h-[42px] text-[13.5px]"
                  />
                </div>
              )}
            </div>
          )}

          {/* 2. Ledger Sub-toggle: Only 'Customer' and 'Vendor' */}
          {activeTab === 'ledger' && (
            <SegmentedControl
              value={ledgerSubTab}
              onChange={(val) => {
                setLedgerSubTab(val as LedgerSubTab);
                setReportData(null);
              }}
              options={[
                { label: 'Customer Ledger', value: 'customer' },
                { label: 'Vendor Ledger', value: 'vendor' },
              ]}
            />
          )}

          {/* 3. Register Tabs Filters: 'Today', 'This Month', 'This FY', 'Custom Range' */}
          {activeTab !== 'pnl' && activeTab !== 'ledger' && (
            <div className="flex flex-wrap items-center gap-2">
              <SegmentedControl
                value={regPeriod}
                onChange={(val) => setRegPeriod(val as RegisterPeriod)}
                options={[
                  { label: 'Today', value: 'TODAY' },
                  { label: 'This Month', value: 'MONTH' },
                  { label: 'This FY', value: 'YEAR' },
                  { label: 'Custom', value: 'CUSTOM' },
                ]}
              />

              {regPeriod === 'YEAR' && (
                <div className="w-[195px] sm:w-[205px]">
                  <Select
                    value={selectedFY}
                    onChange={handleFYChange}
                    options={availableFYs}
                    variant="card"
                    className="h-[42px] min-h-[42px] text-[13.5px]"
                  />
                </div>
              )}
            </div>
          )}

          {/* Universal Document Actions: PDF, Print, CSV */}
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={handleExportPDF}
              disabled={loading || exportingPDF || !reportData}
              title="Save report as PDF"
              className="h-9 px-3 rounded-xl border-0 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5 text-accent" />
              <span>{exportingPDF ? 'Saving...' : 'PDF'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || !reportData}
              title="Print report"
              className="h-9 px-3 rounded-xl border-0 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5 text-slate-500" />
              <span>Print</span>
            </button>

            <button
              type="button"
              onClick={handleExportExcel}
              disabled={loading || !reportData}
              title="Export report to Excel (.xlsx)"
              className="h-9 px-3 rounded-xl border-0 bg-white hover:bg-emerald-50 text-emerald-700 hover:text-emerald-800 text-xs font-semibold shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Excel</span>
            </button>
          </div>
        </div>
      </div>

      {/* Dynamic Contextual Toolbar: Mobile (md:hidden) */}
      <div className="md:hidden space-y-2.5 print:hidden">
        {/* Dynamic Contextual Filters */}
        {activeTab === 'pnl' && (
          <div className="flex flex-col gap-2">
            <FilterChips
              value={pnlPeriod}
              onChange={(val) => setPnlPeriod(val as PnlPeriod)}
              options={[
                { label: 'This Month', value: 'MONTH' },
                { label: 'This FY', value: 'YEAR' },
              ]}
            />
            {pnlPeriod === 'YEAR' && (
              <div className="w-full">
                <Select
                  value={selectedFY}
                  onChange={handleFYChange}
                  options={availableFYs}
                  variant="card"
                  className="h-10 text-[13px] w-full"
                />
              </div>
            )}
          </div>
        )}

        {activeTab === 'ledger' && (
          <FilterChips
            value={ledgerSubTab}
            onChange={(val) => {
              setLedgerSubTab(val as LedgerSubTab);
              setReportData(null);
            }}
            options={[
              { label: 'Customer Ledger', value: 'customer' },
              { label: 'Vendor Ledger', value: 'vendor' },
            ]}
          />
        )}

        {activeTab !== 'pnl' && activeTab !== 'ledger' && (
          <div className="flex flex-col gap-2">
            <FilterChips
              value={regPeriod}
              onChange={(val) => setRegPeriod(val as RegisterPeriod)}
              options={[
                { label: 'Today', value: 'TODAY' },
                { label: 'This Month', value: 'MONTH' },
                { label: 'This FY', value: 'YEAR' },
                { label: 'Custom', value: 'CUSTOM' },
              ]}
            />
            {regPeriod === 'YEAR' && (
              <div className="w-full">
                <Select
                  value={selectedFY}
                  onChange={handleFYChange}
                  options={availableFYs}
                  variant="card"
                  className="h-10 text-[13px] w-full"
                />
              </div>
            )}
          </div>
        )}

        {/* Universal Actions Row (PDF, Print, Excel) */}
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleExportPDF}
            disabled={loading || exportingPDF || !reportData}
            className="h-10 px-2 rounded-xl bg-white text-slate-700 text-xs font-semibold shadow-2xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-accent" />
            <span>{exportingPDF ? 'Saving...' : 'PDF'}</span>
          </button>

          <button
            type="button"
            onClick={handlePrint}
            disabled={loading || !reportData}
            className="h-10 px-2 rounded-xl bg-white text-slate-700 text-xs font-semibold shadow-2xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
          >
            <Printer className="w-3.5 h-3.5 text-slate-500" />
            <span>Print</span>
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            disabled={loading || !reportData}
            className="h-10 px-2 rounded-xl bg-white text-emerald-700 text-xs font-semibold shadow-2xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            <span>Excel</span>
          </button>
        </div>
      </div>

      {/* Expandable Custom Date Range Bar (For Register Tabs when Custom Range is active) */}
      {activeTab !== 'pnl' && activeTab !== 'ledger' && regPeriod === 'CUSTOM' && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-white border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] rounded-2xl print:hidden">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-accent" />
            <span className="text-xs font-semibold text-slate-900">Custom Date Selection:</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">Start Date:</span>
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-9 px-3 rounded-xl border-0 shadow-2xs text-xs bg-slate-50 focus:bg-white text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-[#0F766E]/20"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-slate-500 font-medium">End Date:</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 px-3 rounded-xl border-0 shadow-2xs text-xs bg-slate-50 focus:bg-white text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-[#0F766E]/20"
              />
            </div>

            <button
              type="button"
              onClick={handleApplyCustomRange}
              className="h-9 px-4 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs shadow-xs transition-all cursor-pointer"
            >
              Apply Filter
            </button>
          </div>
        </div>
      )}

      {/* Mobile TabBar (md:hidden) */}
      <div className="md:hidden print:hidden -mx-4 px-4 bg-white border-y border-slate-100">
        <TabBar
          tabs={[
            { value: 'pnl', label: 'P&L' },
            { value: 'ledger', label: 'Ledgers' },
            { value: 'invoices', label: 'Bills' },
            { value: 'receipts', label: 'Receipts' },
            { value: 'payments', label: 'Payments' },
            { value: 'expenses', label: 'Expenses' },
            { value: 'outstanding', label: 'Dues' },
            { value: 'loans', label: 'Loans' },
            { value: 'jobs', label: 'Jobs' },
            { value: 'commission', label: 'Commission' },
          ]}
          value={activeTab}
          onChange={(val) => {
            setActiveTab(val as ReportTab);
            setReportData(null);
            setPartySearch('');
          }}
        />
      </div>

      {/* Desktop Report Categories Tab Navigation (hidden md:block) */}
      <div className="hidden md:block print:hidden">
        <Tabs
          value={activeTab}
          onValueChange={(val) => {
            setActiveTab(val as ReportTab);
            setReportData(null);
            setPartySearch('');
          }}
        >
          <TabsList className="w-full flex-wrap h-auto gap-1 border-0 border-b-0">
            <TabsTrigger value="pnl" className="flex-1 min-w-[70px]">P&amp;L</TabsTrigger>
            <TabsTrigger value="ledger" className="flex-1 min-w-[90px]">Ledgers</TabsTrigger>
            <TabsTrigger value="invoices" className="flex-1 min-w-[70px]">Bills</TabsTrigger>
            <TabsTrigger value="receipts" className="flex-1 min-w-[75px]">Receipts</TabsTrigger>
            <TabsTrigger value="payments" className="flex-1 min-w-[75px]">Payments</TabsTrigger>
            <TabsTrigger value="expenses" className="flex-1 min-w-[75px]">Expenses</TabsTrigger>
            <TabsTrigger value="outstanding" className="flex-1 min-w-[70px]">Dues</TabsTrigger>
            <TabsTrigger value="loans" className="flex-1 min-w-[70px]">Loans</TabsTrigger>
            <TabsTrigger value="jobs" className="flex-1 min-w-[65px]">Jobs</TabsTrigger>
            <TabsTrigger value="commission" className="flex-1 min-w-[85px]">Commission</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* REPORT CONTENT & PRINTABLE CONTAINER */}
      {loading ? (
        <div className="py-16 text-center text-sm text-text-muted">
          Loading {getReportTitle()}...
        </div>
      ) : !reportData ? (
        <EmptyState message="Failed to load report data." />
      ) : (
        <div ref={reportPrintRef} id="print-report-root" className="space-y-4 print:p-0 bg-transparent">
          {/* Printable Official Statement Header (Visible on Screen, in PDF, and in Print) */}
          <div className="p-4 bg-[#EEF0F3] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-white text-accent flex items-center justify-center shrink-0 shadow-2xs">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-semibold text-text text-sm">
                  {reportData.business?.name || 'Business Accounting Statement'}
                </h2>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {reportData.business?.address || 'Document & Business Solutions'}
                  {reportData.business?.mobile && ` · Phone: ${reportData.business.mobile}`}
                </p>
                {reportData.business?.upi_id && (
                  <p className="text-[11px] font-medium text-accent mt-0.5">UPI ID: {reportData.business.upi_id}</p>
                )}
              </div>
            </div>

            <div className="sm:text-right pt-2 sm:pt-0 shrink-0">
              <div className="flex items-center sm:justify-end gap-2 mb-1 shrink-0">
                <img src="/simplify-logo.png" alt="Simplify" className="h-4 w-auto object-contain opacity-90 shrink-0" />
                <Badge variant="neutral" className="bg-white/90 border-0 shadow-2xs whitespace-nowrap text-xs font-semibold text-slate-700 px-2.5 py-0.5">
                  {getReportTitle()}
                </Badge>
              </div>
              <div className="text-text font-semibold text-xs mt-1.5 flex sm:justify-end items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-accent" />
                {reportData.period_label || getActivePeriodBadge()}
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">
                Generated: {formatDate(new Date())}
              </div>
            </div>
          </div>

          {/* 1. PROFIT & LOSS REPORT */}
          {activeTab === 'pnl' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                <Card className="p-4 sm:p-5 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-accent" />
                    Total Income (Receipts)
                  </div>
                  <div className="text-xl sm:text-2xl font-bold tabular-nums text-slate-900 mt-2">
                    {formatINR(reportData.income)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Includes bill payments &amp; other income
                  </div>
                </Card>

                <Card className="p-4 sm:p-5 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingDown className="w-4 h-4 text-slate-400" />
                    Total Outgoing
                  </div>
                  <div className="text-xl sm:text-2xl font-bold tabular-nums text-slate-900 mt-2">
                    {formatINR(reportData.outgoing)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1 tabular-nums truncate" title={`Vendor Payments (${formatINR(reportData.payments)}) + Expenses (${formatINR(reportData.expenses)})`}>
                    Vendors ({formatINR(reportData.payments)}) + Expenses ({formatINR(reportData.expenses)})
                  </div>
                </Card>

                <Card className="p-4 sm:p-5 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Net Profit (Cash Basis)
                  </div>
                  <div
                    className={`text-xl sm:text-2xl font-bold tabular-nums mt-2 ${
                      reportData.net_profit >= 0 ? 'text-[#0F766E]' : 'text-danger'
                    }`}
                  >
                    {formatINR(reportData.net_profit)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Excludes outside loan principal (BR-1)
                  </div>
                </Card>

                <Card className="p-4 sm:p-5 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                    Total Outstanding
                  </div>
                  <div
                    className={`text-xl sm:text-2xl font-bold tabular-nums mt-2 ${
                      (reportData.total_outstanding ?? totalOutstanding) > 0
                        ? 'text-danger'
                        : 'text-slate-900'
                    }`}
                  >
                    {formatINR(reportData.total_outstanding ?? totalOutstanding)}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Pending customer dues
                  </div>
                </Card>
              </div>

              {reportData.loans && (
                <div className="p-3.5 bg-[#EEF0F3] rounded-2xl border-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Building className="w-4 h-4 text-slate-500" />
                    <span className="font-semibold text-slate-900">Capital Ledger Movement (Loans):</span>
                    <span className="text-slate-500 tabular-nums">
                      Taken: <strong className="text-slate-900 font-semibold">{formatINR(reportData.loans.taken)}</strong> · Principal Repaid:{' '}
                      <strong className="text-slate-900 font-semibold">{formatINR(reportData.loans.principal_repaid)}</strong>
                    </span>
                  </div>
                  <div className="text-slate-500 tabular-nums">
                    Interest Paid: <strong className="text-slate-900 font-semibold">{formatINR(reportData.loans.interest_paid)}</strong> (captured as Expense)
                  </div>
                </div>
              )}

              {/* Monthly Trend Table */}
              <div className="bg-white rounded-2xl border-0 overflow-hidden shadow-2xs">
                <div className="px-4 py-3 border-b border-slate-100 font-semibold text-sm text-slate-900">
                  Performance Trend ({getActivePeriodBadge()})
                </div>
                {/* Mobile Trend Cards (md:hidden) */}
                <div className="md:hidden divide-y divide-slate-100 print:hidden">
                  {reportData.monthly_trend?.map((m: any, i: number) => (
                    <div key={i} className="p-3.5 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-slate-900">{m.month}</span>
                        <span
                          className={`font-bold tabular-nums ${
                            m.profit >= 0 ? 'text-[#0F766E]' : 'text-danger'
                          }`}
                        >
                          Net: {formatINR(m.profit)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                        <span>Income: <strong className="text-slate-800 font-semibold tabular-nums">{formatINR(m.income)}</strong></span>
                        <span>Outgoing: <strong className="text-slate-800 font-semibold tabular-nums">{formatINR(m.outgoing)}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Trend Table (hidden md:block) */}
                <div className="hidden md:block print:block overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                      <tr>
                        <th className="px-4 py-2.5">Period / Month</th>
                        <th className="px-4 py-2.5 text-right">Income</th>
                        <th className="px-4 py-2.5 text-right">Outgoing</th>
                        <th className="px-4 py-2.5 text-right">Net Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {reportData.monthly_trend?.map((m: any, i: number) => (
                        <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-4 py-2.5 font-medium text-slate-900">{m.month}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-slate-900 tabular-nums">
                            {formatINR(m.income)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-slate-900 tabular-nums">
                            {formatINR(m.outgoing)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-semibold tabular-nums ${
                              m.profit >= 0 ? 'text-[#0F766E]' : 'text-danger'
                            }`}
                          >
                            {formatINR(m.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 2. LEDGER TAB (CUSTOMER & VENDOR WITH MODAL DRILL-DOWN) */}
          {activeTab === 'ledger' && (
            <div className="space-y-4">
              {/* Customer View */}
              {ledgerSubTab === 'customer' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs">
                      <div className="text-xs text-slate-500 font-medium">Opening Balance</div>
                      <div className="text-xl font-bold text-slate-900 mt-1">
                        {formatINR(reportData.total_opening_balance || 0)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Historical baseline</div>
                    </div>

                    <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs">
                      <div className="text-xs text-slate-500 font-medium">Total Billed</div>
                      <div className="text-xl font-bold text-slate-900 mt-1">
                        {formatINR(reportData.total_period_billed || 0)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Across all bills</div>
                    </div>

                    <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs">
                      <div className="text-xs text-slate-500 font-medium">Total Received</div>
                      <div className="text-xl font-bold text-emerald-600 mt-1">
                        {formatINR(reportData.total_period_paid || 0)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">All customer receipts</div>
                    </div>

                    <div className="p-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs">
                      <div className="text-xs text-slate-500 font-semibold">Total Net Closing Dues</div>
                      <div className="text-xl font-black text-rose-600 mt-1">
                        {formatINR(reportData.total_closing_due || 0)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {reportData.customer_count || 0} active customers
                      </div>
                    </div>
                  </div>

                  {/* Search Toolbar */}
                  <div className="flex items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200/90 shadow-2xs print:hidden">
                    <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 flex-1 max-w-sm">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search customer name or mobile..."
                          value={partySearch}
                          onChange={(e) => setPartySearch(e.target.value)}
                          className="w-full h-9 pl-8 pr-3 text-xs rounded-xl border-0 bg-slate-50 focus:bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#0F766E]/20 transition-all font-medium"
                        />
                      </div>
                      <button
                        type="submit"
                        className="h-9 px-3.5 rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
                      >
                        Filter
                      </button>
                    </form>

                    <div className="text-xs text-slate-500 font-medium hidden sm:block">
                      Showing {reportData.rows?.length || 0} customers (Click Statement for custom date ranges)
                    </div>
                  </div>

                  {/* Mobile Customer Ledger Cards (md:hidden) */}
                  <div className="md:hidden space-y-3 print:hidden">
                    {reportData.rows?.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 bg-white rounded-2xl">
                        No customer records found.
                      </div>
                    ) : (
                      reportData.rows?.map((row: any) => (
                        <div
                          key={row.id}
                          onClick={() => {
                            setSelectedCustomerId(row.id);
                            setCustomerModalOpen(true);
                          }}
                          className="bg-white rounded-2xl p-3.5 space-y-2.5 shadow-2xs border border-border/70 cursor-pointer active:scale-[0.99] transition-all"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-[15px] font-semibold text-slate-900">{row.customer_name}</div>
                              <div className="text-[12.5px] text-slate-500">
                                {row.customer_mobile || 'No mobile'} &middot; <span className="capitalize">{row.customer_type?.toLowerCase()}</span>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className={clsx("text-[16px] font-bold tabular-nums", row.closing_due > 0 ? "text-danger" : "text-slate-900")}>
                                {formatINR(row.closing_due)}
                              </div>
                              <span className="text-[11px] text-slate-400 font-medium">Closing due</span>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-slate-100 grid grid-cols-3 gap-1 text-[11px] text-slate-600">
                            <div>
                              <span className="text-slate-400 block text-[10px]">Opening</span>
                              <span className="font-semibold tabular-nums">{formatINR(row.opening_balance)}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[10px]">Billed (+)</span>
                              <span className="font-semibold tabular-nums">{formatINR(row.period_billed)}</span>
                            </div>
                            <div className="text-right">
                              <span className="text-slate-400 block text-[10px]">Paid (-)</span>
                              <span className="font-semibold text-emerald-600 tabular-nums">{formatINR(row.period_paid)}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            className="w-full h-9 rounded-xl bg-slate-50 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-accent" />
                            <span>View Statement</span>
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Desktop Customers Overview Table (hidden md:block) */}
                  <div className="hidden md:block print:block bg-white rounded-2xl border-0 overflow-x-auto shadow-2xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                        <tr>
                          <th className="px-3.5 py-2.5">Customer</th>
                          <th className="px-3.5 py-2.5">Mobile</th>
                          <th className="px-3.5 py-2.5 text-right">Opening Bal</th>
                          <th className="px-3.5 py-2.5 text-right">Billed (+)</th>
                          <th className="px-3.5 py-2.5 text-right">Paid (-)</th>
                          <th className="px-3.5 py-2.5 text-right">Closing Due</th>
                          <th className="px-3.5 py-2.5 text-center print:hidden">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reportData.rows?.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                              No customer records found.
                            </td>
                          </tr>
                        ) : (
                          reportData.rows?.map((row: any) => (
                            <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-3.5 py-2.5">
                                <div className="font-semibold text-slate-900">{row.customer_name}</div>
                                <span className="text-[10px] text-slate-400 font-medium">{row.customer_type}</span>
                              </td>
                              <td className="px-3.5 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">
                                {row.customer_mobile || '—'}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-medium text-slate-900 tabular-nums whitespace-nowrap">
                                {formatINR(row.opening_balance)}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-medium text-slate-900 tabular-nums whitespace-nowrap">
                                {formatINR(row.period_billed)}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-medium text-emerald-600 tabular-nums whitespace-nowrap">
                                {formatINR(row.period_paid)}
                              </td>
                              <td
                                className={`px-3.5 py-2.5 text-right font-semibold tabular-nums whitespace-nowrap ${
                                  row.closing_due > 0 ? 'text-danger' : 'text-slate-900'
                                }`}
                              >
                                {formatINR(row.closing_due)}
                              </td>
                              <td className="px-3.5 py-2.5 text-center whitespace-nowrap print:hidden">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedCustomerId(row.id);
                                    setCustomerModalOpen(true);
                                  }}
                                  className="h-7 px-2.5 rounded-lg border-0 bg-slate-100/90 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] text-xs font-semibold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1"
                                >
                                  <ExternalLink className="w-3 h-3 text-accent" />
                                  <span>Statement</span>
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                /* Vendor View */
                <div className="space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                      <div className="text-xs text-slate-500 font-medium">Total Paid to Vendors</div>
                      <div className="text-xl font-bold text-danger tabular-nums mt-1">
                        {formatINR(reportData.total_paid || 0)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">All time total</div>
                    </Card>

                    <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                      <div className="text-xs text-slate-500 font-medium">Cash Paid</div>
                      <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">
                        {formatINR(reportData.total_cash_paid || 0)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Physical cash out</div>
                    </Card>

                    <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                      <div className="text-xs text-slate-500 font-medium">Bank / Online Paid</div>
                      <div className="text-xl font-bold text-accent tabular-nums mt-1">
                        {formatINR(reportData.total_bank_paid || 0)}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">UPI, NetBanking, Cards</div>
                    </Card>

                    <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                      <div className="text-xs text-slate-500 font-medium">Active Vendors</div>
                      <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">
                        {reportData.vendor_count || 0}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">Registered suppliers</div>
                    </Card>
                  </div>

                  {/* Search Toolbar */}
                  <div className="flex items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200/90 shadow-2xs print:hidden">
                    <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 flex-1 max-w-sm">
                      <div className="relative flex-1">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search vendor name or mobile..."
                          value={partySearch}
                          onChange={(e) => setPartySearch(e.target.value)}
                          className="w-full h-9 pl-8 pr-3 text-xs rounded-xl border-0 bg-slate-50 focus:bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#0F766E]/20 transition-all font-medium"
                        />
                      </div>
                      <button
                        type="submit"
                        className="h-9 px-3.5 rounded-xl border-0 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold shadow-2xs transition-all cursor-pointer"
                      >
                        Filter
                      </button>
                    </form>

                    <div className="text-xs text-slate-500 font-medium hidden sm:block">
                      Showing {reportData.rows?.length || 0} vendors
                    </div>
                  </div>

                  {/* Mobile Vendor Ledger Cards (md:hidden) */}
                  <div className="md:hidden space-y-3 print:hidden">
                    {reportData.rows?.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 bg-white rounded-2xl">
                        No vendor payment records found.
                      </div>
                    ) : (
                      reportData.rows?.map((row: any) => (
                        <div
                          key={row.id}
                          onClick={() => {
                            setSelectedVendorId(row.id);
                            setVendorModalOpen(true);
                          }}
                          className="bg-white rounded-2xl p-3.5 space-y-2.5 shadow-2xs border border-border/70 cursor-pointer active:scale-[0.99] transition-all"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-[15px] font-semibold text-slate-900">{row.vendor_name}</div>
                              <div className="text-[12.5px] text-slate-500">{row.vendor_mobile || 'No mobile'} &middot; {row.payment_count} txns</div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-[16px] font-bold text-danger tabular-nums">
                                {formatINR(row.total_paid)}
                              </div>
                              <span className="text-[11px] text-slate-400 font-medium">Total paid</span>
                            </div>
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
                            <span>Cash: <strong className="font-semibold tabular-nums">{formatINR(row.cash_paid)}</strong></span>
                            <span>Bank: <strong className="font-semibold text-accent tabular-nums">{formatINR(row.bank_paid)}</strong></span>
                            <span>Last: <span className="text-slate-500">{row.last_payment_date ? formatDate(row.last_payment_date) : '—'}</span></span>
                          </div>

                          <button
                            type="button"
                            className="w-full h-9 rounded-xl bg-slate-50 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5 text-accent" />
                            <span>View Statement</span>
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Desktop Vendors Overview Table (hidden md:block) */}
                  <div className="hidden md:block print:block bg-white rounded-2xl border-0 overflow-x-auto shadow-2xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                        <tr>
                          <th className="px-3.5 py-2.5">Vendor</th>
                          <th className="px-3.5 py-2.5">Mobile</th>
                          <th className="px-3.5 py-2.5 text-right">Cash Paid</th>
                          <th className="px-3.5 py-2.5 text-right">Bank Paid</th>
                          <th className="px-3.5 py-2.5 text-right">Total Paid</th>
                          <th className="px-3.5 py-2.5 text-center">Txns</th>
                          <th className="px-3.5 py-2.5 text-center">Last Payment</th>
                          <th className="px-3.5 py-2.5 text-center print:hidden">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {reportData.rows?.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                              No vendor payment records found.
                            </td>
                          </tr>
                        ) : (
                          reportData.rows?.map((row: any) => (
                            <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                              <td className="px-3.5 py-2.5 font-semibold text-slate-900">
                                {row.vendor_name}
                              </td>
                              <td className="px-3.5 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">
                                {row.vendor_mobile || '—'}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-medium text-slate-900 tabular-nums whitespace-nowrap">
                                {formatINR(row.cash_paid)}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-medium text-accent tabular-nums whitespace-nowrap">
                                {formatINR(row.bank_paid)}
                              </td>
                              <td className="px-3.5 py-2.5 text-right font-semibold text-danger tabular-nums whitespace-nowrap">
                                {formatINR(row.total_paid)}
                              </td>
                              <td className="px-3.5 py-2.5 text-center font-medium text-slate-900 tabular-nums whitespace-nowrap">
                                {row.payment_count}
                              </td>
                              <td className="px-3.5 py-2.5 text-center text-slate-500 whitespace-nowrap">
                                {row.last_payment_date ? formatDate(row.last_payment_date) : '—'}
                              </td>
                              <td className="px-3.5 py-2.5 text-center whitespace-nowrap print:hidden">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedVendorId(row.id);
                                    setVendorModalOpen(true);
                                  }}
                                  className="h-7 px-2.5 rounded-lg border-0 bg-slate-100/90 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] text-xs font-semibold shadow-2xs transition-all cursor-pointer inline-flex items-center gap-1"
                                >
                                  <ExternalLink className="w-3 h-3 text-accent" />
                                  <span>Statement</span>
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. INVOICES / BILLS REPORT */}
          {activeTab === 'invoices' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs text-slate-500 font-medium">Total Billed</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">
                    {formatINR(reportData.total_billed)}
                  </div>
                </Card>
                <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs text-slate-500 font-medium">Total Paid</div>
                  <div className="text-xl font-bold text-emerald-600 tabular-nums mt-1">
                    {formatINR(reportData.total_paid)}
                  </div>
                </Card>
                <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs text-slate-500 font-medium">Total Balance (Due)</div>
                  <div className="text-xl font-bold text-danger tabular-nums mt-1">
                    {formatINR(reportData.total_balance)}
                  </div>
                </Card>
                <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs text-slate-500 font-medium">Bills Count</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">{reportData.count}</div>
                </Card>
              </div>

              {/* Bills Status Filter Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-2.5 rounded-2xl border border-slate-200/90 shadow-2xs print:hidden">
                <div className="flex items-center gap-2 overflow-x-auto max-w-full">
                  <span className="text-xs font-semibold text-slate-500 whitespace-nowrap pl-1">
                    Status:
                  </span>
                  <div className="flex items-center gap-1 p-1 bg-[#EEF0F3] rounded-xl overflow-x-auto">
                    {[
                      { value: 'ALL', label: 'All Bills' },
                      { value: 'PAID', label: 'Paid' },
                      { value: 'UNPAID', label: 'Unpaid' },
                      { value: 'PARTIAL', label: 'Partial' },
                      { value: 'OVERDUE', label: 'Overdue' },
                      { value: 'CANCELLED', label: 'Cancelled' },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setInvoiceStatusFilter(opt.value as any)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                          invoiceStatusFilter === opt.value
                            ? 'bg-white text-slate-900 shadow-2xs font-bold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="text-xs text-slate-500 font-medium pr-1">
                  Showing <span className="font-bold text-slate-900">{reportData.count || 0}</span> bills
                </div>
              </div>

              {/* Status Indicator on Print Only */}
              {invoiceStatusFilter !== 'ALL' && (
                <div className="hidden print:flex items-center gap-2 text-xs text-slate-700 font-semibold bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
                  <span className="text-slate-500 font-normal">Filtered by Status:</span>
                  <span className="uppercase font-bold">{invoiceStatusFilter}</span>
                </div>
              )}

              {/* Mobile Bills Register Cards (md:hidden) */}
              <div className="md:hidden space-y-3 print:hidden">
                {reportData.rows?.map((row: any) => {
                  const isCancelled = row.status === 'CANCELLED';
                  const isPaid = !isCancelled && (row.balance === 0 || row.paid_amount >= row.total);
                  const isPartial = !isCancelled && !isPaid && row.paid_amount > 0;
                  const isOverdue = !isCancelled && !isPaid && row.is_overdue;

                  let badgeCls = 'bg-rose-50 text-rose-700';
                  let label = 'Unpaid';
                  if (isCancelled) {
                    badgeCls = 'bg-rose-100/70 text-rose-700 border-0 line-through';
                    label = 'Cancelled';
                  } else if (isOverdue) {
                    badgeCls = 'bg-rose-100 text-rose-800 font-bold';
                    label = 'Overdue';
                  } else if (isPaid) {
                    badgeCls = 'bg-emerald-50 text-emerald-700';
                    label = 'Paid';
                  } else if (isPartial) {
                    badgeCls = 'bg-amber-50 text-amber-700';
                    label = 'Partial';
                  }

                  return (
                    <div key={row.id} className="bg-white rounded-2xl p-3.5 space-y-2 shadow-2xs border border-border/70">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[15px] font-semibold text-slate-900">{row.party_name || 'Walk-in'}</div>
                          <div className="text-[12.5px] text-slate-500">#{row.number} &middot; {formatDate(row.invoice_date)}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[16px] font-bold text-slate-900 tabular-nums">{formatINR(row.total)}</div>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${badgeCls}`}>
                            {label}
                          </span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
                        <span>Paid: <strong className="text-emerald-600 font-semibold tabular-nums">{formatINR(row.paid_amount)}</strong></span>
                        <span>Balance: <strong className={clsx("font-semibold tabular-nums", row.balance > 0 ? "text-danger" : "text-slate-700")}>{row.balance > 0 ? formatINR(row.balance) : '₹0'}</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Bills Register Table (hidden md:block) */}
              <div className="hidden md:block print:block bg-white rounded-2xl border-0 overflow-x-auto shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                    <tr>
                      <th className="px-3.5 py-2.5">Bill #</th>
                      <th className="px-3.5 py-2.5">Date</th>
                      <th className="px-3.5 py-2.5">Party</th>
                      <th className="px-3.5 py-2.5 text-right">Total</th>
                      <th className="px-3.5 py-2.5 text-right">Paid</th>
                      <th className="px-3.5 py-2.5 text-right">Balance</th>
                      <th className="px-3.5 py-2.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportData.rows?.map((row: any) => (
                      <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-3.5 py-2.5 font-semibold text-slate-900">#{row.number}</td>
                        <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(row.invoice_date)}</td>
                        <td className="px-3.5 py-2.5 font-medium text-slate-800">{row.party_name}</td>
                        <td className="px-3.5 py-2.5 text-right font-medium text-slate-900 tabular-nums whitespace-nowrap">{formatINR(row.total)}</td>
                        <td className="px-3.5 py-2.5 text-right font-medium text-emerald-600 tabular-nums whitespace-nowrap">{formatINR(row.paid_amount)}</td>
                        <td className="px-3.5 py-2.5 text-right font-semibold text-danger tabular-nums whitespace-nowrap">
                          {row.balance > 0 ? formatINR(row.balance) : '—'}
                        </td>
                        <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                          {(() => {
                            const isCancelled = row.status === 'CANCELLED';
                            const isPaid = !isCancelled && (row.balance === 0 || row.paid_amount >= row.total);
                            const isPartial = !isCancelled && !isPaid && row.paid_amount > 0;
                            const isOverdue = !isCancelled && !isPaid && row.is_overdue;

                            let badgeCls = 'bg-rose-50 text-rose-700';
                            let label = 'Unpaid';

                            if (isCancelled) {
                              badgeCls = 'bg-rose-100/70 text-rose-700 border-0 line-through';
                              label = 'Cancelled';
                            } else if (isOverdue) {
                              badgeCls = 'bg-rose-100 text-rose-800 font-bold';
                              label = 'Overdue';
                            } else if (isPaid) {
                              badgeCls = 'bg-emerald-50 text-emerald-700';
                              label = 'Paid';
                            } else if (isPartial) {
                              badgeCls = 'bg-amber-50 text-amber-700';
                              label = 'Partial';
                            }

                            return (
                              <span
                                className={clsx(
                                  'w-[78px] inline-flex items-center justify-center py-1 rounded-md text-[11px] font-semibold text-center shrink-0 border-0',
                                  badgeCls
                                )}
                              >
                                {label}
                              </span>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 4. RECEIPTS REPORT */}
          {activeTab === 'receipts' && (
            <div className="space-y-4">
              <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500 font-medium">Total Receipts Amount</div>
                  <div className="text-2xl font-bold tabular-nums text-slate-900 mt-1">
                    {formatINR(reportData.total_amount)}
                  </div>
                </div>
                <div className="text-xs text-slate-500 tabular-nums font-medium">
                  {reportData.count} receipts in period
                </div>
              </Card>

              {/* Mobile Receipts Cards (md:hidden) */}
              <div className="md:hidden space-y-3 print:hidden">
                {reportData.rows?.map((row: any) => (
                  <div key={row.id} className="bg-white rounded-2xl p-3.5 space-y-2 shadow-2xs border border-border/70">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[15px] font-semibold text-slate-900">{row.customer_name || row.income_category || row.kind}</div>
                        <div className="text-[12.5px] text-slate-500">#{row.number} &middot; {formatDate(row.receipt_date)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[16px] font-bold text-emerald-600 tabular-nums">+{formatINR(row.amount)}</div>
                        <span className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">{row.mode}</span>
                      </div>
                    </div>
                    {row.unallocated_amount > 0 && (
                      <div className="pt-2 border-t border-slate-100 text-[11px] text-amber-700">
                        Unallocated advance: <strong className="font-semibold tabular-nums">{formatINR(row.unallocated_amount)}</strong>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop Receipts Table (hidden md:block) */}
              <div className="hidden md:block print:block bg-white rounded-2xl border-0 overflow-x-auto shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                    <tr>
                      <th className="px-3.5 py-2.5">Receipt #</th>
                      <th className="px-3.5 py-2.5">Date</th>
                      <th className="px-3.5 py-2.5">Customer / Kind</th>
                      <th className="px-3.5 py-2.5">Mode</th>
                      <th className="px-3.5 py-2.5 text-right">Amount</th>
                      <th className="px-3.5 py-2.5 text-right">Unallocated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportData.rows?.map((row: any) => (
                      <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-3.5 py-2.5 font-semibold text-slate-900">#{row.number}</td>
                        <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(row.receipt_date)}</td>
                        <td className="px-3.5 py-2.5 font-medium text-slate-800">
                          {row.customer_name || row.income_category || row.kind}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-600 font-medium">{row.mode}</td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-slate-900 tabular-nums whitespace-nowrap">
                          {formatINR(row.amount)}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-slate-500 tabular-nums whitespace-nowrap">
                          {row.unallocated_amount > 0 ? formatINR(row.unallocated_amount) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5. PAYMENTS REPORT */}
          {activeTab === 'payments' && (
            <div className="space-y-4">
              <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500 font-medium">Total Vendor Payments</div>
                  <div className="text-2xl font-bold tabular-nums text-danger mt-1">
                    {formatINR(reportData.total_amount)}
                  </div>
                </div>
                <div className="text-xs text-slate-500 tabular-nums font-medium">
                  {reportData.count} payments in period
                </div>
              </Card>

              {/* Mobile Payments Cards (md:hidden) */}
              <div className="md:hidden space-y-3 print:hidden">
                {reportData.rows?.map((row: any) => (
                  <div key={row.id} className="bg-white rounded-2xl p-3.5 space-y-2 shadow-2xs border border-border/70">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[15px] font-semibold text-slate-900">{row.vendor_name}</div>
                        <div className="text-[12.5px] text-slate-500">{formatDate(row.payment_date)} {row.invoice_number ? `· Bill #${row.invoice_number}` : ''}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[16px] font-bold text-danger tabular-nums">-{formatINR(row.amount)}</div>
                        <span className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">{row.mode}</span>
                      </div>
                    </div>
                    {row.description && (
                      <div className="pt-1.5 text-xs text-slate-600">
                        {row.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop Payments Table (hidden md:block) */}
              <div className="hidden md:block print:block bg-white rounded-2xl border-0 overflow-x-auto shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                    <tr>
                      <th className="px-3.5 py-2.5">Date</th>
                      <th className="px-3.5 py-2.5">Vendor</th>
                      <th className="px-3.5 py-2.5">Description</th>
                      <th className="px-3.5 py-2.5">Linked Bill</th>
                      <th className="px-3.5 py-2.5">Mode</th>
                      <th className="px-3.5 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportData.rows?.map((row: any) => (
                      <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(row.payment_date)}</td>
                        <td className="px-3.5 py-2.5 font-semibold text-slate-900">{row.vendor_name}</td>
                        <td className="px-3.5 py-2.5 text-slate-700">{row.description}</td>
                        <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">
                          {row.invoice_number ? `#${row.invoice_number}` : '—'}
                        </td>
                        <td className="px-3.5 py-2.5 text-slate-600 font-medium">{row.mode}</td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-danger tabular-nums whitespace-nowrap">
                          {formatINR(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 6. EXPENSES REPORT */}
          {activeTab === 'expenses' && (
            <div className="space-y-4">
              <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs flex items-center justify-between">
                <div>
                  <div className="text-xs text-slate-500 font-medium">Total Overhead Expenses</div>
                  <div className="text-2xl font-bold tabular-nums text-danger mt-1">
                    {formatINR(reportData.total_amount)}
                  </div>
                </div>
                <div className="text-xs text-slate-500 tabular-nums font-medium">
                  {reportData.count} expenses in period
                </div>
              </Card>

              {/* Mobile Expenses Cards (md:hidden) */}
              <div className="md:hidden space-y-3 print:hidden">
                {reportData.rows?.map((row: any) => (
                  <div key={row.id} className="bg-white rounded-2xl p-3.5 space-y-2 shadow-2xs border border-border/70">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[15px] font-semibold text-slate-900">{row.category_name}</div>
                        <div className="text-[12.5px] text-slate-500">{formatDate(row.expense_date)} {row.payee ? `· Payee: ${row.payee}` : ''}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[16px] font-bold text-danger tabular-nums">-{formatINR(row.amount)}</div>
                        <span className="text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">{row.mode}</span>
                      </div>
                    </div>
                    {row.description && (
                      <div className="pt-1.5 text-xs text-slate-600">
                        {row.description}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Desktop Expenses Table (hidden md:block) */}
              <div className="hidden md:block print:block bg-white rounded-2xl border-0 overflow-x-auto shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                    <tr>
                      <th className="px-3.5 py-2.5">Date</th>
                      <th className="px-3.5 py-2.5">Category</th>
                      <th className="px-3.5 py-2.5">Payee</th>
                      <th className="px-3.5 py-2.5">Description</th>
                      <th className="px-3.5 py-2.5">Mode</th>
                      <th className="px-3.5 py-2.5 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportData.rows?.map((row: any) => (
                      <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(row.expense_date)}</td>
                        <td className="px-3.5 py-2.5 font-semibold text-slate-900">{row.category_name}</td>
                        <td className="px-3.5 py-2.5 text-slate-700">{row.payee || '—'}</td>
                        <td className="px-3.5 py-2.5 text-slate-700">{row.description}</td>
                        <td className="px-3.5 py-2.5 text-slate-600 font-medium">{row.mode}</td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-danger tabular-nums whitespace-nowrap">
                          {formatINR(row.amount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 7. OUTSTANDING DUES REPORT */}
          {activeTab === 'outstanding' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs text-slate-500 font-medium">Total Outstanding Balance</div>
                  <div className="text-xl font-bold text-danger tabular-nums mt-1">
                    {formatINR(reportData.total_outstanding || reportData.total_balance || 0)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Across active bills in period</div>
                </Card>

                <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs text-slate-500 font-medium">Overdue Dues</div>
                  <div className="text-xl font-bold text-danger tabular-nums mt-1">
                    {formatINR(reportData.total_overdue || 0)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Passed due date</div>
                </Card>

                <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs text-slate-500 font-medium">Debtors Count</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">
                    {reportData.customer_count || 0}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Customers with pending dues</div>
                </Card>
              </div>

              {/* Mobile Outstanding Dues Cards (md:hidden) */}
              <div className="md:hidden space-y-3 print:hidden">
                {reportData.rows?.map((row: any) => (
                  <div key={row.id} className="bg-white rounded-2xl p-3.5 space-y-2 shadow-2xs border border-border/70">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[15px] font-semibold text-slate-900">{row.customer_name}</div>
                        <div className="text-[12.5px] text-slate-500">{row.customer_mobile || 'No mobile'}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[16px] font-bold text-danger tabular-nums">{formatINR(row.balance)}</div>
                        <span className="text-[11px] text-danger font-medium">Balance due</span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-600">
                      <span>Billed: <strong className="tabular-nums font-semibold">{formatINR(row.total_billed)}</strong></span>
                      <span>Paid: <strong className="text-emerald-600 tabular-nums font-semibold">{formatINR(row.total_paid)}</strong></span>
                      {row.overdue_balance > 0 && (
                        <span className="text-danger font-bold">Overdue: {formatINR(row.overdue_balance)}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Outstanding Dues Table (hidden md:block) */}
              <div className="hidden md:block print:block bg-white rounded-2xl border-0 overflow-x-auto shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                    <tr>
                      <th className="px-3.5 py-2.5">Customer</th>
                      <th className="px-3.5 py-2.5">Mobile</th>
                      <th className="px-3.5 py-2.5 text-right">Total Billed</th>
                      <th className="px-3.5 py-2.5 text-right">Paid</th>
                      <th className="px-3.5 py-2.5 text-right">Balance Due</th>
                      <th className="px-3.5 py-2.5 text-right">Overdue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportData.rows?.map((row: any) => (
                      <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-3.5 py-2.5 font-semibold text-slate-900">{row.customer_name}</td>
                        <td className="px-3.5 py-2.5 text-slate-500 tabular-nums whitespace-nowrap">{row.customer_mobile || '—'}</td>
                        <td className="px-3.5 py-2.5 text-right font-medium text-slate-900 tabular-nums whitespace-nowrap">{formatINR(row.total_billed)}</td>
                        <td className="px-3.5 py-2.5 text-right font-medium text-emerald-600 tabular-nums whitespace-nowrap">{formatINR(row.total_paid)}</td>
                        <td className="px-3.5 py-2.5 text-right font-semibold text-danger tabular-nums whitespace-nowrap">{formatINR(row.balance)}</td>
                        <td className="px-3.5 py-2.5 text-right font-semibold text-danger tabular-nums whitespace-nowrap">
                          {row.overdue_balance > 0 ? formatINR(row.overdue_balance) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 8. LOANS & CAPITAL LEDGER REPORT */}
          {activeTab === 'loans' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs text-slate-500 font-medium">Total Loans Taken</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">
                    {formatINR(reportData.total_taken || 0)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Capital borrowed from outside</div>
                </Card>

                <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs text-slate-500 font-medium">Principal Repaid</div>
                  <div className="text-xl font-bold text-slate-900 tabular-nums mt-1">
                    {formatINR(reportData.total_principal_repaid || 0)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Non-operating capital repaid</div>
                </Card>

                <Card className="p-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                  <div className="text-xs text-slate-500 font-medium">Current Loan Outstanding</div>
                  <div className="text-xl font-bold text-danger tabular-nums mt-1">
                    {formatINR(reportData.total_outstanding || 0)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Principal still payable</div>
                </Card>
              </div>

              {/* Mobile Loans Cards (md:hidden) */}
              <div className="md:hidden space-y-3 print:hidden">
                {reportData.rows?.map((row: any) => (
                  <div key={row.id} className="bg-white rounded-2xl p-3.5 space-y-2.5 shadow-2xs border border-border/70">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[15px] font-semibold text-slate-900">{row.lender_name}</div>
                        <div className="text-[12.5px] text-slate-500">{formatDate(row.loan_date)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[16px] font-bold text-danger tabular-nums">{formatINR(row.current_outstanding)}</div>
                        <span className="text-[11px] text-slate-400 font-medium">Outstanding</span>
                      </div>
                    </div>
                    <div className="pt-2 border-t border-slate-100 grid grid-cols-3 gap-1 text-[11px] text-slate-600">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Taken</span>
                        <span className="font-semibold tabular-nums">{formatINR(row.taken_amount)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Repaid</span>
                        <span className="font-semibold tabular-nums">{formatINR(row.principal_repaid)}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-slate-400 block text-[10px]">Interest</span>
                        <span className="font-semibold text-slate-700 tabular-nums">{formatINR(row.interest_paid)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Loans Table (hidden md:block) */}
              <div className="hidden md:block print:block bg-white rounded-2xl border-0 overflow-x-auto shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                    <tr>
                      <th className="px-3.5 py-2.5">Lender Name</th>
                      <th className="px-3.5 py-2.5">Loan Date</th>
                      <th className="px-3.5 py-2.5 text-right">Taken Amount</th>
                      <th className="px-3.5 py-2.5 text-right">Principal Repaid</th>
                      <th className="px-3.5 py-2.5 text-right">Interest Paid</th>
                      <th className="px-3.5 py-2.5 text-right">Balance Outstanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {reportData.rows?.map((row: any) => (
                      <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-3.5 py-2.5 font-semibold text-slate-900">{row.lender_name}</td>
                        <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(row.loan_date)}</td>
                        <td className="px-3.5 py-2.5 text-right font-medium text-slate-900 tabular-nums whitespace-nowrap">{formatINR(row.taken_amount)}</td>
                        <td className="px-3.5 py-2.5 text-right font-medium text-slate-900 tabular-nums whitespace-nowrap">{formatINR(row.principal_repaid)}</td>
                        <td className="px-3.5 py-2.5 text-right font-medium text-slate-500 tabular-nums whitespace-nowrap">{formatINR(row.interest_paid)}</td>
                        <td className="px-3.5 py-2.5 text-right font-semibold text-danger tabular-nums whitespace-nowrap">{formatINR(row.current_outstanding)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 9. JOBS REPORT */}
          {activeTab === 'jobs' && (
            <div className="space-y-4">
              <Card className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-teal-50 border-0 flex items-center justify-center text-[#0F766E] shrink-0 shadow-2xs print:hidden">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Total Workflow Jobs
                    </div>
                    <div className="flex flex-wrap items-baseline gap-2.5 mt-0.5">
                      <span className="text-2xl sm:text-3xl font-bold tabular-nums text-slate-900 tracking-tight">
                        {reportData.count || 0}
                      </span>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11.5px] font-medium border-0">
                        {jobStatusFilter === 'ALL'
                          ? 'Work orders in period'
                          : jobStatusFilter === 'COMPLETED'
                          ? 'Completed jobs in period'
                          : 'In progress jobs in period'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Status Filter Indicator on Print (Clean text label) */}
                <div className="hidden print:flex items-center gap-1.5 text-xs text-slate-700 font-semibold bg-slate-100 px-3 py-1.5 rounded-lg border-0">
                  <span className="text-slate-500 font-normal">Status:</span>
                  <span>{jobStatusFilter === 'ALL' ? 'All Jobs' : jobStatusFilter === 'COMPLETED' ? 'Completed' : 'In Progress'}</span>
                </div>

                {/* Job Status Toggle Pill for Screen */}
                <div className="flex items-center gap-1.5 p-1 bg-[#EEF0F3] rounded-xl self-start sm:self-auto print:hidden">
                  <button
                    type="button"
                    onClick={() => setJobStatusFilter('ALL')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      jobStatusFilter === 'ALL'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All Jobs
                  </button>
                  <button
                    type="button"
                    onClick={() => setJobStatusFilter('IN_PROGRESS')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      jobStatusFilter === 'IN_PROGRESS'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    In Progress
                  </button>
                  <button
                    type="button"
                    onClick={() => setJobStatusFilter('COMPLETED')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      jobStatusFilter === 'COMPLETED'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Completed
                  </button>
                </div>
              </Card>

              {/* Mobile Jobs Cards (md:hidden) */}
              <div className="md:hidden space-y-3 print:hidden">
                {(!reportData.rows || reportData.rows.length === 0) ? (
                  <div className="p-8 text-center text-slate-400 bg-white rounded-2xl">
                    No jobs found matching the selected filter
                  </div>
                ) : (
                  reportData.rows.map((row: any) => (
                    <div key={row.id} className="bg-white rounded-2xl p-3.5 space-y-2 shadow-2xs border border-border/70">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[15px] font-semibold text-slate-900">{row.job_type_name}</div>
                          <div className="text-[12.5px] text-slate-500">{row.party_name} {row.applicant_name ? `· App: ${row.applicant_name}` : ''}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[16px] font-bold text-slate-900 tabular-nums">{formatINR(row.amount)}</div>
                          <span
                            className={clsx(
                              'inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider',
                              row.status === 'COMPLETED'
                                ? 'bg-emerald-50 text-emerald-700'
                                : row.status === 'IN_PROGRESS'
                                ? 'bg-slate-100 text-slate-700'
                                : 'bg-rose-50 text-rose-700'
                            )}
                          >
                            {row.status === 'IN_PROGRESS' ? 'IN PROGRESS' : row.status}
                          </span>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                        <span>Bill #{row.invoice_number} &middot; Staff: <strong className="text-slate-700">{row.assigned_staff_name || 'Unassigned'}</strong></span>
                        <span>Due: {formatDate(row.deadline_date)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop Jobs Table (hidden md:block) */}
              <div className="hidden md:block print:block bg-white rounded-2xl border-0 overflow-x-auto shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                    <tr>
                      <th className="px-3.5 py-2.5">Job Type</th>
                      <th className="px-3.5 py-2.5">Party / Customer</th>
                      <th className="px-3.5 py-2.5">Applicant</th>
                      <th className="px-3.5 py-2.5">Assigned Staff</th>
                      <th className="px-3.5 py-2.5">Bill #</th>
                      <th className="px-3.5 py-2.5 text-right">Amount</th>
                      <th className="px-3.5 py-2.5">Deadline</th>
                      <th className="px-3.5 py-2.5 text-center w-[120px]">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(!reportData.rows || reportData.rows.length === 0) ? (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-slate-400">
                          No jobs found matching the selected filter
                        </td>
                      </tr>
                    ) : (
                      reportData.rows.map((row: any) => (
                        <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-3.5 py-2.5 font-semibold text-slate-900">{row.job_type_name}</td>
                          <td className="px-3.5 py-2.5 text-slate-800 font-medium">{row.party_name}</td>
                          <td className="px-3.5 py-2.5 text-slate-500">{row.applicant_name || '—'}</td>
                          <td className="px-3.5 py-2.5 text-slate-500">{row.assigned_staff_name || 'Unassigned'}</td>
                          <td className="px-3.5 py-2.5 text-slate-900 font-medium whitespace-nowrap">#{row.invoice_number}</td>
                          <td className="px-3.5 py-2.5 text-right font-medium text-slate-900 tabular-nums whitespace-nowrap">{formatINR(row.amount)}</td>
                          <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">{formatDate(row.deadline_date)}</td>
                          <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                            <span
                              className={clsx(
                                'w-[96px] inline-flex items-center justify-center py-1 rounded-md text-[10.5px] font-bold uppercase tracking-wider text-center',
                                row.status === 'COMPLETED'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : row.status === 'IN_PROGRESS'
                                  ? 'bg-slate-100 text-slate-700'
                                  : 'bg-rose-50 text-rose-700'
                              )}
                            >
                              {row.status === 'IN_PROGRESS' ? 'IN PROGRESS' : row.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 10. COMMISSION REPORT */}
          {activeTab === 'commission' && (
            <div className="space-y-4">
              <Card className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 border border-slate-200/90 rounded-2xl bg-white shadow-2xs">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-teal-50 border-0 flex items-center justify-center text-[#0F766E] shrink-0 shadow-2xs print:hidden">
                    <Award className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                      Total Staff Commission
                    </div>
                    <div className="flex flex-wrap items-baseline gap-2.5 mt-0.5">
                      <span className="text-2xl sm:text-3xl font-bold tabular-nums text-[#0F766E] tracking-tight">
                        {formatINR(reportData.total_amount)}
                      </span>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11.5px] font-medium border-0">
                        {reportData.count || 0} commission entries in period
                      </span>
                    </div>
                  </div>
                </div>

                {/* Staff Filter Indicator on Print (Clean text label) */}
                <div className="hidden print:flex items-center gap-1.5 text-xs text-slate-700 font-semibold bg-slate-100 px-3 py-1.5 rounded-lg border-0">
                  <span className="text-slate-500 font-normal">Staff Filter:</span>
                  <span>{staffMembers.find((s) => s.id === selectedStaffId)?.name || 'All Staff'}</span>
                </div>

                {/* Staff Member Selector Filter for Screen */}
                <div className="flex items-center gap-2 self-start sm:self-auto bg-slate-100/90 rounded-xl px-3 py-1 transition-all shadow-2xs print:hidden">
                  <Users className="w-4 h-4 text-[#0F766E] shrink-0" />
                  <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">Staff:</span>
                  <div className="min-w-[140px]">
                    <Select
                      value={selectedStaffId}
                      onChange={setSelectedStaffId}
                      options={[
                        { value: 'ALL', label: 'All Staff' },
                        ...staffMembers.map((staff) => ({
                          value: staff.id,
                          label: staff.name,
                        })),
                      ]}
                      size="sm"
                      variant="ghost"
                      searchable={staffMembers.length > 5}
                    />
                  </div>
                </div>
              </Card>

              {/* Mobile Commission Cards (md:hidden) */}
              <div className="md:hidden space-y-3 print:hidden">
                {(!reportData.rows || reportData.rows.length === 0) ? (
                  <div className="p-8 text-center text-slate-400 bg-white rounded-2xl">
                    No commission records found matching the selected filter
                  </div>
                ) : (
                  reportData.rows.map((row: any) => (
                    <div key={row.id} className="bg-white rounded-2xl p-3.5 space-y-2 shadow-2xs border border-border/70">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[15px] font-semibold text-slate-900">{row.staff_name}</div>
                          <div className="text-[12.5px] text-slate-500">{row.job_type_name} &middot; {formatDate(row.earned_at)}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[16px] font-bold text-[#0F766E] tabular-nums">+{formatINR(row.amount)}</div>
                          <span className="text-[11px] font-semibold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">{row.percent}% comm.</span>
                        </div>
                      </div>
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                        <span>Job Base: <strong className="text-slate-800 font-semibold tabular-nums">{formatINR(row.base_amount)}</strong></span>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
                          {row.status}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Desktop Commission Table (hidden md:block) */}
              <div className="hidden md:block print:block bg-white rounded-2xl border-0 overflow-x-auto shadow-2xs">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                    <tr>
                      <th className="px-3.5 py-2.5">Staff Member</th>
                      <th className="px-3.5 py-2.5">Job Type</th>
                      <th className="px-3.5 py-2.5 text-right">Job Base</th>
                      <th className="px-3.5 py-2.5 text-right">Commission %</th>
                      <th className="px-3.5 py-2.5 text-right">Commission Amount</th>
                      <th className="px-3.5 py-2.5">Earned Date</th>
                      <th className="px-3.5 py-2.5 text-center w-[110px]">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(!reportData.rows || reportData.rows.length === 0) ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-slate-400">
                          No commission records found matching the selected filter
                        </td>
                      </tr>
                    ) : (
                      reportData.rows.map((row: any) => (
                        <tr key={row.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-3.5 py-2.5 font-semibold text-slate-900">{row.staff_name}</td>
                          <td className="px-3.5 py-2.5 text-slate-800 font-medium">{row.job_type_name}</td>
                          <td className="px-3.5 py-2.5 text-right font-medium text-slate-900 tabular-nums whitespace-nowrap">{formatINR(row.base_amount)}</td>
                          <td className="px-3.5 py-2.5 text-right text-slate-500 tabular-nums whitespace-nowrap">{row.percent}%</td>
                          <td className="px-3.5 py-2.5 text-right font-semibold text-accent tabular-nums whitespace-nowrap">{formatINR(row.amount)}</td>
                          <td className="px-3.5 py-2.5 text-slate-500 whitespace-nowrap">
                            {row.earned_at ? formatDate(row.earned_at) : 'In Progress'}
                          </td>
                          <td className="px-3.5 py-2.5 text-center whitespace-nowrap">
                            <span
                              className={clsx(
                                'w-[86px] inline-flex items-center justify-center py-1 rounded-md text-[10.5px] font-bold uppercase tracking-wider text-center',
                                row.status === 'EARNED'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : row.status === 'UPCOMING'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-rose-50 text-rose-700'
                              )}
                            >
                              {row.status}
                            </span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Official Document Footer (Captured in PDF & Print) */}
          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-1 text-[10px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <span>Powered by</span>
              <img src="/simplify-logo.png" alt="Simplify" className="h-3.5 w-auto object-contain inline-block" />
              <span>Business Management &amp; Billing Software</span>
            </div>
            <div>Verified Business Records · Confidential</div>
          </div>
        </div>
      )}

      {/* Customer Full Statement Modal */}
      <CustomerLedgerModal
        open={customerModalOpen}
        onOpenChange={setCustomerModalOpen}
        customerId={selectedCustomerId}
      />

      {/* Vendor Full Statement Modal */}
      <VendorDetailModal
        open={vendorModalOpen}
        onOpenChange={setVendorModalOpen}
        vendorId={selectedVendorId}
      />

      {/* Privacy PIN Modal Gate */}
      <PrivacyPinModal
        open={pinModalOpen}
        onOpenChange={setPinModalOpen}
        onSuccess={() => {
          if (pendingFY) {
            setSelectedFY(pendingFY);
            setPendingFY(null);
          }
        }}
      />
    </div>
  );
};
