import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Database } from '../types/supabase';
import { getWhatsAppUrl } from '../lib/auth';
import { useAuth } from '../context/AuthContext';

type InvoiceItem = Database['public']['Tables']['invoice_items']['Row'];
type Invoice = Database['public']['Tables']['invoices']['Row'] & {
  invoice_items?: InvoiceItem[];
};

type InvoiceFilter = 'ALL' | 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE' | 'CANCELLED';
type DatePreset = 'ALL' | 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'CUSTOM' | 'RANGE';

export const BillsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { business, role } = useAuth();
  const isStaff = role === 'STAFF';

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InvoiceFilter>('ALL');

  // Date-wise search & filtering state (defaults to ALL for both Owner & Staff)
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

  const handleWhatsAppClick = (e: React.MouseEvent, inv: Invoice) => {
    e.stopPropagation();
    if (!inv.party_mobile) return;
    const bal = Math.max(0, inv.total - inv.paid_amount);
    const msg = `Hello ${inv.party_name}, regarding your bill #${inv.number} of ${formatINR(
      inv.total
    )}${bal > 0 ? ` with balance ${formatINR(bal)} due on ${formatDate(inv.due_date)}` : ' (Fully Paid)'}. - ${
      business?.name || 'SIMPLIFY'
    }`;
    const url = getWhatsAppUrl(inv.party_mobile, msg);
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
  }, [filter]);

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
      <div className="space-y-2.5">
        <div className="relative">
          <Input
            placeholder="Search by bill #, customer, particulars, date (e.g. 07 Nov), mobile..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>

        {/* Date Filter Bar - Quick One-Tap Presets + Custom Date Pickers */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs bg-slate-50/80 p-2 rounded-xl border border-slate-200/80">
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
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
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
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
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
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
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
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            This Month
          </button>

          {/* Pick Specific Date */}
          <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-0.5 shadow-2xs">
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
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            Range...
          </button>

          {datePreset === 'RANGE' && (
            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2 py-0.5 shadow-2xs">
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

        {/* Filter Segmented Control */}
        <div className="overflow-x-auto pb-0.5">
          <SegmentedControl
            value={filter}
            onChange={(val) => setFilter(val as InvoiceFilter)}
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
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[760px] md:min-w-0 space-y-1.5">
            {filteredInvoices.map((inv) => {
              const bal = Math.max(0, inv.total - inv.paid_amount);
              const isOverdue =
                inv.status === 'ACTIVE' && bal > 0 && new Date(inv.due_date) < new Date();

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
                  className="bg-white hover:bg-slate-50/90 border border-slate-200/90 hover:border-slate-300 rounded-xl px-3 py-1 sm:py-1.5 flex items-center gap-2 sm:gap-2.5 transition-all duration-150 shadow-2xs cursor-pointer select-none"
                >
                  {/* 1. Bill Document Icon */}
                  <div className="w-6 h-6 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
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
                  <div className="h-3.5 w-px bg-slate-200/90 shrink-0" />

                  {/* 5. Particulars (Center flex-1 expands to fill space) */}
                  <div
                    className="text-xs sm:text-sm font-normal text-slate-500 truncate flex-1 min-w-0"
                    title={particulars}
                  >
                    <span>{particulars}</span>
                  </div>

                  {/* 6. Divider before Date */}
                  <div className="h-3.5 w-px bg-slate-200/90 shrink-0 hidden sm:block" />

                  {/* 7. Date Column (Strict fixed width) */}
                  <div className="w-[92px] shrink-0 hidden sm:flex items-center gap-1.5 text-xs font-medium text-slate-500 whitespace-nowrap">
                    <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                    <span>{formatDate(inv.invoice_date)}</span>
                  </div>

                  {/* 8. Divider before Customer */}
                  <div className="h-3.5 w-px bg-slate-200/90 shrink-0 hidden md:block" />

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
                  <div className="h-3.5 w-px bg-slate-200/90 shrink-0" />

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
                  <div className="h-3.5 w-px bg-slate-200/90 shrink-0" />

                  {/* 13. Quick Action Buttons (Strict fixed width & right-aligned) */}
                  <div
                    className="w-[78px] shrink-0 flex items-center justify-end gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!isStaff && inv.status === 'ACTIVE' && Number(inv.paid_amount || 0) === 0 && (
                      <button
                        type="button"
                        title="Edit Bill"
                        onClick={() => navigate(`/bills/${inv.id}/edit`)}
                        className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
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
                        className="p-1 rounded-md text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer"
                      >
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {!isStaff && inv.status === 'ACTIVE' && (
                      <button
                        type="button"
                        title="Cancel Bill"
                        onClick={() => setBillToCancel(inv)}
                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
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
