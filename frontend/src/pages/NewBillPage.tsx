import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { computeBillTotals, computeLineAmount, formatINR } from '../lib/money';
import { formatInputDate, getFYLabel } from '../lib/dates';
import { normaliseMobile } from '../lib/auth';
import { getErrorMessage } from '../i18n';
import { useToast } from '../components/ui/Toast';
import { BillDetailModal } from '../components/bills/BillDetailModal';
import { ReceivePaymentSheet } from '../components/receipts/ReceivePaymentSheet';
import {
  FileText,
  CreditCard,
  Building,
  Smartphone,
  Banknote,
  Receipt,
  CheckCircle2,
  Zap,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  User,
  Search,
  Calculator,
  Percent,
  Check,
  Minus,
  Rows3,
  Printer,
  FileCheck,
  Layers,
  BookUser,
  UserCheck,
} from 'lucide-react';
import { Database } from '../types/supabase';

type Service = Database['public']['Tables']['services']['Row'];
type Customer = Database['public']['Tables']['customers']['Row'];
type Invoice = Database['public']['Tables']['invoices']['Row'];
type InvoiceItem = Database['public']['Tables']['invoice_items']['Row'];

// Single unified item state for all items & jobs
interface BillItemState {
  id: string;
  service_id?: string | null;
  description: string;
  particular: string; // Extra field for Particular / Applicant / Order Details
  create_job: boolean; // Create Job in Queue checkbox, DEFAULT IS ALWAYS TRUE (checked)
  quantity: string;
  rate: string;
}

const DRAFT_STORAGE_KEY = 'simplify_new_bill_draft_v3';
const LAST_PAYMENT_MODE_KEY = 'simplify_last_payment_mode';

const PAYMENT_MODES = [
  { id: 'CASH', label: 'Cash', icon: Banknote },
  { id: 'BANK', label: 'Bank', icon: Building },
  { id: 'UPI', label: 'UPI', icon: Smartphone },
  { id: 'CARD', label: 'Card', icon: CreditCard },
  { id: 'CHEQUE', label: 'Cheque', icon: Receipt },
] as const;

// Pastel theme mapping for quick service cards matching user design
const SERVICE_THEMES = [
  {
    bg: 'bg-[#F0F7FF]',
    border: 'border-[#D6E8FD]',
    iconBg: 'bg-blue-100 text-[#0862EC]',
    plusBg: 'bg-blue-100 text-[#0862EC] hover:bg-[#0862EC] hover:text-white',
    icon: BookUser,
  },
  {
    bg: 'bg-[#F0FDF4]',
    border: 'border-[#DCFCE7]',
    iconBg: 'bg-emerald-100 text-emerald-600',
    plusBg: 'bg-emerald-100 text-emerald-600 hover:bg-emerald-600 hover:text-white',
    icon: UserCheck,
  },
  {
    bg: 'bg-[#FBF5FF]',
    border: 'border-[#F3E8FF]',
    iconBg: 'bg-purple-100 text-purple-600',
    plusBg: 'bg-purple-100 text-purple-600 hover:bg-purple-600 hover:text-white',
    icon: CreditCard,
  },
  {
    bg: 'bg-[#FFF9F2]',
    border: 'border-[#FEEDDC]',
    iconBg: 'bg-orange-100 text-orange-600',
    plusBg: 'bg-orange-100 text-orange-600 hover:bg-orange-600 hover:text-white',
    icon: Printer,
  },
  {
    bg: 'bg-[#FFF1F2]',
    border: 'border-[#FFE4E6]',
    iconBg: 'bg-rose-100 text-rose-600',
    plusBg: 'bg-rose-100 text-rose-600 hover:bg-rose-600 hover:text-white',
    icon: Layers,
  },
  {
    bg: 'bg-[#F0FDFA]',
    border: 'border-[#CCFBF1]',
    iconBg: 'bg-teal-100 text-teal-600',
    plusBg: 'bg-teal-100 text-teal-600 hover:bg-teal-600 hover:text-white',
    icon: FileCheck,
  },
];

export const NewBillPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const quickScrollRef = useRef<HTMLDivElement>(null);

  // Reference data
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Customer selection state
  const [isWalkIn, setIsWalkIn] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [walkInName, setWalkInName] = useState('');
  const [walkInMobile, setWalkInMobile] = useState('');

  // Single unified items list (Jobs & Items combined with 'create_job' default true)
  const [items, setItems] = useState<BillItemState[]>([
    {
      id: '1',
      description: '',
      particular: '',
      create_job: true, // Default ALWAYS checked per user requirement!
      quantity: '1',
      rate: '',
    },
  ]);

  // Discount state
  const [discountType, setDiscountType] = useState<'NONE' | 'FLAT' | 'PERCENT'>('NONE');
  const [discountValue, setDiscountValue] = useState('');

  // Payment state
  const [paidNow, setPaidNow] = useState('');
  const [paymentMode, setPaymentMode] = useState<string>('CASH');

  // Dates and Notes
  const [invoiceDate, setInvoiceDate] = useState(formatInputDate());
  const [dueDate, setDueDate] = useState(formatInputDate());
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);

  // Status & Bill Detail Modal
  const [saving, setSaving] = useState(false);
  const [savedInvoice, setSavedInvoice] = useState<(Invoice & { invoice_items?: InvoiceItem[] }) | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Receive payment sheet state from modal shortcut
  const [isReceivePaymentOpen, setIsReceivePaymentOpen] = useState(false);
  const [receivePaymentInvoice, setReceivePaymentInvoice] = useState<Invoice | null>(null);

  const resetForm = () => {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    setItems([
      {
        id: '1',
        description: '',
        particular: '',
        create_job: true,
        quantity: '1',
        rate: '',
      },
    ]);
    setWalkInName('');
    setWalkInMobile('');
    setDiscountType('NONE');
    setDiscountValue('');
    setPaidNow('');
    setNotes('');
    setSelectedCustomerId(null);
    setIsWalkIn(true);
  };

  // Load services & customers
  useEffect(() => {
    const lastMode = localStorage.getItem(LAST_PAYMENT_MODE_KEY);
    if (lastMode) setPaymentMode(lastMode);

    supabase
      .from('services')
      .select('*')
      .eq('active', true)
      .is('deleted_at', null)
      .order('is_job_type', { ascending: false })
      .order('name')
      .then(({ data }) => {
        if (data) setServices(data as Service[]);
      });

    supabase
      .from('customers')
      .select('*')
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => {
        if (data) setCustomers(data as Customer[]);
      });

    // Check saved draft
    const draft = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed.items && parsed.items.length > 0) setItems(parsed.items);
        if (parsed.walkInName) setWalkInName(parsed.walkInName);
        if (parsed.walkInMobile) setWalkInMobile(parsed.walkInMobile);
        if (parsed.discountType) setDiscountType(parsed.discountType);
        if (parsed.discountValue) setDiscountValue(parsed.discountValue);
        if (parsed.paidNow) setPaidNow(parsed.paidNow);
      } catch (e) {}
    }
  }, []);

  // Auto-save draft locally on change
  useEffect(() => {
    const draft = {
      isWalkIn,
      selectedCustomerId,
      walkInName,
      walkInMobile,
      items,
      discountType,
      discountValue,
      paidNow,
      notes,
    };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [
    isWalkIn,
    selectedCustomerId,
    walkInName,
    walkInMobile,
    items,
    discountType,
    discountValue,
    paidNow,
    notes,
  ]);

  // Combined line preview items for decimal.js live calculation
  const allLines = items.map((it) => ({
    quantity: it.quantity || '0',
    rate: it.rate || '0',
  }));

  const totals = computeBillTotals(allLines, discountType, discountValue, paidNow);

  // Quick service scroll helper
  const handleScrollRight = () => {
    if (quickScrollRef.current) {
      quickScrollRef.current.scrollBy({ left: 240, behavior: 'smooth' });
    }
  };

  // Item handlers
  const handleAddItem = (service?: Service) => {
    const newItem: BillItemState = {
      id: Math.random().toString(36).substring(2, 9),
      service_id: service?.id || null,
      description: service?.name || '',
      particular: '',
      create_job: true, // Default ALWAYS checked (true) per user requirement!
      quantity: '1',
      rate: service?.default_rate ? String(service.default_rate) : '',
    };

    if (items.length === 1 && items[0].description.trim() === '' && !items[0].rate) {
      setItems([newItem]);
    } else {
      setItems((prev) => [...prev, newItem]);
    }
  };

  const handleUpdateItem = (id: string, updates: Partial<BillItemState>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...updates } : it)));
  };

  const handleRemoveItem = (id: string) => {
    if (items.length === 1) {
      setItems([
        {
          id: '1',
          description: '',
          particular: '',
          create_job: true,
          quantity: '1',
          rate: '',
        },
      ]);
      return;
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleQtyChange = (id: string, delta: number) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;
        const currentQty = parseFloat(it.quantity || '1') || 1;
        const newQty = Math.max(1, currentQty + delta);
        return { ...it, quantity: String(newQty) };
      })
    );
  };

  const handlePaidInFull = () => {
    setPaidNow(totals.total.toString());
  };

  const handleSave = async (saveAndNew = false) => {
    // Collect valid items
    const validItems = items.filter((it) => it.description.trim() !== '');

    if (validItems.length === 0) {
      showToast('Please add at least one item to the bill', 'error');
      return;
    }

    // Client-side BR-5 Validation: if balance > 0, customer name and mobile are mandatory
    if (totals.balance.greaterThan(0)) {
      if (isWalkIn && (!walkInName.trim() || !walkInMobile.trim())) {
        showToast('Customer Name and 10-digit Mobile are required for bills with due balance', 'error');
        return;
      }
    }

    const hasJobTicked = validItems.some((it) => it.create_job);
    if (hasJobTicked && isWalkIn && !walkInMobile.trim()) {
      showToast('Tip: Enter customer mobile to enable WhatsApp updates for tracked jobs', 'info');
    }

    setSaving(true);
    try {
      // Map items with Particular -> applicant_name & create_job -> is_job
      const mappedItems = validItems.map((it) => ({
        service_id: it.service_id || null,
        description: it.description.trim(),
        quantity: parseFloat(it.quantity || '1'),
        rate: parseFloat(it.rate || '0'),
        is_job: it.create_job, // Explicitly respects user's checkbox (default true)
        applicant_name: it.particular.trim() || walkInName.trim() || null,
      }));

      const payload: any = {
        invoice_date: invoiceDate,
        due_date: dueDate,
        discount_type: discountType,
        discount_value: discountValue ? parseFloat(discountValue) : 0,
        notes: notes.trim() || null,
        items: mappedItems,
      };

      if (!isWalkIn && selectedCustomerId) {
        payload.customer_id = selectedCustomerId;
      } else {
        payload.walk_in = {
          name: walkInName.trim() || undefined,
          mobile: walkInMobile ? normaliseMobile(walkInMobile) : undefined,
        };
      }

      if (paidNow && parseFloat(paidNow) > 0) {
        payload.paid = {
          amount: parseFloat(paidNow),
          mode: paymentMode,
        };
        localStorage.setItem(LAST_PAYMENT_MODE_KEY, paymentMode);
      }

      const { data, error } = await supabase.rpc('create_invoice', { payload });
      if (error) throw error;

      // Clear local draft
      localStorage.removeItem(DRAFT_STORAGE_KEY);

      // Fetch complete invoice data and items so BillDetailModal displays full document
      const { data: invData } = await supabase
        .from('invoices')
        .select('*')
        .eq('id', data.id)
        .single();

      const { data: itemsData } = await supabase
        .from('invoice_items')
        .select('*')
        .eq('invoice_id', data.id);

      const fullInvoice: Invoice & { invoice_items?: InvoiceItem[] } = {
        ...(invData || data),
        invoice_items: (itemsData as InvoiceItem[]) || [],
      };

      setSavedInvoice(fullInvoice);
      setIsDetailModalOpen(true);
      resetForm();
      showToast(
        saveAndNew
          ? `Bill #${data.number} saved! Form ready for next bill.`
          : `Bill #${data.number} created successfully!`,
        'success'
      );
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto p-3 sm:p-5 flex flex-col gap-3.5 min-h-screen lg:h-[calc(100vh-64px)] lg:overflow-hidden font-sans">
      {/* 1. TOP HEADER: Title, Date, FY, and Customer Single Row Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
        {/* Left: Title & FY Subtitle */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="w-10 h-10 rounded-2xl bg-[#0862EC] text-white flex items-center justify-center shadow-md shadow-blue-500/20">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 leading-tight">
              Create Bill
            </h1>
            <p className="text-xs text-slate-400 font-medium">
              {formatInputDate()} · FY {getFYLabel()}
            </p>
          </div>
        </div>

        {/* Right: Customer Segmented Pill + Inline Customer Inputs */}
        <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap flex-1 justify-end max-w-2xl">
          {/* Segmented Switch: Walk-in vs Existing */}
          <div className="inline-flex bg-slate-100 p-1 rounded-xl border border-slate-200/60 shrink-0">
            <button
              type="button"
              onClick={() => {
                setIsWalkIn(true);
                setSelectedCustomerId(null);
              }}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                isWalkIn
                  ? 'bg-[#0862EC] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Walk-in
            </button>
            <button
              type="button"
              onClick={() => setIsWalkIn(false)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                !isWalkIn
                  ? 'bg-[#0862EC] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Existing
            </button>
          </div>

          {isWalkIn ? (
            <div className="flex items-center gap-2 flex-1">
              {/* Customer Name */}
              <div className="relative flex-1">
                <User className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Customer Name (optional if fully paid)"
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-[#0862EC] focus:ring-1 focus:ring-[#0862EC] focus:outline-none transition-all shadow-2xs"
                />
              </div>

              {/* Customer Mobile */}
              <div className="relative w-44 shrink-0">
                <Smartphone className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="tel"
                  inputMode="tel"
                  placeholder="10-digit Mobile"
                  value={walkInMobile}
                  onChange={(e) => setWalkInMobile(e.target.value)}
                  className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-200 bg-white text-xs font-medium text-slate-900 placeholder:text-slate-400 focus:border-[#0862EC] focus:ring-1 focus:ring-[#0862EC] focus:outline-none transition-all shadow-2xs"
                />
              </div>
            </div>
          ) : (
            <div className="flex-1">
              <select
                value={selectedCustomerId || ''}
                onChange={(e) => setSelectedCustomerId(e.target.value || null)}
                className="w-full h-10 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-900 focus:border-[#0862EC] focus:ring-1 focus:ring-[#0862EC] focus:outline-none shadow-2xs"
              >
                <option value="">-- Choose Existing Customer --</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.mobile ? `(${c.mobile})` : ''} - {c.type}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* 2. MAIN 2-COLUMN WORKSPACE */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 lg:overflow-hidden min-h-0">
        {/* LEFT COLUMN: Quick Services + Bill Items Table (approx 68% width) */}
        <div className="lg:col-span-8 flex flex-col gap-3.5 lg:overflow-hidden min-h-0">
          {/* Card 1: Quick Add Service / Job */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs shrink-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-[#0862EC] flex items-center justify-center">
                  <Zap className="w-4 h-4 fill-current" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 leading-tight">
                    Quick Add Service / Job
                  </h2>
                  <p className="text-xs text-slate-400">
                    Click to add common services (Auto-fills item below)
                  </p>
                </div>
              </div>

              {/* Add Empty Row Button */}
              <button
                type="button"
                onClick={() => handleAddItem()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-all cursor-pointer shadow-2xs"
              >
                <Rows3 className="w-3.5 h-3.5 text-slate-500" />
                <span>Add Empty Row</span>
              </button>
            </div>

            {/* Quick Cards Scroll Container */}
            <div className="relative">
              <div
                ref={quickScrollRef}
                className="flex items-center gap-2.5 overflow-x-auto no-scrollbar scroll-smooth py-1"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {services.slice(0, 10).map((srv, idx) => {
                  const theme = SERVICE_THEMES[idx % SERVICE_THEMES.length];
                  const IconComp = theme.icon;
                  return (
                    <div
                      key={srv.id}
                      onClick={() => handleAddItem(srv)}
                      className={`shrink-0 flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-2xl border ${theme.bg} ${theme.border} hover:shadow-xs transition-all cursor-pointer min-w-[170px] select-none`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-xl ${theme.iconBg} flex items-center justify-center shrink-0 shadow-2xs`}
                        >
                          <IconComp className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate leading-snug">
                            {srv.name}
                          </p>
                          <p className="text-xs font-extrabold text-slate-800">
                            {formatINR(srv.default_rate || 0)}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        className={`w-6 h-6 rounded-full ${theme.plusBg} flex items-center justify-center shrink-0 text-xs font-bold transition-all shadow-2xs`}
                        title="Add to Bill"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Right Arrow Carousel Button */}
              {services.length > 5 && (
                <button
                  type="button"
                  onClick={handleScrollRight}
                  className="absolute -right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white border border-slate-200 shadow-md text-slate-500 hover:text-slate-800 flex items-center justify-center z-10 transition-all"
                  title="Scroll right"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Card 2: Bill Items Table */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-2xs flex-1 flex flex-col min-h-0 lg:overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between mb-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 text-[#0862EC] flex items-center justify-center">
                  <FileText className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 leading-tight">
                    Bill Items
                  </h2>
                  <p className="text-xs text-slate-400">
                    Add items or select from above services
                  </p>
                </div>
              </div>

              {/* Add Item Button */}
              <button
                type="button"
                onClick={() => handleAddItem()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#0862EC] text-white hover:bg-blue-700 text-xs font-bold transition-all cursor-pointer shadow-xs shadow-blue-500/20"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item</span>
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>
            </div>

            {/* Table Header Row */}
            <div className="hidden sm:grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-500 px-3 py-2 bg-slate-50/70 rounded-xl shrink-0">
              <div className="col-span-1 text-center">#</div>
              <div className="col-span-3">Item / Service / Job</div>
              <div className="col-span-3">Particular (Applicant / Order Details)</div>
              <div className="col-span-1 text-center">Create Job</div>
              <div className="col-span-1 text-center">Qty</div>
              <div className="col-span-1 text-center">Rate (₹)</div>
              <div className="col-span-1 text-right">Amount (₹)</div>
              <div className="col-span-1 text-center">Action</div>
            </div>

            {/* Table Body (Internal Scroll for 100+ items) */}
            <div className="flex-1 overflow-y-auto space-y-2 py-1 pr-1 min-h-[160px]">
              {items.map((item, idx) => {
                const lineAmt = computeLineAmount(item.quantity, item.rate);
                return (
                  <div
                    key={item.id}
                    className="p-2 sm:px-3 sm:py-2 rounded-xl border border-slate-200/80 bg-white hover:border-slate-300 transition-all flex flex-col sm:grid sm:grid-cols-12 gap-2 items-center text-xs shadow-2xs"
                  >
                    {/* # Index */}
                    <div className="hidden sm:block col-span-1 text-center font-bold text-slate-400">
                      {idx + 1}
                    </div>

                    {/* Item / Service / Job (Search / Type-ahead select) */}
                    <div className="w-full sm:col-span-3 relative">
                      <div className="relative flex items-center">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                        <input
                          type="text"
                          list={`service-list-${item.id}`}
                          placeholder="Select or Type Service..."
                          value={item.description}
                          onChange={(e) => {
                            const val = e.target.value;
                            const matched = services.find(
                              (s) => s.name.toLowerCase() === val.toLowerCase()
                            );
                            if (matched) {
                              handleUpdateItem(item.id, {
                                description: matched.name,
                                service_id: matched.id,
                                rate: matched.default_rate
                                  ? String(matched.default_rate)
                                  : item.rate,
                                create_job: true, // Default ALWAYS checked true!
                              });
                            } else {
                              handleUpdateItem(item.id, { description: val });
                            }
                          }}
                          className="w-full h-9 pl-8 pr-7 rounded-xl border border-slate-200 text-xs font-semibold text-slate-900 bg-white focus:border-[#0862EC] focus:ring-1 focus:ring-[#0862EC] focus:outline-none"
                        />
                        <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 pointer-events-none" />
                        <datalist id={`service-list-${item.id}`}>
                          {services.map((s) => (
                            <option key={s.id} value={s.name}>
                              {s.is_job_type ? '[Job]' : '[Item]'} Rate: ₹{s.default_rate || 0}
                            </option>
                          ))}
                        </datalist>
                      </div>
                    </div>

                    {/* Particular (Applicant / Order Details) */}
                    <div className="w-full sm:col-span-3">
                      <input
                        type="text"
                        placeholder="e.g. Meena Kumari"
                        value={item.particular}
                        onChange={(e) => handleUpdateItem(item.id, { particular: e.target.value })}
                        className="w-full h-9 px-3 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0862EC] focus:ring-1 focus:ring-[#0862EC] focus:outline-none"
                      />
                    </div>

                    {/* Create Job Checkbox (Default checked true, click to toggle) */}
                    <div className="w-full sm:col-span-1 flex items-center justify-between sm:justify-center">
                      <span className="sm:hidden text-slate-500 font-medium">Create Job:</span>
                      <button
                        type="button"
                        onClick={() => handleUpdateItem(item.id, { create_job: !item.create_job })}
                        className={`w-4 h-4 rounded flex items-center justify-center transition-all cursor-pointer ${
                          item.create_job
                            ? 'bg-[#0862EC] text-white'
                            : 'border border-slate-300 bg-white hover:border-slate-400'
                        }`}
                        title="Default checked: creates live job in Queue. Uncheck for random non-job entry."
                      >
                        {item.create_job && <Check className="w-3 h-3 stroke-[3]" />}
                      </button>
                    </div>

                    {/* Qty Stepper [ - ] 1 [ + ] */}
                    <div className="w-full sm:col-span-1 flex items-center justify-between sm:justify-center">
                      <span className="sm:hidden text-slate-500 font-medium">Qty:</span>
                      <div className="inline-flex items-center border border-slate-200 rounded-xl overflow-hidden bg-white h-9 shadow-2xs">
                        <button
                          type="button"
                          onClick={() => handleQtyChange(item.id, -1)}
                          className="px-2 text-slate-400 hover:text-slate-700 hover:bg-slate-50 text-xs font-bold transition-colors cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <input
                          type="number"
                          step="any"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleUpdateItem(item.id, { quantity: e.target.value })}
                          className="w-7 text-center text-xs font-bold text-slate-900 border-none outline-none focus:ring-0"
                        />
                        <button
                          type="button"
                          onClick={() => handleQtyChange(item.id, 1)}
                          className="px-2 text-slate-400 hover:text-slate-700 hover:bg-slate-50 text-xs font-bold transition-colors cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    {/* Rate (₹) */}
                    <div className="w-full sm:col-span-1 flex items-center justify-between sm:justify-center">
                      <span className="sm:hidden text-slate-500 font-medium">Rate (₹):</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        value={item.rate}
                        onChange={(e) => handleUpdateItem(item.id, { rate: e.target.value })}
                        className="w-20 sm:w-full h-9 px-2 rounded-xl border border-slate-200 text-xs font-semibold text-center text-slate-900 focus:border-[#0862EC] focus:ring-1 focus:ring-[#0862EC] focus:outline-none"
                      />
                    </div>

                    {/* Amount (₹) */}
                    <div className="w-full sm:col-span-1 flex items-center justify-between sm:justify-end">
                      <span className="sm:hidden text-slate-500 font-medium">Amount:</span>
                      <span className="font-extrabold text-xs text-[#0862EC] text-right truncate">
                        {formatINR(lineAmt)}
                      </span>
                    </div>

                    {/* Action (Delete) */}
                    <div className="w-full sm:col-span-1 flex items-center justify-end sm:justify-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveItem(item.id)}
                        className="p-1.5 rounded-lg text-rose-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Remove row"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Centered Add Another Item Button */}
              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => handleAddItem()}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0862EC] hover:text-blue-700 hover:underline cursor-pointer py-1"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Another Item</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: POS Billing Terminal Sidebar (approx 32% width) */}
        <div className="lg:col-span-4 flex flex-col justify-between gap-3 lg:overflow-y-auto pr-0.5">
          <div className="space-y-3">
            {/* Card 1: Total Bill Amount Banner */}
            <div className="bg-[#F0F7FF] border border-[#D6E8FD] rounded-2xl p-4 shadow-2xs">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-white border border-blue-100 text-[#0862EC] flex items-center justify-center shrink-0 shadow-2xs">
                  <Calculator className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[11px] font-bold tracking-wider text-slate-500 uppercase">
                    Total Bill Amount
                  </div>
                  <div className="text-3xl font-extrabold text-[#0862EC] tracking-tight leading-tight">
                    {formatINR(totals.total)}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500 font-medium mt-2.5 pt-2 border-t border-blue-100/70">
                <span>Subtotal: {formatINR(totals.subtotal)}</span>
                <span>Items: {items.filter((i) => i.description.trim()).length || items.length}</span>
              </div>
            </div>

            {/* Card 2: % Discount */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-3.5 shadow-2xs">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                  <Percent className="w-3.5 h-3.5 text-slate-500" />
                  <span>Discount</span>
                </div>

                <div className="inline-flex bg-slate-100 p-0.5 rounded-xl border border-slate-200/60">
                  <button
                    type="button"
                    onClick={() => {
                      setDiscountType('NONE');
                      setDiscountValue('');
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      discountType === 'NONE'
                        ? 'bg-[#0862EC] text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    None
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountType('FLAT')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      discountType === 'FLAT'
                        ? 'bg-[#0862EC] text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    ₹ Flat
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscountType('PERCENT')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      discountType === 'PERCENT'
                        ? 'bg-[#0862EC] text-white shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    % Percent
                  </button>
                </div>
              </div>

              {discountType !== 'NONE' && (
                <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-xs text-slate-500 font-medium">
                    {discountType === 'FLAT' ? 'Flat ₹ Off:' : 'Percentage % Off:'}
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder={discountType === 'FLAT' ? '0.00' : '0%'}
                      value={discountValue}
                      onChange={(e) => setDiscountValue(e.target.value)}
                      className="w-24 h-8 px-2 rounded-lg border border-slate-200 text-xs font-bold text-right text-slate-900 focus:border-[#0862EC] focus:outline-none"
                    />
                    {totals.discountAmount.greaterThan(0) && (
                      <span className="text-xs font-bold text-emerald-600">
                        (-{formatINR(totals.discountAmount)})
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Card 3: Payment Received */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-3.5 shadow-2xs">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                  <div className="w-5 h-5 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold">
                    ₹
                  </div>
                  <span>Payment Received</span>
                </div>

                {totals.total.greaterThan(0) && (
                  <button
                    type="button"
                    onClick={handlePaidInFull}
                    className="text-[11px] font-bold text-[#0862EC] hover:underline px-2 py-0.5 rounded-lg bg-blue-50 cursor-pointer"
                  >
                    1-Tap Paid in Full
                  </button>
                )}
              </div>

              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                  ₹
                </span>
                <input
                  type="number"
                  step="any"
                  min="0"
                  placeholder="0.00"
                  value={paidNow}
                  onChange={(e) => setPaidNow(e.target.value)}
                  className="w-full h-11 pl-8 pr-3 rounded-xl border border-slate-200 bg-white text-base font-extrabold text-slate-900 placeholder:text-slate-300 focus:border-[#0862EC] focus:ring-1 focus:ring-[#0862EC] focus:outline-none transition-all shadow-2xs"
                />
              </div>

              {totals.balance.greaterThan(0) ? (
                <div className="flex items-center justify-between mt-2 pt-1 text-xs">
                  <span className="text-amber-700 font-semibold">Balance Due:</span>
                  <span className="font-extrabold text-amber-700">{formatINR(totals.balance)}</span>
                </div>
              ) : totals.total.greaterThan(0) && totals.balance.isZero() ? (
                <div className="flex items-center gap-1 mt-2 pt-1 text-xs text-emerald-700 font-bold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Fully Paid</span>
                </div>
              ) : null}
            </div>

            {/* Card 4: Payment Mode */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-3.5 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-2">
                <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                <span>Payment Mode</span>
              </div>

              <div className="grid grid-cols-5 gap-1.5">
                {PAYMENT_MODES.map((m) => {
                  const IconComp = m.icon;
                  const isSelected = paymentMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMode(m.id)}
                      className={`py-2 px-1 rounded-xl border text-[11px] font-semibold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-[#0862EC] text-white border-[#0862EC] shadow-2xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <IconComp className="w-4 h-4" />
                      <span className="truncate">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Card 5: Additional Details (Optional Accordion) */}
            <div className="bg-white border border-slate-200/80 rounded-2xl p-3 shadow-2xs">
              <button
                type="button"
                onClick={() => setShowNotes(!showNotes)}
                className="w-full flex items-center justify-between text-xs font-bold text-slate-700 cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-slate-500" />
                  <span>Additional Details (Optional)</span>
                </div>
                {showNotes ? (
                  <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                )}
              </button>

              {showNotes && (
                <div className="mt-2.5 pt-2.5 border-t border-slate-100 space-y-2 text-xs">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Bill Date</label>
                      <input
                        type="date"
                        value={invoiceDate}
                        onChange={(e) => setInvoiceDate(e.target.value)}
                        className="w-full h-8 px-2 rounded-lg border border-slate-200 text-xs font-medium"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Due Date</label>
                      <input
                        type="date"
                        value={dueDate}
                        onChange={(e) => setDueDate(e.target.value)}
                        className="w-full h-8 px-2 rounded-lg border border-slate-200 text-xs font-medium"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase">Notes & Remarks</label>
                    <textarea
                      rows={2}
                      placeholder="Custom date, notes, reference, terms etc..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full p-2 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0862EC] focus:outline-none resize-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Action Buttons: Save & New Bill + Save Bill */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(true)}
              className="py-3 px-3 rounded-xl border border-[#0862EC] bg-white text-[#0862EC] hover:bg-blue-50 text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
            >
              <FileText className="w-4 h-4" />
              <span>Save & New Bill</span>
            </button>

            <button
              type="button"
              disabled={saving}
              onClick={() => handleSave(false)}
              className="py-3 px-3 rounded-xl bg-[#0862EC] hover:bg-blue-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-md shadow-blue-500/20 disabled:opacity-50"
            >
              <Check className="w-4 h-4 stroke-[3]" />
              <span>Save Bill ({formatINR(totals.total)})</span>
            </button>
          </div>
        </div>
      </div>

      {/* Generated Bill Invoice Modal (identical to Bill List view) */}
      <BillDetailModal
        open={isDetailModalOpen}
        onOpenChange={(open) => {
          setIsDetailModalOpen(open);
        }}
        invoice={savedInvoice}
        onInvoiceUpdated={async () => {
          if (savedInvoice?.id) {
            const { data: invData } = await supabase
              .from('invoices')
              .select('*')
              .eq('id', savedInvoice.id)
              .single();
            const { data: itemsData } = await supabase
              .from('invoice_items')
              .select('*')
              .eq('invoice_id', savedInvoice.id);
            if (invData) {
              setSavedInvoice({
                ...(invData as Invoice),
                invoice_items: (itemsData as InvoiceItem[]) || [],
              });
            }
          }
        }}
        onReceivePayment={(inv) => {
          setReceivePaymentInvoice(inv);
          setIsReceivePaymentOpen(true);
        }}
        onNewBill={() => {
          resetForm();
        }}
        onGoToBills={() => {
          navigate('/bills');
        }}
      />

      {/* Receive Payment Sheet shortcut from Bill Modal */}
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
          onSuccess={async () => {
            if (savedInvoice?.id) {
              const { data: invData } = await supabase
                .from('invoices')
                .select('*')
                .eq('id', savedInvoice.id)
                .single();
              if (invData) {
                setSavedInvoice((prev) => (prev ? { ...prev, ...(invData as Invoice) } : null));
              }
            }
          }}
        />
      )}
    </div>
  );
};
