import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabase';
import { getErrorMessage } from '../../i18n';
import { getWhatsAppUrl } from '../../lib/auth';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { ReceiptDocument } from '../documents/ReceiptDocument';
import { exportReceiptPDF } from '../documents/pdfExport';
import { Printer, Download, Share2 } from 'lucide-react';

export interface ReceiptDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receiptId: string | null;
}

export const ReceiptDetailModal: React.FC<ReceiptDetailModalProps> = ({
  open,
  onOpenChange,
  receiptId,
}) => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    receipt: any;
    customer: any;
    allocations: any[];
    business: any;
  } | null>(null);

  const [format, setFormat] = useState<'a4' | 'thermal80'>('a4');
  const [exporting, setExporting] = useState(false);
  const printDocRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !receiptId) {
      setData(null);
      return;
    }

    const fetchDetail = async () => {
      setLoading(true);
      try {
        const { data: res, error } = await supabase.rpc('receipt_detail', {
          p_receipt_id: receiptId,
        });
        if (error) throw error;
        setData(res as any);
      } catch (err: any) {
        showToast(getErrorMessage(err.message), 'error');
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [open, receiptId]);

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    if (!printDocRef.current || !data) return;
    setExporting(true);
    try {
      await exportReceiptPDF(
        printDocRef.current,
        `Receipt-${data.receipt.number}.pdf`
      );
      showToast('Receipt PDF downloaded successfully', 'success');
    } catch (err: any) {
      showToast('Failed to export PDF: ' + err.message, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleWhatsApp = () => {
    if (!data?.customer?.mobile) {
      showToast('No customer mobile number available', 'error');
      return;
    }
    const message = `Hello ${data.customer.name}, payment receipt #${data.receipt.number} for ${formatINR(data.receipt.amount)} dated ${formatDate(data.receipt.receipt_date)} received via ${data.receipt.mode}. Thank you! - ${data.business?.name || 'SIMPLIFY'}`;
    const url = getWhatsAppUrl(data.customer.mobile, message);
    window.open(url, '_blank');
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={data ? `Payment Receipt #${data.receipt.number}` : 'Loading Receipt...'}
      description={data?.customer ? `Customer: ${data.customer.name}` : undefined}
    >
      <div className="space-y-4 max-h-[80vh] flex flex-col">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-xl">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFormat('a4')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                format === 'a4'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              A4 Document
            </button>
            <button
              type="button"
              onClick={() => setFormat('thermal80')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                format === 'thermal80'
                  ? 'bg-primary text-white shadow-2xs'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Thermal 80mm
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {data?.customer?.mobile && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleWhatsApp}
                title="Send on WhatsApp"
                className="border-emerald-300 text-emerald-800 hover:bg-emerald-50"
              >
                <Share2 className="w-3.5 h-3.5 mr-1" />
                WhatsApp
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              title="Print Receipt"
            >
              <Printer className="w-3.5 h-3.5 mr-1" />
              Print
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={handleDownloadPDF}
              disabled={exporting || loading}
            >
              <Download className="w-3.5 h-3.5 mr-1" />
              {exporting ? 'Exporting...' : 'PDF'}
            </Button>
          </div>
        </div>

        {/* Document Container */}
        <div className="flex-1 overflow-y-auto overflow-x-auto bg-slate-100/80 p-4 rounded-xl border border-slate-200">
          {loading ? (
            <div className="py-20 text-center text-xs text-slate-500 font-medium">
              Loading receipt document...
            </div>
          ) : data ? (
            <div className="flex justify-center">
              <ReceiptDocument
                ref={printDocRef}
                receipt={data.receipt}
                customer={data.customer}
                allocations={data.allocations}
                business={data.business}
                format={format}
              />
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-danger font-medium">
              Failed to load receipt details.
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
};
