import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate } from '../lib/dates';
import { t, getErrorMessage } from '../i18n';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { BillDetailModal } from '../components/bills/BillDetailModal';
import { ReceivePaymentSheet } from '../components/receipts/ReceivePaymentSheet';
import { ReceiptDetailModal } from '../components/receipts/ReceiptDetailModal';
import { Plus, Search, Pencil, ArrowDownLeft, XCircle, FileText, Calendar, Phone, X } from 'lucide-react';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { FilterChips, SearchField, BillRow } from '../components/mobile';
import { Database } from '../types/supabase';
import { normalizeCustomerMobile } from '../components/documents/documentSharing';
import { useAuth } from '../context/AuthContext';

type InvoiceItem = Database['public']['Tables']['invoice_items']['Row'];
type Invoice = Database['public']['Tables']['invoices']['Row'] & {
  invoice_items?: InvoiceItem[];
};

type InvoiceFilter = 'ALL' | 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE' | 'CANCELLED';
type DatePreset = 'ALL' | 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'CUSTOM' | 'RANGE';

export const BillsPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { showToast } = useToast();
  const { business, role, member } = useAuth();
  const isStaff = role === 'STAFF';

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const validFilters: InvoiceFilter[] = ['ALL', 'PAID', 'PARTIAL', 'UNPAID', 'OVERDUE', 'CANCELLED'];
  const statusParam = (searchParams.get('status') || searchParams.get('filter'))?.toUpperCase();
  const [filter, setFilter] = useState<InvoiceFilter>(() => {
    return validFilters.includes(statusParam as any) ? (statusParam as InvoiceFilter) : 'ALL';
  });

  useEffect(() => {
    const p = (searchParams.get('status') || searchParams.get('filter'))?.toUpperCase();
    if (p && validFilters.includes(p as any) && p !== filter) {
      setFilter(p as InvoiceFilter);
    }
  }, [searchParams]);

  const handleFilterChange = (val: InvoiceFilter) => {
    setFilter(val);
    const newParams = new URLSearchParams(searchParams);
    if (val === 'ALL') {
      newParams.delete('status');
      newParams.delete('filter');
    } else {
      newParams.set('status', val);
    }
    setSearchParams(newParams, { replace: true });
  };

  // Date-wise search & filtering state (defaults to ALL)
  const [datePreset, setDatePreset] = useState<DatePreset>('ALL');
  const [customDate, setCustomDate] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Selected bill for detail view
  const [selectedInvoice, setSelectedInvoice] = useState<(Invoice & { invoice_items?: InvoiceItem[] }) | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Receive payment sheet state
  const [isReceivePaymentOpen, setIsReceivePaymentOpen] = useState(false);
  const [receivePaymentInvoice, setReceivePaymentInvoice] = useState<Invoice | null>(null);
  const [selectedReceiptDetailId, setSelectedReceiptDetailId] = useState<string | null>(null);
  const [billToCancel, setBillToCancel] = useState<Invoice | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [focusedRowIndex, setFocusedRowIndex] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleWhatsAppClick = (e: React.MouseEvent, inv: Invoice) => {
    e.stopPropagation();
    if (!inv.party_mobile) {
      setSelectedInvoice(inv);
      return;
    }
    const mob = normalizeCustomerMobile(inv.party_mobile);
    if (!mob.valid) {
      setSelectedInvoice(inv);
      return;
    }
    const bal = Math.max(0, inv.total - inv.paid_amount);
    const msg = `Hello ${inv.party_name},\n\nRegarding your invoice #${inv.number} for ${formatINR(
      inv.total
    )}${bal > 0 ? ` (Balance: ${formatINR(bal)}, Due: ${formatDate(inv.due_date)})` : ' (Fully Paid)'}.\n\nThank you for your business!\n— ${
      business?.name || 'SIMPLIFY'
    }`;
    const url = `https://wa.me/${mob.whatsappNumber}?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  };

  const getStatusBadge = (inv: Invoice, isOverdue: boolean) => {
    if (inv.status === 'CANCELLED') {
      return (
        <span className="w-[74px] py-0.5 text-xs font-semibold rounded-md bg-slate-100 text-slate-500 line-through inline-flex items-center justify-center text-center shrink-0 border-0">
          Cancelled
        </span>
      );
    }
    if (isOverdue) {
      return (
        <span className="w-[74px] py-0.5 text-xs font-bold rounded-md bg-rose-100 text-rose-800 inline-flex items-center justify-center text-center shrink-0 border-0">
          Overdue
        </span>
      );
    }
    if (inv.paid_amount >= inv.total) {
      return (
        <span className="w-[74px] py-0.5 text-xs font-semibold rounded-md bg-emerald-50 text-emerald-700 inline-flex items-center justify-center text-center shrink-0 border-0">
          Paid
        </span>
      );
    }
    if (inv.paid_amount > 0) {
      return (
        <span className="w-[74px] py-0.5 text-xs font-semibold rounded-md bg-amber-50 text-amber-700 inline-flex items-center justify-center text-center shrink-0 border-0">
          Partial
        </span>
      );
    }
    return (
      <span className="w-[74px] py-0.5 text-xs font-semibold rounded-md bg-rose-50 text-rose-700 inline-flex items-center justify-center text-center shrink-0 border-0">
        Unpaid
      </span>
    );
  };

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('invoices')
        .select('*, invoice_items(*)')
        .is('deleted_at', null)
        .order('invoice_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (filter === 'CANCELLED') {
        query = query.eq('status', 'CANCELLED');
      } else if (filter !== 'ALL') {
        query = query.eq('status', 'ACTIVE');
      }

      // Staff can ONLY view their own created bills
      if (isStaff && member?.id) {
        query = query.eq('created_by', member.id);
      }

      const { data, error } = await query;
      if (error) throw error;
      setInvoices((data as Invoice[]) || []);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInvoices();
  }, [filter, isStaff, member?.id]);

  const handleOpenDetail = async (inv: Invoice) => {
    let items = inv.invoice_items;
    if (!items || items.length === 0) {
      const { data } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', inv.id);
      items = (data as InvoiceItem[]) || [];
    }

    setSelectedInvoice({
      ...inv,
      invoice_items: items,
    });
    setIsDetailOpen(true);
  };

  const getTodayString = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const getYesterdayString = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const getThisMonthPrefix = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  };

  const filteredInvoices = invoices.filter((inv) => {
    // 1. Status filter
    const bal = inv.total - inv.paid_amount;
    const isOverdue = inv.status === 'ACTIVE' && bal > 0 && new Date(inv.due_date) < new Date();

    if (filter === 'PAID' && (inv.status !== 'ACTIVE' || inv.paid_amount < inv.total)) return false;
    if (filter === 'PARTIAL' && (inv.status !== 'ACTIVE' || inv.paid_amount <= 0 || inv.paid_amount >= inv.total)) return false;
    if (filter === 'UNPAID' && (inv.status !== 'ACTIVE' || inv.paid_amount > 0)) return false;
    if (filter === 'OVERDUE' && !isOverdue) return false;

    // 2. Date-wise filter
    if (datePreset === 'TODAY') {
      const today = getTodayString();
      if (inv.invoice_date !== today) return false;
    } else if (datePreset === 'YESTERDAY') {
      const yest = getYesterdayString();
      if (inv.invoice_date !== yest) return false;
    } else if (datePreset === 'THIS_MONTH') {
      const monthPrefix = getThisMonthPrefix();
      if (!inv.invoice_date.startsWith(monthPrefix)) return false;
    } else if (datePreset === 'CUSTOM') {
      if (customDate && inv.invoice_date !== customDate) return false;
    } else if (datePreset === 'RANGE') {
      if (startDate && inv.invoice_date < startDate) return false;
      if (endDate && inv.invoice_date > endDate) return false;
    }

    // 3. Search filter (number, customer, phone, date, particulars)
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchNo = inv.number.toLowerCase().includes(q);
      const matchParty = inv.party_name.toLowerCase().includes(q);
      const matchMobile = Boolean(inv.party_mobile && inv.party_mobile.includes(q));
      const matchDate = Boolean(
        inv.invoice_date.toLowerCase().includes(q) ||
        formatDate(inv.invoice_date).toLowerCase().includes(q)
      );
      const matchParticulars = Boolean(
        inv.invoice_items &&
          inv.invoice_items.some(
            (it) =>
              it.description.toLowerCase().includes(q) ||
              (it.applicant_name && it.applicant_name.toLowerCase().includes(q))
          )
      );
      return matchNo || matchParty || matchMobile || matchDate || matchParticulars;
    }

    return true;
  });

  // Keyboard navigation for bills list
  useEffect(() => {
    const handleBillsKeyDown = (e: KeyboardEvent) => {
      if (isDetailOpen || isReceivePaymentOpen || billToCancel) return;

      const activeEl = document.activeElement as HTMLElement | null;
      const isInputActive =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.isContentEditable);

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isInputActive && activeEl === searchInputRef.current) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          searchInputRef.current?.blur();
          setFocusedRowIndex(0);
        }
        return;
      }

      if (isInputActive) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedRowIndex((prev) => (prev + 1 >= filteredInvoices.length ? 0 : prev + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedRowIndex((prev) => (prev <= 0 ? Math.max(0, filteredInvoices.length - 1) : prev - 1));
      } else if (e.key === 'Enter' && focusedRowIndex >= 0 && focusedRowIndex < filteredInvoices.length) {
        e.preventDefault();
        handleOpenDetail(filteredInvoices[focusedRowIndex]);
      }
    };

    window.addEventListener('keydown', handleBillsKeyDown);
    return () => window.removeEventListener('keydown', handleBillsKeyDown);
  }, [filteredInvoices, focusedRowIndex, isDetailOpen, isReceivePaymentOpen, billToCancel]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text">{t('nav.bills')}</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {filteredInvoices.length !== invoices.length
              ? `Showing ${filteredInvoices.length} of ${invoices.length} bills`
              : `${invoices.length} total bills`}
          </p>
        </div>
        <Button variant="primary" size="md" onClick={() => navigate('/bills/new')}>
          <Plus className="w-4 h-4 mr-1.5" />
          <span>{t('nav.new_bill')}</span>
        </Button>
      </div>

      {/* Search & Filter Bar */}
      <div className="space-y-3">
        {/* Mobile Single SearchField */}
        <div className="md:hidden">
          <SearchField
            placeholder="Search by bill #, customer, particulars..."
            value={search}
            onChange={(val) => setSearch(val)}
          />
        </div>

        {/* Desktop Search (unchanged) */}
        <div className="hidden md:block relative">
          <Input
            ref={searchInputRef}
            placeholder="Search by bill #, customer, particulars, date (e.g. 07 Nov), mobile... (Press / to search)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4 text-[#94A3B8]" />}
            className="border-0 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#0F766E]/20 rounded-xl h-11"
          />
        </div>

        {/* Date Filter Bar - Quick One-Tap Presets + Custom Date Pickers */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs bg-white p-2.5 rounded-xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
          <span className="text-slate-500 font-semibold mr-1 flex items-center gap-1 shrink-0">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <span>Date:</span>
          </span>

          <button
            type="button"
            onClick={() => {
              setDatePreset('ALL');
              setCustomDate('');
              setStartDate('');
              setEndDate('');
            }}
            className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
              datePreset === 'ALL'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-[#F6F7F9] border-0 text-slate-700 hover:text-slate-900 hover:bg-[#EEF2F6]'
            }`}
          >
            All
          </button>

          <button
            type="button"
            onClick={() => {
              setDatePreset('TODAY');
              setCustomDate('');
              setStartDate('');
              setEndDate('');
            }}
            className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
              datePreset === 'TODAY'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-[#F6F7F9] border-0 text-slate-700 hover:text-slate-900 hover:bg-[#EEF2F6]'
            }`}
          >
            Today
          </button>

          <button
            type="button"
            onClick={() => {
              setDatePreset('YESTERDAY');
              setCustomDate('');
              setStartDate('');
              setEndDate('');
            }}
            className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
              datePreset === 'YESTERDAY'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-[#F6F7F9] border-0 text-slate-700 hover:text-slate-900 hover:bg-[#EEF2F6]'
            }`}
          >
            Yesterday
          </button>

          <button
            type="button"
            onClick={() => {
              setDatePreset('THIS_MONTH');
              setCustomDate('');
              setStartDate('');
              setEndDate('');
            }}
            className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
              datePreset === 'THIS_MONTH'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-[#F6F7F9] border-0 text-slate-700 hover:text-slate-900 hover:bg-[#EEF2F6]'
            }`}
          >
            This Month
          </button>

          {/* Pick Specific Date */}
          <div className="flex items-center gap-1 bg-[#F6F7F9] border-0 rounded-lg px-2.5 py-1 shadow-2xs">
            <span className="text-[11px] text-slate-400 font-medium">Pick:</span>
            <input
              type="date"
              value={customDate}
              onChange={(e) => {
                setCustomDate(e.target.value);
                if (e.target.value) {
                  setDatePreset('CUSTOM');
                  setStartDate('');
                  setEndDate('');
                } else {
                  setDatePreset('ALL');
                }
              }}
              className={`text-xs bg-transparent cursor-pointer font-medium focus:outline-none ${
                datePreset === 'CUSTOM' && customDate
                  ? 'text-blue-700 font-bold'
                  : 'text-slate-700'
              }`}
            />
            {datePreset === 'CUSTOM' && customDate && (
              <button
                type="button"
                onClick={() => {
                  setCustomDate('');
                  setDatePreset('ALL');
                }}
                className="p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer ml-0.5"
                title="Clear date"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Date Range Option */}
          <button
            type="button"
            onClick={() => {
              if (datePreset === 'RANGE') {
                setDatePreset('ALL');
                setStartDate('');
                setEndDate('');
              } else {
                setDatePreset('RANGE');
                setCustomDate('');
              }
            }}
            className={`px-2.5 py-1 rounded-lg font-semibold transition-all cursor-pointer ${
              datePreset === 'RANGE'
                ? 'bg-slate-900 text-white shadow-2xs'
                : 'bg-[#F6F7F9] border-0 text-slate-700 hover:text-slate-900 hover:bg-[#EEF2F6]'
            }`}
          >
            Range...
          </button>

          {datePreset === 'RANGE' && (
            <div className="flex items-center gap-1.5 bg-[#F6F7F9] border-0 rounded-lg px-2.5 py-1 shadow-2xs">
              <span className="text-[11px] text-slate-400 font-medium">From:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="text-xs text-slate-800 bg-transparent cursor-pointer focus:outline-none font-medium"
              />
              <span className="text-[11px] text-slate-400 font-medium">To:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="text-xs text-slate-800 bg-transparent cursor-pointer focus:outline-none font-medium"
              />
              {(startDate || endDate) && (
                <button
                  type="button"
                  onClick={() => {
                    setStartDate('');
                    setEndDate('');
                    setDatePreset('ALL');
                  }}
                  className="p-0.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer ml-1"
                  title="Clear range"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Mobile Filter Chips */}
        <div className="md:hidden">
          <FilterChips<InvoiceFilter>
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'UNPAID', label: 'Unpaid' },
              { value: 'PARTIAL', label: 'Partial' },
              { value: 'PAID', label: 'Paid' },
              { value: 'OVERDUE', label: 'Overdue' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
            value={filter}
            onChange={(val) => handleFilterChange(val)}
          />
        </div>

        {/* Desktop Filter Segmented Control */}
        <div className="hidden md:block overflow-x-auto pb-0.5">
          <SegmentedControl
            value={filter}
            onChange={(val) => handleFilterChange(val as InvoiceFilter)}
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'UNPAID', label: 'Unpaid' },
              { value: 'PARTIAL', label: 'Partial' },
              { value: 'PAID', label: 'Paid' },
              { value: 'OVERDUE', label: 'Overdue' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
          />
        </div>
      </div>

      {/* Bills List - High-density Single Row Format */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
      ) : filteredInvoices.length === 0 ? (
        <EmptyState
          message="No bills found"
          actionLabel={t('nav.new_bill')}
          onAction={() => navigate('/bills/new')}
        />
      ) : (
        <>
          {/* Mobile Native BillRow Cards */}
          <div className="md:hidden space-y-3">
            {filteredInvoices.map((inv) => {
              const bal = Math.max(0, inv.total - inv.paid_amount);
              const isOverdue =
                inv.status === 'ACTIVE' && bal > 0 && new Date(inv.due_date) < new Date();
              const billStatus: 'paid' | 'partial' | 'unpaid' | 'cancelled' =
                inv.status === 'CANCELLED'
                  ? 'cancelled'
                  : inv.paid_amount >= inv.total
                  ? 'paid'
                  : inv.paid_amount > 0
                  ? 'partial'
                  : 'unpaid';

              return (
                <BillRow
                  key={inv.id}
                  partyName={inv.party_name || 'Walk-in'}
                  amount={inv.total}
                  invoiceNumber={inv.number}
                  invoiceDate={inv.invoice_date}
                  status={billStatus}
                  isOverdue={isOverdue}
                  onClick={() => handleOpenDetail(inv)}
                />
              );
            })}
          </div>

          {/* Desktop High-density Single Row Format */}
          <div className="hidden md:block overflow-x-auto pb-2">
            <div className="min-w-[760px] md:min-w-0 space-y-2">
            {filteredInvoices.map((inv, idx) => {
              const bal = Math.max(0, inv.total - inv.paid_amount);
              const isOverdue =
                inv.status === 'ACTIVE' && bal > 0 && new Date(inv.due_date) < new Date();
              const isFocused = idx === focusedRowIndex;

              const particulars =
                inv.invoice_items && inv.invoice_items.length > 0
                  ? inv.invoice_items
                      .map((it) => it.description + (it.applicant_name ? ` (${it.applicant_name})` : ''))
                      .join(', ')
                  : '—';

              return (
                <div
                  key={inv.id}
                  onClick={() => handleOpenDetail(inv)}
                  className={clsx(
                    "border-0 rounded-xl px-3.5 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-2.5 transition-all duration-150 cursor-pointer select-none",
                    isFocused
                      ? "bg-[#EAF2F1] ring-2 ring-[#0F766E] shadow-sm"
                      : "bg-white hover:bg-[#FAFBFD] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
                  )}
                >
                  {/* 1. Bill Document Icon */}
                  <div className="w-6 h-6 rounded-md bg-blue-50/80 text-blue-600 flex items-center justify-center shrink-0">
                    <FileText className="w-3.5 h-3.5" />
                  </div>

                  {/* 2. Bill Number */}
                  <div className="w-[72px] shrink-0">
                    <span className="text-xs sm:text-sm font-bold font-mono text-slate-900 block truncate">
                      {inv.number}
                    </span>
                  </div>

                  {/* 3. Status Badge */}
                  <div className="w-[74px] shrink-0 flex items-center justify-center">
                    {getStatusBadge(inv, isOverdue)}
                  </div>

                  {/* 4. Divider */}
                  <div className="h-3.5 w-px bg-[#F1F5F9] shrink-0" />

                  {/* 5. Particulars (Center flex-1 expands to fill space) */}
                  <div
                    className="text-xs sm:text-sm font-normal text-slate-500 truncate flex-1 min-w-0"
                    title={particulars}
                  >
                    <span>{particulars}</span>
                  </div>

                  {/* 6. Divider before Date */}
                  <div className="h-3.5 w-px bg-[#F1F5F9] shrink-0 hidden sm:block" />

                  {/* 7. Date Column (Strict fixed width) */}
                  <div className="w-[92px] shrink-0 hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
                    <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                    <span>{formatDate(inv.invoice_date)}</span>
                  </div>

                  {/* 8. Divider before Customer */}
                  <div className="h-3.5 w-px bg-[#F1F5F9] shrink-0 hidden md:block" />

                  {/* 9. Customer / Party Name & Phone (Strict fixed width) */}
                  <div className="w-[130px] shrink-0 hidden md:flex items-center justify-between gap-1.5 min-w-0">
                    <span className="text-xs font-medium text-slate-700 truncate flex-1 min-w-0" title={inv.party_name}>
                      {inv.party_name}
                    </span>
                    {inv.party_mobile && (
                      <button
                        type="button"
                        onClick={(e) => handleWhatsAppClick(e, inv)}
                        className="inline-flex items-center text-slate-400 hover:text-emerald-700 transition-colors cursor-pointer shrink-0 p-0.5 rounded hover:bg-emerald-50"
                        title="Chat on WhatsApp"
                      >
                        <Phone className="w-3 h-3 text-slate-400 hover:text-emerald-600" />
                      </button>
                    )}
                  </div>

                  {/* 10. Divider before Amounts */}
                  <div className="h-3.5 w-px bg-[#F1F5F9] shrink-0" />

                  {/* 11. Amounts Column (Strict fixed width: Total + Due/Paid) */}
                  <div className="w-[145px] shrink-0 flex items-center justify-end gap-2 tabular-nums">
                    <span className="text-xs sm:text-sm font-bold text-slate-900 text-right min-w-[55px] truncate">
                      {formatINR(inv.total)}
                    </span>
                    <div className="w-[78px] text-right shrink-0">
                      {inv.status === 'CANCELLED' ? (
                        <span className="text-xs font-semibold text-slate-400 whitespace-nowrap block">
                          Cancelled
                        </span>
                      ) : bal > 0 ? (
                        <span className="text-xs font-bold text-rose-600 whitespace-nowrap block">
                          Due: {formatINR(bal)}
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-emerald-600 whitespace-nowrap block">
                          Paid
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 12. Divider before Actions */}
                  <div className="h-3.5 w-px bg-[#F1F5F9] shrink-0" />

                  {/* 13. Quick Action Buttons (Strict fixed width & right-aligned) */}
                  <div
                    className="w-[88px] shrink-0 flex items-center justify-end gap-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isStaff && inv.status === 'ACTIVE' && (
                      <button
                        type="button"
                        title="Edit Bill"
                        onClick={() => navigate(`/bills/${inv.id}/edit`)}
                        className="w-7 h-7 rounded-lg bg-slate-100/90 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {inv.status === 'ACTIVE' && bal > 0 && (
                      <button
                        type="button"
                        title="Receive Payment"
                        onClick={() => {
                          setReceivePaymentInvoice(inv);
                          setIsReceivePaymentOpen(true);
                        }}
                        className="w-7 h-7 rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-700 flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                      >
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {!isStaff && inv.status === 'ACTIVE' && (
                      <button
                        type="button"
                        title="Cancel Bill"
                        onClick={() => setBillToCancel(inv)}
                        className="w-7 h-7 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 flex items-center justify-center transition-all cursor-pointer shadow-2xs hover:scale-105"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </>
      )}

      {/* Detail Modal */}
      <BillDetailModal
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        invoice={selectedInvoice}
        onInvoiceUpdated={() => fetchInvoices()}
        onReceivePayment={(inv) => {
          setReceivePaymentInvoice(inv);
          setIsReceivePaymentOpen(true);
        }}
      />

      {/* Receive Payment Sheet shortcut from Bill */}
      {receivePaymentInvoice && (
        <ReceivePaymentSheet
          open={isReceivePaymentOpen}
          onOpenChange={(v) => {
            setIsReceivePaymentOpen(v);
            if (!v) setReceivePaymentInvoice(null);
          }}
          prefillCustomer={
            receivePaymentInvoice.customer_id
              ? {
                  id: receivePaymentInvoice.customer_id,
                  name: receivePaymentInvoice.party_name,
                  mobile: receivePaymentInvoice.party_mobile,
                }
              : undefined
          }
          prefillInvoice={{
            id: receivePaymentInvoice.id,
            number: receivePaymentInvoice.number,
            balance: Math.max(0, receivePaymentInvoice.total - receivePaymentInvoice.paid_amount),
          }}
          onSuccess={() => {
            fetchInvoices();
          }}
          onViewReceipt={(receiptId) => setSelectedReceiptDetailId(receiptId)}
        />
      )}

      {/* Receipt Detail & PDF Modal */}
      <ReceiptDetailModal
        open={Boolean(selectedReceiptDetailId)}
        onOpenChange={(v) => !v && setSelectedReceiptDetailId(null)}
        receiptId={selectedReceiptDetailId}
      />

      {/* Cancel Bill Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(billToCancel)}
        onOpenChange={(open) => !open && setBillToCancel(null)}
        title={`Cancel Bill #${billToCancel?.number || ''}`}
        description="Cancelling an invoice releases any payments to customer advance and marks linked jobs as cancelled. This action cannot be undone."
        confirmLabel="Cancel Bill"
        variant="danger"
        loading={cancelLoading}
        onConfirm={async () => {
          if (!billToCancel) return;
          setCancelLoading(true);
          try {
            const { error } = await supabase.rpc('cancel_invoice', {
              id: billToCancel.id,
              reason: 'Cancelled by user',
            });
            if (error) throw error;
            showToast(`Bill #${billToCancel.number} cancelled successfully`, 'success');
            setBillToCancel(null);
            fetchInvoices();
          } catch (err: any) {
            showToast(getErrorMessage(err.message), 'error');
          } finally {
            setCancelLoading(false);
          }
        }}
      />
    </div>
  );
};
