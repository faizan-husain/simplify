import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getErrorMessage, t } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { exportDocumentPDF } from '../documents/pdfExport';
import { Printer, Download, Plus } from 'lucide-react';

export interface CustomerLedgerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string | null;
  customerName?: string;
  onReceivePayment?: (customer: { id: string; name: string; mobile?: string | null }) => void;
}

interface LedgerSummary {
  total_billed: number;
  total_paid: number;
  balance: number;
  advance: number;
}

interface LedgerEntry {
  entry_date: string;
  type: 'INVOICE' | 'RECEIPT';
  ref_id: string;
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
}

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
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!open || !customerId) return;

    const fetchLedger = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.rpc('customer_ledger', {
          customer_id: customerId,
        });

        if (error) throw error;
        const res = data as any;
        setCustomer(res.customer);
        setSummary(res.summary);
        setEntries(res.entries || []);
      } catch (err: any) {
        showToast(getErrorMessage(err.message), 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchLedger();
  }, [open, customerId]);

  const handlePrint = () => {
    window.print();
  };

  const handleExportPDF = async () => {
    if (!printRef.current || !customer) return;
    setExporting(true);
    try {
      await exportDocumentPDF(
        printRef.current,
        `Customer-Statement-${customer.name}.pdf`
      );
      showToast('Customer statement downloaded successfully', 'success');
    } catch (err: any) {
      showToast('Failed to export PDF: ' + err.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={customer?.name || customerName || t('customers.ledger')}
      description={customer?.mobile ? `Mobile: ${customer.mobile} · Type: ${customer.type}` : undefined}
    >
      <div className="space-y-4 max-h-[80vh] flex flex-col">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl">
          <div className="flex items-center gap-1">
            <span className="text-xs font-bold text-slate-700">Account Statement</span>
          </div>

          <div className="flex items-center gap-1.5">
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

            <Button
              variant="outline"
              size="sm"
              onClick={handleExportPDF}
              disabled={exporting || loading}
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              PDF
            </Button>

            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="w-3.5 h-3.5 mr-1" />
              Print
            </Button>
          </div>
        </div>

        {/* Printable Container */}
        <div ref={printRef} className="space-y-4 overflow-y-auto pr-1">
          {/* Summary Metric Cards */}
          {summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div className="text-slate-500 font-semibold">{t('customers.billed')}</div>
                <div className="text-base font-bold text-slate-900 mt-0.5">
                  {formatINR(summary.total_billed)}
                </div>
              </div>
              <div className="bg-emerald-50/70 p-3 rounded-xl border border-emerald-200">
                <div className="text-emerald-800 font-semibold">{t('customers.received')}</div>
                <div className="text-base font-black text-success mt-0.5">
                  {formatINR(summary.total_paid)}
                </div>
              </div>
              <div className="bg-rose-50/70 p-3 rounded-xl border border-rose-200">
                <div className="text-rose-800 font-semibold">{t('dues.title')}</div>
                <div className={`text-base font-black mt-0.5 ${summary.balance > 0 ? 'text-danger' : 'text-slate-800'}`}>
                  {formatINR(summary.balance)}
                </div>
              </div>
              <div className="bg-blue-50/70 p-3 rounded-xl border border-blue-200">
                <div className="text-primary font-semibold">{t('customers.advance')}</div>
                <div className="text-base font-black text-primary mt-0.5">
                  {formatINR(summary.advance)}
                </div>
              </div>
            </div>
          )}

          {/* Ledger Table */}
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading customer records...</div>
          ) : entries.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
              No billing or payment transactions recorded for this customer yet.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden text-xs bg-white">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-600 font-bold uppercase text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-3">Ref #</th>
                    <th className="py-2.5 px-3 text-right">Debit (Billed +)</th>
                    <th className="py-2.5 px-3 text-right">Credit (Paid -)</th>
                    <th className="py-2.5 px-3 text-right">Balance Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {entries.map((e, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3 font-medium text-slate-600 whitespace-nowrap">
                        {formatDate(e.entry_date)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                            e.type === 'INVOICE'
                              ? 'bg-blue-50 text-primary border-blue-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}
                        >
                          {e.type === 'INVOICE' ? '🧾 Bill' : '💳 Receipt'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-slate-900 whitespace-nowrap">
                        #{e.ref_number}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-slate-900 whitespace-nowrap">
                        {e.debit > 0 ? formatINR(e.debit) : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-black text-success whitespace-nowrap">
                        {e.credit > 0 ? formatINR(e.credit) : '—'}
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-black whitespace-nowrap ${
                          e.running_balance > 0 ? 'text-danger' : 'text-slate-700'
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
        </div>
      </div>
    </Dialog>
  );
};
