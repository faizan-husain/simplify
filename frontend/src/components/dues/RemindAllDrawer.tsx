import React, { useState } from 'react';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getWhatsAppUrl } from '../../lib/auth';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useAuth } from '../../context/AuthContext';
import { Share2, ArrowRight } from 'lucide-react';

export interface DueCustomerItem {
  customer_id: string;
  customer_name: string;
  customer_mobile: string | null;
  total_due: number;
  bill_count: number;
  oldest_bill_date: string;
}

export interface RemindAllDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customers: DueCustomerItem[];
}

export const RemindAllDrawer: React.FC<RemindAllDrawerProps> = ({
  open,
  onOpenChange,
  customers,
}) => {
  const { business } = useAuth();
  const [currentIndex, setCurrentIndex] = useState(0);

  // Filter only customers with mobile numbers
  const actionable = customers.filter((c) => Boolean(c.customer_mobile));

  if (!open) return null;

  const current = actionable[currentIndex];
  const isFinished = !current || currentIndex >= actionable.length;

  const handleSend = () => {
    if (!current?.customer_mobile) return;
    const upiNote = business?.upi_id ? ` Payment UPI: ${business.upi_id}.` : '';
    const message = `Namaste ${current.customer_name}, your outstanding with ${business?.name || 'SIMPLIFY'} is ${formatINR(current.total_due)} across ${current.bill_count} bills (oldest ${formatDate(current.oldest_bill_date)}).${upiNote} Thank you!`;
    const url = getWhatsAppUrl(current.customer_mobile, message);
    window.open(url, '_blank');
    setCurrentIndex((prev) => prev + 1);
  };

  const handleSkip = () => {
    setCurrentIndex((prev) => prev + 1);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setCurrentIndex(0);
        onOpenChange(v);
      }}
      title="Remind All Dues Queue"
      description={
        actionable.length > 0 && !isFinished
          ? `Customer ${currentIndex + 1} of ${actionable.length}`
          : undefined
      }
    >
      {actionable.length === 0 ? (
        <div className="py-6 text-center text-xs text-text-muted">
          No customers with mobile numbers in this dues list.
        </div>
      ) : isFinished ? (
        <div className="py-8 text-center space-y-3">
          <div className="text-sm font-bold text-text">Reminder Queue Completed</div>
          <p className="text-xs text-text-muted">
            All {actionable.length} customers have been reviewed.
          </p>
          <Button
            variant="primary"
            size="md"
            className="w-full"
            onClick={() => {
              setCurrentIndex(0);
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-surface p-4 rounded-xl border border-border text-xs space-y-2">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-sm font-bold text-text">{current.customer_name}</div>
                <div className="text-text-muted mt-0.5">{current.customer_mobile}</div>
              </div>
              <div className="text-right">
                <div className="text-base font-bold text-danger">{formatINR(current.total_due)}</div>
                <div className="text-text-muted">{current.bill_count} unpaid bill{current.bill_count > 1 ? 's' : ''}</div>
              </div>
            </div>

            <div className="pt-2 border-t border-border flex justify-between text-text-muted">
              <span>Oldest Bill Date:</span>
              <span className="font-medium text-text">{formatDate(current.oldest_bill_date)}</span>
            </div>
          </div>

          <div className="p-3 bg-white border border-border rounded-lg text-xs text-text-muted italic">
            "Namaste {current.customer_name}, your outstanding with {business?.name || 'SIMPLIFY'} is{' '}
            {formatINR(current.total_due)} across {current.bill_count} bills (oldest{' '}
            {formatDate(current.oldest_bill_date)}).
            {business?.upi_id ? ` Payment UPI: ${business.upi_id}.` : ''} Thank you!"
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              className="flex-1"
              onClick={handleSkip}
            >
              Skip
              <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              className="flex-1"
              onClick={handleSend}
            >
              <Share2 className="w-3.5 h-3.5 mr-1.5" />
              Send WhatsApp
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
};
