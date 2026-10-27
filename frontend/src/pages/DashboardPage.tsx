import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate } from '../lib/dates';
import { t, getErrorMessage } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import {
  FileText,
  Receipt as ReceiptIcon,
  CreditCard,
  TrendingDown,
  UserPlus,
  AlertTriangle,
  Clock,
  ArrowRight,
  TrendingUp,
  Building,
} from 'lucide-react';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { business, member, role } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const { data: dash, error } = await supabase.rpc('dashboard');
      if (error) throw error;
      if (dash) {
        setData(dash);
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  const todayStr = formatDate(new Date());

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-6">
      {/* Welcome & Business Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border pb-4">
        <div>
          <div className="text-xs text-text-muted font-medium uppercase tracking-wider">
            {todayStr}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-text mt-0.5">
            {business?.name || 'SIMPLIFY'}
          </h1>
          <p className="text-xs text-text-muted">
            Signed in as {member?.name} ({member?.role})
          </p>
        </div>

        <Button
          size="md"
          onClick={() => navigate('/bills/new')}
          className="self-start sm:self-auto shadow-sm"
        >
          <FileText className="w-4 h-4 mr-1.5" />
          {t('nav.new_bill')}
        </Button>
      </div>

      {/* Quick Action Chips (Touch-friendly 1-tap shortcuts) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <button
          type="button"
          onClick={() => navigate('/bills/new')}
          className="flex items-center gap-2 p-3 bg-white rounded-card border border-border hover:border-primary/40 hover:shadow-subtle transition-all text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text">+ Bill</div>
            <div className="text-[11px] text-text-muted truncate">Create sale</div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => navigate('/money')}
          className="flex items-center gap-2 p-3 bg-white rounded-card border border-border hover:border-primary/40 hover:shadow-subtle transition-all text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
            <ReceiptIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text">+ Receipt</div>
            <div className="text-[11px] text-text-muted truncate">Money IN</div>
          </div>
        </button>

        {role !== 'STAFF' && (
          <button
            type="button"
            onClick={() => navigate('/money')}
            className="flex items-center gap-2 p-3 bg-white rounded-card border border-border hover:border-primary/40 hover:shadow-subtle transition-all text-left"
          >
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0">
              <CreditCard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-text">+ Payment</div>
              <div className="text-[11px] text-text-muted truncate">To vendor</div>
            </div>
          </button>
        )}

        {role !== 'STAFF' && (
          <button
            type="button"
            onClick={() => navigate('/money')}
            className="flex items-center gap-2 p-3 bg-white rounded-card border border-border hover:border-primary/40 hover:shadow-subtle transition-all text-left"
          >
            <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0">
              <TrendingDown className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-text">+ Expense</div>
              <div className="text-[11px] text-text-muted truncate">Overhead</div>
            </div>
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate('/customers')}
          className="flex items-center gap-2 p-3 bg-white rounded-card border border-border hover:border-primary/40 hover:shadow-subtle transition-all text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center flex-shrink-0">
            <UserPlus className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-text">+ Customer</div>
            <div className="text-[11px] text-text-muted truncate">Profiles</div>
          </div>
        </button>
      </div>

      {/* Bill & Job Alerts Banners */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Overdue & Due Today Invoices Banner */}
          {(data.alerts?.overdue_bills_count > 0 || data.alerts?.due_today_bills_count > 0) && (
            <div className="p-3.5 bg-danger-bg/50 border border-danger/30 rounded-card flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-danger flex-shrink-0" />
                <div className="text-xs">
                  <div className="font-bold text-danger">Outstanding Payment Alerts</div>
                  <div className="text-text-muted mt-0.5">
                    {data.alerts.overdue_bills_count > 0 && (
                      <span className="font-semibold text-danger">
                        {data.alerts.overdue_bills_count} overdue bills
                      </span>
                    )}
                    {data.alerts.overdue_bills_count > 0 && data.alerts.due_today_bills_count > 0 && ' • '}
                    {data.alerts.due_today_bills_count > 0 && (
                      <span className="font-semibold text-text">
                        {data.alerts.due_today_bills_count} bills due today
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/bills')}
                className="text-xs h-7 border-danger/40 text-danger hover:bg-danger/10"
              >
                View Bills
              </Button>
            </div>
          )}

          {/* Job Deadlines Alert (when enabled) */}
          {data.jobs?.enabled && (data.jobs.red_count > 0 || data.jobs.yellow_count > 0) && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-card flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div className="text-xs">
                  <div className="font-bold text-amber-900">Job Deadline Alerts</div>
                  <div className="text-amber-700 mt-0.5">
                    {data.jobs.red_count > 0 && (
                      <span className="font-semibold text-danger">
                        {data.jobs.red_count} urgent (Red)
                      </span>
                    )}
                    {data.jobs.red_count > 0 && data.jobs.yellow_count > 0 && ' • '}
                    {data.jobs.yellow_count > 0 && (
                      <span className="font-semibold text-amber-800">
                        {data.jobs.yellow_count} upcoming (Yellow)
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/jobs')}
                className="text-xs h-7 border-amber-300 text-amber-900 hover:bg-amber-100"
              >
                View Jobs
              </Button>
            </div>
          )}
        </div>
      )}

      {/* TODAY'S METRICS */}
      <div className="space-y-2">
        <div className="text-xs font-bold text-text-muted uppercase tracking-wider">
          Today's Activity
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-4 bg-white rounded-card border border-border shadow-sm">
            <div className="text-xs font-medium text-text-muted">Bills Made</div>
            <div className="text-2xl font-bold text-text mt-1">
              {loading ? '—' : data?.today?.bills_count || 0}
            </div>
          </div>

          <div className="p-4 bg-white rounded-card border border-border shadow-sm">
            <div className="text-xs font-medium text-text-muted">Collection (IN)</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              {loading ? '—' : formatINR(data?.today?.collection || 0)}
            </div>
          </div>

          {role !== 'STAFF' && (
            <div className="p-4 bg-white rounded-card border border-border shadow-sm">
              <div className="text-xs font-medium text-text-muted">Vendor Payments</div>
              <div className="text-2xl font-bold text-text mt-1">
                {loading ? '—' : formatINR(data?.today?.payments || 0)}
              </div>
            </div>
          )}

          {role !== 'STAFF' && (
            <div className="p-4 bg-white rounded-card border border-border shadow-sm">
              <div className="text-xs font-medium text-text-muted">Operating Expenses</div>
              <div className="text-2xl font-bold text-text mt-1">
                {loading ? '—' : formatINR(data?.today?.expenses || 0)}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* THIS MONTH OVERVIEW (Cash-basis Profit & Receivables) */}
      {role !== 'STAFF' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-text-muted uppercase tracking-wider">
              This Month (Cash Basis)
            </div>
            <button
              onClick={() => navigate('/reports')}
              className="text-xs text-primary hover:underline font-medium flex items-center gap-1"
            >
              Full Reports <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-4 bg-white rounded-card border border-border shadow-sm">
              <div className="text-xs font-medium text-text-muted flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />
                Total Income (Receipts)
              </div>
              <div className="text-2xl font-bold text-text mt-1">
                {loading ? '—' : formatINR(data?.this_month?.income || 0)}
              </div>
            </div>

            <div className="p-4 bg-white rounded-card border border-border shadow-sm">
              <div className="text-xs font-medium text-text-muted flex items-center gap-1">
                <TrendingDown className="w-3.5 h-3.5 text-text-muted" />
                Outgoing (Payments + Expenses)
              </div>
              <div className="text-2xl font-bold text-text mt-1">
                {loading ? '—' : formatINR(data?.this_month?.outgoing || 0)}
              </div>
            </div>

            <div className="p-4 bg-white rounded-card border border-border shadow-sm">
              <div className="text-xs font-medium text-text-muted">
                Net Profit (Cash Basis)
              </div>
              <div
                className={`text-2xl font-bold mt-1 ${
                  (data?.this_month?.net_profit || 0) >= 0
                    ? 'text-primary'
                    : 'text-danger'
                }`}
              >
                {loading ? '—' : formatINR(data?.this_month?.net_profit || 0)}
              </div>
            </div>
          </div>

          {/* Dues and Loans balances */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="p-3.5 bg-surface rounded-card border border-border flex items-center justify-between">
              <div>
                <div className="text-xs text-text-muted font-medium">
                  Total Customer Receivables
                </div>
                <div className="text-lg font-bold text-danger mt-0.5">
                  {loading ? '—' : formatINR(data?.this_month?.total_outstanding || 0)}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/money')}
                className="text-xs h-8"
              >
                View Dues
              </Button>
            </div>

            <div className="p-3.5 bg-surface rounded-card border border-border flex items-center justify-between">
              <div>
                <div className="text-xs text-text-muted font-medium flex items-center gap-1">
                  <Building className="w-3.5 h-3.5 text-text-muted" />
                  Loan Outstanding (Capital Ledger)
                </div>
                <div className="text-lg font-bold text-text mt-0.5">
                  {loading ? '—' : formatINR(data?.this_month?.loan_outstanding || 0)}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate('/money')}
                className="text-xs h-8"
              >
                Capital Ledger
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* JOBS TRACKING OVERVIEW (if enabled) */}
      {data?.jobs?.enabled && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold text-text-muted uppercase tracking-wider">
              Jobs Overview
            </div>
            <button
              onClick={() => navigate('/jobs')}
              className="text-xs text-primary hover:underline font-medium flex items-center gap-1"
            >
              All Jobs <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3.5 bg-white rounded-card border border-border">
              <div className="text-xs text-text-muted">Pending Jobs</div>
              <div className="text-xl font-bold text-text mt-1">
                {data.jobs.pending}
              </div>
            </div>

            <div className="p-3.5 bg-white rounded-card border border-border">
              <div className="text-xs text-text-muted">Completed Today</div>
              <div className="text-xl font-bold text-primary mt-1">
                {data.jobs.completed_today}
              </div>
            </div>

            <div className="p-3.5 bg-white rounded-card border border-border">
              <div className="text-xs text-text-muted">Red Bucket (&le;3d)</div>
              <div className="text-xl font-bold text-danger mt-1">
                {data.jobs.red_count}
              </div>
            </div>

            <div className="p-3.5 bg-white rounded-card border border-border">
              <div className="text-xs text-text-muted">Yellow Bucket (4-5d)</div>
              <div className="text-xl font-bold text-amber-600 mt-1">
                {data.jobs.yellow_count}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
