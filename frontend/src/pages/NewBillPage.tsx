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
import { Card } from '../components/ui/Card';
import { Sheet } from '../components/ui/Sheet';
import { useToast } from '../components/ui/Toast';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Briefcase,
  User,
  FileText,
  CreditCard,
  Building,
  Smartphone,
  Banknote,
  Receipt,
  CheckCircle2,
  AlertCircle,
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
  { id: 'BANK', label: 'Bank Transfer', icon: Building },
  { id: 'UPI', label: 'UPI (GPay/PhonePe)', icon: Smartphone },
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
  const availableRegularServices = (frequentServices.length > 0 ? frequentServices : services).filter((s) => !s.is_job_type);

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
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-3 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-primary flex items-center justify-center font-bold">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              {t('billing.new_bill')}
            </h1>
            <p className="text-xs text-slate-500">
              {formatInputDate()} · India FY {getFYLabel()}
            </p>
          </div>
        </div>

        {/* Live Total Amount Badge */}
        <div className="bg-blue-50/80 border border-blue-100 rounded-xl px-4 py-2 text-right shrink-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-primary/80">
            Total Amount
          </div>
          <div className="text-xl sm:text-2xl font-black text-primary">
            {formatINR(totals.total)}
          </div>
        </div>
      </div>

      {/* 1. CUSTOMER SECTION */}
      <Card className="p-4 sm:p-5 rounded-2xl border-slate-200 shadow-2xs space-y-3.5 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              {t('billing.customer')}
            </h2>
          </div>

          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => {
                setIsWalkIn(true);
                setSelectedCustomerId(null);
              }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                isWalkIn ? 'bg-white text-primary shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {t('billing.walk_in')}
            </button>
            <button
              type="button"
              onClick={() => setIsWalkIn(false)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                !isWalkIn ? 'bg-white text-primary shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Select Existing
            </button>
          </div>
        </div>

        {isWalkIn ? (
          <div className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Customer Name
                </label>
                <Input
                  placeholder="Enter name (e.g. Ramesh Kumar)"
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                  className="h-10 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  10-Digit Mobile Number
                </label>
                <Input
                  placeholder="Enter mobile (e.g. 9876543210)"
                  type="tel"
                  inputMode="tel"
                  value={walkInMobile}
                  onChange={(e) => setWalkInMobile(e.target.value)}
                  className="h-10 text-sm"
                />
              </div>
            </div>

            <p className="text-[11px] text-slate-500 flex items-center gap-1.5 pt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span>
                Optional if paid in full; required if bill has due balance or jobs in tracking queue.
              </span>
            </p>
          </div>
        ) : (
          <div>
            <label className="text-xs font-semibold text-slate-700 block mb-1">
              Choose Existing Customer
            </label>
            <select
              value={selectedCustomerId || ''}
              onChange={(e) => setSelectedCustomerId(e.target.value || null)}
              className="w-full h-11 px-3.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 shadow-2xs focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="">-- Choose Customer from Directory --</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.mobile ? `(${c.mobile})` : ''} - {c.type}
                </option>
              ))}
            </select>
          </div>
        )}
      </Card>

      {/* 2. MULTI-STEP JOB SERVICES SECTION (LIVE WORK QUEUE TRACKING) */}
      <Card className="p-4 sm:p-5 rounded-2xl border-blue-200/80 bg-blue-50/20 shadow-2xs space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2 border-b border-blue-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-100 text-primary flex items-center justify-center">
              <Briefcase className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                Job Services (Live Workflow Tracking)
              </h2>
              <p className="text-[11px] text-slate-500">
                Multi-step services auto-create tracked jobs with deadlines & WhatsApp status updates
              </p>
            </div>
          </div>

          <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-100 text-primary shrink-0 self-start sm:self-auto">
            {jobItems.length} Job{jobItems.length !== 1 ? 's' : ''} Selected
          </span>
        </div>

        {/* Quick Clickable Job Type Cards */}
        {availableJobServices.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-700">
              Click to Add Job Service:
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {availableJobServices.map((srv) => (
                <button
                  key={srv.id}
                  type="button"
                  onClick={() => handleAddJob(srv)}
                  className="p-2.5 rounded-xl border border-blue-200/90 bg-white hover:bg-blue-50/80 hover:border-primary transition-all text-left shadow-2xs group flex flex-col justify-between cursor-pointer"
                >
                  <div className="flex items-center justify-between w-full mb-1">
                    <span className="w-6 h-6 rounded-md bg-blue-50 text-primary flex items-center justify-center text-xs group-hover:bg-primary group-hover:text-white transition-colors">
                      <Plus className="w-3.5 h-3.5" />
                    </span>
                    {srv.default_rate && (
                      <span className="text-xs font-bold text-slate-900">
                        {formatINR(srv.default_rate)}
                      </span>
                    )}
                  </div>
                  <div className="font-semibold text-xs text-slate-800 line-clamp-1 group-hover:text-primary">
                    {srv.name}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Added Job Items List */}
        {jobItems.length > 0 ? (
          <div className="space-y-2.5 pt-1">
            <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
              Jobs In This Bill:
            </div>
            {jobItems.map((job, idx) => (
              <div
                key={job.id}
                className="p-3 sm:p-3.5 rounded-xl border border-blue-200 bg-white shadow-2xs space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-md bg-blue-100 text-primary font-bold text-xs flex items-center justify-center">
                      J{idx + 1}
                    </span>
                    <span className="font-bold text-slate-900 text-sm">
                      {job.job_type_name}
                    </span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      ⚡ Queue Tracking
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRemoveJob(job.id)}
                    className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove Job"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Job Inputs: Applicant Name & Service Rate */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div className="sm:col-span-2">
                    <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                      Applicant Name (Candidate / Order Holder)
                    </label>
                    <Input
                      placeholder="e.g. Meena Kumari"
                      value={job.applicant_name}
                      onChange={(e) => handleUpdateJob(job.id, { applicant_name: e.target.value })}
                      className="h-9 text-xs"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-0.5">
                      Fee / Rate (₹)
                    </label>
                    <Input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={job.rate}
                      onChange={(e) => handleUpdateJob(job.id, { rate: e.target.value })}
                      className="h-9 text-xs font-bold text-right"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-3 rounded-xl border border-dashed border-blue-200 bg-white/60 text-center text-xs text-slate-500">
            No workflow jobs added yet. Click any job service card above to add to the tracking queue.
          </div>
        )}
      </Card>

      {/* 3. REGULAR PRODUCTS & SERVICES SECTION */}
      <Card className="p-4 sm:p-5 rounded-2xl border-slate-200 shadow-2xs space-y-3.5 bg-white">
        <div className="flex items-center justify-between pb-2 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                Bill Items & Regular Services
              </h2>
              <p className="text-[11px] text-slate-500">
                Photocopy, printout, stationery, lamination, typing, stamp paper etc.
              </p>
            </div>
          </div>

          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => handleAddRegularItem()}
            className="text-xs font-semibold h-8 border-primary/40 text-primary hover:bg-primary/5"
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            Add Item
          </Button>
        </div>

        {/* Quick Chips for Regular Services */}
        {availableRegularServices.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-600">Quick Items:</div>
            <div className="flex flex-wrap gap-1.5">
              {availableRegularServices.map((srv) => (
                <button
                  key={srv.id}
                  type="button"
                  onClick={() => handleAddRegularItem(srv)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300 text-xs font-medium text-slate-800 shadow-2xs transition-all cursor-pointer"
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
          </div>
        )}

        {/* Regular Items Table */}
        <div className="space-y-2 pt-1">
          {regularItems.map((item, idx) => {
            const lineAmt = computeLineAmount(item.quantity, item.rate);
            return (
              <div
                key={item.id}
                className="p-3 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition-all shadow-2xs space-y-2"
              >
                <div className="grid grid-cols-12 gap-2.5 items-center">
                  <div className="col-span-1 text-xs font-bold text-slate-400 text-center">
                    {idx + 1}
                  </div>

                  <div className="col-span-6 sm:col-span-5">
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
                      className="w-full h-10 px-3 rounded-lg border border-slate-200 text-xs sm:text-sm text-slate-800 focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="col-span-2">
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="Qty"
                      value={item.quantity}
                      onChange={(e) => handleUpdateRegularItem(item.id, { quantity: e.target.value })}
                      className="w-full h-10 px-2 rounded-lg border border-slate-200 text-xs sm:text-sm font-semibold text-center text-slate-800 focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="col-span-2 sm:col-span-2">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="Rate (₹)"
                      value={item.rate}
                      onChange={(e) => handleUpdateRegularItem(item.id, { rate: e.target.value })}
                      className="w-full h-10 px-2 rounded-lg border border-slate-200 text-xs sm:text-sm font-semibold text-right text-slate-800 focus:border-primary focus:outline-none"
                    />
                  </div>

                  <div className="col-span-1 sm:col-span-2 flex items-center justify-end gap-2">
                    <div className="hidden sm:block font-bold text-sm text-slate-900 text-right w-16 truncate">
                      {formatINR(lineAmt)}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveRegularItem(item.id)}
                      className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remove Item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          <div className="pt-1">
            <button
              type="button"
              onClick={() => handleAddRegularItem()}
              className="text-xs font-semibold text-primary hover:underline flex items-center gap-1.5 py-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Another Product / Item</span>
            </button>
          </div>
        </div>
      </Card>

      {/* 4. BILL SUMMARY & DISCOUNT */}
      <Card className="p-4 sm:p-5 rounded-2xl border-slate-200 shadow-2xs space-y-4 bg-white">
        <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
          Bill Summary
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
          {/* Discount options */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 block">
              Discount
            </label>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setDiscountType('NONE');
                  setDiscountValue('');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  discountType === 'NONE'
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                No Discount
              </button>
              <button
                type="button"
                onClick={() => setDiscountType('FLAT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  discountType === 'FLAT'
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                ₹ Flat
              </button>
              <button
                type="button"
                onClick={() => setDiscountType('PERCENT')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  discountType === 'PERCENT'
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                % Percent
              </button>
            </div>

            {discountType !== 'NONE' && (
              <div className="w-36 pt-1">
                <Input
                  type="number"
                  step="any"
                  placeholder={discountType === 'FLAT' ? '₹ Amount' : 'Percentage %'}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            )}
          </div>

          {/* Subtotal & Total Display */}
          <div className="space-y-1.5 text-right sm:border-l sm:border-slate-200 sm:pl-6">
            <div className="flex justify-between sm:justify-end gap-6 text-xs text-slate-600">
              <span>Subtotal</span>
              <span className="font-semibold">{formatINR(totals.subtotal)}</span>
            </div>

            {totals.discountAmount.greaterThan(0) && (
              <div className="flex justify-between sm:justify-end gap-6 text-xs text-emerald-600 font-semibold">
                <span>Discount</span>
                <span>-{formatINR(totals.discountAmount)}</span>
              </div>
            )}

            <div className="flex justify-between sm:justify-end gap-6 text-lg sm:text-xl font-black text-slate-900 pt-1 border-t border-slate-100">
              <span>Total Amount</span>
              <span className="text-primary">{formatINR(totals.total)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* 5. PAYMENT RECEIVED & BANK / CASH MANAGEMENT */}
      <Card className="p-4 sm:p-5 rounded-2xl border-slate-200 shadow-2xs space-y-4 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Banknote className="w-4 h-4 text-emerald-600" />
            <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Payment Received
            </h2>
          </div>

          {totals.balance.isZero() && totals.total.greaterThan(0) ? (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              Paid in Full
            </span>
          ) : totals.balance.greaterThan(0) ? (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300">
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
              Due Balance: {formatINR(totals.balance)}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 items-end">
          {/* Amount Paid input */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700">Received Amount (₹)</label>
              {totals.total.greaterThan(0) && (
                <button
                  type="button"
                  onClick={handlePaidInFull}
                  className="text-[11px] font-bold text-primary hover:underline"
                >
                  Paid in Full
                </button>
              )}
            </div>
            <AmountInput
              value={paidNow}
              onChange={setPaidNow}
              placeholder="0.00"
              className="h-11 text-base font-bold"
            />
          </div>

          {/* Payment Mode Selector */}
          <div className="space-y-1 sm:col-span-2">
            <label className="text-xs font-semibold text-slate-700 block">
              Payment Mode (Cash / Bank / Online)
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
              {PAYMENT_MODES.map((m) => {
                const IconComponent = m.icon;
                const isSelected = paymentMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMode(m.id)}
                    className={`py-2 px-1.5 rounded-xl border text-xs font-semibold flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-primary text-white border-primary shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <IconComponent className="w-4 h-4" />
                    <span className="text-[11px] truncate w-full text-center">{m.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* 6. ADDITIONAL DETAILS (OPTIONAL) */}
      <div className="border border-slate-200 rounded-xl bg-white overflow-hidden shadow-2xs">
        <button
          type="button"
          onClick={() => setShowNotes(!showNotes)}
          className="w-full p-3.5 text-left font-semibold text-xs text-slate-700 flex items-center justify-between hover:bg-slate-50"
        >
          <span>Additional Details (Invoice Date, Due Date, Notes)</span>
          {showNotes ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showNotes && (
          <div className="p-4 border-t border-slate-100 space-y-3 bg-slate-50/50">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">
                  Invoice Date
                </label>
                <Input
                  type="date"
                  value={invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 block mb-1">Due Date</label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-700 block mb-1">
                Terms / Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes or terms printed on invoice..."
                rows={2}
                className="w-full p-2.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:border-primary"
              />
            </div>
          </div>
        )}
      </div>

      {/* BOTTOM ACTION BAR */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate('/bills')}
          className="h-11 px-5 rounded-xl text-slate-700 border-slate-300"
        >
          {t('common.cancel')}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => handleSave(true)}
          loading={saving}
          className="h-11 px-5 rounded-xl border-primary text-primary hover:bg-primary/5 font-bold"
        >
          Save & New
        </Button>

        <Button
          type="button"
          variant="primary"
          onClick={() => handleSave(false)}
          loading={saving}
          className="h-11 px-7 rounded-xl bg-primary hover:bg-primary-hover text-white font-bold shadow-xs text-sm"
        >
          Save Bill ({formatINR(totals.total)})
        </Button>
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
