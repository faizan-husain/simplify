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
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { Database } from '../types/supabase';

type Service = Database['public']['Tables']['services']['Row'];
type Customer = Database['public']['Tables']['customers']['Row'];

interface BillItemState {
  id: string;
  service_id?: string | null;
  description: string;
  quantity: string;
  rate: string;
  is_job: boolean;
  applicant_name?: string;
}

const DRAFT_STORAGE_KEY = 'simplify_new_bill_draft';
const LAST_PAYMENT_MODE_KEY = 'simplify_last_payment_mode';

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
  const [showWalkInInputs, setShowWalkInInputs] = useState(false);

  // Items state
  const [items, setItems] = useState<BillItemState[]>([
    { id: '1', description: '', quantity: '1', rate: '', is_job: false }
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

    supabase.from('services').select('*').eq('active', true).is('deleted_at', null).then(({ data }) => {
      if (data) setServices(data as Service[]);
    });

    supabase.from('customers').select('*').is('deleted_at', null).then(({ data }) => {
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
        if (parsed.items && parsed.items.length > 0) {
          setItems(parsed.items);
          if (parsed.walkInName) setWalkInName(parsed.walkInName);
          if (parsed.walkInMobile) setWalkInMobile(parsed.walkInMobile);
          if (parsed.discountType) setDiscountType(parsed.discountType);
          if (parsed.discountValue) setDiscountValue(parsed.discountValue);
          if (parsed.paidNow) setPaidNow(parsed.paidNow);
        }
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
  }, [isWalkIn, selectedCustomerId, walkInName, walkInMobile, items, discountType, discountValue, paidNow, notes]);

  // Live client totals preview via decimal.js
  const totals = computeBillTotals(
    items.map((it) => ({ quantity: it.quantity || '0', rate: it.rate || '0' })),
    discountType,
    discountValue,
    paidNow
  );

  // Auto-expand walk-in inputs if balance > 0 (BR-5)
  useEffect(() => {
    if (isWalkIn && totals.balance.greaterThan(0)) {
      setShowWalkInInputs(true);
    }
  }, [isWalkIn, totals.balance]);

  const handleAddItem = (service?: Service) => {
    const newItem: BillItemState = {
      id: Math.random().toString(36).substring(2, 9),
      service_id: service?.id || null,
      description: service?.name || '',
      quantity: '1',
      rate: service?.default_rate ? String(service.default_rate) : '',
      is_job: service?.is_job_type || false,
    };
    setItems((prev) => [...prev, newItem]);
  };

  const handleUpdateItem = (id: string, updates: Partial<BillItemState>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...updates } : it)));
  };

  const handleRemoveItem = (id: string) => {
    if (items.length === 1) {
      setItems([{ id: '1', description: '', quantity: '1', rate: '', is_job: false }]);
      return;
    }
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handlePaidInFull = () => {
    setPaidNow(totals.total.toString());
  };

  const handleSave = async (saveAndNew = false) => {
    // Basic validation
    const validItems = items.filter((it) => it.description.trim() !== '');
    if (validItems.length === 0) {
      showToast('Add at least one item', 'error');
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        invoice_date: invoiceDate,
        due_date: dueDate,
        discount_type: discountType,
        discount_value: discountValue ? parseFloat(discountValue) : 0,
        notes: notes.trim() || null,
        items: validItems.map((it) => ({
          service_id: it.service_id || null,
          description: it.description.trim(),
          quantity: parseFloat(it.quantity || '1'),
          rate: parseFloat(it.rate || '0'),
          is_job: it.is_job,
          applicant_name: it.applicant_name?.trim() || null,
        })),
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
        showToast(`Bill #${data.number} saved!`, 'success');
        // Reset form
        setItems([{ id: '1', description: '', quantity: '1', rate: '', is_job: false }]);
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
    <div className="p-4 md:p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">{t('billing.new_bill')}</h1>
          <p className="text-xs text-text-muted">{formatInputDate()} · {getFYLabel()}</p>
        </div>
        <div className="text-right">
          <div className="text-xs text-text-muted">Total</div>
          <div className="text-lg font-bold text-primary">{formatINR(totals.total)}</div>
        </div>
      </div>

      {/* 1. Customer Selection */}
      <Card className="p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            {t('billing.customer')}
          </span>
          <div className="flex gap-1.5 bg-surface p-1 rounded-lg border border-border">
            <button
              type="button"
              onClick={() => {
                setIsWalkIn(true);
                setSelectedCustomerId(null);
              }}
              className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                isWalkIn ? 'bg-white text-primary shadow-sm' : 'text-text-muted hover:text-text'
              }`}
            >
              {t('billing.walk_in')}
            </button>
            <button
              type="button"
              onClick={() => setIsWalkIn(false)}
              className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                !isWalkIn ? 'bg-white text-primary shadow-sm' : 'text-text-muted hover:text-text'
              }`}
            >
              Select Existing
            </button>
          </div>
        </div>

        {isWalkIn ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => setShowWalkInInputs(!showWalkInInputs)}
              className="text-xs text-primary font-medium flex items-center gap-1 hover:underline"
            >
              {showWalkInInputs ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <span>{showWalkInInputs ? 'Hide customer name/mobile' : '+ Add Name / Mobile (Optional for full-paid)'}</span>
            </button>

            {showWalkInInputs && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 animate-in fade-in">
                <Input
                  placeholder="Customer Name"
                  value={walkInName}
                  onChange={(e) => setWalkInName(e.target.value)}
                />
                <Input
                  placeholder="10-digit Mobile"
                  type="tel"
                  inputMode="tel"
                  value={walkInMobile}
                  onChange={(e) => setWalkInMobile(e.target.value)}
                />
              </div>
            )}
          </div>
        ) : (
          <div>
            <select
              value={selectedCustomerId || ''}
              onChange={(e) => setSelectedCustomerId(e.target.value || null)}
              className="w-full h-11 px-3 rounded-lg border border-border bg-white text-sm"
            >
              <option value="">-- Choose Customer --</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.mobile ? `(${c.mobile})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </Card>

      {/* Frequent Services Chips */}
      {frequentServices.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-text-muted">{t('billing.frequent')}</div>
          <div className="flex flex-wrap gap-1.5">
            {frequentServices.map((srv) => (
              <button
                key={srv.id}
                type="button"
                onClick={() => handleAddItem(srv)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface hover:bg-white active:bg-gray-100 rounded-full border border-border text-xs font-medium text-text shadow-soft transition-colors"
              >
                <span>+ {srv.name}</span>
                {srv.default_rate && (
                  <span className="text-primary font-semibold">{formatINR(srv.default_rate)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 2. Items List */}
      <Card className="p-3.5 space-y-3">
        <div className="flex items-center justify-between pb-1 border-b border-border/50">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            {t('billing.items')}
          </span>
          <button
            type="button"
            onClick={() => handleAddItem()}
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('billing.add_item')}</span>
          </button>
        </div>

        <div className="space-y-2.5">
          {items.map((item, idx) => {
            const lineAmt = computeLineAmount(item.quantity, item.rate);
            return (
              <div key={item.id} className="p-2.5 rounded-lg border border-border/60 bg-white space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-text-muted select-none w-4">{idx + 1}.</span>
                  <div className="flex-1">
                    <input
                      type="text"
                      list="services-list"
                      placeholder="Item name / Service"
                      value={item.description}
                      onChange={(e) => {
                        const val = e.target.value;
                        const matched = services.find((s) => s.name.toLowerCase() === val.toLowerCase());
                        if (matched) {
                          handleUpdateItem(item.id, {
                            description: matched.name,
                            service_id: matched.id,
                            rate: matched.default_rate ? String(matched.default_rate) : item.rate,
                            is_job: matched.is_job_type,
                          });
                        } else {
                          handleUpdateItem(item.id, { description: val });
                        }
                      }}
                      className="w-full h-10 px-3 rounded-md border border-border text-sm focus:border-primary focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(item.id)}
                    className="p-2 text-text-muted hover:text-danger rounded"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 pl-6">
                  <div>
                    <label className="text-[10px] text-text-muted font-semibold">Qty</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.quantity}
                      disabled={item.is_job}
                      onChange={(e) => handleUpdateItem(item.id, { quantity: e.target.value })}
                      className="w-full h-9 px-2 rounded-md border border-border text-sm text-center disabled:bg-surface"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-muted font-semibold">Rate (₹)</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={item.rate}
                      onChange={(e) => handleUpdateItem(item.id, { rate: e.target.value })}
                      placeholder="0"
                      className="w-full h-9 px-2 rounded-md border border-border text-sm text-right"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-muted font-semibold">Amount</label>
                    <div className="h-9 flex items-center justify-end font-bold text-sm text-text pr-1">
                      {formatINR(lineAmt)}
                    </div>
                  </div>
                </div>

                {item.is_job && (
                  <div className="pl-6 pt-1">
                    <input
                      type="text"
                      placeholder="Applicant Name (for Job)"
                      value={item.applicant_name || ''}
                      onChange={(e) => handleUpdateItem(item.id, { applicant_name: e.target.value })}
                      className="w-full h-8 px-2.5 rounded border border-border text-xs focus:border-primary focus:outline-none"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* 3. Discount & Totals */}
      <Card className="p-3.5 space-y-3">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>Subtotal</span>
          <span className="font-semibold text-text">{formatINR(totals.subtotal)}</span>
        </div>

        {/* Discount toggle */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-surface p-0.5 rounded border border-border">
            {(['NONE', 'FLAT', 'PERCENT'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDiscountType(mode)}
                className={`px-2 py-1 text-xs font-semibold rounded ${
                  discountType === mode ? 'bg-white text-primary shadow-sm' : 'text-text-muted hover:text-text'
                }`}
              >
                {mode === 'NONE' ? 'No Disc' : mode === 'FLAT' ? '₹ Flat' : '%'}
              </button>
            ))}
          </div>

          {discountType !== 'NONE' && (
            <input
              type="text"
              inputMode="decimal"
              placeholder={discountType === 'FLAT' ? 'Discount ₹' : 'Discount %'}
              value={discountValue}
              onChange={(e) => setDiscountValue(e.target.value)}
              className="flex-1 h-9 px-3 rounded border border-border text-sm"
            />
          )}

          {discountType !== 'NONE' && (
            <span className="text-xs font-bold text-danger">
              -{formatINR(totals.discountAmount)}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border text-base font-bold text-text">
          <span>Total</span>
          <span className="text-primary text-lg">{formatINR(totals.total)}</span>
        </div>
      </Card>

      {/* 4. Payment */}
      <Card className="p-3.5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
            Payment Received
          </span>
          <button
            type="button"
            onClick={handlePaidInFull}
            className="text-xs font-bold text-primary hover:underline bg-primary-light px-2.5 py-1 rounded"
          >
            Paid in full
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <AmountInput
            placeholder="0"
            value={paidNow}
            onChange={(val) => setPaidNow(val)}
          />
          <div className="flex flex-col justify-center items-end pr-2">
            <span className="text-[10px] text-text-muted">Balance Due</span>
            <span className={`text-sm font-bold ${totals.balance.greaterThan(0) ? 'text-danger' : 'text-success'}`}>
              {formatINR(totals.balance)}
            </span>
          </div>
        </div>

        {paidNow && parseFloat(paidNow) > 0 && (
          <div className="flex gap-1.5 overflow-x-auto pt-1">
            {['CASH', 'UPI', 'CARD', 'BANK', 'CHEQUE'].map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setPaymentMode(mode)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                  paymentMode === mode ? 'bg-primary text-white shadow-sm' : 'bg-surface text-text-muted hover:text-text'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* 5. Date & Notes */}
      <button
        type="button"
        onClick={() => setShowNotes(!showNotes)}
        className="text-xs text-text-muted hover:text-text font-medium flex items-center gap-1"
      >
        {showNotes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        <span>{showNotes ? 'Hide Date & Notes' : '+ Custom Date & Notes / Terms'}</span>
      </button>

      {showNotes && (
        <div className="space-y-2 bg-surface p-3 rounded-lg border border-border">
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="Bill Date"
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
            <Input
              label="Due Date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <Input
            label="Notes / Terms"
            placeholder="Notes visible on bill"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      )}

      {/* Datalist for autocomplete */}
      <datalist id="services-list">
        {services.map((s) => (
          <option key={s.id} value={s.name} />
        ))}
      </datalist>

      {/* 6. Action Buttons */}
      <div className="flex gap-2.5 pt-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          className="flex-1"
          loading={saving}
          onClick={() => handleSave(false)}
        >
          {t('common.save')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          className="flex-1"
          loading={saving}
          onClick={() => handleSave(true)}
        >
          {t('common.save_and_new')}
        </Button>
      </div>

      {/* Success Bottom Sheet */}
      <Sheet
        open={isSuccessSheetOpen}
        onOpenChange={setIsSuccessSheetOpen}
        title={`Bill #${savedInvoice?.number || ''} Saved!`}
      >
        <div className="space-y-4 py-2">
          <div className="bg-surface p-4 rounded-lg border border-border text-center space-y-1">
            <div className="text-2xl font-bold text-primary">{formatINR(savedInvoice?.total)}</div>
            <div className="text-xs text-text-muted">
              Paid: {formatINR(savedInvoice?.paid_amount)} · Due: {formatINR((savedInvoice?.total || 0) - (savedInvoice?.paid_amount || 0))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => {
                setIsSuccessSheetOpen(false);
                navigate('/bills');
              }}
            >
              View in Bills
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setIsSuccessSheetOpen(false);
                setItems([{ id: '1', description: '', quantity: '1', rate: '', is_job: false }]);
                setWalkInName('');
                setWalkInMobile('');
                setDiscountType('NONE');
                setDiscountValue('');
                setPaidNow('');
                setNotes('');
              }}
            >
              + Next Bill
            </Button>
          </div>

          {savedInvoice?.party_mobile && (
            <Button
              variant="secondary"
              size="md"
              className="w-full text-success"
              onClick={() => {
                const url = getWhatsAppUrl(
                  savedInvoice.party_mobile,
                  `Hello ${savedInvoice.party_name}, here is your bill #${savedInvoice.number} of ${formatINR(savedInvoice.total)}. Thank you!`
                );
                window.open(url, '_blank');
              }}
            >
              Send WhatsApp Bill
            </Button>
          )}
        </div>
      </Sheet>
    </div>
  );
};
