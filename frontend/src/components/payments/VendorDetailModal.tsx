import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { exportDocumentPDF } from '../documents/pdfExport';
import { Printer, Download, Plus } from 'lucide-react';

export interface VendorDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string | null;
  onRecordPayment?: (vendorId: string) => void;
}

export const VendorDetailModal: React.FC<VendorDetailModalProps> = ({
  open,
  onOpenChange,
  vendorId,
  onRecordPayment,
}) => {
  const { showToast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    vendor: any;
    summary: { total_paid: number; payment_count: number };
    payments: any[];
  } | null>(null);

  const [period, setPeriod] = useState<'MONTH' | 'YEAR' | 'ALL'>('ALL');
  const [exporting, setExporting] = useState(false);

  const fetchVendor = async () => {
    if (!vendorId) return;
    setLoading(true);
    try {
      const now = new Date();
      let fromDate: string | null = null;
      let toDate: string | null = null;

      if (period === 'MONTH') {
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        fromDate = firstDay.toISOString().split('T')[0];
        toDate = lastDay.toISOString().split('T')[0];
      } else if (period === 'YEAR') {
        const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
        fromDate = `${year}-04-01`;
        toDate = `${year + 1}-03-31`;
      }

      const { data: res, error } = await supabase.rpc('vendor_ledger', {
        p_vendor_id: vendorId,
        p_from_date: fromDate,
        p_to_date: toDate,
      });
      if (error) throw error;
      setData(res as any);
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
    window.print();
  };

  const handleExportPDF = async () => {
    if (!printRef.current || !data) return;
    setExporting(true);
    try {
      await exportDocumentPDF(
        printRef.current,
        `Vendor-Statement-${data.vendor.name}.pdf`
      );
      showToast('Vendor statement downloaded successfully', 'success');
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
      title={data?.vendor?.name ? `Vendor Statement: ${data.vendor.name}` : 'Vendor Details'}
      description={data?.vendor?.mobile ? `Mobile: ${data.vendor.mobile}` : undefined}
    >
      <div className="space-y-4 max-h-[80vh] flex flex-col">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl">
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-white text-xs">
            <button
              type="button"
              onClick={() => setPeriod('MONTH')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                period === 'MONTH' ? 'bg-primary text-white shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              This Month
            </button>
            <button
              type="button"
              onClick={() => setPeriod('YEAR')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                period === 'YEAR' ? 'bg-primary text-white shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              This FY
            </button>
            <button
              type="button"
              onClick={() => setPeriod('ALL')}
              className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                period === 'ALL' ? 'bg-primary text-white shadow-2xs font-bold' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Time
            </button>
          </div>

          <div className="flex items-center gap-1.5">
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

        {/* Printable Statement Container */}
        <div ref={printRef} className="space-y-4 overflow-y-auto pr-1">
          {/* Summary Metric Header */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                Total Paid to Vendor
              </div>
              <div className="text-2xl font-black text-danger mt-0.5">
                {formatINR(data?.summary?.total_paid || 0)}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {data?.summary?.payment_count || 0} payment transactions recorded
              </div>
            </div>

            <div className="text-right">
              <span className="text-xs px-2.5 py-1 rounded-full bg-white border border-slate-200 font-bold text-slate-700">
                Vendor Account
              </span>
            </div>
          </div>

          {/* Statement Table */}
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading vendor ledger...</div>
          ) : !data || data.payments.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-xl border border-slate-200">
              No payments recorded for this vendor in this period.
            </div>
          ) : (
            <div className="border border-slate-200 rounded-xl overflow-hidden text-xs divide-y divide-slate-100 bg-white">
              <div className="bg-slate-50 grid grid-cols-12 p-2.5 font-bold text-slate-600 uppercase text-[10px] tracking-wider">
                <div className="col-span-3">Date</div>
                <div className="col-span-4">Description / Bill #</div>
                <div className="col-span-2">Mode / Bank</div>
                <div className="col-span-3 text-right">Amount Paid</div>
              </div>
              {data.payments.map((p) => (
                <div key={p.id} className="grid grid-cols-12 p-3 items-center hover:bg-slate-50/50">
                  <div className="col-span-3 font-medium text-slate-600">
                    {formatDate(p.payment_date)}
                  </div>
                  <div className="col-span-4 pr-1">
                    <div className="font-bold text-slate-900 truncate">{p.description}</div>
                    {p.invoice_number && (
                      <div className="text-[10px] text-primary font-semibold">
                        Linked Bill #{p.invoice_number}
                      </div>
                    )}
                    {p.notes && <div className="text-[10px] text-slate-400">{p.notes}</div>}
                  </div>
                  <div className="col-span-2">
                    <span className="px-2 py-0.5 rounded-full bg-slate-100 text-[10px] font-bold text-slate-700">
                      {p.mode}
                    </span>
                    {p.bank_name && (
                      <div className="text-[10px] text-slate-500 truncate mt-0.5">{p.bank_name}</div>
                    )}
                  </div>
                  <div className="col-span-3 text-right font-black text-danger text-sm">
                    {formatINR(p.amount)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
};
