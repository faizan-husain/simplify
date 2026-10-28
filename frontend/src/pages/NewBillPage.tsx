import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { computeBillTotals, computeLineAmount, formatINR } from '../lib/money';
import { formatInputDate, getFYLabel } from '../lib/dates';
import { normaliseMobile, getWhatsAppUrl } from '../lib/auth';
import { t, getErrorMessage } from '../i18n';
import { Input } from '../components/ui/Input';
import { AmountInput } from '../components/ui/AmountInput';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { useToast } from '../components/ui/Toast';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Briefcase,
  FileText,
  CreditCard,
  Building,
  Smartphone,
  Banknote,
  Receipt,
  CheckCircle2,
  Zap,
} from 'lucide-react';
import { Database } from '../types/supabase';

type Service = Database['public']['Tables']['services']['Row'];
type Customer = Database['public']['Tables']['customers']['Row'];

// Distinct state for Tracked Jobs
interface JobItemState {
  id: string;
  service_id: string;
  job_type_name: string;
  rate: string;
  applicant_name: string;
}

// Distinct state for Regular Products & Services
interface RegularItemState {
  id: string;
  service_id?: string | null;
  description: string;
  quantity: string;
  rate: string;
}

const DRAFT_STORAGE_KEY = 'simplify_new_bill_draft_v2';
const LAST_PAYMENT_MODE_KEY = 'simplify_last_payment_mode';

const PAYMENT_MODES = [
  { id: 'CASH', label: 'Cash', icon: Banknote },
  { id: 'BANK', label: 'Bank', icon: Building },
  { id: 'UPI', label: 'UPI', icon: Smartphone },
  { id: 'CARD', label: 'Card', icon: CreditCard },
  { id: 'CHEQUE', label: 'Cheque', icon: Receipt },
] as const;

export const NewBillPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Reference data
  const [services, setServices] = useState<Service[]>([]);
  const [frequentServices, setFrequentServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Customer selection state
  const [isWalkIn, setIsWalkIn] = useState(true);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [walkInName, setWalkInName] = useState('');
  const [walkInMobile, setWalkInMobile] = useState('');

  // 1. Tracked Jobs List (Multi-step workflows with applicant name & queue tracking)
  const [jobItems, setJobItems] = useState<JobItemState[]>([]);

  // 2. Regular Products & Items List (Photocopy, Printout, Lamination, etc.)
  const [regularItems, setRegularItems] = useState<RegularItemState[]>([
    { id: '1', description: '', quantity: '1', rate: '' },
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

  // Status & Success Sheet
  const [saving, setSaving] = useState(false);
  const [savedInvoice, setSavedInvoice] = useState<any | null>(null);
  const [isSuccessSheetOpen, setIsSuccessSheetOpen] = useState(false);

  // Load services & customers
  useEffect(() => {
    const lastMode = localStorage.getItem(LAST_PAYMENT_MODE_KEY);
    if (lastMode) setPaymentMode(lastMode);

    supabase
      .from('services')
      .select('*')
      .eq('active', true)
      .is('deleted_at', null)
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

    supabase.rpc('frequent_services').then(({ data }) => {
      if (data && Array.isArray(data)) setFrequentServices(data as Service[]);
    });

    // Check saved draft
    const draft = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (parsed.jobItems) setJobItems(parsed.jobItems);
        if (parsed.regularItems) setRegularItems(parsed.regularItems);
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
      jobItems,
      regularItems,
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
    jobItems,
    regularItems,
    discountType,
    discountValue,
    paidNow,
    notes,
  ]);

  // Combined line preview items for decimal.js live calculation
  const allLines = [
    ...jobItems.map((j) => ({ quantity: 1, rate: j.rate || '0' })),
    ...regularItems.map((r) => ({ quantity: r.quantity || '0', rate: r.rate || '0' })),
  ];

  const totals = computeBillTotals(allLines, discountType, discountValue, paidNow);

  // Job management handlers
  const handleAddJob = (service: Service) => {
    const newJob: JobItemState = {
      id: Math.random().toString(36).substring(2, 9),
      service_id: service.id,
      job_type_name: service.name,
      rate: service.default_rate ? String(service.default_rate) : '',
      applicant_name: walkInName || '',
    };
    setJobItems((prev) => [...prev, newJob]);
    showToast(`Added '${service.name}' to tracked jobs`, 'success');
  };

  const handleUpdateJob = (id: string, updates: Partial<JobItemState>) => {
    setJobItems((prev) => prev.map((j) => (j.id === id ? { ...j, ...updates } : j)));
  };

  const handleRemoveJob = (id: string) => {
    setJobItems((prev) => prev.filter((j) => j.id !== id));
  };

  // Regular items handlers
  const handleAddRegularItem = (service?: Service) => {
    const newItem: RegularItemState = {
      id: Math.random().toString(36).substring(2, 9),
      service_id: service?.id || null,
      description: service?.name || '',
      quantity: '1',
      rate: service?.default_rate ? String(service.default_rate) : '',
    };
    if (regularItems.length === 1 && regularItems[0].description.trim() === '' && !regularItems[0].rate) {
      setRegularItems([newItem]);
    } else {
      setRegularItems((prev) => [...prev, newItem]);
    }
  };

  const handleUpdateRegularItem = (id: string, updates: Partial<RegularItemState>) => {
    setRegularItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...updates } : r)));
  };

  const handleRemoveRegularItem = (id: string) => {
    if (regularItems.length === 1 && jobItems.length === 0) {
      setRegularItems([{ id: '1', description: '', quantity: '1', rate: '' }]);
      return;
    }
    setRegularItems((prev) => prev.filter((r) => r.id !== id));
  };

  const handlePaidInFull = () => {
    setPaidNow(totals.total.toString());
  };

  // Available job types and regular services
  const availableJobServices = services.filter((s) => s.is_job_type);
  const availableRegularServices = (frequentServices.length > 0 ? frequentServices : services).filter(
    (s) => !s.is_job_type
  );

  const handleSave = async (saveAndNew = false) => {
    // Collect valid items
    const validJobs = jobItems.filter((j) => j.job_type_name.trim() !== '');
    const validRegular = regularItems.filter((r) => r.description.trim() !== '');

    if (validJobs.length === 0 && validRegular.length === 0) {
      showToast('Please add at least one job or bill item', 'error');
      return;
    }

    // Client-side BR-5 Validation: if balance > 0, customer name and mobile are mandatory
    if (totals.balance.greaterThan(0)) {
      if (isWalkIn && (!walkInName.trim() || !walkInMobile.trim())) {
        showToast('Customer Name and 10-digit Mobile are required for bills with due balance', 'error');
        return;
      }
    }

    // If job is added, advise entering mobile for WhatsApp updates
    if (validJobs.length > 0 && isWalkIn && !walkInMobile.trim()) {
      showToast('Please enter customer mobile for live job tracking WhatsApp updates', 'info');
    }

    setSaving(true);
    try {
      // Map both job items and regular items into the invoice items array
      const mappedItems = [
        ...validJobs.map((j) => ({
          service_id: j.service_id,
          description: j.job_type_name.trim(),
          quantity: 1,
          rate: parseFloat(j.rate || '0'),
          is_job: true,
          applicant_name: j.applicant_name.trim() || walkInName.trim() || null,
        })),
        ...validRegular.map((r) => ({
          service_id: r.service_id || null,
          description: r.description.trim(),
          quantity: parseFloat(r.quantity || '1'),
          rate: parseFloat(r.rate || '0'),
          is_job: false,
          applicant_name: null,
        })),
      ];

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

      if (saveAndNew) {
        showToast(`Bill #${data.number} created successfully!`, 'success');
        // Reset form
        setJobItems([]);
        setRegularItems([{ id: '1', description: '', quantity: '1', rate: '' }]);
        setWalkInName('');
        setWalkInMobile('');
        setDiscountType('NONE');
        setDiscountValue('');
        setPaidNow('');
        setNotes('');
      } else {
        setSavedInvoice(data);
        setIsSuccessSheetOpen(true);
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="w-full max-w-[1600px] mx-auto p-2.5 sm:p-4 lg:p-5 flex flex-col lg:h-[calc(100vh-64px)] lg:overflow-hidden gap-3">
      {/* 1. TOP BAR: Compact Header + Single-Line Customer Details Bar */}
      <div className="bg-white border border-slate-200/90 rounded-2xl p-2.5 sm:px-4 sm:py-2.5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-2.5 shrink-0">
        {/* Title & FY */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-xl bg-blue-50 text-primary flex items-center justify-center font-bold">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 leading-none">
              {t('billing.new_bill')}
            </h1>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {formatInputDate()} · FY {getFYLabel()}
            </p>
          </div>
        </div>

        {/* Customer Single Inline Row */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap flex-1 justify-end">
          {/* Walk-in vs Existing Switcher */}
          <div className="flex gap-0.5 bg-slate-100 p-0.5 rounded-lg border border-slate-200 shrink-0">
            <button
              type="button"
              onClick={() => {
                setIsWalkIn(true);
                setSelectedCustomerId(null);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                isWalkIn ? 'bg-white text-primary shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Walk-in
            </button>
            <button
              type="button"
              onClick={() => setIsWalkIn(false)}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                !isWalkIn ? 'bg-white text-primary shadow-2xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Existing
            </button>
          </div>

          {isWalkIn ? (
            <div className="flex items-center gap-2 flex-1 max-w-lg">
              <input
                type="text"
                placeholder="Customer Name (optional if paid in full)"
                value={walkInName}
                onChange={(e) => setWalkInName(e.target.value)}
                className="w-full h-8 px-2.5 rounded-lg border border-slate-200 text-xs focus:border-primary focus:outline-none"
              />
              <input
                type="tel"
                inputMode="tel"
                placeholder="10-digit Mobile"
                value={walkInMobile}
                onChange={(e) => setWalkInMobile(e.target.value)}
                className="w-36 h-8 px-2.5 rounded-lg border border-slate-200 text-xs focus:border-primary focus:outline-none shrink-0"
              />
            </div>
          ) : (
            <div className="flex-1 max-w-md">
              <select
                value={selectedCustomerId || ''}
                onChange={(e) => setSelectedCustomerId(e.target.value || null)}
                className="w-full h-8 px-2.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-800 focus:border-primary focus:outline-none"
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

      {/* 2. FULL-SCREEN 2-COLUMN WORKSPACE (Left: Jobs & Items, Right: POS Terminal & Save) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-3 lg:overflow-hidden min-h-0">
        {/* LEFT COLUMN: Input Workspace (Scrolls internally if items > screen, no whole-page scroll) */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-3 lg:overflow-y-auto pr-0 lg:pr-1.5">
          {/* SECTION A: MULTI-STEP JOB SERVICES (WORKFLOW & LIVE QUEUE TRACKING) */}
          <div className="bg-white border border-blue-200/90 rounded-2xl p-3 sm:p-4 shadow-2xs space-y-2.5">
            <div className="flex items-center justify-between pb-1.5 border-b border-blue-100">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-blue-100 text-primary flex items-center justify-center">
                  <Briefcase className="w-3.5 h-3.5" />
                </span>
                <div>
                  <h2 className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight flex items-center gap-1.5">
                    <span>Multi-Step Job Services</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-primary">
                      Live Queue Tracking
                    </span>
                  </h2>
                </div>
              </div>

              <span className="text-[11px] font-semibold text-slate-500">
                {jobItems.length} Job{jobItems.length !== 1 ? 's' : ''} Added
              </span>
            </div>

            {/* Quick Job Type Clickable Badges */}
            {availableJobServices.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {availableJobServices.map((srv) => (
                  <button
                    key={srv.id}
                    type="button"
                    onClick={() => handleAddJob(srv)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-blue-200 bg-blue-50/50 hover:bg-blue-100/70 hover:border-primary text-xs font-semibold text-primary shadow-2xs transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{srv.name}</span>
                    {srv.default_rate && (
                      <span className="font-bold text-slate-800 text-[11px]">
                        ({formatINR(srv.default_rate)})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Added Jobs List (Single-row compact items) */}
            {jobItems.length > 0 && (
              <div className="space-y-1.5 pt-1">
                {jobItems.map((job, idx) => (
                  <div
                    key={job.id}
                    className="p-2 sm:px-3 sm:py-2 rounded-xl border border-blue-200/90 bg-blue-50/20 shadow-2xs flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="w-5 h-5 rounded bg-blue-100 text-primary font-bold text-[10px] flex items-center justify-center">
                        J{idx + 1}
                      </span>
                      <span className="font-bold text-slate-900 truncate max-w-[140px] sm:max-w-[180px]">
                        {job.job_type_name}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 flex-1 justify-end">
                      <input
                        type="text"
                        placeholder="Applicant Name (Candidate)"
                        value={job.applicant_name}
                        onChange={(e) => handleUpdateJob(job.id, { applicant_name: e.target.value })}
                        className="h-8 px-2 rounded-lg border border-slate-200 text-xs bg-white flex-1 max-w-[200px] focus:border-primary focus:outline-none"
                      />

                      <div className="w-24 shrink-0">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="Rate ₹"
                          value={job.rate}
                          onChange={(e) => handleUpdateJob(job.id, { rate: e.target.value })}
                          className="w-full h-8 px-2 rounded-lg border border-slate-200 text-xs font-bold text-right bg-white focus:border-primary focus:outline-none"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveJob(job.id)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                        title="Remove Job"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SECTION B: REGULAR BILL ITEMS & PRODUCTS */}
          <div className="bg-white border border-slate-200/90 rounded-2xl p-3 sm:p-4 shadow-2xs space-y-2 flex-1 flex flex-col min-h-[220px]">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 shrink-0">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">
                  <FileText className="w-3.5 h-3.5" />
                </span>
                <h2 className="text-xs sm:text-sm font-bold text-slate-900 tracking-tight">
                  Regular Items & Products (Photocopy, Printout, Lamination, etc.)
                </h2>
              </div>

              <button
                type="button"
                onClick={() => handleAddRegularItem()}
                className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Item</span>
              </button>
            </div>

            {/* Quick Chips for Regular Services */}
            {availableRegularServices.length > 0 && (
              <div className="flex flex-wrap gap-1.5 shrink-0">
                {availableRegularServices.map((srv) => (
                  <button
                    key={srv.id}
                    type="button"
                    onClick={() => handleAddRegularItem(srv)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 hover:bg-white text-xs font-medium text-slate-800 shadow-2xs transition-all cursor-pointer"
                  >
                    <Plus className="w-3 h-3 text-primary" />
                    <span>{srv.name}</span>
                    {srv.default_rate && (
                      <span className="font-bold text-primary text-[11px]">
                        ({formatINR(srv.default_rate)})
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Fast Table of Regular Items */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pt-1">
              {regularItems.map((item, idx) => {
                const lineAmt = computeLineAmount(item.quantity, item.rate);
                return (
                  <div
                    key={item.id}
                    className="p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all shadow-2xs flex items-center gap-2 text-xs"
                  >
                    <span className="text-[11px] font-bold text-slate-400 w-4 text-center shrink-0">
                      {idx + 1}
                    </span>

                    <input
                      type="text"
                      placeholder="Item name / service description"
                      value={item.description}
                      onChange={(e) => {
                        const val = e.target.value;
                        const matched = availableRegularServices.find(
                          (s) => s.name.toLowerCase() === val.toLowerCase()
                        );
                        if (matched) {
                          handleUpdateRegularItem(item.id, {
                            description: matched.name,
                            service_id: matched.id,
                            rate: matched.default_rate ? String(matched.default_rate) : item.rate,
                          });
                        } else {
                          handleUpdateRegularItem(item.id, { description: val });
                        }
                      }}
                      className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:border-primary focus:outline-none min-w-[120px]"
                    />

                    <div className="w-20 shrink-0">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        placeholder="Qty"
                        value={item.quantity}
                        onChange={(e) => handleUpdateRegularItem(item.id, { quantity: e.target.value })}
                        className="w-full h-8 px-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-center text-slate-800 focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div className="w-24 shrink-0">
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="Rate ₹"
                        value={item.rate}
                        onChange={(e) => handleUpdateRegularItem(item.id, { rate: e.target.value })}
                        className="w-full h-8 px-2 rounded-lg border border-slate-200 text-xs font-semibold text-right text-slate-800 focus:border-primary focus:outline-none"
                      />
                    </div>

                    <div className="font-bold text-xs text-slate-900 text-right w-16 shrink-0 truncate">
                      {formatINR(lineAmt)}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveRegularItem(item.id)}
                      className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors shrink-0"
                      title="Remove Item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: POS Billing Terminal (Sticks in full-screen view without scrolling) */}
        <div className="lg:col-span-5 xl:col-span-4 bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-3.5 sm:p-4 lg:p-5 flex flex-col justify-between gap-3 overflow-hidden">
          {/* TOP: Big Bold POS Total Display */}
          <div className="bg-blue-50/80 border border-blue-100 rounded-2xl p-3 sm:p-4 text-center">
            <div className="text-[11px] font-extrabold uppercase tracking-widest text-primary/80">
              Total Bill Amount
            </div>
            <div className="text-3xl sm:text-4xl font-black text-primary tracking-tight mt-0.5">
              {formatINR(totals.total)}
            </div>
            <div className="flex items-center justify-center gap-4 text-xs text-slate-600 mt-1">
              <span>Subtotal: <strong>{formatINR(totals.subtotal)}</strong></span>
              {totals.discountAmount.greaterThan(0) && (
                <span className="text-emerald-700 font-bold">
                  Discount: -{formatINR(totals.discountAmount)}
                </span>
              )}
            </div>
          </div>

          {/* MIDDLE: Discount & Payment Received Controls */}
          <div className="space-y-3">
            {/* Discount selector in one row */}
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider shrink-0">
                Discount
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setDiscountType('NONE');
                    setDiscountValue('');
                  }}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${
                    discountType === 'NONE'
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  None
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('FLAT')}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${
                    discountType === 'FLAT'
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  ₹ Flat
                </button>
                <button
                  type="button"
                  onClick={() => setDiscountType('PERCENT')}
                  className={`px-2 py-1 rounded-md text-[11px] font-semibold border ${
                    discountType === 'PERCENT'
                      ? 'bg-primary text-white border-primary'
                      : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  % Off
                </button>

                {discountType !== 'NONE' && (
                  <input
                    type="number"
                    step="any"
                    placeholder={discountType === 'FLAT' ? '₹' : '%'}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    className="w-16 h-7 px-1.5 rounded border border-slate-300 text-xs font-bold text-right"
                  />
                )}
              </div>
            </div>

            {/* Payment Received Input + Paid in full pill */}
            <div className="space-y-1 p-2.5 rounded-xl bg-slate-50 border border-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">Received Amount</span>
                {totals.total.greaterThan(0) && (
                  <button
                    type="button"
                    onClick={handlePaidInFull}
                    className="text-[11px] font-bold text-primary hover:underline px-1.5 py-0.5 rounded bg-blue-100/60"
                  >
                    1-Tap Paid in Full
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <AmountInput
                  value={paidNow}
                  onChange={setPaidNow}
                  placeholder="0.00"
                  className="h-10 text-base font-bold bg-white"
                />

                <div className="shrink-0">
                  {totals.balance.isZero() && totals.total.greaterThan(0) ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-100 text-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                      Paid
                    </span>
                  ) : totals.balance.greaterThan(0) ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-100 text-amber-900">
                      Due: {formatINR(totals.balance)}
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            {/* Payment Mode Selector: 5 Compact Grid Buttons */}
            <div>
              <div className="text-[11px] font-bold text-slate-600 mb-1">
                Payment Mode (Bank / Cash)
              </div>
              <div className="grid grid-cols-5 gap-1">
                {PAYMENT_MODES.map((m) => {
                  const IconComp = m.icon;
                  const isSelected = paymentMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMode(m.id)}
                      className={`py-1.5 px-1 rounded-xl border text-[11px] font-semibold flex flex-col items-center justify-center gap-0.5 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-primary text-white border-primary shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <IconComp className="w-3.5 h-3.5" />
                      <span className="truncate">{m.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quick Invoice Notes Toggle */}
            <div>
              <button
                type="button"
                onClick={() => setShowNotes(!showNotes)}
                className="text-[11px] font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1"
              >
                {showNotes ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                <span>{showNotes ? 'Hide notes & custom dates' : '+ Custom date & notes'}</span>
              </button>

              {showNotes && (
                <div className="pt-1.5 space-y-1.5 text-xs">
                  <div className="grid grid-cols-2 gap-1.5">
                    <Input
                      type="date"
                      value={invoiceDate}
                      onChange={(e) => setInvoiceDate(e.target.value)}
                      className="h-7 text-[11px]"
                    />
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="h-7 text-[11px]"
                    />
                  </div>
                  <input
                    type="text"
                    placeholder="Invoice notes / remarks..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full h-7 px-2 text-xs rounded border border-slate-200"
                  />
                </div>
              )}
            </div>
          </div>

          {/* BOTTOM: Permanently Visible Action Buttons */}
          <div className="space-y-2 pt-2 border-t border-slate-100">
            {/* Primary Save Button */}
            <Button
              type="button"
              variant="primary"
              onClick={() => handleSave(false)}
              loading={saving}
              className="w-full h-12 rounded-xl bg-primary hover:bg-primary-hover text-white text-base font-extrabold shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <Zap className="w-5 h-5 fill-white" />
              <span>Save Bill ({formatINR(totals.total)})</span>
            </Button>

            {/* Secondary Buttons Row */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleSave(true)}
                loading={saving}
                className="flex-1 h-9 rounded-xl border-primary text-primary font-bold text-xs hover:bg-primary/5 cursor-pointer"
              >
                Save & New Bill
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/bills')}
                className="h-9 px-4 rounded-xl text-slate-600 border-slate-200 text-xs cursor-pointer"
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* SUCCESS SHEET / WHATSAPP SHARE */}
      {savedInvoice && (
        <Sheet
          open={isSuccessSheetOpen}
          onOpenChange={(open) => {
            setIsSuccessSheetOpen(open);
            if (!open) navigate('/bills');
          }}
          title="Bill Created Successfully!"
        >
          <div className="space-y-5 py-2 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div>
              <div className="text-2xl font-black text-slate-900">
                {formatINR(savedInvoice.total)}
              </div>
              <p className="text-sm font-semibold text-slate-600 mt-1">
                Bill #{savedInvoice.number} · {savedInvoice.party_name}
              </p>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl text-left text-xs space-y-2 border border-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-500">Party</span>
                <span className="font-semibold text-slate-800">{savedInvoice.party_name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Paid Amount</span>
                <span className="font-semibold text-emerald-600">
                  {formatINR(savedInvoice.paid_amount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Balance Due</span>
                <span className="font-bold text-slate-900">
                  {formatINR(savedInvoice.balance)}
                </span>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              {savedInvoice.party_mobile && (
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold h-11 rounded-xl"
                  onClick={() => {
                    const waUrl = getWhatsAppUrl(
                      savedInvoice.party_mobile,
                      `Hello ${savedInvoice.party_name}, your bill #${savedInvoice.number} for ${formatINR(
                        savedInvoice.total
                      )} has been generated. Thank you!`
                    );
                    window.open(waUrl, '_blank');
                  }}
                >
                  Share Invoice on WhatsApp
                </Button>
              )}

              <Button
                variant="outline"
                className="w-full h-11 rounded-xl"
                onClick={() => navigate('/bills')}
              >
                Go to Bills List
              </Button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
};
