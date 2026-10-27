import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate } from '../lib/dates';
import { t, getErrorMessage } from '../i18n';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { StatusDot } from '../components/ui/StatusDot';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import { BillDetailModal } from '../components/bills/BillDetailModal';
import { Plus, Search } from 'lucide-react';
import { Database } from '../types/supabase';

type Invoice = Database['public']['Tables']['invoices']['Row'];
type InvoiceItem = Database['public']['Tables']['invoice_items']['Row'];

type InvoiceFilter = 'ALL' | 'PAID' | 'PARTIAL' | 'UNPAID' | 'OVERDUE' | 'CANCELLED';

export const BillsPage: React.FC = () => {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InvoiceFilter>('ALL');

  // Selected bill for detail view
  const [selectedInvoice, setSelectedInvoice] = useState<(Invoice & { invoice_items?: InvoiceItem[] }) | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const fetchInvoices = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('invoices')
        .select('*')
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
    // Fetch items
    const { data: items } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', inv.id);

    setSelectedInvoice({
      ...inv,
      invoice_items: (items as InvoiceItem[]) || [],
    });
    setIsDetailOpen(true);
  };

  const filteredInvoices = invoices.filter((inv) => {
    // Status filter
    const bal = inv.total - inv.paid_amount;
    const isOverdue = inv.status === 'ACTIVE' && bal > 0 && new Date(inv.due_date) < new Date();

    if (filter === 'PAID' && (inv.status !== 'ACTIVE' || inv.paid_amount < inv.total)) return false;
    if (filter === 'PARTIAL' && (inv.status !== 'ACTIVE' || inv.paid_amount <= 0 || inv.paid_amount >= inv.total)) return false;
    if (filter === 'UNPAID' && (inv.status !== 'ACTIVE' || inv.paid_amount > 0)) return false;
    if (filter === 'OVERDUE' && !isOverdue) return false;

    // Search filter
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchNo = inv.number.toLowerCase().includes(q);
      const matchParty = inv.party_name.toLowerCase().includes(q);
      const matchMobile = inv.party_mobile && inv.party_mobile.includes(q);
      return matchNo || matchParty || matchMobile;
    }

    return true;
  });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">{t('nav.bills')}</h1>
          <p className="text-xs text-text-muted">{invoices.length} total bills</p>
        </div>
        <Button variant="primary" size="md" onClick={() => navigate('/bills/new')}>
          <Plus className="w-4 h-4 mr-1.5" />
          <span>{t('nav.new_bill')}</span>
        </Button>
      </div>

      {/* Search & Filter Bar */}
      <div className="space-y-2">
        <div className="relative">
          <Input
            placeholder="Search by bill no, party, mobile..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
          />
        </div>

        {/* Filter Chips */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {(['ALL', 'PAID', 'PARTIAL', 'UNPAID', 'OVERDUE', 'CANCELLED'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                filter === mode
                  ? 'bg-primary text-white shadow-sm'
                  : 'bg-surface text-text-muted hover:text-text border border-border'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Bills List */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : filteredInvoices.length === 0 ? (
        <EmptyState
          message="No bills found"
          actionLabel={t('nav.new_bill')}
          onAction={() => navigate('/bills/new')}
        />
      ) : (
        <div className="space-y-2">
          {filteredInvoices.map((inv) => {
            const bal = Math.max(0, inv.total - inv.paid_amount);
            const isOverdue = inv.status === 'ACTIVE' && bal > 0 && new Date(inv.due_date) < new Date();
            const statusVariant = inv.status === 'CANCELLED' ? 'cancelled' : inv.paid_amount >= inv.total ? 'paid' : inv.paid_amount > 0 ? 'partial' : 'unpaid';

            return (
              <Card
                key={inv.id}
                className="cursor-pointer hover:border-gray-400 p-3.5 flex items-center justify-between transition-colors"
                onClick={() => handleOpenDetail(inv)}
              >
                <div className="min-w-0 flex-1 mr-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-primary font-mono">{inv.number}</span>
                    <StatusDot status={statusVariant} />
                    {isOverdue && (
                      <span className="text-[10px] text-danger font-bold">OVERDUE</span>
                    )}
                  </div>
                  <div className="text-sm font-semibold text-text truncate mt-0.5">
                    {inv.party_name}
                  </div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {formatDate(inv.invoice_date)}
                    {inv.party_mobile && ` · ${inv.party_mobile}`}
                  </div>
                </div>

                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold text-text">{formatINR(inv.total)}</div>
                  <div className={`text-xs mt-0.5 ${bal > 0 ? 'text-danger font-medium' : 'text-text-muted'}`}>
                    {bal > 0 ? `Due: ${formatINR(bal)}` : 'Paid in full'}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      <BillDetailModal
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        invoice={selectedInvoice}
        onInvoiceUpdated={() => fetchInvoices()}
        onReceivePayment={(inv) => {
          navigate(`/money?tab=receipts&action=receive&invoice_id=${inv.id}&customer_id=${inv.customer_id || ''}`);
        }}
      />
    </div>
  );
};
