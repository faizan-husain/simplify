import React, { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { supabase } from '../lib/supabase';
import { normaliseMobile, formatMobileDisplay, isValidIndianMobile } from '../lib/auth';
import { t, getErrorMessage } from '../i18n';
import { formatConcurrencyError } from '../lib/idempotency';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Sheet } from '../components/ui/Sheet';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { DuplicateCustomerModal, MatchingCustomer } from '../components/customers/DuplicateCustomerModal';
import { CustomerLedgerModal } from '../components/customers/CustomerLedgerModal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { Plus, Search, Trash2, BookOpen, Edit2, UserCheck, User, ArrowDownLeft, Phone, MapPin, FileText, CheckCircle2 } from 'lucide-react';
import { Database } from '../types/supabase';
import { SegmentedControl } from '../components/ui/SegmentedControl';
import { useAuth } from '../context/AuthContext';
import { formatINR } from '../lib/money';
import { formatDate } from '../lib/dates';
import { ReceivePaymentSheet } from '../components/receipts/ReceivePaymentSheet';
import { ReceiptDetailModal } from '../components/receipts/ReceiptDetailModal';

type Customer = Database['public']['Tables']['customers']['Row'];

export const CustomersPage: React.FC = () => {
  const { showToast } = useToast();
  const { role } = useAuth();
  const isStaff = role === 'STAFF';

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'WITH_DUE' | 'REGULAR' | 'WALK_IN'>('ALL');
  const [sortBy, setSortBy] = useState<'DUE_DESC' | 'NAME_ASC' | 'NAME_DESC'>('NAME_ASC');

  // Customer dues map: { [customerId: string]: { totalDue, isOverdue, unpaidBillsCount, overdueAmount } }
  const [customerDuesMap, setCustomerDuesMap] = useState<{
    [customerId: string]: {
      totalDue: number;
      isOverdue: boolean;
      unpaidBillsCount: number;
      overdueAmount: number;
    };
  }>({});

  // Receipt detail view state after payment
  const [selectedReceiptDetailId, setSelectedReceiptDetailId] = useState<string | null>(null);

  // Sheet state
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

  // Staff customer profile sheet state
  const [staffCustomerSheetOpen, setStaffCustomerSheetOpen] = useState(false);
  const [staffSelectedCustomer, setStaffSelectedCustomer] = useState<Customer | null>(null);
  const [staffCustomerDue, setStaffCustomerDue] = useState<number>(0);
  const [staffCustomerBills, setStaffCustomerBills] = useState<any[]>([]);
  const [staffLoadingBills, setStaffLoadingBills] = useState(false);

  // Receive payment sheet state
  const [isReceivePaymentOpen, setIsReceivePaymentOpen] = useState(false);
  const [receivePaymentCustomer, setReceivePaymentCustomer] = useState<Customer | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [customerType, setCustomerType] = useState<'REGULAR' | 'WALK_IN'>('REGULAR');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Duplicate modal state
  const [duplicateMatches, setDuplicateMatches] = useState<MatchingCustomer[]>([]);
  const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);

  // Ledger modal state
  const [ledgerCustomerId, setLedgerCustomerId] = useState<string | null>(null);
  const [focusedCustomerIndex, setFocusedCustomerIndex] = useState<number>(-1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Customer to delete confirmation state
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchDuesData = async () => {
    try {
      const { data, error } = await supabase.rpc('dues_list', {
        p_filter: 'ALL',
        p_search: null,
        p_limit: 1000,
        p_offset: 0,
      });

      if (!error && data) {
        const res = data as any;
        const duesMap: {
          [customerId: string]: {
            totalDue: number;
            isOverdue: boolean;
            unpaidBillsCount: number;
            overdueAmount: number;
          };
        } = {};

        (res.customers || []).forEach((c: any) => {
          if (c.customer_id) {
            duesMap[c.customer_id] = {
              totalDue: Number(c.total_due || 0),
              isOverdue: Boolean(c.is_overdue),
              unpaidBillsCount: Number(c.unpaid_bills_count || 0),
              overdueAmount: Number(c.overdue_amount || 0),
            };
          }
        });

        setCustomerDuesMap(duesMap);
      }
    } catch (err) {
      console.error('Error fetching customer dues map:', err);
    }
  };

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('customers')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (filterType === 'REGULAR' || filterType === 'WALK_IN') {
        query = query.eq('type', filterType);
      }

      const { data, error } = await query;
      if (error) throw error;
      setCustomers((data as Customer[]) || []);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCustomers();
    fetchDuesData();
  }, [filterType]);

  // Enterprise Multi-Device Realtime sync: automatically refresh customer and dues data on remote device changes
  useEffect(() => {
    const handleSync = (e: any) => {
      const table = e.detail?.table;
      if (!table || table === 'customers' || table === 'invoices' || table === 'receipts') {
        fetchCustomers();
        fetchDuesData();
      }
    };
    window.addEventListener('simplify:sync', handleSync);
    return () => window.removeEventListener('simplify:sync', handleSync);
  }, []);

  const handleOpenCreate = () => {
    setEditingCustomer(null);
    setName('');
    setMobile('');
    setWhatsapp('');
    setEmail('');
    setAddress('');
    setNotes('');
    setCustomerType('REGULAR');
    setFormError(null);
    setIsSheetOpen(true);
  };

  const handleOpenEdit = (c: Customer) => {
    setEditingCustomer(c);
    setName(c.name);
    setMobile(c.mobile || '');
    setWhatsapp(c.whatsapp || '');
    setEmail(c.email || '');
    setAddress(c.address || '');
    setNotes(c.notes || '');
    setCustomerType(c.type as 'REGULAR' | 'WALK_IN');
    setFormError(null);
    setIsSheetOpen(true);
  };

  const handleSelectCustomer = async (c: Customer) => {
    if (!isStaff) {
      handleOpenEdit(c);
      return;
    }

    setStaffSelectedCustomer(c);
    setStaffCustomerSheetOpen(true);
    setStaffLoadingBills(true);

    try {
      // Use outstanding_invoices RPC to fetch all pending invoices across the business for this customer
      const { data: outData, error: outError } = await supabase.rpc('outstanding_invoices', {
        customer_id: c.id,
      });

      if (outError) throw outError;
      const bills = (outData || []).map((b: any) => ({
        ...b,
        balance: Math.max(0, Number(b.balance ?? (Number(b.total || 0) - Number(b.paid_amount || 0)))),
      }));
      setStaffCustomerBills(bills);
      const totalDue = bills.reduce((acc: number, b: any) => acc + b.balance, 0);
      setStaffCustomerDue(totalDue);
    } catch (err: any) {
      console.error('Error fetching customer bills for staff:', err);
    } finally {
      setStaffLoadingBills(false);
    }
  };

  const handleMobileBlur = async () => {
    if (mobile && isValidIndianMobile(mobile)) {
      if (!whatsapp) {
        setWhatsapp(mobile);
      }
      try {
        const { data } = await supabase.rpc('check_customer_mobile', {
          mobile: normaliseMobile(mobile),
          exclude_customer_id: editingCustomer?.id,
        });
        if (data && Array.isArray(data) && data.length > 0) {
          setDuplicateMatches(data as MatchingCustomer[]);
          setIsDuplicateModalOpen(true);
        }
      } catch (err) {
        // Non-blocking duplicate check error
      }
    }
  };

  const saveCustomer = async (possibleDuplicate = false) => {
    if (!name.trim()) {
      setFormError(t('auth.required'));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const cleanMobile = mobile ? normaliseMobile(mobile) : null;
      const cleanWhatsapp = whatsapp ? normaliseMobile(whatsapp) : cleanMobile;

      if (editingCustomer) {
        const payload: any = {
          id: editingCustomer.id,
          last_updated_at: (editingCustomer as any).updated_at || null,
          name: name.trim(),
          mobile: cleanMobile,
          whatsapp: cleanWhatsapp,
          email: email.trim() || null,
          address: address.trim() || null,
          notes: notes.trim() || null,
          type: customerType,
          possible_duplicate: possibleDuplicate || editingCustomer.possible_duplicate,
        };

        const { error: occError } = await supabase.rpc('update_customer_occ', { payload });
        if (occError) {
          // If RPC doesn't exist yet in remote DB, fallback gracefully to direct update
          if (occError.message?.includes('function') && occError.message?.includes('does not exist')) {
            const { error: directError } = await supabase
              .from('customers')
              .update({
                name: name.trim(),
                mobile: cleanMobile,
                whatsapp: cleanWhatsapp,
                email: email.trim() || null,
                address: address.trim() || null,
                notes: notes.trim() || null,
                type: customerType,
                possible_duplicate: possibleDuplicate || editingCustomer.possible_duplicate,
              })
              .eq('id', editingCustomer.id);
            if (directError) throw directError;
          } else {
            throw occError;
          }
        }
        showToast(t('common.success'), 'success');
      } else {
        const { error } = await supabase
          .from('customers')
          .insert({
            name: name.trim(),
            mobile: cleanMobile,
            whatsapp: cleanWhatsapp,
            email: email.trim() || null,
            address: address.trim() || null,
            notes: notes.trim() || null,
            type: customerType,
            possible_duplicate: possibleDuplicate,
          });

        if (error) throw error;
        showToast(t('common.success'), 'success');
      }

      setIsSheetOpen(false);
      fetchCustomers();
    } catch (err: any) {
      setFormError(formatConcurrencyError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (customer: Customer, e: React.MouseEvent) => {
    e.stopPropagation();
    setCustomerToDelete(customer);
  };

  const dueCustomersCount = React.useMemo(() => {
    return customers.filter((c) => (customerDuesMap[c.id]?.totalDue || 0) > 0).length;
  }, [customers, customerDuesMap]);

  const filteredCustomers = React.useMemo(() => {
    return customers
      .filter((c) => {
        // Search filter
        if (search.trim()) {
          const q = search.toLowerCase();
          const matchName = c.name?.toLowerCase().includes(q);
          const matchMobile = c.mobile && c.mobile.includes(q);
          const matchAddress = c.address && c.address.toLowerCase().includes(q);
          if (!matchName && !matchMobile && !matchAddress) return false;
        }

        // Category / Due filter
        if (filterType === 'WITH_DUE') {
          return (customerDuesMap[c.id]?.totalDue || 0) > 0;
        }
        if (filterType === 'REGULAR') {
          return c.type === 'REGULAR';
        }
        if (filterType === 'WALK_IN') {
          return c.type === 'WALK_IN';
        }
        return true;
      })
      .sort((a, b) => {
        const dueA = customerDuesMap[a.id]?.totalDue || 0;
        const dueB = customerDuesMap[b.id]?.totalDue || 0;

        if (sortBy === 'DUE_DESC') {
          if (dueB !== dueA) {
            return dueB - dueA; // highest due first
          }
          return a.name.localeCompare(b.name);
        }
        if (sortBy === 'NAME_DESC') {
          return b.name.localeCompare(a.name);
        }
        // Default: NAME_ASC
        return a.name.localeCompare(b.name);
      });
  }, [customers, search, filterType, sortBy, customerDuesMap]);

  // Keyboard navigation for customers
  useEffect(() => {
    const handleCustomersKeyDown = (e: KeyboardEvent) => {
      if (isSheetOpen || staffCustomerSheetOpen || isReceivePaymentOpen || isDuplicateModalOpen || ledgerCustomerId) return;

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
          setFocusedCustomerIndex(0);
        }
        return;
      }

      if (isInputActive) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedCustomerIndex((prev) => (prev + 1 >= filteredCustomers.length ? 0 : prev + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedCustomerIndex((prev) => (prev <= 0 ? Math.max(0, filteredCustomers.length - 1) : prev - 1));
      } else if (e.key === 'Enter' && focusedCustomerIndex >= 0 && focusedCustomerIndex < filteredCustomers.length) {
        e.preventDefault();
        handleSelectCustomer(filteredCustomers[focusedCustomerIndex]);
      }
    };

    window.addEventListener('keydown', handleCustomersKeyDown);
    return () => window.removeEventListener('keydown', handleCustomersKeyDown);
  }, [filteredCustomers, focusedCustomerIndex, isSheetOpen, staffCustomerSheetOpen, isReceivePaymentOpen, isDuplicateModalOpen, ledgerCustomerId]);

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t('customers.title')}</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {customers.length} total customers
            {dueCustomersCount > 0 && (
              <span className="ml-1.5 font-semibold text-rose-600">
                · {dueCustomersCount} with pending dues
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="h-10 px-4 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{t('customers.add_customer')}</span>
        </button>
      </div>

      {/* Filter and Search Bar with Due Filter & Sorting */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Input
              ref={searchInputRef}
              placeholder="Search customer by name or mobile... (Press / to search)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              leftIcon={<Search className="w-4 h-4 text-[#94A3B8]" />}
              className="border-0 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#0F766E]/20 rounded-xl h-11"
            />
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <SegmentedControl
              value={filterType}
              onChange={(val) => {
                const nextFilter = val as any;
                setFilterType(nextFilter);
                if (nextFilter === 'WITH_DUE') {
                  setSortBy('DUE_DESC');
                }
              }}
              options={[
                { label: t('common.all'), value: 'ALL' },
                {
                  label: dueCustomersCount > 0 ? `Due (${dueCustomersCount})` : 'Due',
                  value: 'WITH_DUE',
                },
                { label: t('customers.regular'), value: 'REGULAR' },
                { label: t('customers.walk_in'), value: 'WALK_IN' },
              ]}
            />
          </div>
        </div>

        {/* Sorting & Filter Indicator Track */}
        <div className="flex items-center justify-between text-xs text-slate-500 pt-0.5">
          <div className="font-medium">
            Showing <strong className="text-slate-900">{filteredCustomers.length}</strong> {filteredCustomers.length === 1 ? 'customer' : 'customers'}
            {filterType === 'WITH_DUE' && (
              <span className="ml-1.5 px-2 py-0.5 rounded-md bg-rose-50 text-rose-700 font-bold text-[11px]">
                Pending Dues Only
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium hidden sm:inline">Sort:</span>
            <div className="inline-flex p-1 bg-[#EEF0F3] rounded-xl text-xs font-semibold">
              <button
                type="button"
                onClick={() => setSortBy('DUE_DESC')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  sortBy === 'DUE_DESC'
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title="Sort highest pending due first"
              >
                Highest Due
              </button>
              <button
                type="button"
                onClick={() => setSortBy('NAME_ASC')}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                  sortBy === 'NAME_ASC'
                    ? 'bg-white text-slate-900 shadow-2xs font-bold'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title="Sort alphabetically A to Z"
              >
                Name (A–Z)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Customers List */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Skeleton className="h-28 w-full rounded-2xl border-0" />
          <Skeleton className="h-28 w-full rounded-2xl border-0" />
          <Skeleton className="h-28 w-full rounded-2xl border-0" />
        </div>
      ) : filteredCustomers.length === 0 ? (
        <EmptyState
          message={
            filterType === 'WITH_DUE'
              ? 'No customers with pending dues found.'
              : t('common.empty')
          }
          actionLabel={filterType === 'WITH_DUE' ? undefined : t('customers.add_customer')}
          onAction={filterType === 'WITH_DUE' ? undefined : handleOpenCreate}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredCustomers.map((customer, idx) => {
            const dueInfo = customerDuesMap[customer.id];
            const customerDue = dueInfo?.totalDue || 0;
            const isOverdue = dueInfo?.isOverdue;
            const isFocused = idx === focusedCustomerIndex;

            return (
              <div
                key={customer.id}
                className={clsx(
                  "bg-white border-0 rounded-2xl p-4 sm:p-5 flex flex-col justify-between hover:-translate-y-0.5 transition-all cursor-pointer group",
                  isFocused
                    ? "ring-2 ring-[#0F766E] shadow-md bg-[#FAFBFD]"
                    : "shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
                )}
                onClick={() => handleSelectCustomer(customer)}
              >
                <div>
                  {/* Top Row: Name + Type Badge on Left, Due Badge + Receive on Right */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span className="text-[15px] font-semibold text-slate-900 truncate group-hover:text-[#0F766E] transition-colors">
                        {customer.name}
                      </span>
                      <span
                        className={`px-2 py-0.5 text-[10.5px] font-semibold rounded-md border-0 shrink-0 ${
                          customer.type === 'REGULAR'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {customer.type === 'REGULAR' ? 'Regular' : 'Walk-in'}
                      </span>
                    </div>

                    {/* Due badge */}
                    <div className="shrink-0 flex items-center justify-end">
                      {customerDue > 0 ? (
                        <span
                          className={`px-2 py-0.5 text-[11px] font-bold rounded-md border-0 tabular-nums inline-flex items-center gap-1 ${
                            isOverdue
                              ? 'bg-red-50 text-red-700'
                              : 'bg-rose-50 text-rose-700'
                          }`}
                        >
                          Due: ₹{formatINR(customerDue).replace('₹', '')}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[11px] font-medium rounded-md border-0 bg-slate-50 text-slate-400">
                          No Dues
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Second Row: Mobile Phone on Left, Management & Receive Actions on Right */}
                  <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-100/70">
                    <div className="text-xs text-slate-500 tabular-nums flex items-center gap-1.5 min-w-0">
                      <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate">{customer.mobile ? formatMobileDisplay(customer.mobile) : 'No mobile'}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {customerDue > 0 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setReceivePaymentCustomer(customer);
                            setIsReceivePaymentOpen(true);
                          }}
                          className="w-7 h-7 rounded-lg border-0 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 hover:text-emerald-700 flex items-center justify-center shadow-2xs transition-all cursor-pointer hover:scale-105 active:scale-95 shrink-0"
                          title="Receive Payment"
                        >
                          <ArrowDownLeft className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {!isStaff && (
                        <>
                          <button
                            type="button"
                            title={t('customers.ledger')}
                            onClick={(e) => {
                              e.stopPropagation();
                              setLedgerCustomerId(customer.id);
                            }}
                            className="w-7 h-7 rounded-lg border-0 bg-slate-100/90 hover:bg-slate-200 text-slate-700 hover:text-slate-900 transition-all flex items-center justify-center cursor-pointer hover:scale-105"
                          >
                            <BookOpen className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title={t('common.edit')}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenEdit(customer);
                            }}
                            className="w-7 h-7 rounded-lg border-0 bg-slate-100/90 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] transition-all flex items-center justify-center cursor-pointer hover:scale-105"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title={t('common.delete')}
                            onClick={(e) => handleDelete(customer, e)}
                            className="w-7 h-7 rounded-lg border-0 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 transition-all flex items-center justify-center cursor-pointer hover:scale-105"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {customer.address && (
                  <div className="text-xs text-slate-400 mt-2 pt-1.5 border-t border-slate-100/50 truncate flex items-center gap-1">
                    <MapPin className="w-3 h-3 text-slate-300 shrink-0" />
                    <span className="truncate">{customer.address}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Bottom Sheet */}
      <Sheet
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        title={editingCustomer ? t('customers.edit_customer') : t('customers.add_customer')}
        className="border-0 shadow-[0_8px_30px_rgba(0,0,0,0.1)]"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveCustomer();
          }}
          className="space-y-4"
        >
          {/* Customer Type Selector (Walk-in vs Regular) */}
          <div>
            <label className="text-[12.5px] font-semibold text-slate-500 block mb-1.5">
              Customer Type
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-[#F1F5F9] p-1.5 rounded-2xl border-0 shadow-2xs">
              <button
                type="button"
                onClick={() => setCustomerType('REGULAR')}
                className={`py-2 px-3 rounded-xl text-xs sm:text-[13px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 border-0 whitespace-nowrap ${
                  customerType === 'REGULAR'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <UserCheck className="w-4 h-4 text-[#0F766E] shrink-0" />
                <span>Regular Customer</span>
              </button>
              <button
                type="button"
                onClick={() => setCustomerType('WALK_IN')}
                className={`py-2 px-3 rounded-xl text-xs sm:text-[13px] font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 border-0 whitespace-nowrap ${
                  customerType === 'WALK_IN'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <User className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Walk-in Profile</span>
              </button>
            </div>
          </div>

          <Input
            label={t('customers.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer name"
            disabled={saving}
          />

          <Input
            label={t('customers.mobile')}
            type="tel"
            inputMode="tel"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            onBlur={handleMobileBlur}
            placeholder="10-digit mobile"
            disabled={saving}
          />

          <Input
            label={t('customers.whatsapp')}
            type="tel"
            inputMode="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="WhatsApp number (default same as mobile)"
            disabled={saving}
          />

          <Input
            label={t('customers.email')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Optional email"
            disabled={saving}
          />

          <Input
            label={t('customers.address')}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Optional address"
            disabled={saving}
          />

          <Input
            label={t('common.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Notes about customer"
            disabled={saving}
          />

          {formError && <div className="text-xs text-danger font-medium">{formError}</div>}

          <div className="pt-3">
            <Button
              type="submit"
              variant="primary"
              size="md"
              className="w-full h-11 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-xs"
              loading={saving}
            >
              {editingCustomer ? 'Update Customer' : 'Save Customer'}
            </Button>
          </div>
        </form>
      </Sheet>

      {/* Duplicate Customer Warning Modal */}
      <DuplicateCustomerModal
        open={isDuplicateModalOpen}
        onOpenChange={setIsDuplicateModalOpen}
        matches={duplicateMatches}
        onUseExisting={(match) => {
          setIsSheetOpen(false);
          const found = customers.find((c) => c.id === match.id);
          if (found) handleOpenEdit(found);
        }}
        onCreateAnyway={() => {
          saveCustomer(true);
        }}
      />

      {/* Customer Ledger Modal */}
      <CustomerLedgerModal
        open={Boolean(ledgerCustomerId)}
        onOpenChange={(v) => !v && setLedgerCustomerId(null)}
        customerId={ledgerCustomerId}
      />

      {/* Staff Customer Profile Sheet */}
      <Sheet
        open={staffCustomerSheetOpen}
        onOpenChange={setStaffCustomerSheetOpen}
        title="Customer Profile"
        className="border-0 shadow-[0_8px_30px_rgba(0,0,0,0.1)]"
      >
        {staffSelectedCustomer && (
          <div className="space-y-4">
            <div className="p-4 bg-[#F8FAFC] rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.03)] flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-base font-bold text-slate-900 break-words">
                  {staffSelectedCustomer.name}
                </div>
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                  <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>
                    {staffSelectedCustomer.mobile
                      ? formatMobileDisplay(staffSelectedCustomer.mobile)
                      : 'No mobile recorded'}
                  </span>
                </div>
                {staffSelectedCustomer.address && (
                  <div className="text-xs text-slate-500 mt-1 flex items-start gap-1.5">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                    <span className="break-words">{staffSelectedCustomer.address}</span>
                  </div>
                )}
              </div>
              <span
                className={`px-2 py-0.5 text-[11px] font-semibold rounded-md border-0 shrink-0 ${
                  staffSelectedCustomer.type === 'REGULAR'
                    ? 'bg-emerald-50 text-emerald-700'
                    : 'bg-amber-50 text-amber-700'
                }`}
              >
                {staffSelectedCustomer.type === 'REGULAR' ? 'Regular' : 'Walk-in'}
              </span>
            </div>

            {/* Dues Status Card */}
            <div
              className={`p-4 rounded-2xl border-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                staffCustomerDue > 0
                  ? 'bg-rose-50/80 shadow-[0_2px_8px_rgba(244,63,94,0.06)]'
                  : 'bg-emerald-50/80 shadow-[0_2px_8px_rgba(16,185,129,0.06)]'
              }`}
            >
              <div>
                <div
                  className={`text-[11px] font-semibold uppercase tracking-wider ${
                    staffCustomerDue > 0 ? 'text-rose-800' : 'text-emerald-800'
                  }`}
                >
                  Pending Due
                </div>
                <div
                  className={`text-lg font-bold tabular-nums mt-0.5 ${
                    staffCustomerDue > 0 ? 'text-rose-900' : 'text-emerald-900'
                  }`}
                >
                  {formatINR(staffCustomerDue)}
                </div>
              </div>
              {staffCustomerDue > 0 ? (
                <button
                  type="button"
                  className="h-9 px-3.5 rounded-xl border-0 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs flex items-center justify-center gap-1.5 w-full sm:w-auto shrink-0 transition-all cursor-pointer"
                  onClick={() => {
                    setReceivePaymentCustomer(staffSelectedCustomer);
                    setIsReceivePaymentOpen(true);
                  }}
                >
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  <span>Receive Payment</span>
                </button>
              ) : (
                <div className="flex items-center gap-1 text-emerald-700 text-xs font-semibold shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>No balance due</span>
                </div>
              )}
            </div>

            {/* Notes */}
            {staffSelectedCustomer.notes && (
              <div className="p-3.5 bg-[#F8FAFC] rounded-2xl border-0 shadow-2xs text-xs text-slate-500">
                <span className="font-semibold text-slate-800 block mb-0.5">Notes:</span>
                {staffSelectedCustomer.notes}
              </div>
            )}

            {/* Bills by this staff */}
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-900">
                <span>Recent Bills</span>
                <span className="text-slate-400 font-normal">
                  {staffCustomerBills.length} active bills
                </span>
              </div>

              {staffLoadingBills ? (
                <div className="space-y-2 py-4">
                  <Skeleton className="h-10 w-full rounded-xl border-0" />
                  <Skeleton className="h-10 w-full rounded-xl border-0" />
                </div>
              ) : staffCustomerBills.length === 0 ? (
                <div className="text-center py-6 text-xs text-slate-400">
                  No active bills found for this customer.
                </div>
              ) : (
                <div className="divide-y divide-slate-100 rounded-2xl overflow-hidden bg-white border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
                  {staffCustomerBills.map((b) => (
                    <div key={b.id} className="p-3 flex items-center justify-between text-xs hover:bg-slate-50 transition-colors">
                      <div>
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-[#0F766E]" />
                          <span>#{b.number}</span>
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {formatDate(b.invoice_date)}
                        </div>
                      </div>
                      <div className="text-right tabular-nums">
                        <div className="font-semibold text-slate-900">{formatINR(b.total)}</div>
                        {b.balance > 0 ? (
                          <div className="text-[11px] font-semibold text-rose-600">
                            Due: {formatINR(b.balance)}
                          </div>
                        ) : (
                          <div className="text-[11px] font-medium text-emerald-600">Paid</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Sheet>

      {/* Receive Payment Sheet for Staff & Owner */}
      <ReceivePaymentSheet
        open={isReceivePaymentOpen}
        onOpenChange={(open) => {
          setIsReceivePaymentOpen(open);
          if (!open) setReceivePaymentCustomer(null);
        }}
        prefillCustomer={
          receivePaymentCustomer
            ? {
                id: receivePaymentCustomer.id,
                name: receivePaymentCustomer.name,
                mobile: receivePaymentCustomer.mobile,
              }
            : undefined
        }
        onSuccess={() => {
          if (staffSelectedCustomer) {
            handleSelectCustomer(staffSelectedCustomer);
          }
          fetchCustomers();
          fetchDuesData();
        }}
        onViewReceipt={(receiptId) => {
          setIsReceivePaymentOpen(false);
          setStaffCustomerSheetOpen(false);
          setSelectedReceiptDetailId(receiptId);
        }}
      />

      {/* Official Receipt Detail & Print/Share Modal */}
      <ReceiptDetailModal
        open={Boolean(selectedReceiptDetailId)}
        onOpenChange={(open) => !open && setSelectedReceiptDetailId(null)}
        receiptId={selectedReceiptDetailId}
      />

      {/* Delete Customer Confirmation Dialog (Owner only) */}
      {!isStaff && (
        <ConfirmDialog
          open={Boolean(customerToDelete)}
          onOpenChange={(v) => !v && setCustomerToDelete(null)}
          title={`Delete Customer: ${customerToDelete?.name || ''}`}
          description="Are you sure you want to delete this customer? Note: Customers with active bills cannot be deleted."
          confirmLabel="Delete Customer"
          variant="danger"
          loading={deleteLoading}
          onConfirm={async () => {
            if (!customerToDelete) return;
            setDeleteLoading(true);
            try {
              const { error } = await supabase.rpc('soft_delete', {
                p_table: 'customers',
                p_id: customerToDelete.id,
              });
              if (error) throw error;
              showToast('Customer deleted successfully', 'success');
              setCustomerToDelete(null);
              fetchCustomers();
            } catch (err: any) {
              showToast(getErrorMessage(err.message), 'error');
            } finally {
              setDeleteLoading(false);
            }
          }}
        />
      )}
    </div>
  );
};
