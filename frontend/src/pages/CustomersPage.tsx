import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { normaliseMobile, formatMobileDisplay, isValidIndianMobile } from '../lib/auth';
import { t, getErrorMessage } from '../i18n';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Sheet } from '../components/ui/Sheet';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { DuplicateCustomerModal, MatchingCustomer } from '../components/customers/DuplicateCustomerModal';
import { CustomerLedgerModal } from '../components/customers/CustomerLedgerModal';
import { Plus, Search, Trash2, BookOpen, Edit } from 'lucide-react';
import { Database } from '../types/supabase';

type Customer = Database['public']['Tables']['customers']['Row'];

export const CustomersPage: React.FC = () => {
  const { showToast } = useToast();

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'REGULAR' | 'WALK_IN'>('ALL');

  // Sheet state
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);

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

  const fetchCustomers = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('customers')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (filterType !== 'ALL') {
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
  }, [filterType]);

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
        const { error } = await supabase
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

        if (error) throw error;
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
      setFormError(getErrorMessage(err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (customer: Customer, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete customer ${customer.name}?`)) return;

    try {
      const { error } = await supabase.rpc('soft_delete', {
        p_table: 'customers',
        p_id: customer.id,
      });

      if (error) throw error;
      showToast(t('common.success'), 'success');
      fetchCustomers();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    }
  };

  const filteredCustomers = customers.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.mobile && c.mobile.includes(q));
  });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">{t('customers.title')}</h1>
          <p className="text-xs text-text-muted">{customers.length} total customers</p>
        </div>
        <Button variant="primary" size="md" onClick={handleOpenCreate}>
          <Plus className="w-4 h-4 mr-1.5" />
          <span>{t('customers.add_customer')}</span>
        </Button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Input
            placeholder={t('common.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>
        <div className="flex gap-1.5 bg-surface p-1 rounded-lg border border-border">
          {(['ALL', 'REGULAR', 'WALK_IN'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold select-none transition-colors ${
                filterType === type ? 'bg-white text-primary shadow-sm' : 'text-text-muted hover:text-text'
              }`}
            >
              {type === 'ALL' ? t('common.all') : type === 'REGULAR' ? t('customers.regular') : t('customers.walk_in')}
            </button>
          ))}
        </div>
      </div>

      {/* Customers List */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : filteredCustomers.length === 0 ? (
        <EmptyState
          message={t('common.empty')}
          actionLabel={t('customers.add_customer')}
          onAction={handleOpenCreate}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredCustomers.map((customer) => (
            <Card
              key={customer.id}
              className="cursor-pointer hover:border-gray-400 p-3.5 flex flex-col justify-between"
              onClick={() => handleOpenEdit(customer)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-semibold text-text truncate">{customer.name}</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {customer.mobile ? formatMobileDisplay(customer.mobile) : 'No mobile'}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                    customer.type === 'REGULAR' ? 'bg-primary-light text-primary' : 'bg-gray-100 text-text-muted'
                  }`}>
                    {customer.type}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLedgerCustomerId(customer.id);
                    }}
                    className="p-1 text-text-muted hover:text-primary rounded"
                    title={t('customers.ledger')}
                  >
                    <BookOpen className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenEdit(customer);
                    }}
                    className="p-1 text-text-muted hover:text-primary rounded"
                    title={t('common.edit')}
                  >
                    <Edit className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(e) => handleDelete(customer, e)}
                    className="p-1 text-text-muted hover:text-danger rounded"
                    title={t('common.delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {customer.address && (
                <div className="text-xs text-text-muted mt-2 truncate">{customer.address}</div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit Bottom Sheet */}
      <Sheet
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        title={editingCustomer ? t('customers.edit_customer') : t('customers.add_customer')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveCustomer();
          }}
          className="space-y-4"
        >
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

          <div className="pt-2">
            <Button type="submit" variant="primary" size="md" className="w-full" loading={saving}>
              {t('common.save')}
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
    </div>
  );
};
