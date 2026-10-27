import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate, getFYLabel } from '../lib/dates';
import { getErrorMessage } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { EmptyState } from '../components/ui/EmptyState';
import { PrivacyPinModal } from '../components/privacy/PrivacyPinModal';
import {
  Download,
  TrendingUp,
  TrendingDown,
  Building,
} from 'lucide-react';

type ReportType =
  | 'pnl'
  | 'invoices'
  | 'receipts'
  | 'payments'
  | 'expenses'
  | 'outstanding'
  | 'loans'
  | 'jobs'
  | 'commission';

export const ReportsPage: React.FC = () => {
  const { role } = useAuth();
  const { showToast } = useToast();

  const currentFY = getFYLabel(new Date());

  const [activeReport, setActiveReport] = useState<ReportType>('pnl');
  const [selectedFY, setSelectedFY] = useState(currentFY);
  const [loading, setLoading] = useState(true);
  const [reportData, setReportData] = useState<any>(null);

  // Privacy PIN state
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pendingFY, setPendingFY] = useState<string | null>(null);

  const availableFYs = [
    { label: `${currentFY} (Current)`, value: currentFY },
    { label: '2025-26', value: '2025-26' },
    { label: '2024-25', value: '2024-25' },
    { label: '2023-24', value: '2023-24' },
  ];

  const loadReport = async (fyToUse = selectedFY, typeToUse = activeReport) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('report', {
        type: typeToUse,
        params: { fy_label: fyToUse },
      });
      if (error) throw error;
      setReportData(data);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport(selectedFY, activeReport);
  }, [activeReport, selectedFY]);

  const handleFYChange = async (newFY: string) => {
    if (newFY === currentFY) {
      setSelectedFY(newFY);
      return;
    }

    // Checking if privacy pin is set and not unlocked in this session
    const isUnlocked = Boolean(sessionStorage.getItem('privacy_pin_unlocked'));
    if (!isUnlocked) {
      const { data: hasPin } = await supabase.rpc('has_privacy_pin');
      if (hasPin) {
        setPendingFY(newFY);
        setPinModalOpen(true);
        return;
      }
    }

    setSelectedFY(newFY);
  };

  const handleExportCSV = () => {
    if (!reportData) return;

    let rows: any[] = [];
    let filename = `${activeReport}-${selectedFY}.csv`;

    if (activeReport === 'pnl') {
      rows = (reportData.monthly_trend || []).map((m: any) => ({
        Month: m.month,
        Income: m.income,
        Outgoing: m.outgoing,
        NetProfit: m.profit,
      }));
    } else if (reportData.rows) {
      rows = reportData.rows;
    }

    if (rows.length === 0) {
      showToast('No data to export', 'error');
      return;
    }

    const headers = Object.keys(rows[0]);
    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [
        headers.join(','),
        ...rows.map((row) =>
          headers
            .map((h) => {
              const val = row[h];
              if (val === null || val === undefined) return '';
              const str = String(val).replace(/"/g, '""');
              return `"${str}"`;
            })
            .join(',')
        ),
      ].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Exported ${filename}`, 'success');
  };

  if (role === 'STAFF') {
    return (
      <div className="p-8 text-center text-text-muted">
        Reports are accessible only to Owners and Accountants.
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">Business Reports</h1>
          <p className="text-xs text-text-muted">
            Financial Year statements, cash-basis profit, and operational audits
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-44">
            <Select
              value={selectedFY}
              onChange={handleFYChange}
              options={availableFYs}
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportCSV}
            disabled={!reportData}
            title="Download CSV"
          >
            <Download className="w-4 h-4 mr-1.5" />
            CSV
          </Button>
        </div>
      </div>

      {/* Report Type Selector Tabs */}
      <Tabs
        value={activeReport}
        onValueChange={(val) => setActiveReport(val as ReportType)}
      >
        <TabsList className="w-full">
          <TabsTrigger value="pnl" className="flex-1">P&amp;L</TabsTrigger>
          <TabsTrigger value="invoices" className="flex-1">Bills</TabsTrigger>
          <TabsTrigger value="receipts" className="flex-1">Receipts</TabsTrigger>
          <TabsTrigger value="payments" className="flex-1">Payments</TabsTrigger>
          <TabsTrigger value="expenses" className="flex-1">Expenses</TabsTrigger>
          <TabsTrigger value="outstanding" className="flex-1">Dues</TabsTrigger>
          <TabsTrigger value="loans" className="flex-1">Loans</TabsTrigger>
          <TabsTrigger value="jobs" className="flex-1">Jobs</TabsTrigger>
          <TabsTrigger value="commission" className="flex-1">Commission</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* REPORT CONTENT */}
      {loading ? (
        <div className="py-16 text-center text-sm text-text-muted">
          Loading report...
        </div>
      ) : !reportData ? (
        <EmptyState message="Failed to load report data." />
      ) : (
        <div className="space-y-4">
          {/* 1. PROFIT & LOSS REPORT */}
          {activeReport === 'pnl' && (
            <div className="space-y-4">
              {/* Summary 3-pack banner */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 bg-white rounded-card border border-border shadow-sm">
                  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-emerald-600" />
                    Total Income (Receipts)
                  </div>
                  <div className="text-2xl font-bold text-text mt-1.5">
                    {formatINR(reportData.income)}
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">
                    Includes bill payments &amp; other income
                  </div>
                </div>

                <div className="p-4 bg-white rounded-card border border-border shadow-sm">
                  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingDown className="w-4 h-4 text-text-muted" />
                    Total Outgoing
                  </div>
                  <div className="text-2xl font-bold text-text mt-1.5">
                    {formatINR(reportData.outgoing)}
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">
                    Vendor Payments ({formatINR(reportData.payments)}) + Expenses ({formatINR(reportData.expenses)})
                  </div>
                </div>

                <div className="p-4 bg-white rounded-card border border-border shadow-sm">
                  <div className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                    Net Profit (Cash Basis)
                  </div>
                  <div
                    className={`text-2xl font-bold mt-1.5 ${
                      reportData.net_profit >= 0 ? 'text-primary' : 'text-danger'
                    }`}
                  >
                    {formatINR(reportData.net_profit)}
                  </div>
                  <div className="text-[11px] text-text-muted mt-0.5">
                    Excludes outside loan principal (BR-1)
                  </div>
                </div>
              </div>

              {/* Capital Ledger Summary (Separate from P&L per BR-1) */}
              {reportData.loans && (
                <div className="p-3.5 bg-surface rounded-card border border-border flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <Building className="w-4 h-4 text-text-muted" />
                    <span className="font-semibold text-text">Capital Ledger Movement (Loans):</span>
                    <span className="text-text-muted">
                      Taken: <strong>{formatINR(reportData.loans.taken)}</strong> • Principal Repaid:{' '}
                      <strong>{formatINR(reportData.loans.principal_repaid)}</strong>
                    </span>
                  </div>
                  <div className="text-text-muted">
                    Interest Paid: <strong className="text-text">{formatINR(reportData.loans.interest_paid)}</strong> (captured as Expense)
                  </div>
                </div>
              )}

              {/* Monthly Trend Table */}
              <div className="bg-white rounded-card border border-border overflow-hidden">
                <div className="px-4 py-3 border-b border-border font-semibold text-sm text-text">
                  Monthly Performance Trend ({selectedFY})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surface text-text-muted uppercase border-b border-border">
                      <tr>
                        <th className="px-4 py-2.5">Month</th>
                        <th className="px-4 py-2.5 text-right">Income</th>
                        <th className="px-4 py-2.5 text-right">Outgoing</th>
                        <th className="px-4 py-2.5 text-right">Net Profit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {reportData.monthly_trend?.map((m: any, i: number) => (
                        <tr key={i} className="hover:bg-surface/50">
                          <td className="px-4 py-2.5 font-medium text-text">{m.month}</td>
                          <td className="px-4 py-2.5 text-right font-medium text-emerald-600">
                            {formatINR(m.income)}
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-text">
                            {formatINR(m.outgoing)}
                          </td>
                          <td
                            className={`px-4 py-2.5 text-right font-bold ${
                              m.profit >= 0 ? 'text-primary' : 'text-danger'
                            }`}
                          >
                            {formatINR(m.profit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* 2. INVOICES / BILLS REPORT */}
          {activeReport === 'invoices' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-white rounded-card border border-border">
                  <div className="text-xs text-text-muted">Total Billed</div>
                  <div className="text-xl font-bold text-text mt-1">
                    {formatINR(reportData.total_billed)}
                  </div>
                </div>
                <div className="p-3 bg-white rounded-card border border-border">
                  <div className="text-xs text-text-muted">Total Paid</div>
                  <div className="text-xl font-bold text-emerald-600 mt-1">
                    {formatINR(reportData.total_paid)}
                  </div>
                </div>
                <div className="p-3 bg-white rounded-card border border-border">
                  <div className="text-xs text-text-muted">Total Balance (Due)</div>
                  <div className="text-xl font-bold text-danger mt-1">
                    {formatINR(reportData.total_balance)}
                  </div>
                </div>
                <div className="p-3 bg-white rounded-card border border-border">
                  <div className="text-xs text-text-muted">Bills Count</div>
                  <div className="text-xl font-bold text-text mt-1">{reportData.count}</div>
                </div>
              </div>

              <div className="bg-white rounded-card border border-border overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface text-text-muted uppercase border-b border-border">
                    <tr>
                      <th className="px-3.5 py-2.5">Bill #</th>
                      <th className="px-3.5 py-2.5">Date</th>
                      <th className="px-3.5 py-2.5">Party</th>
                      <th className="px-3.5 py-2.5 text-right">Total</th>
                      <th className="px-3.5 py-2.5 text-right">Paid</th>
                      <th className="px-3.5 py-2.5 text-right">Balance</th>
                      <th className="px-3.5 py-2.5 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reportData.rows?.map((row: any) => (
                      <tr key={row.id} className="hover:bg-surface/50">
                        <td className="px-3.5 py-2.5 font-semibold text-text">{row.number}</td>
                        <td className="px-3.5 py-2.5 text-text-muted">{formatDate(row.invoice_date)}</td>
                        <td className="px-3.5 py-2.5 font-medium text-text">{row.party_name}</td>
                        <td className="px-3.5 py-2.5 text-right font-medium">{formatINR(row.total)}</td>
                        <td className="px-3.5 py-2.5 text-right text-emerald-600">{formatINR(row.paid_amount)}</td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-danger">
                          {row.balance > 0 ? formatINR(row.balance) : '—'}
                        </td>
                        <td className="px-3.5 py-2.5 text-center">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                              row.status === 'CANCELLED'
                                ? 'bg-surface text-text-muted'
                                : row.balance === 0
                                ? 'bg-primary/10 text-primary'
                                : row.is_overdue
                                ? 'bg-danger-bg text-danger'
                                : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {row.status === 'CANCELLED'
                              ? 'Cancelled'
                              : row.balance === 0
                              ? 'Paid'
                              : row.is_overdue
                              ? 'Overdue'
                              : 'Unpaid'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 3. RECEIPTS REPORT */}
          {activeReport === 'receipts' && (
            <div className="space-y-3">
              <div className="p-4 bg-white rounded-card border border-border flex items-center justify-between">
                <div>
                  <div className="text-xs text-text-muted">Total Receipts Amount</div>
                  <div className="text-2xl font-bold text-emerald-600 mt-0.5">
                    {formatINR(reportData.total_amount)}
                  </div>
                </div>
                <div className="text-xs text-text-muted font-medium">
                  {reportData.count} receipts in {selectedFY}
                </div>
              </div>

              <div className="bg-white rounded-card border border-border overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface text-text-muted uppercase border-b border-border">
                    <tr>
                      <th className="px-3.5 py-2.5">Receipt #</th>
                      <th className="px-3.5 py-2.5">Date</th>
                      <th className="px-3.5 py-2.5">Customer / Kind</th>
                      <th className="px-3.5 py-2.5">Mode</th>
                      <th className="px-3.5 py-2.5 text-right">Amount</th>
                      <th className="px-3.5 py-2.5 text-right">Unallocated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reportData.rows?.map((row: any) => (
                      <tr key={row.id} className="hover:bg-surface/50">
                        <td className="px-3.5 py-2.5 font-semibold text-text">{row.number}</td>
                        <td className="px-3.5 py-2.5 text-text-muted">{formatDate(row.receipt_date)}</td>
                        <td className="px-3.5 py-2.5 font-medium text-text">
                          {row.customer_name || row.income_category || row.kind}
                        </td>
                        <td className="px-3.5 py-2.5 text-text-muted">{row.mode}</td>
                        <td className="px-3.5 py-2.5 text-right font-bold text-emerald-600">
                          {formatINR(row.amount)}
                        </td>
                        <td className="px-3.5 py-2.5 text-right text-text-muted">
                          {row.unallocated_amount > 0 ? formatINR(row.unallocated_amount) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 4. OTHER SIMPLE REPORTS (PAYMENTS, EXPENSES, OUTSTANDING, LOANS, JOBS, COMMISSION) */}
          {(activeReport === 'payments' ||
            activeReport === 'expenses' ||
            activeReport === 'outstanding' ||
            activeReport === 'loans' ||
            activeReport === 'jobs' ||
            activeReport === 'commission') && (
            <div className="bg-white rounded-card border border-border overflow-x-auto">
              {reportData.rows?.length === 0 ? (
                <EmptyState message="No records found for this period." />
              ) : (
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface text-text-muted uppercase border-b border-border">
                    <tr>
                      {Object.keys(reportData.rows[0])
                        .filter((k) => k !== 'id')
                        .map((key) => (
                          <th key={key} className="px-3.5 py-2.5">
                            {key.replace(/_/g, ' ')}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {reportData.rows.map((row: any, idx: number) => (
                      <tr key={idx} className="hover:bg-surface/50">
                        {Object.entries(row)
                          .filter(([k]) => k !== 'id')
                          .map(([k, val]: any, cidx) => (
                            <td key={cidx} className="px-3.5 py-2.5 text-text font-medium">
                              {typeof val === 'number' && (k.includes('amount') || k.includes('balance') || k.includes('total') || k.includes('paid') || k.includes('earned') || k.includes('taken') || k.includes('repaid') || k.includes('outstanding'))
                                ? formatINR(val)
                                : String(val ?? '—')}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {/* Privacy PIN Modal Gate */}
      <PrivacyPinModal
        open={pinModalOpen}
        onOpenChange={setPinModalOpen}
        onSuccess={() => {
          if (pendingFY) {
            setSelectedFY(pendingFY);
            setPendingFY(null);
          }
        }}
      />
    </div>
  );
};
