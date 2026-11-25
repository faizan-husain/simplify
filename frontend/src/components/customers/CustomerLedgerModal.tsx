import React, { useState, useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getErrorMessage, t } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { setPrintPageSize, exportDocumentPDF } from '../documents/pdfExport';
import { Printer, Download, Plus, Share2, Building2 } from 'lucide-react';

export interface CustomerLedgerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string | null;
  customerName?: string;
  onReceivePayment?: (customer: { id: string; name: string; mobile?: string | null }) => void;
}

interface LedgerSummary {
  opening_balance: number;
  period_billed: number;
  period_paid: number;
  balance: number;
  advance: number;
  from_date?: string | null;
  to_date?: string | null;
}

interface LedgerEntry {
  entry_date: string;
  type: 'OPENING_BALANCE' | 'INVOICE' | 'RECEIPT';
  ref_id?: string | null;
  ref_number: string;
  description: string;
  debit: number;
  credit: number;
  running_balance: number;
}

interface CustomerInfo {
  id: string;
  name: string;
  mobile: string | null;
  type: string;
  address?: string | null;
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

type PeriodType = 'TODAY' | 'MONTH' | 'YEAR' | 'ALL' | 'CUSTOM';

import { SegmentedControl } from '../ui/SegmentedControl';
import { Badge } from '../ui/Badge';

export const CustomerLedgerModal: React.FC<CustomerLedgerModalProps> = ({
  open,
  onOpenChange,
  customerId,
  customerName,
  onReceivePayment,
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

  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [business, setBusiness] = useState<BusinessInfo | null>(null);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);

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

  const fetchLedger = async () => {
    if (!open || !customerId) return;
    setLoading(true);
    try {
      const { fromDate, toDate } = getDateBounds(period);
      const { data, error } = await supabase.rpc('customer_ledger', {
        customer_id: customerId,
        p_from_date: fromDate,
        p_to_date: toDate,
      });

      if (error) throw error;
      const res = data as any;
      setCustomer(res.customer);
      setBusiness(res.business);
      setSummary(res.summary);
      setEntries(res.entries || []);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && customerId) {
      fetchLedger();
    }
  }, [open, customerId, period]);

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

  const handleExportPDF = async () => {
    if (!printRef.current || !customer) return;
    try {
      showToast('Generating statement PDF...', 'info');
      await exportDocumentPDF(printRef.current, `Customer_Statement_${customer.name.replace(/\s+/g, '_')}.pdf`);
      showToast('Statement PDF downloaded', 'success');
    } catch {
      // Fallback is handled automatically inside exportPdf
    }
  };

  const getPeriodLabel = (): string => {
    if (period === 'TODAY') return 'Today';
    if (period === 'MONTH') return 'This Month';
    if (period === 'YEAR') return 'Financial Year 2026-27';
    if (period === 'CUSTOM') return `${formatDate(customFrom)} – ${formatDate(customTo)}`;
    return 'All Time';
  };

  const handleShareWhatsApp = () => {
    if (!customer?.mobile) {
      showToast('Customer mobile number is not available', 'error');
      return;
    }

    const cleanMobile = customer.mobile.replace(/\D/g, '');
    const mobileWithCountry = cleanMobile.length === 10 ? `91${cleanMobile}` : cleanMobile;
    const bizName = business?.name || 'Simplify Billing';
    const periodLabel = getPeriodLabel();

    const text =
      `*Account Statement from ${bizName}*\n` +
      `Customer: ${customer.name}\n` +
      `Period: ${periodLabel}\n` +
      `-----------------------------\n` +
      (period !== 'ALL' ? `Opening Balance: ${formatINR(summary?.opening_balance || 0)}\n` : '') +
      `Total Billed: ${formatINR(summary?.period_billed || 0)}\n` +
      `Total Paid: ${formatINR(summary?.period_paid || 0)}\n` +
      `*Current Balance Due: ${formatINR(summary?.balance || 0)}*\n` +
      ((summary?.advance || 0) > 0 ? `Advance Credit: ${formatINR(summary?.advance || 0)}\n` : '') +
      `-----------------------------\n` +
      ((summary?.balance || 0) > 0 && business?.upi_id
        ? `Pay via UPI: ${business.upi_id}\n`
        : '') +
      `Thank you!`;

    const url = `https://wa.me/${mobileWithCountry}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={customer?.name || customerName || t('customers.ledger')}
      description={customer?.mobile ? `Mobile: ${customer.mobile} · Type: ${customer.type}` : undefined}
      className="sm:max-w-[760px] border-0 shadow-[0_8px_30px_rgba(0,0,0,0.1)]"
    >
      <div className="space-y-4">
        {/* Top Control Bar: Period Filter + Action Buttons */}
        <div className="no-print flex flex-col gap-3 p-3 bg-[#EEF0F3] border-none rounded-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            {/* Period Segmented Control */}
            <div className="overflow-x-auto">
              <SegmentedControl
                value={period}
                onChange={(val) => setPeriod(val as PeriodType)}
                options={[
                  { label: 'Today', value: 'TODAY' },
                  { label: 'This Month', value: 'MONTH' },
                  { label: 'This FY', value: 'YEAR' },
                  { label: 'All Time', value: 'ALL' },
                  { label: 'Custom', value: 'CUSTOM' },
                ]}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:ml-auto">
              {onReceivePayment && customer && (summary?.balance || 0) > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    onOpenChange(false);
                    onReceivePayment(customer);
                  }}
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  Receive Payment
                </Button>
              )}

              <button
                type="button"
                onClick={handleShareWhatsApp}
                disabled={!customer?.mobile}
                title={customer?.mobile ? 'Send statement via WhatsApp' : 'No mobile number'}
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
            </div>
          </div>

          {/* Custom Date Range Selector Bar */}
          {period === 'CUSTOM' && (
            <div className="flex flex-wrap items-center gap-2.5 pt-2 border-t border-slate-200/60 text-xs">
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
                onClick={fetchLedger}
                className="h-7 text-xs px-3 border-0"
              >
                Apply Range
              </Button>
            </div>
          )}
        </div>

        {/* Printable Statement Container */}
        <div ref={printRef} className="space-y-4 pr-1">
          {/* Printable Business & Customer Branding Header */}
          <div className="p-3.5 bg-[#EEF0F3] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-white text-accent flex items-center justify-center shrink-0 shadow-2xs">
                <Building2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-semibold text-text text-sm">{business?.name || 'Business Statement'}</h3>
                <p className="text-[11px] text-text-muted mt-0.5">
                  {business?.address || 'Document & Business Solutions'}
                  {business?.mobile && ` · Phone: ${business.mobile}`}
                </p>
                {business?.upi_id && (
                  <p className="text-[11px] font-medium text-accent mt-0.5">UPI ID: {business.upi_id}</p>
                )}
              </div>
            </div>

            <div className="sm:text-right pt-2 sm:pt-0">
              <div className="flex items-center sm:justify-end gap-2 mb-1">
                <img src="/simplify-logo.png" alt="Simplify" className="h-4 w-auto object-contain opacity-90" />
                <Badge variant="neutral" className="bg-white/80 border-none shadow-2xs">Customer Statement</Badge>
              </div>
              <div className="text-text font-semibold text-xs mt-1">
                {customer?.name || 'Walk-in Customer'}
              </div>
              <div className="text-[11px] text-text-muted">
                {customer?.mobile ? `Mobile: ${customer.mobile}` : 'No phone recorded'}
              </div>
              <div className="text-[10px] font-medium text-text-muted mt-0.5">
                Period: {getPeriodLabel()}
              </div>
            </div>
          </div>

          {/* Summary Metric Cards */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              {period !== 'ALL' && (
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                  <div className="text-slate-500 text-[11px] font-medium">Opening Balance</div>
                  <div className="text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                    {formatINR(summary.opening_balance)}
                  </div>
                </div>
              )}
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                <div className="text-slate-500 text-[11px] font-medium">
                  {period === 'ALL' ? t('customers.billed') : 'Period Billed'}
                </div>
                <div className="text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                  {formatINR(summary.period_billed)}
                </div>
              </div>
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                <div className="text-slate-500 text-[11px] font-medium">
                  {period === 'ALL' ? t('customers.received') : 'Period Paid'}
                </div>
                <div className="text-base font-semibold text-slate-900 tabular-nums mt-0.5">
                  {formatINR(summary.period_paid)}
                </div>
              </div>
              <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                <div className="text-slate-500 text-[11px] font-medium">{t('dues.title')}</div>
                <div
                  className={`text-base font-semibold tabular-nums mt-0.5 ${
                    summary.balance > 0 ? 'text-rose-600' : 'text-slate-900'
                  }`}
                >
                  {formatINR(summary.balance)}
                </div>
              </div>
              {period === 'ALL' && (
                <div className="bg-white p-3.5 rounded-2xl border border-slate-200/90 shadow-2xs">
                  <div className="text-slate-500 text-[11px] font-medium">{t('customers.advance')}</div>
                  <div className="text-base font-semibold text-[#0F766E] tabular-nums mt-0.5">
                    {formatINR(summary.advance)}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Ledger Table */}
          {loading ? (
            <div className="p-8 text-center text-xs text-text-muted">Loading ledger records...</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border-0">
              No transactions recorded for this customer in the selected period.
            </div>
          ) : (
            <div className="border-0 rounded-2xl overflow-x-auto text-xs bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
              <table className="w-full text-left min-w-[560px]">
                <thead className="bg-slate-50 text-slate-500 font-semibold uppercase text-[10px] tracking-wider border-b border-slate-100">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3 text-center">Type</th>
                    <th className="py-2.5 px-3">Ref # / Details</th>
                    <th className="py-2.5 px-3 text-right">Debit (Billed +)</th>
                    <th className="py-2.5 px-3 text-right">Credit (Paid -)</th>
                    <th className="py-2.5 px-3 text-right">Balance Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.map((e, idx) => (
                    <tr
                      key={idx}
                      className={
                        e.type === 'OPENING_BALANCE'
                          ? 'bg-surface-2/40 font-medium'
                          : 'hover:bg-surface-2/50 transition-colors'
                      }
                    >
                      <td className="py-2.5 px-3 text-text-muted whitespace-nowrap">
                        {formatDate(e.entry_date)}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span
                          className={clsx(
                            'w-[74px] inline-flex items-center justify-center py-0.5 rounded-md text-[11px] font-semibold text-center shrink-0 border-0',
                            e.type === 'INVOICE'
                              ? 'bg-slate-100 text-slate-700'
                              : e.type === 'RECEIPT'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-slate-100 text-slate-500'
                          )}
                        >
                          {e.type === 'OPENING_BALANCE'
                            ? 'Opening'
                            : e.type === 'INVOICE'
                            ? 'Bill'
                            : 'Receipt'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-text">
                        {e.type === 'OPENING_BALANCE' ? (
                          <span className="text-text font-medium">{e.description}</span>
                        ) : (
                          <span>
                            #{e.ref_number}{' '}
                            <span className="text-[11px] text-text-muted font-normal">
                              ({e.description})
                            </span>
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-text tabular-nums whitespace-nowrap">
                        {e.debit > 0 ? formatINR(e.debit) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-medium text-text tabular-nums whitespace-nowrap">
                        {e.credit > 0 ? formatINR(e.credit) : '—'}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-semibold tabular-nums whitespace-nowrap ${
                          e.running_balance > 0 ? 'text-danger-fg' : 'text-text'
                        }`}
                      >
                        {formatINR(e.running_balance)}
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
  );
};
