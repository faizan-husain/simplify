import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { computeBillTotals, computeLineAmount, formatINR, validateQuantityPrecision } from '../lib/money';
import { formatInputDate, getFYLabel } from '../lib/dates';
import { addDays, parseISO } from 'date-fns';
import { normaliseMobile, isValidIndianMobile } from '../lib/auth';
import { getErrorMessage } from '../i18n';
import { generateIdempotencyKey, formatConcurrencyError } from '../lib/idempotency';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../context/AuthContext';
import { QRCodeSVG } from 'qrcode.react';
import { BillDetailModal } from '../components/bills/BillDetailModal';
import { AddNewCustomerModal } from '../components/bills/AddNewCustomerModal';
import { ReceivePaymentSheet } from '../components/receipts/ReceivePaymentSheet';
import { ReceiptDetailModal } from '../components/receipts/ReceiptDetailModal';
import { useKeyboardShortcuts } from '../context/KeyboardShortcutContext';
import { Kbd } from '../components/ui/Kbd';
import { Select } from '../components/ui/Select';
import {
  CreditCard,
  Building,
  Smartphone,
  Banknote,
  Receipt,
  Search,
  Check,
  Briefcase,
  Copy,
  RotateCcw,
  User,
  UserCheck,
  X,
  Plus,
} from 'lucide-react';
import { Database } from '../types/supabase';

type Service = Database['public']['Tables']['services']['Row'];
type Customer = Database['public']['Tables']['customers']['Row'];
type Invoice = Database['public']['Tables']['invoices']['Row'];
type InvoiceItem = Database['public']['Tables']['invoice_items']['Row'];

interface BillItemState {
  id: string;
  service_id?: string | null;
  description: string;
  particular: string; // Applicant / Order details
  create_job: boolean; // Default true for job tracking
  quantity: string;
  rate: string;
}

const DRAFT_STORAGE_KEY = 'simplify_new_bill_draft_v7';
const LAST_PAYMENT_MODE_KEY = 'simplify_last_payment_mode';

const PAYMENT_MODES = [
  { id: 'CASH', label: 'Cash', icon: Banknote },
  { id: 'UPI', label: 'UPI', icon: Smartphone },
  { id: 'CARD', label: 'Card', icon: CreditCard },
  { id: 'BANK', label: 'Bank', icon: Building },
  { id: 'CHEQUE', label: 'Cheque', icon: Receipt },
] as const;

export const NewBillPage: React.FC = () => {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [searchParams] = useSearchParams();
  const editInvoiceId = params.id || searchParams.get('edit') || null;

  const { business } = useAuth();
  const { showToast } = useToast();
  const jobsScrollRef = useRef<HTMLDivElement>(null);

  // Prevent vertical page scroll when mouse-scrolling over the horizontal frequent items capsule bar
  useEffect(() => {
    const el = jobsScrollRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
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
  }, []);

  // Edit mode state
  const [editingInvoiceNumber, setEditingInvoiceNumber] = useState<string | null>(null);
  const [editingInvoiceUpdatedAt, setEditingInvoiceUpdatedAt] = useState<string | null>(null);
  const [nextInvoiceNumber, setNextInvoiceNumber] = useState<string>('INV-1001');
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);
  const [draftSaved, setDraftSaved] = useState(false);

  // Reference data
  const [services, setServices] = useState<Service[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerBalances, setCustomerBalances] = useState<Record<string, number>>({});

  // Customer State: ONLY 2 Concepts (Walk-in vs Regular)
  const { registerSaveHandler } = useKeyboardShortcuts();
  const walkInNameRef = useRef<HTMLInputElement>(null);
  const customerSearchRef = useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey('bill'));

  const [isWalkIn, setIsWalkIn] = useState(true); // Default Walk-in for rapid POS billing
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [walkInName, setWalkInName] = useState('');
  const [walkInMobile, setWalkInMobile] = useState('');
  const [showCustomerSearch, setShowCustomerSearch] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [isAddCustomerModalOpen, setIsAddCustomerModalOpen] = useState(false);

  // Auto-focus customer input on mount
  useEffect(() => {
    if (!editInvoiceId) {
      setTimeout(() => {
        if (isWalkIn) {
          walkInNameRef.current?.focus();
        } else {
          customerSearchRef.current?.focus();
        }
      }, 100);
    }
  }, [editInvoiceId]);

  // Single unified items list
  const [items, setItems] = useState<BillItemState[]>([
    {
      id: '1',
      description: '',
      particular: '',
      create_job: true, // Default ALWAYS true per user requirement
      quantity: '1',
      rate: '',
    },
  ]);

  // Discount state
  const [discountType, setDiscountType] = useState<'NONE' | 'FLAT' | 'PERCENT'>('NONE');
  const [discountValue, setDiscountValue] = useState('');

  // Payment state
  const [paidNow, setPaidNow] = useState('');
  const [paymentMode, setPaymentMode] = useState<string>('UPI');
  const [bankAccounts, setBankAccounts] = useState<
    Array<{
      id: string;
      bank_name: string;
      account_name: string;
      account_number?: string | null;
      upi_id?: string | null;
    }>
  >([]);
  const [selectedBankId, setSelectedBankId] = useState<string>('');

  // Dates and Notes
  const [invoiceDate, setInvoiceDate] = useState(formatInputDate());
  const [dueDate, setDueDate] = useState(() => {
    const terms = Number(business?.default_terms_days) || 0;
    return terms > 0 ? formatInputDate(addDays(new Date(), terms)) : formatInputDate();
  });
  const [notes, setNotes] = useState('');
  const [showNotes, setShowNotes] = useState(false);

  // Sync default due date based on business terms (e.g. Invoice Date + default_terms_days)
  useEffect(() => {
    if (!editInvoiceId && business) {
      const terms = Number(business.default_terms_days) || 0;
      if (terms > 0) {
        try {
          const invD = invoiceDate ? parseISO(invoiceDate) : new Date();
          setDueDate(formatInputDate(addDays(invD, terms)));
        } catch {}
      }
    }
  }, [business?.default_terms_days, editInvoiceId]);

  const handleInvoiceDateChange = (newDate: string) => {
    setInvoiceDate(newDate);
    if (!editInvoiceId) {
      const terms = Number(business?.default_terms_days) || 0;
      if (terms > 0) {
        try {
          const invD = newDate ? parseISO(newDate) : new Date();
          setDueDate(formatInputDate(addDays(invD, terms)));
        } catch {
          setDueDate(newDate);
        }
      } else {
        setDueDate(newDate);
      }
    }
  };

  // Status & Bill Detail Modal
  const [saving, setSaving] = useState(false);
  const [savedInvoice, setSavedInvoice] = useState<(Invoice & { invoice_items?: InvoiceItem[] }) | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Receive payment sheet state from modal shortcut
  const [isReceivePaymentOpen, setIsReceivePaymentOpen] = useState(false);
  const [receivePaymentInvoice, setReceivePaymentInvoice] = useState<Invoice | null>(null);
  const [selectedReceiptDetailId, setSelectedReceiptDetailId] = useState<string | null>(null);

  const resetForm = () => {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    setItems([
      {
        id: Math.random().toString(36).substring(2, 9),
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
    setShowNotes(false);
    setIsWalkIn(true);
    setSelectedCustomerId(null);
    const today = formatInputDate();
    setInvoiceDate(today);
    const terms = Number(business?.default_terms_days) || 0;
    setDueDate(terms > 0 ? formatInputDate(addDays(new Date(), terms)) : today);
  };

  // Fetch next invoice number preview & customer balances
  useEffect(() => {
    supabase
      .from('invoices')
      .select('number')
      .order('created_at', { ascending: false })
      .limit(1)
      .then(({ data }) => {
        if (data && data.length > 0 && data[0].number) {
          const match = data[0].number.match(/(\d+)$/);
          if (match) {
            const nextNum = parseInt(match[1], 10) + 1;
            const prefix = data[0].number.slice(0, match.index);
            setNextInvoiceNumber(`${prefix}${nextNum}`);
          } else {
            setNextInvoiceNumber(data[0].number);
          }
        }
      });

    // Customer dues across invoices
    supabase
      .from('invoices')
      .select('customer_id, total, paid_amount')
      .eq('status', 'ACTIVE')
      .not('customer_id', 'is', null)
      .then(({ data }) => {
        if (data) {
          const dues: Record<string, number> = {};
          data.forEach((inv: any) => {
            const bal = Math.max(0, Number(inv.total || 0) - Number(inv.paid_amount || 0));
            if (bal > 0 && inv.customer_id) {
              dues[inv.customer_id] = (dues[inv.customer_id] || 0) + bal;
            }
          });
          setCustomerBalances(dues);
        }
      });
  }, []);

  // Load services, customers, bank accounts
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

    supabase
      .from('bank_accounts')
      .select('id, bank_name, account_name, account_number, upi_id')
      .is('deleted_at', null)
      .order('bank_name')
      .then(({ data }) => {
        const list = (data as any) || [];
        setBankAccounts(list);
        if (list.length > 0) {
          setSelectedBankId(list[0].id);
        }
      });

    // Check saved draft only if not editing
    if (!editInvoiceId) {
      const draft = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (draft) {
        try {
          const parsed = JSON.parse(draft);
          if (parsed.items && parsed.items.length > 0) setItems(parsed.items);
          if (parsed.isWalkIn !== undefined) setIsWalkIn(parsed.isWalkIn);
          if (parsed.selectedCustomerId) setSelectedCustomerId(parsed.selectedCustomerId);
          if (parsed.walkInName) setWalkInName(parsed.walkInName);
          if (parsed.walkInMobile) setWalkInMobile(parsed.walkInMobile);
          if (parsed.discountType) setDiscountType(parsed.discountType);
          if (parsed.discountValue) setDiscountValue(parsed.discountValue);
          if (parsed.paidNow) setPaidNow(parsed.paidNow);
          if (parsed.notes) {
            setNotes(parsed.notes);
            setShowNotes(true);
          }
          setDraftSaved(true);
        } catch (e) {}
      }
    }
  }, [editInvoiceId]);

  // Load existing invoice for editing
  useEffect(() => {
    if (!editInvoiceId) return;

    let isMounted = true;
    setLoadingEdit(true);

    const loadInvoice = async () => {
      try {
        const { data: inv, error: invError } = await supabase
          .from('invoices')
          .select('*')
          .eq('id', editInvoiceId)
          .single();

        if (invError || !inv) {
          showToast('Invoice not found', 'error');
          navigate('/bills');
          return;
        }

        setEditingInvoiceUpdatedAt(inv.updated_at);

        if (inv.status === 'CANCELLED') {
          showToast('Cancelled bills cannot be edited', 'error');
          navigate('/bills');
          return;
        }

        // Check if any job steps are already ticked
        const { data: jobs } = await supabase
          .from('jobs')
          .select('id, job_steps(id, ticked)')
          .eq('invoice_id', editInvoiceId);

        const hasTickedSteps = (jobs || []).some((j: any) =>
          (j.job_steps || []).some((s: any) => s.ticked)
        );

        if (hasTickedSteps) {
          showToast('This bill has jobs with progressed steps and cannot be edited.', 'error');
          navigate('/bills');
          return;
        }

        // Fetch invoice items
        const { data: rawItems } = await supabase
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', editInvoiceId);

        // Fetch existing upfront receipt details if any (robustly query allocations & receipt)
        let existingReceipt: any = null;
        try {
          const { data: allocations } = await supabase
            .from('receipt_allocations')
            .select('amount, receipt_id')
            .eq('invoice_id', editInvoiceId);

          if (allocations && allocations.length > 0 && allocations[0].receipt_id) {
            const { data: rcpt } = await supabase
              .from('receipts')
              .select('id, mode, bank_account_id, amount')
              .eq('id', allocations[0].receipt_id)
              .maybeSingle();
            if (rcpt) {
              existingReceipt = rcpt;
            }
          }
        } catch (e) {
          console.warn('Failed to load receipt details for edit:', e);
        }

        if (!isMounted) return;

        setEditingInvoiceNumber(inv.number);
        setInvoiceDate(inv.invoice_date);
        setDueDate(inv.due_date || inv.invoice_date);
        setNotes(inv.notes || '');
        if (inv.notes) setShowNotes(true);
        setDiscountType((inv.discount_type as any) || 'NONE');
        setDiscountValue(inv.discount_value ? String(inv.discount_value) : '');

        // Preserve paid amount, payment mode and bank account with 100% accuracy
        const currentPaid = Number(inv.paid_amount || 0);
        if (currentPaid > 0 || (existingReceipt && Number(existingReceipt.amount || 0) > 0)) {
          const amountToSet = currentPaid > 0 ? currentPaid : Number(existingReceipt.amount || 0);
          setPaidNow(String(amountToSet));

          const modeToSet = existingReceipt?.mode ? String(existingReceipt.mode).toUpperCase() : 'UPI';
          setPaymentMode(modeToSet);

          if (existingReceipt?.bank_account_id) {
            setSelectedBankId(existingReceipt.bank_account_id);
          } else if (modeToSet !== 'CASH' && bankAccounts.length > 0) {
            setSelectedBankId(bankAccounts[0].id);
          }
        } else {
          setPaidNow('');
        }

        if (inv.customer_id) {
          setIsWalkIn(false);
          setSelectedCustomerId(inv.customer_id);
          setWalkInName('');
          setWalkInMobile('');
        } else {
          setIsWalkIn(true);
          setSelectedCustomerId(null);
          setWalkInName(inv.party_name && inv.party_name !== 'Walk-in' ? inv.party_name : '');
          setWalkInMobile(inv.party_mobile || '');
        }

        if (rawItems && rawItems.length > 0) {
          setItems(
            rawItems.map((it: any) => ({
              id: it.id,
              service_id: it.service_id,
              description: it.description || '',
              particular: it.applicant_name || '',
              create_job: !!it.is_job,
              quantity: String(it.quantity || 1),
              rate: String(it.rate || 0),
            }))
          );
        }
      } catch (err: any) {
        showToast(err.message || 'Failed to load bill', 'error');
        navigate('/bills');
      } finally {
        if (isMounted) setLoadingEdit(false);
      }
    };

    loadInvoice();

    return () => {
      isMounted = false;
    };
  }, [editInvoiceId, navigate, showToast]);

  // Auto-save draft locally on change
  useEffect(() => {
    if (editInvoiceId) return;

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
    setDraftSaved(true);
  }, [
    editInvoiceId,
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

  // Live bill totals
  const allLines = items.map((it) => ({
    quantity: it.quantity || '0',
    rate: it.rate || '0',
  }));
  const totals = computeBillTotals(allLines, discountType, discountValue, paidNow);

  // Does the bill have any tracked jobs?
  const hasTrackedJobs = items.some((it) => it.create_job);

  // Selected customer object for Regular mode
  const selectedCustomerObj = customers.find((c) => c.id === selectedCustomerId);
  const regularCustomers = customers.filter((c) => c.type === 'REGULAR');

  // Filtered customer list for instant type-ahead search
  const filteredCustomerList = useMemo(() => {
    const q = customerSearchQuery.trim().toLowerCase();
    if (!q) return regularCustomers;
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.mobile && c.mobile.includes(q))
    );
  }, [customers, regularCustomers, customerSearchQuery]);

  // Customer display name for summary
  const customerDisplayName = isWalkIn
    ? (walkInName.trim() || 'Walk-in')
    : (selectedCustomerObj?.name || 'Regular Customer');

  // Customer outstanding display
  const customerOutstanding = selectedCustomerObj
    ? (customerBalances[selectedCustomerObj.id] || 0)
    : 0;

  // Initials for avatar
  const customerInitials = (customerDisplayName || 'C')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');

  // Payment mode label
  const currentModeObj = PAYMENT_MODES.find((m) => m.id === paymentMode);
  const currentModeLabel = currentModeObj?.label || paymentMode;

  // Dynamic QR Code computations based on selected bank account
  const selectedBank = bankAccounts.find((b) => b.id === selectedBankId);
  const activeUpiId = selectedBank?.upi_id?.trim() || business?.upi_id?.trim() || 'bservices@upi';
  const qrPayableAmount = Number(paidNow) > 0
    ? Number(paidNow)
    : (totals.balance.greaterThan(0) ? totals.balance.toNumber() : totals.total.toNumber());

  const upiQrString = `upi://pay?pa=${encodeURIComponent(activeUpiId)}&pn=${encodeURIComponent(business?.name || 'Simplify Merchant')}&am=${qrPayableAmount.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Bill Payment')}`;

  const handleCopyUpi = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(activeUpiId);
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2000);
      showToast('UPI ID copied to clipboard', 'success');
    }
  };

  // Check duplicate customer by 10-digit mobile
  const checkDuplicateMobile = (mobile: string) => {
    const clean = normaliseMobile(mobile);
    if (!clean || clean.length !== 10) return null;
    return customers.find((c) => c.mobile && normaliseMobile(c.mobile) === clean) || null;
  };

  const walkInDuplicate = isWalkIn ? checkDuplicateMobile(walkInMobile) : null;

  // "Same as previous bill" loader
  const handleSameAsPreviousBill = async () => {
    try {
      const { data: latestInv } = await supabase
        .from('invoices')
        .select('*, invoice_items(*)')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!latestInv) {
        showToast('No previous bill found', 'info');
        return;
      }

      if (latestInv.customer_id) {
        setIsWalkIn(false);
        setSelectedCustomerId(latestInv.customer_id);
        setWalkInName('');
        setWalkInMobile('');
      } else {
        setIsWalkIn(true);
        setSelectedCustomerId(null);
        setWalkInName(latestInv.party_name && latestInv.party_name !== 'Walk-in' ? latestInv.party_name : '');
        setWalkInMobile(latestInv.party_mobile || '');
      }

      if (latestInv.invoice_items && latestInv.invoice_items.length > 0) {
        setItems(
          latestInv.invoice_items.map((it: any) => ({
            id: Math.random().toString(36).substring(2, 9),
            service_id: it.service_id,
            description: it.description || '',
            particular: it.applicant_name || '',
            create_job: !!it.is_job,
            quantity: String(it.quantity || 1),
            rate: String(it.rate || 0),
          }))
        );
      }

      if (latestInv.discount_type && latestInv.discount_type !== 'NONE') {
        setDiscountType(latestInv.discount_type as any);
        setDiscountValue(latestInv.discount_value ? String(latestInv.discount_value) : '');
      }

      showToast('Loaded details from previous bill', 'success');
    } catch (e: any) {
      showToast('Failed to load previous bill', 'error');
    }
  };

  // Item handlers
  const handleAddItem = (service?: Service) => {
    const newItemId = Math.random().toString(36).substring(2, 9);
    const newItem: BillItemState = {
      id: newItemId,
      service_id: service?.id || null,
      description: service?.name || '',
      particular: '',
      create_job: !!service?.is_job_type, // If it's a job service, default ON!
      quantity: '1',
      rate: service?.default_rate ? String(service.default_rate) : '',
    };

    if (items.length === 1 && items[0].description.trim() === '' && !items[0].rate) {
      setItems([newItem]);
    } else {
      setItems((prev) => [...prev, newItem]);
    }

    // Auto-focus new item description field
    setTimeout(() => {
      const el = document.getElementById(`item-desc-${newItemId}`);
      if (el) el.focus();
    }, 60);
  };

  const handleUpdateItem = (id: string, updates: Partial<BillItemState>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...updates } : it)));
  };

  const handleRemoveItem = (id: string) => {
    if (items.length <= 1) {
      setItems([
        {
          id: Math.random().toString(36).substring(2, 9),
          description: '',
          particular: '',
          create_job: false,
          quantity: '1',
          rate: '',
        },
      ]);
      return;
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handlePaidInFull = () => {
    setPaidNow(totals.total.toString());
  };

  const handleSave = useCallback(
    async (saveAndNew = false) => {
      // 1. Collect valid items
      const validItems = items.filter((it) => it.description.trim() !== '');

      if (validItems.length === 0) {
        showToast('Please add at least one item to the bill', 'error');
        return;
      }

      // Check quantity validity: must be at least 0.01 and have at most 2 decimal places
      for (const it of validItems) {
        const valRes = validateQuantityPrecision(it.quantity);
        if (!valRes.valid) {
          showToast(valRes.message || 'Invalid quantity.', 'error');
          return;
        }
      }

      // 2. USER MANDATORY RULE: If ANY item has Job ON, Job Service selection is mandatory!
      const invalidJobItem = validItems.find((it) => it.create_job && !it.description.trim());
      if (invalidJobItem) {
        showToast('Please select or specify a Job Service for all tracked jobs.', 'error');
        return;
      }

      // 3. USER MANDATORY RULE: If ANY item has Job created (create_job = true), Customer Name & 10-digit Mobile are MANDATORY
      const hasJob = validItems.some((it) => it.create_job);
      if (hasJob && isWalkIn && (!walkInName.trim() || !walkInMobile.trim() || !isValidIndianMobile(walkInMobile))) {
        showToast(
          'Customer Name & 10-digit Mobile are mandatory for Job Tracking & WhatsApp updates.',
          'error'
        );
        return;
      }

      // 4. USER MANDATORY RULE: If bill has due balance (totals.balance > 0), Customer Name & 10-digit Mobile are MANDATORY
      if (totals.balance.greaterThan(0)) {
        if (isWalkIn && (!walkInName.trim() || !walkInMobile.trim() || !isValidIndianMobile(walkInMobile))) {
          showToast(
            'Customer Name & 10-digit Mobile are mandatory for bills with due balance.',
            'error'
          );
          return;
        }
        if (!isWalkIn && !selectedCustomerId) {
          showToast('Please select a Regular Customer for dues.', 'error');
          return;
        }
      }

      setSaving(true);
      try {
        // Ensure every job item has a valid service_id in the database so RPC never fails
        const mappedItems = await Promise.all(
          validItems.map(async (it) => {
            let resolvedServiceId =
              it.service_id && it.service_id !== 'null' && it.service_id !== 'undefined'
                ? it.service_id
                : null;

            // Try matching with existing services by name
            if (!resolvedServiceId) {
              const matched = services.find(
                (s) => s.name.toLowerCase().trim() === it.description.toLowerCase().trim()
              );
              if (matched) {
                resolvedServiceId = matched.id;
              }
            }

            // If it's a tracked job and still has no service_id, auto-create the service on the fly
            if (it.create_job && !resolvedServiceId) {
              const { data: newSrv } = await supabase
                .from('services')
                .insert({
                  name: it.description.trim(),
                  is_job_type: true,
                  default_rate: parseFloat(it.rate || '0') || null,
                  active: true,
                })
                .select('*')
                .single();

              if (newSrv) {
                resolvedServiceId = newSrv.id;
                setServices((prev) => [...prev, newSrv as Service]);
              }
            }

            return {
              service_id: resolvedServiceId,
              description: it.description.trim(),
              quantity: parseFloat(it.quantity || '1'),
              rate: parseFloat(it.rate || '0'),
              is_job: it.create_job,
              applicant_name: it.particular.trim() || walkInName.trim() || null,
            };
          })
        );

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
          let bankIdToUse = selectedBankId;
          if (paymentMode !== 'CASH' && !bankIdToUse && bankAccounts.length > 0) {
            bankIdToUse = bankAccounts[0].id;
          }

          if (paymentMode !== 'CASH' && !bankIdToUse) {
            showToast(`Please select a Bank Account for ${paymentMode} payment`, 'error');
            setSaving(false);
            return;
          }

          const selectedBank = bankAccounts.find((b) => b.id === bankIdToUse);
          payload.paid = {
            amount: parseFloat(paidNow),
            mode: paymentMode,
            bank_account_id: paymentMode !== 'CASH' ? bankIdToUse || null : null,
            bank_name: paymentMode !== 'CASH' ? selectedBank?.bank_name || null : null,
          };
          localStorage.setItem(LAST_PAYMENT_MODE_KEY, paymentMode);
        } else if (editInvoiceId) {
          payload.paid = {
            amount: 0,
            mode: 'CASH',
            bank_account_id: null,
            bank_name: null,
          };
        }

        // Attach unique idempotency key to prevent duplicates on double-click or network retry
        payload.idempotency_key = idempotencyKeyRef.current;

        if (editInvoiceId) {
          if (editingInvoiceUpdatedAt) {
            payload.last_updated_at = editingInvoiceUpdatedAt;
          }
          const { error } = await supabase.rpc('update_invoice', {
            p_invoice_id: editInvoiceId,
            payload,
          });
          if (error) throw error;

          idempotencyKeyRef.current = generateIdempotencyKey('bill');
          showToast(`Bill #${editingInvoiceNumber || ''} updated successfully!`, 'success');
          navigate('/bills');
          return;
        }

        const { data, error } = await supabase.rpc('create_invoice', { payload });
        if (error) throw error;

        // Reset idempotency key for next bill
        idempotencyKeyRef.current = generateIdempotencyKey('bill');

        // Clear local draft
        localStorage.removeItem(DRAFT_STORAGE_KEY);

        const targetInvId = data.invoice_id || data.id;

        // Fetch complete invoice data and items
        const { data: invData } = await supabase
          .from('invoices')
          .select('*')
          .eq('id', targetInvId)
          .single();

        const { data: itemsData } = await supabase
          .from('invoice_items')
          .select('*')
          .eq('invoice_id', targetInvId);

        const fullInvoice: Invoice & { invoice_items?: InvoiceItem[] } = {
          ...(invData || data),
          invoice_items: (itemsData as InvoiceItem[]) || [],
        };

        setSavedInvoice(fullInvoice);
        setIsDetailModalOpen(true);
        resetForm();
        showToast(
          saveAndNew
            ? `Bill #${data.number} saved! Ready for next bill.`
            : `Bill #${data.number} created successfully!`,
          'success'
        );
      } catch (err: any) {
        showToast(formatConcurrencyError(err) || getErrorMessage(err.message), 'error');
      } finally {
        setSaving(false);
      }
    },
    [
      items,
      totals,
      isWalkIn,
      walkInName,
      walkInMobile,
      invoiceDate,
      dueDate,
      discountType,
      discountValue,
      notes,
      selectedCustomerId,
      paidNow,
      paymentMode,
      selectedBankId,
      bankAccounts,
      editInvoiceId,
      editingInvoiceNumber,
      services,
      showToast,
      navigate,
    ]
  );

  // Register global save handler for Ctrl+S / Cmd+S
  useEffect(() => {
    const unregister = registerSaveHandler(() => {
      handleSave(false);
    });
    return unregister;
  }, [registerSaveHandler, handleSave]);

  // Keyboard shortcut Ctrl+Enter to save, Ctrl+Shift+S for save & new, Alt+A to add item
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        handleSave(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSave(false);
      } else if (e.altKey && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        handleAddItem();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleAddItem]);

  if (editInvoiceId && loadingEdit) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 select-none">
        <div className="w-7 h-7 border-[2.5px] border-[#0F766E]/20 border-t-[#0F766E] rounded-full animate-spin" />
        <div className="text-xs font-medium text-slate-500">Loading bill details...</div>
      </div>
    );
  }

  const billHeaderNumber = editInvoiceId
    ? `Bill #${editingInvoiceNumber || ''}`
    : nextInvoiceNumber;
  const billHeaderDate = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="w-full max-w-[1340px] mx-auto space-y-4 select-none">
      {/* TOP PAGE HEADER: Title, Date, Subtitle, and Shortcuts */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-[#0F172A] leading-tight">
            {editInvoiceId ? `Edit bill` : 'New bill'}
          </h1>
          <p className="text-[13px] text-[#64748B] font-normal mt-0.5">
            {billHeaderNumber} · {billHeaderDate} · FY {getFYLabel()}
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          {draftSaved && (
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#64748B]">
              <Check className="w-4 h-4 text-[#0F766E]" />
              <span>Draft saved</span>
            </div>
          )}

          {!editInvoiceId && (
            <button
              type="button"
              onClick={handleSameAsPreviousBill}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border-0 bg-white text-[13px] font-medium text-[#0F172A] shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_14px_rgba(0,0,0,0.06)] hover:bg-[#F8FAFC] active:scale-[0.98] transition-all cursor-pointer select-none"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#64748B]" />
              <span>Same as previous bill</span>
            </button>
          )}
        </div>
      </div>

      {/* 2-COLUMN MAIN LAYOUT */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* LEFT COLUMN: Customer + Items + Payment (~65% width) */}
        <div className="lg:col-span-8 space-y-4">
          {/* CARD 1: LUXURY CUSTOMER CARD (Crisp White Card on #F6F7F9 Canvas) */}
          <div className="bg-white border-0 rounded-2xl p-5 sm:p-6 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-3.5">
            <div className="flex items-center justify-between">
              <h2 className="text-[15px] font-bold text-[#0F172A]">Customer</h2>
            </div>

            {/* STATE 1: Selected Customer Preview */}
            {selectedCustomerObj ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-4 rounded-2xl bg-[#F6F7F9] border-0 shadow-2xs">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#E6F4EA] text-[#0F766E] font-bold text-[13px] flex items-center justify-center shrink-0">
                      {customerInitials}
                    </div>
                    <div className="min-w-0">
                      <div className="text-[14.5px] font-bold text-[#0F172A] truncate">
                        {selectedCustomerObj.name}
                      </div>
                      <div className="text-[12.5px] text-[#64748B] mt-0.5 truncate">
                        {selectedCustomerObj.mobile || 'No mobile'} · Outstanding:{' '}
                        <strong className={customerOutstanding > 0 ? 'text-amber-700 font-bold' : 'text-[#0F172A]'}>
                          {formatINR(customerOutstanding)}
                        </strong>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerSearch(true);
                      setCustomerSearchQuery('');
                    }}
                    className="text-[13px] font-semibold text-[#0F766E] hover:underline cursor-pointer shrink-0 ml-2"
                  >
                    Change
                  </button>
                </div>

                {/* Actions below the selected customer card */}
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setIsWalkIn(true);
                      setSelectedCustomerId(null);
                      setShowCustomerSearch(false);
                    }}
                    className="px-4 py-1.5 rounded-full bg-[#EEF0F3] hover:bg-[#E5E8ED] text-[#1E293B] text-[13px] font-medium transition-all cursor-pointer shadow-2xs"
                  >
                    Walk-in
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddCustomerModalOpen(true)}
                    className="px-4 py-1.5 rounded-full bg-[#EEF0F3] hover:bg-[#E5E8ED] text-[#1E293B] text-[13px] font-medium transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#64748B]" />
                    <span>New customer</span>
                  </button>
                </div>
              </div>
            ) : showCustomerSearch ? (
              /* STATE 2: Fast Type-Ahead Customer Search List */
              <div className="space-y-3 animate-in fade-in duration-150">
                {/* Search Input */}
                <div className="relative">
                  <Search className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search regular customer by name or mobile..."
                    value={customerSearchQuery}
                    onChange={(e) => setCustomerSearchQuery(e.target.value)}
                    className="w-full h-11 pl-10 pr-9 rounded-xl border border-[#E2E8F0] bg-white text-[14px] font-medium text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20 focus:outline-none transition-all shadow-2xs"
                  />
                  {customerSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setCustomerSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {/* Instant Filtered Customer List */}
                <div className="max-h-60 overflow-y-auto rounded-xl border border-[#E2E8F0] bg-white divide-y divide-[#F1F5F9] shadow-2xs">
                  {filteredCustomerList.length > 0 ? (
                    filteredCustomerList.map((c) => {
                      const bal = customerBalances[c.id] || 0;
                      const initials = c.name
                        .split(' ')
                        .map((n) => n[0])
                        .join('')
                        .toUpperCase()
                        .slice(0, 2);
                      const isReg = c.type === 'REGULAR';

                      return (
                        <div
                          key={c.id}
                          onClick={() => {
                            setSelectedCustomerId(c.id);
                            setIsWalkIn(false);
                            setShowCustomerSearch(false);
                            setCustomerSearchQuery('');
                          }}
                          className="p-3 hover:bg-[#F8FAFC] transition-colors cursor-pointer flex items-center justify-between gap-3 group"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${
                                isReg
                                  ? 'bg-[#E6F4EA] text-[#0F766E]'
                                  : 'bg-[#FEF3C7] text-amber-800'
                              }`}
                            >
                              {initials}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-[13.5px] text-[#0F172A] group-hover:text-[#0F766E] transition-colors truncate">
                                  {c.name}
                                </span>
                                <span
                                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                    isReg
                                      ? 'bg-emerald-50 text-[#0F766E] border border-emerald-200/60'
                                      : 'bg-amber-50 text-amber-800 border border-amber-200/60'
                                  }`}
                                >
                                  {isReg ? 'Regular' : 'Walk-in'}
                                </span>
                              </div>
                              <div className="text-[12px] text-[#64748B] mt-0.5">
                                {c.mobile || 'No mobile'}
                              </div>
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div
                              className={`text-[12px] font-semibold tabular-nums ${
                                bal > 0 ? 'text-amber-700' : 'text-[#64748B]'
                              }`}
                            >
                              {bal > 0 ? `${formatINR(bal)} due` : 'No dues'}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="p-4 text-center">
                      <p className="text-xs text-slate-500 mb-2">
                        No customers found matching "{customerSearchQuery}"
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setWalkInName(customerSearchQuery);
                          setIsAddCustomerModalOpen(true);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0F766E] text-white text-xs font-semibold shadow-2xs hover:bg-[#0D655E]"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add "{customerSearchQuery}" as customer</span>
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsWalkIn(true);
                        setShowCustomerSearch(false);
                        setCustomerSearchQuery('');
                      }}
                      className="px-4 py-1.5 rounded-full bg-[#EEF0F3] hover:bg-[#E5E8ED] text-[#1E293B] text-[13px] font-medium cursor-pointer shadow-2xs"
                    >
                      Walk-in
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAddCustomerModalOpen(true)}
                      className="px-4 py-1.5 rounded-full bg-[#EEF0F3] hover:bg-[#E5E8ED] text-[#1E293B] text-[13px] font-medium cursor-pointer flex items-center gap-1 shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5 text-[#64748B]" />
                      <span>New customer</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerSearch(false);
                      setCustomerSearchQuery('');
                    }}
                    className="text-[12.5px] text-[#64748B] hover:text-[#0F172A] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              /* STATE 3: Walk-in Mode (Direct Inputs + Suggestions) */
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="relative">
                    <User className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      ref={walkInNameRef}
                      type="text"
                      placeholder={
                        hasTrackedJobs || totals.balance.greaterThan(0)
                          ? 'Customer Name (Required)'
                          : 'Customer Name (Optional if paid)'
                      }
                      value={walkInName}
                      onChange={(e) => setWalkInName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (walkInMobile.trim()) {
                            const firstItemEl = document.getElementById(`item-desc-${items[0]?.id}`);
                            firstItemEl?.focus();
                          } else {
                            const mobileEl = document.getElementById('walkin-mobile-input');
                            mobileEl?.focus();
                          }
                        }
                      }}
                      className={`w-full h-11 pl-10 pr-3.5 rounded-xl border bg-white text-[14px] font-medium text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none transition-all shadow-2xs ${
                        (hasTrackedJobs || totals.balance.greaterThan(0)) && !walkInName.trim()
                          ? 'border-[#0F766E]/40 focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/15'
                          : 'border-[#E2E8F0] focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20'
                      }`}
                    />
                  </div>

                  <div className="relative">
                    <Smartphone className="w-4 h-4 text-[#94A3B8] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="walkin-mobile-input"
                      type="tel"
                      inputMode="tel"
                      placeholder={
                        hasTrackedJobs || totals.balance.greaterThan(0)
                          ? '10-digit Mobile (Required)'
                          : '10-digit Mobile (for WhatsApp)'
                      }
                      value={walkInMobile}
                      onChange={(e) => setWalkInMobile(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const firstItemEl = document.getElementById(`item-desc-${items[0]?.id}`);
                          firstItemEl?.focus();
                        }
                      }}
                      className={`w-full h-11 pl-10 pr-3.5 rounded-xl border bg-white text-[14px] font-medium text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none transition-all shadow-2xs ${
                        (hasTrackedJobs || totals.balance.greaterThan(0)) && (!walkInMobile.trim() || !isValidIndianMobile(walkInMobile))
                          ? 'border-[#0F766E]/40 focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/15'
                          : 'border-[#E2E8F0] focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20'
                      }`}
                    />
                  </div>
                </div>

                {/* Contextual Helpful Hint (Smooth, Border-less, Quiet Luxury) */}
                {(hasTrackedJobs || totals.balance.greaterThan(0)) && (
                  <div className="flex items-center gap-2 text-[12px] text-[#0F766E] bg-[#EAF2F1] px-3.5 py-2 rounded-xl border-0 shadow-[0_1px_4px_rgba(15,118,110,0.06)] animate-in fade-in">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#0F766E] shrink-0" />
                    <span className="font-medium">
                      {hasTrackedJobs
                        ? 'Customer Name & 10-digit Mobile are required for Job Tracking & WhatsApp updates.'
                        : 'Customer Name & 10-digit Mobile are required for bills with due balance.'}
                    </span>
                  </div>
                )}

                {/* LUXURY FOUND CUSTOMER SUGGESTION CARD (Border-less & Smooth) */}
                {walkInDuplicate && (
                  <div className="p-3.5 rounded-2xl bg-[#F6F7F9] border-0 flex items-center justify-between gap-3 text-xs transition-all shadow-2xs animate-in fade-in">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full bg-[#E6F4EA] text-[#0F766E] font-bold text-[12.5px] flex items-center justify-center shrink-0">
                        {walkInDuplicate.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-[13.5px] text-[#0F172A] truncate">
                            {walkInDuplicate.name}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                            {walkInDuplicate.type === 'REGULAR' ? 'Regular Customer' : 'Walk-in'}
                          </span>
                        </div>
                        <div className="text-[12px] text-[#64748B] mt-0.5">
                          {walkInDuplicate.mobile}
                          {customerBalances[walkInDuplicate.id] > 0
                            ? ` · Outstanding: ${formatINR(customerBalances[walkInDuplicate.id])}`
                            : ' · No dues'}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomerId(walkInDuplicate.id);
                        setIsWalkIn(false);
                        setWalkInName(walkInDuplicate.name);
                        setWalkInMobile(walkInDuplicate.mobile || '');
                        showToast(`Selected customer: ${walkInDuplicate.name}`, 'info');
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-[#0F766E] hover:bg-[#0D635C] text-white font-semibold text-[11.5px] shrink-0 cursor-pointer shadow-2xs transition-all active:scale-95"
                    >
                      Use Customer
                    </button>
                  </div>
                )}

                {/* Actions: Choose Regular & + New Customer */}
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCustomerSearch(true);
                      setCustomerSearchQuery('');
                    }}
                    className="px-4 py-1.5 rounded-full bg-[#EEF0F3] hover:bg-[#E5E8ED] text-[#1E293B] text-[13px] font-medium transition-all cursor-pointer shadow-2xs flex items-center gap-1.5"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-[#0F766E]" />
                    <span>Choose Regular</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddCustomerModalOpen(true)}
                    className="px-4 py-1.5 rounded-full bg-[#EEF0F3] hover:bg-[#E5E8ED] text-[#1E293B] text-[13px] font-medium transition-all cursor-pointer flex items-center gap-1 shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5 text-[#64748B]" />
                    <span>New customer</span>
                  </button>
                </div>
              </div>
            )}
          </div>

            {/* CARD 2: ITEMS CARD (Crisp White Card on #F6F7F9 Canvas) */}
            <div className="bg-white border-0 rounded-2xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-4">
              {/* Header with Horizontal Mouse Scrollable Capsule Buttons (Matching Screenshot) */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1">
                <h2 className="text-[15px] font-bold text-[#0F172A]">Items</h2>

                {/* Natural Horizontal Mouse-Wheel Scrollable Capsule Bar (Matching Screenshot) */}
                <div
                  ref={jobsScrollRef}
                  className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 max-w-[500px]"
                  style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', overscrollBehaviorX: 'contain' }}
                >
                  <span className="text-[12px] font-medium text-[#64748B] shrink-0 mr-1 hidden sm:inline">
                    Frequent
                  </span>

                  {services.slice(0, 10).map((srv) => (
                    <button
                      key={srv.id}
                      type="button"
                      onClick={() => handleAddItem(srv)}
                      className="shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#EEF0F3] hover:bg-[#E5E8ED] text-[#1E293B] text-[13px] font-medium transition-all cursor-pointer active:scale-95 shadow-2xs select-none"
                    >
                      {srv.is_job_type && <Briefcase className="w-3.5 h-3.5 text-[#0F766E] shrink-0" />}
                      <span>{srv.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Column Headers (Desktop Only) */}
              <div className="hidden sm:grid grid-cols-12 gap-3 px-1 text-[13px] font-medium text-[#64748B] select-none">
                <div className="col-span-6 sm:col-span-5">Item</div>
                <div className="col-span-2 text-center">Qty</div>
                <div className="col-span-2 text-center">Rate</div>
                <div className="col-span-2 sm:col-span-3 text-right pr-6">Amount</div>
              </div>

              {/* Items List: Clean Light Grey Wells Matching SaaS Quality with Job & Applicant Functionality */}
              <div className="space-y-3">
                {items.map((item) => {
                  const lineAmt = computeLineAmount(item.quantity, item.rate);
                  const isJob = item.create_job;
                  const isJobServiceMissing = isJob && !item.description.trim();

                  return (
                    <div
                      key={item.id}
                      className="p-3.5 sm:p-4 rounded-xl bg-[#F8FAFC] border-0 space-y-3 transition-all"
                    >
                      {/* Mobile Item Layout: Un-cramped, clean multi-line layout with generous inputs */}
                      <div className="sm:hidden flex flex-col gap-2.5">
                        {/* Mobile Row 1: Item / Service input + Delete button */}
                        <div className="flex items-center gap-2">
                          <div className="flex-1 relative flex items-center">
                            {isJob && (
                              <Briefcase className="w-4 h-4 text-[#0F766E] absolute left-3 pointer-events-none shrink-0" />
                            )}
                            <input
                              id={`item-desc-mob-${item.id}`}
                              type="text"
                              list={`service-list-${item.id}`}
                              placeholder={isJob ? 'Select Job Service (Required) *' : 'Service or item name'}
                              value={item.description}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  document.getElementById(`item-qty-mob-${item.id}`)?.focus();
                                }
                              }}
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
                                    create_job: !!matched.is_job_type,
                                  });
                                } else {
                                  handleUpdateItem(item.id, { description: val });
                                }
                              }}
                              className={`w-full h-10 ${isJob ? 'pl-9' : 'pl-3'} pr-3 rounded-xl border bg-white text-[13.5px] font-medium text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none transition-colors shadow-2xs ${
                                isJobServiceMissing
                                  ? 'border-[#0F766E]/40 focus:border-[#0F766E]'
                                  : 'border-[#E2E8F0] focus:border-[#0F766E]'
                              }`}
                            />
                          </div>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.id)}
                              className="p-2 rounded-lg text-[#94A3B8] hover:text-[#EF4444] hover:bg-red-50 transition-colors shrink-0"
                              title="Remove item"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        {/* Mobile Row 2: Qty, Rate, and Line Total Amount */}
                        <div className="flex items-center gap-2.5">
                          <div className="w-20 shrink-0">
                            <label className="block text-[10.5px] font-medium text-[#64748B] mb-0.5">Qty</label>
                            <input
                              id={`item-qty-mob-${item.id}`}
                              type="number"
                              step="0.01"
                              min="0.01"
                              value={item.quantity}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  document.getElementById(`item-rate-mob-${item.id}`)?.focus();
                                }
                              }}
                              onChange={(e) => handleUpdateItem(item.id, { quantity: e.target.value })}
                              className="w-full h-9 px-1 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-semibold text-center text-[#0F172A] focus:border-[#0F766E] focus:outline-none"
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <label className="block text-[10.5px] font-medium text-[#64748B] mb-0.5">Rate (₹)</label>
                            <input
                              id={`item-rate-mob-${item.id}`}
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0"
                              value={item.rate}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const currentIndex = items.findIndex((it) => it.id === item.id);
                                  if (currentIndex === items.length - 1) {
                                    handleAddItem();
                                  } else {
                                    const nextItem = items[currentIndex + 1];
                                    document.getElementById(`item-desc-mob-${nextItem.id}`)?.focus();
                                  }
                                }
                              }}
                              onChange={(e) => handleUpdateItem(item.id, { rate: e.target.value })}
                              className="w-full h-9 px-2 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-semibold text-center text-[#0F172A] tabular-nums focus:border-[#0F766E] focus:outline-none"
                            />
                          </div>
                          <div className="text-right shrink-0 pl-1">
                            <label className="block text-[10.5px] font-medium text-[#64748B] mb-0.5">Amount</label>
                            <div className="h-9 flex items-center justify-end font-bold text-[14.5px] text-[#0F172A] tabular-nums">
                              {formatINR(lineAmt)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Desktop Main Item Row: Item, Qty, Rate, Amount & Delete */}
                      <div className="hidden sm:grid grid-cols-12 gap-3 items-center">
                        {/* Item Service Input */}
                        <div className="col-span-6 sm:col-span-5 relative">
                          <div className="relative flex items-center">
                            {isJob && (
                              <Briefcase className="w-4 h-4 text-[#0F766E] absolute left-3.5 pointer-events-none shrink-0" />
                            )}
                            <input
                              id={`item-desc-${item.id}`}
                              type="text"
                              list={`service-list-${item.id}`}
                              placeholder={isJob ? 'Select Job Service (Required) *' : 'Service or item name'}
                              value={item.description}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  document.getElementById(`item-qty-${item.id}`)?.focus();
                                }
                              }}
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
                                    create_job: !!matched.is_job_type,
                                  });
                                } else {
                                  handleUpdateItem(item.id, { description: val });
                                }
                              }}
                              className={`w-full h-11 ${isJob ? 'pl-10' : 'pl-3.5'} pr-3.5 rounded-xl border bg-white text-[14px] font-medium text-[#0F172A] placeholder:text-[#94A3B8] focus:outline-none transition-colors shadow-2xs ${
                                isJobServiceMissing
                                  ? 'border-[#0F766E]/40 focus:border-[#0F766E] focus:ring-2 focus:ring-[#0F766E]/15'
                                  : 'border-[#E2E8F0] focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20'
                              }`}
                            />
                            <datalist id={`service-list-${item.id}`}>
                              {services.map((s) => (
                                <option key={s.id} value={s.name}>
                                  {s.is_job_type ? '[Job]' : '[Item]'} ₹{s.default_rate || 0}
                                </option>
                              ))}
                            </datalist>
                          </div>
                        </div>

                        {/* Qty Input */}
                        <div className="col-span-2">
                          <input
                            id={`item-qty-${item.id}`}
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={item.quantity}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                document.getElementById(`item-rate-${item.id}`)?.focus();
                              }
                            }}
                            onChange={(e) => handleUpdateItem(item.id, { quantity: e.target.value })}
                            className="w-full h-11 px-2 rounded-xl border border-[#E2E8F0] bg-white text-[14px] font-semibold text-center text-[#0F172A] focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20 focus:outline-none shadow-2xs"
                          />
                        </div>

                        {/* Rate Input */}
                        <div className="col-span-2">
                          <input
                            id={`item-rate-${item.id}`}
                            type="number"
                            step="0.01"
                            min="0"
                            placeholder="0"
                            value={item.rate}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const currentIndex = items.findIndex((it) => it.id === item.id);
                                if (currentIndex === items.length - 1) {
                                  handleAddItem();
                                } else {
                                  const nextItem = items[currentIndex + 1];
                                  document.getElementById(`item-desc-${nextItem.id}`)?.focus();
                                }
                              }
                            }}
                            onChange={(e) => handleUpdateItem(item.id, { rate: e.target.value })}
                            className="w-full h-11 px-2 rounded-xl border border-[#E2E8F0] bg-white text-[14px] font-semibold text-center text-[#0F172A] tabular-nums focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20 focus:outline-none shadow-2xs"
                          />
                        </div>

                        {/* Amount & Delete */}
                        <div className="col-span-2 sm:col-span-3 flex items-center justify-end gap-2 pr-1">
                          <span className="font-bold text-[15px] text-[#0F172A] tabular-nums text-right truncate">
                            {formatINR(lineAmt)}
                          </span>
                          {items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(item.id)}
                              className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#EF4444] hover:bg-red-50 transition-colors cursor-pointer shrink-0"
                              title="Remove item"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Line 2: Applicant (Job ON) / Particular (Job OFF) + Fixed-size Job Toggle */}
                      <div className="flex items-center justify-between gap-3 pt-0.5">
                        <div className="w-full max-w-[300px] sm:max-w-[360px] min-w-0">
                          <input
                            type="text"
                            placeholder={
                              isJob
                                ? 'Applicant Name (e.g. Ramesh Kumar) *'
                                : 'Particular / Notes (Optional)'
                            }
                            value={item.particular}
                            onChange={(e) => handleUpdateItem(item.id, { particular: e.target.value })}
                            className="w-full h-10 px-3.5 rounded-xl border border-[#E2E8F0] bg-white text-[13px] font-medium text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20 focus:outline-none transition-colors shadow-2xs"
                          />
                        </div>

                        {/* Fixed-size iOS-style Job ON/OFF toggle button - spacious & no cutoff */}
                        <button
                          type="button"
                          onClick={() => {
                            if (isJob) {
                              handleUpdateItem(item.id, { create_job: false });
                            } else {
                              handleUpdateItem(item.id, { create_job: true });
                            }
                          }}
                          className={`h-10 w-[136px] shrink-0 px-3 rounded-xl border flex items-center justify-between text-[12px] font-semibold shadow-2xs transition-all cursor-pointer select-none ${
                            isJob
                              ? 'border-[#0F766E]/30 bg-white text-[#0F766E] hover:bg-[#F0FDF9]'
                              : 'border-[#E2E8F0] bg-white text-[#64748B] hover:border-[#CBD5E1] hover:bg-[#F8FAFC]'
                          }`}
                          title={isJob ? 'Job tracking is ON — click to switch OFF' : 'Job tracking is OFF — click to switch ON'}
                        >
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Briefcase className={`w-3.5 h-3.5 shrink-0 ${isJob ? 'text-[#0F766E]' : 'text-[#94A3B8]'}`} />
                            <span className="shrink-0">{isJob ? 'Job: ON' : 'Job: OFF'}</span>
                          </div>
                          <div className={`w-7 h-4 rounded-full p-0.5 transition-colors shrink-0 ${isJob ? 'bg-[#0F766E]' : 'bg-[#CBD5E1]'}`}>
                            <div className={`w-3 h-3 rounded-full bg-white shadow-xs transition-transform ${isJob ? 'translate-x-3' : 'translate-x-0'}`} />
                          </div>
                        </button>
                      </div>
                    </div>
                  );
                })}

                {/* Empty Item Placeholder Row matching screenshot */}
                <div
                  onClick={() => handleAddItem()}
                  className="grid grid-cols-12 gap-3 items-center cursor-pointer group pt-1"
                >
                  <div className="col-span-6 sm:col-span-5">
                    <div className="h-11 rounded-xl border border-[#E2E8F0] bg-white flex items-center px-3.5 text-[#94A3B8] group-hover:border-[#0F766E] group-hover:text-[#0F766E] transition-colors shadow-2xs">
                      <Search className="w-4 h-4 mr-2.5 text-[#94A3B8] shrink-0" />
                      <span className="text-[13.5px] font-normal truncate">Add an item or type a custom one</span>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="h-11 rounded-xl border border-[#E2E8F0] bg-white flex items-center justify-center text-[13.5px] font-medium text-[#94A3B8] shadow-2xs">
                      1
                    </div>
                  </div>
                  <div className="col-span-2">
                    <div className="h-11 rounded-xl border border-[#E2E8F0] bg-white flex items-center justify-center text-[13.5px] font-medium text-[#94A3B8] shadow-2xs">
                      0
                    </div>
                  </div>
                  <div className="col-span-2 sm:col-span-3 flex items-center justify-end pr-6 text-[15px] font-bold text-[#94A3B8]">
                    ₹0
                  </div>
                </div>
              </div>

              {/* Discount Section */}
              <div className="pt-4 border-t border-[#F1F5F9] flex items-center justify-between">
                <span className="text-[14px] font-semibold text-[#0F172A]">Discount</span>

                <div className="flex items-center gap-2.5">
                  <div className="inline-flex bg-[#EEF0F3] p-1 rounded-xl shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setDiscountType('FLAT')}
                      className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
                        discountType === 'FLAT'
                          ? 'bg-white text-[#0F172A] font-semibold shadow-2xs'
                          : 'text-[#64748B] hover:text-[#0F172A]'
                      }`}
                    >
                      ₹
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscountType('PERCENT')}
                      className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all cursor-pointer ${
                        discountType === 'PERCENT'
                          ? 'bg-white text-[#0F172A] font-semibold shadow-2xs'
                          : 'text-[#64748B] hover:text-[#0F172A]'
                      }`}
                    >
                      %
                    </button>
                  </div>

                  <input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="0"
                    value={discountValue}
                    onChange={(e) => {
                      setDiscountValue(e.target.value);
                      if (discountType === 'NONE') setDiscountType('FLAT');
                    }}
                    className="h-11 w-28 sm:w-32 rounded-xl border border-[#E2E8F0] bg-white text-right px-3.5 text-[15px] font-semibold text-[#0F172A] focus:border-[#0F766E] focus:outline-none shadow-2xs"
                  />
                </div>
              </div>
            </div>

            {/* CARD 3: PAYMENT CARD (Crisp White Card on #F6F7F9 Canvas) */}
            <div className="bg-white border-0 rounded-2xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-4">
              <h2 className="text-[15px] font-bold text-[#0F172A]">Payment</h2>

              {/* Payment Mode Pills */}
              <div className="flex items-center gap-2 flex-wrap">
                {PAYMENT_MODES.map((m) => {
                  const isSelected = paymentMode === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setPaymentMode(m.id)}
                      className={`px-4 py-2 rounded-xl text-[13px] font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-white border-2 border-[#0F766E] text-[#0F766E] font-semibold shadow-2xs'
                          : 'bg-[#EEF0F3] border-2 border-transparent text-[#64748B] hover:bg-[#E5E8ED] hover:text-[#0F172A]'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 text-[#0F766E] stroke-[3]" />}
                      <span>{m.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Bank selector when non-cash mode is active */}
              {paymentMode !== 'CASH' && (
                <div className="pt-1">
                  {bankAccounts.length > 0 ? (
                    <Select
                      value={selectedBankId}
                      onChange={setSelectedBankId}
                      options={[
                        { value: '', label: '-- Deposit to Bank Account * --' },
                        ...bankAccounts.map((b) => ({
                          value: b.id,
                          label: `${b.bank_name} (${b.account_name}${b.account_number ? ` - ${b.account_number}` : ''}${b.upi_id ? ` · UPI: ${b.upi_id}` : ''})`,
                        })),
                      ]}
                      placeholder="-- Deposit to Bank Account * --"
                      searchable={bankAccounts.length > 5}
                    />
                  ) : (
                    <div className="text-[12px] text-[#64748B] bg-white p-3 rounded-xl border border-[#E2E8F0] flex items-center justify-between shadow-2xs">
                      <span>No bank account configured.</span>
                      <a href="/money" className="text-[#0F766E] font-medium hover:underline">
                        Add in Money &rarr;
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* Paid Now Section */}
              <div className="space-y-1.5 pt-1">
                <label className="text-[12px] font-medium text-[#64748B]">Paid now</label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] font-semibold text-[#64748B]">
                      ₹
                    </span>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      placeholder="0"
                      value={paidNow}
                      onChange={(e) => setPaidNow(e.target.value)}
                      className="w-full h-11 pl-8 pr-3.5 rounded-xl border border-[#E2E8F0] bg-white text-[18px] font-bold text-[#0F172A] tabular-nums placeholder:text-[#94A3B8] focus:border-[#0F766E] focus:ring-1 focus:ring-[#0F766E]/20 focus:outline-none shadow-2xs"
                    />
                  </div>

                  {totals.total.greaterThan(0) && (
                    <button
                      type="button"
                      onClick={handlePaidInFull}
                      className="h-11 px-4 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F1F3F5] text-[12.5px] font-medium text-[#0F172A] transition-all cursor-pointer shrink-0 shadow-2xs active:scale-95"
                    >
                      Paid in full
                    </button>
                  )}
                </div>
              </div>

              {/* Dates: Date & Due Date side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="text-[12px] font-medium text-[#64748B] block mb-1">Date</label>
                  <input
                    type="date"
                    value={invoiceDate}
                    onChange={(e) => handleInvoiceDateChange(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E2E8F0] bg-white text-[13px] font-medium text-[#0F172A] focus:border-[#0F766E] focus:outline-none shadow-2xs"
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium text-[#64748B] block mb-1">Due date</label>
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-[#E2E8F0] bg-white text-[13px] font-medium text-[#0F172A] focus:border-[#0F766E] focus:outline-none shadow-2xs"
                  />
                </div>
              </div>

              {/* Add Note link / textarea */}
              <div className="pt-1">
                {!showNotes ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowNotes(true);
                      if (!notes && business?.default_notes) {
                        setNotes(business.default_notes);
                      }
                    }}
                    className="text-[13px] font-medium text-[#0F766E] hover:underline cursor-pointer"
                  >
                    + Add note / terms
                  </button>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-[12px] font-medium text-[#64748B]">Note / Terms</label>
                      <button
                        type="button"
                        onClick={() => {
                          setShowNotes(false);
                          setNotes('');
                        }}
                        className="text-[11px] text-[#94A3B8] hover:text-[#EF4444]"
                      >
                        Remove
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      placeholder="Add custom bill notes or terms..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full p-3 rounded-xl border border-[#E2E8F0] bg-white text-[13px] text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#0F766E] focus:outline-none resize-none shadow-2xs"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Summary & Action Buttons (~35% width) */}
          <div className="lg:col-span-4 space-y-4 lg:sticky lg:top-6">
            {/* SUMMARY CARD (Crisp White Card on #F6F7F9 Canvas) */}
            <div className="bg-white border-0 rounded-2xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.03)] space-y-3.5">
              {/* Header row: Summary & Customer Name */}
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-bold text-[#0F172A]">Summary</h3>
                <span className="text-[13px] font-normal text-[#64748B] truncate max-w-[170px]" title={customerDisplayName}>
                  {customerDisplayName}
                </span>
              </div>

              {/* Subtotal & Discount rows */}
              <div className="space-y-2 text-[14px]">
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B] font-normal">Subtotal</span>
                  <span className="font-semibold text-[#0F172A] tabular-nums">{formatINR(totals.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B] font-normal">Discount</span>
                  <span className="font-semibold text-[#0F172A] tabular-nums">
                    {totals.discountAmount.greaterThan(0)
                      ? `-${formatINR(totals.discountAmount)}`
                      : '-₹0'}
                  </span>
                </div>
              </div>

              {/* Hairline Divider */}
              <div className="border-t border-[#E2E8F0]" />

              {/* Total row with large prominent typography */}
              <div className="flex items-baseline justify-between pt-1 pb-1">
                <span className="text-[14px] font-medium text-[#64748B]">Total</span>
                <span className="text-[34px] font-extrabold text-[#0F172A] tracking-tight tabular-nums leading-none">
                  {formatINR(totals.total)}
                </span>
              </div>

              {/* Paid and Balance due rows */}
              <div className="space-y-2 text-[14px]">
                <div className="flex items-center justify-between">
                  <span className="text-[#64748B] font-normal">Paid · {currentModeLabel}</span>
                  <span className="font-semibold text-[#0F172A] tabular-nums">
                    {formatINR(totals.paid)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        totals.balance.greaterThan(0)
                          ? 'bg-[#EA580C]'
                          : totals.total.greaterThan(0)
                          ? 'bg-[#10B981]'
                          : 'bg-[#94A3B8]'
                      }`}
                    />
                    <span className="font-normal text-[#0F172A]">
                      {totals.balance.greaterThan(0)
                        ? 'Balance due'
                        : totals.total.greaterThan(0)
                        ? 'Fully paid'
                        : 'Balance due'}
                    </span>
                  </div>
                  <span className="text-[15px] font-bold text-[#0F172A] tabular-nums">
                    {formatINR(totals.balance)}
                  </span>
                </div>
              </div>

              {/* Dynamic QR Code Box (Matching Image 2 Reference) */}
              {paymentMode === 'UPI' && (
                <div className="bg-[#F6F7F9] border-0 rounded-2xl p-4 flex items-center gap-4 mt-2 transition-all shadow-2xs">
                  <div className="p-2 bg-white rounded-xl shadow-2xs border border-[#E2E8F0]/40 shrink-0">
                    <QRCodeSVG
                      value={upiQrString}
                      size={76}
                      level="M"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[12px] font-medium text-[#64748B]">Scan to pay</span>
                      {selectedBank && (
                        <span className="text-[11px] font-medium text-[#0F766E] bg-[#E6F4EA] px-1.5 py-0.5 rounded">
                          {selectedBank.bank_name}
                        </span>
                      )}
                    </div>
                    <div className="text-[20px] font-bold text-[#0F172A] tracking-tight tabular-nums leading-tight mt-0.5">
                      {formatINR(qrPayableAmount)}
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyUpi}
                      className="text-[12px] text-[#64748B] hover:text-[#0F172A] truncate mt-1 flex items-center gap-1.5 font-mono cursor-pointer transition-colors"
                      title="Click to copy UPI ID"
                    >
                      <span className="truncate">{activeUpiId}</span>
                      {copiedUpi ? (
                        <Check className="w-3.5 h-3.5 text-[#0F766E] shrink-0" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-[#94A3B8] hover:text-[#0F172A] shrink-0" />
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* ACTION BUTTONS */}
              <div className="pt-2 space-y-2">
                {editInvoiceId ? (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSave(false)}
                      className="w-full py-3.5 rounded-xl bg-[#0B1220] hover:bg-[#1E293B] text-white text-[14px] font-medium flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm active:scale-[0.99] disabled:opacity-50"
                    >
                      <span>{saving ? 'Updating...' : `Update bill`}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => navigate('/bills')}
                      className="w-full py-2.5 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F1F3F5] text-[#0F172A] text-[13px] font-medium flex items-center justify-center transition-all cursor-pointer shadow-2xs"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSave(false)}
                      className="w-full py-3.5 rounded-xl bg-[#0B1220] hover:bg-[#1E293B] text-white text-[14px] font-medium flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm active:scale-[0.99] disabled:opacity-50"
                    >
                      <span>{saving ? 'Saving...' : 'Save bill'}</span>
                      <Kbd className="text-[10.5px] text-slate-300 border-slate-700 bg-slate-800 px-1.5 py-0.5 ml-1">
                        Ctrl+S
                      </Kbd>
                    </button>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => handleSave(true)}
                      className="w-full py-2.5 rounded-xl border border-[#E2E8F0] bg-white hover:bg-[#F1F3F5] text-[#0F172A] text-[13px] font-medium flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-2xs active:scale-[0.99] disabled:opacity-50"
                    >
                      <span>Save & new</span>
                      <Kbd className="text-[10px] text-slate-600 border-slate-300 bg-slate-50 px-1.5 py-0.5">
                        Ctrl+Shift+S
                      </Kbd>
                    </button>

                    <div className="text-center pt-1 text-[11px] text-[#94A3B8] font-mono">
                      Ctrl+S to save • Alt+A to add item
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

      {/* Generated Bill Invoice Modal */}
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
          onViewReceipt={(receiptId) => setSelectedReceiptDetailId(receiptId)}
        />
      )}

      {/* Receipt Detail & PDF Modal */}
      <ReceiptDetailModal
        open={Boolean(selectedReceiptDetailId)}
        onOpenChange={(v) => !v && setSelectedReceiptDetailId(null)}
        receiptId={selectedReceiptDetailId}
      />

      {/* Add New Customer Modal */}
      <AddNewCustomerModal
        open={isAddCustomerModalOpen}
        onOpenChange={setIsAddCustomerModalOpen}
        initialName={walkInName}
        initialMobile={walkInMobile}
        onCustomerCreatedAndSelected={(customer) => {
          setCustomers((prev) => {
            const exists = prev.some((c) => c.id === customer.id);
            return exists ? prev : [...prev, customer];
          });
          setSelectedCustomerId(customer.id);
          setIsWalkIn(false);
          setShowCustomerSearch(false);
        }}
      />
    </div>
  );
};
