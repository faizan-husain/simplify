import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';

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
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{
    vendor: any;
    total_paid: number;
    payments: any[];
  } | null>(null);

  useEffect(() => {
    if (!open || !vendorId) return;
    const fetchVendor = async () => {
      setLoading(true);
      try {
        const { data: res, error } = await supabase.rpc('vendor_detail', {
          p_vendor_id: vendorId,
        });
        if (error) throw error;
        setData(res as any);
      } catch (err: any) {
        showToast(getErrorMessage(err.message), 'error');
      } finally {
        setLoading(false);
      }
    };
    fetchVendor();
  }, [open, vendorId]);

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={data?.vendor?.name || 'Vendor Details'}
      description={data?.vendor?.mobile ? `Mobile: ${data.vendor.mobile}` : undefined}
    >
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        <div className="bg-surface p-3.5 rounded-xl border border-border flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-text-muted uppercase">Total Paid to Vendor</div>
            <div className="text-xl font-bold text-text mt-0.5">
              {formatINR(data?.total_paid || 0)}
            </div>
          </div>
          {onRecordPayment && vendorId && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                onOpenChange(false);
                onRecordPayment(vendorId);
              }}
            >
              + New Payment
            </Button>
          )}
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-text-muted">Loading vendor payments...</div>
        ) : !data || data.payments.length === 0 ? (
          <div className="p-6 text-center text-xs text-text-muted bg-surface rounded-lg border border-border">
            No payments recorded for this vendor yet.
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden text-xs divide-y divide-border/60">
            <div className="bg-surface grid grid-cols-12 p-2.5 font-semibold text-text-muted">
              <div className="col-span-3">Date</div>
              <div className="col-span-4">Description</div>
              <div className="col-span-2">Mode</div>
              <div className="col-span-3 text-right">Amount</div>
            </div>
            {data.payments.map((p) => (
              <div key={p.id} className="grid grid-cols-12 p-2.5 items-center">
                <div className="col-span-3 text-text-muted">{formatDate(p.payment_date)}</div>
                <div className="col-span-4 font-medium text-text truncate pr-1">{p.description}</div>
                <div className="col-span-2 text-text-muted">{p.mode}</div>
                <div className="col-span-3 text-right font-bold text-text">{formatINR(p.amount)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
};
