import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getErrorMessage, t } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Tabs, TabsList, TabsTrigger } from '../ui/Tabs';
import { useToast } from '../ui/Toast';

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

  const [activeTab, setActiveTab] = useState('ledger');
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState<CustomerInfo | null>(null);
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);

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

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={customer?.name || customerName || t('customers.ledger')}
      description={customer?.mobile ? `Mobile: ${customer.mobile} · Type: ${customer.type}` : undefined}
    >
      <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
        {/* Summary Metric Cards */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            <div className="bg-surface p-2.5 rounded-lg border border-border">
              <div className="text-text-muted">{t('customers.billed')}</div>
              <div className="text-sm font-bold text-text mt-0.5">{formatINR(summary.total_billed)}</div>
            </div>
            <div className="bg-surface p-2.5 rounded-lg border border-border">
              <div className="text-text-muted">{t('customers.received')}</div>
              <div className="text-sm font-bold text-success mt-0.5">{formatINR(summary.total_paid)}</div>
            </div>
            <div className="bg-surface p-2.5 rounded-lg border border-border">
              <div className="text-text-muted">{t('dues.title')}</div>
              <div className={`text-sm font-bold mt-0.5 ${summary.balance > 0 ? 'text-danger' : 'text-text'}`}>
                {formatINR(summary.balance)}
              </div>
            </div>
            <div className="bg-surface p-2.5 rounded-lg border border-border">
              <div className="text-text-muted">{t('customers.advance')}</div>
              <div className="text-sm font-bold text-primary mt-0.5">{formatINR(summary.advance)}</div>
            </div>
          </div>
        )}

        {/* Tab switch */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="ledger" className="flex-1">
              Chronological Ledger
            </TabsTrigger>
            <TabsTrigger value="summary" className="flex-1">
              Overview
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {loading ? (
          <div className="p-8 text-center text-xs text-text-muted">Loading customer records...</div>
        ) : activeTab === 'ledger' ? (
          /* Ledger Table */
          <div className="space-y-2">
            {entries.length === 0 ? (
              <div className="p-6 text-center text-xs text-text-muted bg-surface rounded-lg border border-border">
                No billing or payment transactions recorded for this customer yet.
              </div>
            ) : (
              <div className="border border-border rounded-lg overflow-hidden text-xs">
                <div className="bg-surface grid grid-cols-12 p-2.5 font-semibold text-text-muted border-b border-border">
                  <div className="col-span-3">Date</div>
                  <div className="col-span-4">Particulars</div>
                  <div className="col-span-2 text-right">Debit (+)</div>
                  <div className="col-span-2 text-right">Credit (-)</div>
                  <div className="col-span-1 text-right">Bal</div>
                </div>

                <div className="divide-y divide-border/60">
                  {entries.map((entry, idx) => (
                    <div key={idx} className="grid grid-cols-12 p-2.5 items-center">
                      <div className="col-span-3 text-text-muted text-[11px]">
                        {formatDate(entry.entry_date)}
                      </div>
                      <div className="col-span-4 font-medium text-text truncate pr-1">
                        {entry.description}
                      </div>
                      <div className="col-span-2 text-right font-medium text-text">
                        {entry.debit > 0 ? formatINR(entry.debit) : '-'}
                      </div>
                      <div className="col-span-2 text-right font-medium text-success">
                        {entry.credit > 0 ? formatINR(entry.credit) : '-'}
                      </div>
                      <div className="col-span-1 text-right font-bold text-text text-[11px]">
                        {formatINR(entry.running_balance)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Overview Details */
          <div className="space-y-3 bg-surface p-4 rounded-xl border border-border text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Customer Name:</span>
              <span className="font-semibold text-text">{customer?.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Mobile Number:</span>
              <span className="font-semibold text-text">{customer?.mobile || 'Not specified'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Customer Type:</span>
              <span className="font-semibold text-text">{customer?.type}</span>
            </div>
            <div className="flex justify-between pt-2 border-t border-border">
              <span className="text-text-muted">Total Net Outstanding:</span>
              <span className={`font-bold ${summary && summary.balance > 0 ? 'text-danger' : 'text-success'}`}>
                {summary ? formatINR(summary.balance) : '-'}
              </span>
            </div>
          </div>
        )}

        {/* Receive Payment Quick Action */}
        {customer && onReceivePayment && (
          <div className="pt-2 border-t border-border flex justify-end gap-2">
            <Button
              variant="outline"
              size="md"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                onOpenChange(false);
                onReceivePayment({
                  id: customer.id,
                  name: customer.name,
                  mobile: customer.mobile,
                });
              }}
            >
              Receive Payment
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
};
