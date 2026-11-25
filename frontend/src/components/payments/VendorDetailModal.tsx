import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import { setPrintPageSize } from '../documents/pdfExport';
import { Printer, Download, Plus, Share2, Building2, Pencil, Trash2 } from 'lucide-react';

export interface VendorDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string | null;
  onRecordPayment?: (vendorId: string) => void;
  onVendorUpdated?: () => void;
}

type PeriodType = 'TODAY' | 'MONTH' | 'YEAR' | 'ALL' | 'CUSTOM';

interface VendorSummary {
  total_paid: number;
  payment_count: number;
  cash_paid: number;
  bank_paid: number;
  from_date?: string | null;
  to_date?: string | null;
}

interface VendorPayment {
  id: string;
  payment_date: string;
  description: string;
  amount: number;
  mode: string;
  bank_name?: string | null;
  notes?: string | null;
  invoice_id?: string | null;
  invoice_number?: string | null;
  cumulative_paid?: number;
  created_at: string;
}

interface VendorInfo {
  id: string;
  name: string;
  mobile: string | null;
  created_at?: string;
}

interface BusinessInfo {
  id: string;
  name: string;
  owner_name?: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  upi_id?: string | null;
}

export const VendorDetailModal: React.FC<VendorDetailModalProps> = ({
  open,
  onOpenChange,
  vendorId,
  onRecordPayment,
  onVendorUpdated,
}) => {
  const { showToast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<PeriodType>('YEAR');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().split('T')[0]);

  const [vendor, setVendor] = useState<VendorInfo | null>(null);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [summary, setSummary] = useState<VendorSummary | null>(null);
  const [payments, setPayments] = useState<VendorPayment[]>([]);

  // Edit / Delete vendor states
  const [isEditVendorOpen, setIsEditVendorOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editMobile, setEditMobile] = useState('');
  const [savingVendor, setSavingVendor] = useState(false);
  const [isDeleteVendorOpen, setIsDeleteVendorOpen] = useState(false);
  const [deletingVendor, setDeletingVendor] = useState(false);

  const handleSaveVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendorId || !editName.trim()) return;
    setSavingVendor(true);
    try {
      const { error } = await supabase
        .from('vendors')
        .update({
          name: editName.trim(),
          mobile: editMobile.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', vendorId);

      if (error) throw error;
      showToast('Vendor updated successfully', 'success');
      setVendor((prev) => (prev ? { ...prev, name: editName.trim(), mobile: editMobile.trim() || null } : null));
      setIsEditVendorOpen(false);
      onVendorUpdated?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSavingVendor(false);
    }
  };

  const handleDeleteVendor = async () => {
    if (!vendorId) return;
    setDeletingVendor(true);
    try {
      const { error } = await supabase.rpc('soft_delete', {
        p_table: 'vendors',
        p_id: vendorId,
      });

      if (error) throw error;
      showToast('Vendor deleted successfully', 'success');
      setIsDeleteVendorOpen(false);
      onOpenChange(false);
      onVendorUpdated?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setDeletingVendor(false);
    }
  };

  const getDateBounds = (p: PeriodType): { fromDate: string | null; toDate: string | null } => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    if (p === 'TODAY') {
      const todayStr = toYMD(now);
      return { fromDate: todayStr, toDate: todayStr };
    }
    if (p === 'MONTH') {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { fromDate: toYMD(first), toDate: toYMD(last) };
    }
    if (p === 'YEAR') {
      const currentYear = now.getFullYear();
      const isPostApril = now.getMonth() >= 3;
      const startYear = isPostApril ? currentYear : currentYear - 1;
      return {
        fromDate: `${startYear}-04-01`,
        toDate: `${startYear + 1}-03-31`,
      };
    }
    if (p === 'CUSTOM') {
      return { fromDate: customFrom || null, toDate: customTo || null };
    }
    return { fromDate: null, toDate: null };
  };

  const fetchVendor = async () => {
    if (!vendorId) return;
    setLoading(true);
    try {
      const { fromDate, toDate } = getDateBounds(period);
      const { data: res, error } = await supabase.rpc('vendor_ledger', {
        p_vendor_id: vendorId,
        p_from_date: fromDate,
        p_to_date: toDate,
      });
      if (error) throw error;
      const json = res as any;
      setVendor(json.vendor);
      setBusiness(json.business);
      setSummary(json.summary);
      setPayments(json.payments || []);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && vendorId) {
      fetchVendor();
    }
  }, [open, vendorId, period]);

  const handlePrint = () => {
    setPrintPageSize('a4', 8);
    document.body.classList.add('printing-statement-active');
    const cleanup = () => {
      document.body.classList.remove('printing-statement-active');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  const handleExportPDF = () => {
    handlePrint();
  };

  const getPeriodLabel = (): string => {
    if (period === 'TODAY') return 'Today';
    if (period === 'MONTH') return 'This Month';
    if (period === 'YEAR') return 'Financial Year 2026-27';
    if (period === 'CUSTOM') return `${formatDate(customFrom)} – ${formatDate(customTo)}`;
    return 'All Time';
  };

  const handleShareWhatsApp = () => {
    if (!vendor?.mobile) {
      showToast('Vendor mobile number is not available', 'error');
      return;
    }

    const cleanMobile = vendor.mobile.replace(/\D/g, '');
    const mobileWithCountry = cleanMobile.length === 10 ? `91${cleanMobile}` : cleanMobile;
    const bizName = business?.name || 'Simplify Billing';
    const periodLabel = getPeriodLabel();

    const text =
      `*Vendor Payment Statement from ${bizName}*\n` +
      `Vendor: ${vendor.name}\n` +
      `Period: ${periodLabel}\n` +
      `-----------------------------\n` +
      `Total Paid: ${formatINR(summary?.total_paid || 0)}\n` +
      `Cash Paid: ${formatINR(summary?.cash_paid || 0)}\n` +
      `Bank/UPI Paid: ${formatINR(summary?.bank_paid || 0)}\n` +
      `Payment Entries: ${summary?.payment_count || 0}\n` +
      `-----------------------------\n` +
      `Generated on: ${formatDate(new Date())}\n` +
      `Thank you for your business!`;

    const url = `https://wa.me/${mobileWithCountry}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  if (!open) return null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={vendor?.name ? `Vendor Statement: ${vendor.name}` : 'Vendor Details'}
        description={vendor?.mobile ? `Mobile: ${vendor.mobile}` : undefined}
        className="sm:max-w-[760px]"
      >
      <div className="space-y-3">
        {/* Top Control Bar: Period Filter + Action Buttons */}
        <div className="no-print flex flex-col gap-2 p-2 bg-[#EEF0F3] border-none rounded-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Period Filter Chips */}
            <div className="overflow-x-auto max-w-full">
              <div className="inline-flex rounded-xl border-0 p-0.5 bg-white text-xs whitespace-nowrap shadow-2xs">
                <button
                  type="button"
                  onClick={() => setPeriod('TODAY')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                    period === 'TODAY'
                      ? 'bg-slate-900 text-white shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod('MONTH')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                    period === 'MONTH'
                      ? 'bg-slate-900 text-white shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  This Month
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod('YEAR')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                    period === 'YEAR'
                      ? 'bg-slate-900 text-white shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  This FY
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod('ALL')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                    period === 'ALL'
                      ? 'bg-slate-900 text-white shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Time
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod('CUSTOM')}
                  className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                    period === 'CUSTOM'
                      ? 'bg-slate-900 text-white shadow-2xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Custom Range
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto sm:ml-auto">
              {onRecordPayment && vendorId && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onRecordPayment(vendorId);
                  }}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Pay Vendor
                </Button>
              )}

              <button
                type="button"
                onClick={handleShareWhatsApp}
                disabled={!vendor?.mobile}
                title={vendor?.mobile ? 'Send statement via WhatsApp' : 'No mobile number'}
                className="h-8 px-2.5 rounded-xl border-0 bg-white hover:bg-emerald-50 text-emerald-700 hover:text-emerald-800 text-xs font-semibold shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <Share2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>WhatsApp</span>
              </button>

              <button
                type="button"
                onClick={handleExportPDF}
                disabled={loading}
                title="Export PDF Document"
                className="h-8 px-2.5 rounded-xl border-0 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-semibold shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <Download className="w-3.5 h-3.5 text-slate-500" />
                <span>PDF</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                disabled={loading}
                title="Print Statement"
                className="h-8 px-2.5 rounded-xl border-0 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 text-xs font-semibold shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              >
                <Printer className="w-3.5 h-3.5 text-slate-500" />
                <span>Print</span>
              </button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditName(vendor?.name || '');
                  setEditMobile(vendor?.mobile || '');
                  setIsEditVendorOpen(true);
                }}
                title="Edit Vendor Details"
                className="border-0 bg-slate-100/90 hover:bg-[#EAF2F1] text-slate-700 hover:text-[#0F766E] shadow-2xs text-xs font-semibold transition-all hover:scale-105"
              >
                <Pencil className="w-3.5 h-3.5 mr-1" />
                Edit
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDeleteVendorOpen(true)}
                title="Delete Vendor"
                className="border-0 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 shadow-2xs text-xs font-semibold transition-all hover:scale-105"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Delete
              </Button>
            </div>
          </div>

          {/* Custom Date Range Selector Bar */}
          {period === 'CUSTOM' && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200/60 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">From:</span>
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="px-2.5 py-1 rounded-xl border-0 shadow-2xs text-xs bg-white text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-[#0F766E]/20"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-slate-500 font-medium">To:</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="px-2.5 py-1 rounded-xl border-0 shadow-2xs text-xs bg-white text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-[#0F766E]/20"
                />
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={fetchVendor}
                className="h-7 text-xs px-3"
              >
                Apply Range
              </Button>
            </div>
          )}
        </div>

        {/* Printable Statement Container */}
        <div ref={printRef} className="space-y-4 pr-1">
          {/* Printable Business & Vendor Branding Header */}
          <div className="p-3.5 bg-[#EEF0F3] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white text-accent flex items-center justify-center shrink-0 shadow-2xs">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-semibold text-text text-sm">{business?.name || 'Business Statement'}</h3>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {business?.address || 'Document & Business Solutions'}
                  {business?.mobile && ` · Phone: ${business.mobile}`}
                </p>
              </div>
            </div>

            <div className="sm:text-right pt-2 sm:pt-0">
              <div className="flex items-center sm:justify-end gap-2 mb-1">
                <img src="/simplify-logo.png" alt="Simplify" className="h-4 w-auto object-contain opacity-90" />
                <span className="text-[10px] uppercase font-medium tracking-wider px-2 py-0.5 rounded-full bg-white/80 text-text-muted shadow-2xs">
                  Vendor Statement
                </span>
              </div>
              <div className="text-text font-medium text-xs mt-1">
                {vendor?.name || 'Vendor'}
              </div>
              <div className="text-[11px] text-text-muted">
                {vendor?.mobile ? `Mobile: ${vendor.mobile}` : 'No phone recorded'}
              </div>
              <div className="text-[10px] font-medium text-text-muted mt-0.5">
                Period: {getPeriodLabel()}
              </div>
            </div>
          </div>

          {/* Summary Metric Header 4-pack */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-1">
              <div className="text-xs text-slate-500 font-medium">Total Paid</div>
              <div className="text-xl font-semibold text-slate-900 tabular-nums">
                {formatINR(summary?.total_paid || 0)}
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-1">
              <div className="text-xs text-slate-500 font-medium">Cash Paid</div>
              <div className="text-xl font-semibold text-slate-900 tabular-nums">
                {formatINR(summary?.cash_paid || 0)}
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-1">
              <div className="text-xs text-slate-500 font-medium">Bank / Online Paid</div>
              <div className="text-xl font-semibold text-slate-900 tabular-nums">
                {formatINR(summary?.bank_paid || 0)}
              </div>
            </div>
            <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs space-y-1">
              <div className="text-xs text-slate-500 font-medium">Payments Count</div>
              <div className="text-xl font-semibold text-slate-900 tabular-nums">
                {summary?.payment_count || 0}
              </div>
            </div>
          </div>

          {/* Payment History Table */}
          {loading ? (
            <div className="p-8 text-center text-xs text-text-muted">Loading vendor payments...</div>
          ) : payments.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border-0">
              No payments made to this vendor in the selected period.
            </div>
          ) : (
            <div className="border-0 rounded-2xl overflow-x-auto text-xs bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <table className="w-full text-left min-w-[520px]">
                <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-100 text-[10px] tracking-wider font-semibold">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Description</th>
                    <th className="py-2.5 px-3">Mode &amp; Account</th>
                    <th className="py-2.5 px-3">Linked Bill</th>
                    <th className="py-2.5 px-3 text-right">Amount Paid</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-3 font-medium text-slate-500 whitespace-nowrap">
                        {formatDate(p.payment_date)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-slate-900">{p.description}</div>
                        {p.notes && <div className="text-[11px] text-slate-500">{p.notes}</div>}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-medium border-0 bg-slate-100 text-slate-700">
                          {p.mode}
                        </span>
                        {p.bank_name && (
                          <span className="ml-1.5 text-[11px] text-text-muted font-normal">
                            {p.bank_name}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        {p.invoice_number ? (
                          <span className="font-bold text-slate-800">#{p.invoice_number}</span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-danger whitespace-nowrap">
                        {formatINR(p.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Official Marketing Footer */}
          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-1 text-[10px] text-slate-400">
            <div className="flex items-center gap-1.5">
              <span>Powered by</span>
              <img src="/simplify-logo.png" alt="Simplify" className="h-3.5 w-auto object-contain inline-block" />
              <span>Business Management &amp; Billing Software</span>
            </div>
            <div>Verified Business Records · Confidential</div>
          </div>
        </div>
      </div>
    </Dialog>

    {/* Edit Vendor Modal */}
    <Dialog
      open={isEditVendorOpen}
      onOpenChange={setIsEditVendorOpen}
      title="Edit Vendor"
      description="Update vendor business name and phone number"
      className="max-w-sm"
    >
      <form onSubmit={handleSaveVendor} className="space-y-4">
        <Input
          label="Vendor Name"
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          required
          autoFocus
        />
        <Input
          label="Mobile Number (Optional)"
          value={editMobile}
          onChange={(e) => setEditMobile(e.target.value)}
          placeholder="10-digit mobile"
        />
        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setIsEditVendorOpen(false)}
            disabled={savingVendor}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={savingVendor}
          >
            Save Changes
          </Button>
        </div>
      </form>
    </Dialog>

    {/* Delete Vendor Confirmation */}
    <ConfirmDialog
      open={isDeleteVendorOpen}
      onOpenChange={setIsDeleteVendorOpen}
      title={`Delete Vendor: ${vendor?.name || ''}`}
      description="Are you sure you want to delete this vendor? Historical payments made to this vendor will remain preserved for accounting."
      confirmLabel="Delete Vendor"
      variant="danger"
      loading={deletingVendor}
      onConfirm={handleDeleteVendor}
    />
  </>
  );
};
