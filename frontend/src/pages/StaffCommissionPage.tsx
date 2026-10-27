import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { formatDate } from '../lib/dates';
import { t, getErrorMessage } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { EmptyState } from '../components/ui/EmptyState';
import { PayStaffModal } from '../components/staff/PayStaffModal';
import {
  DollarSign,
  Clock,
  CheckCircle2,
  Calendar,
  Plus,
  ArrowUpRight,
  FileText,
} from 'lucide-react';

export const StaffCommissionPage: React.FC = () => {
  const { role, member } = useAuth();
  const { showToast } = useToast();

  const isOwner = role === 'OWNER';
  const isStaff = role === 'STAFF';

  const [period, setPeriod] = useState<'DAY' | 'MONTH' | 'YEAR' | 'ALL'>('MONTH');
  const [selectedStaffId, setSelectedStaffId] = useState<string>(isStaff && member?.id ? member.id : '');
  const [activeSubTab, setActiveSubTab] = useState<'entries' | 'payouts' | 'team'>('entries');

  const [staffList, setStaffList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Data from staff_summary & staff_commission
  const [summary, setSummary] = useState({
    total_earned: 0,
    total_paid: 0,
    balance_payable: 0,
    upcoming: 0,
    staff: [] as any[],
  });

  const [commissionData, setCommissionData] = useState<{
    entries: any[];
    payouts: any[];
    total_earned: number;
    total_paid: number;
    balance_payable: number;
    upcoming: number;
  }>({
    entries: [],
    payouts: [],
    total_earned: 0,
    total_paid: 0,
    balance_payable: 0,
    upcoming: 0,
  });

  const [payStaffModalOpen, setPayStaffModalOpen] = useState(false);
  const [targetStaffForPayout, setTargetStaffForPayout] = useState<any | null>(null);

  // Load staff list for dropdown
  useEffect(() => {
    if (!isStaff) {
      supabase
        .from('members')
        .select('id, name, role, mobile')
        .eq('active', true)
        .is('deleted_at', null)
        .order('name')
        .then(({ data }) => {
          setStaffList(data || []);
        });
    }
  }, [isStaff]);

  const loadData = async () => {
    setLoading(true);
    try {
      const targetId = isStaff && member?.id ? member.id : (selectedStaffId || null);

      // Load overall summary
      const { data: sumData, error: sumError } = await supabase.rpc('staff_summary', {
        p_staff_id: targetId,
      });
      if (sumError) throw sumError;
      if (sumData) {
        setSummary(sumData);
      }

      // Load commission drill-down & payouts for period
      const { data: commData, error: commError } = await supabase.rpc('staff_commission', {
        p_staff_id: targetId,
        p_period: period,
      });
      if (commError) throw commError;
      if (commData) {
        setCommissionData(commData);
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [period, selectedStaffId]);

  const handleOpenPayStaff = (staff?: any) => {
    setTargetStaffForPayout(staff || null);
    setPayStaffModalOpen(true);
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">{t('staff.title')}</h1>
          <p className="text-xs text-text-muted">
            Track earned commissions, upcoming jobs, and team payouts
          </p>
        </div>

        {isOwner && (
          <Button
            size="sm"
            onClick={() => handleOpenPayStaff()}
            className="self-start sm:self-auto"
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {t('staff.pay_staff')}
          </Button>
        )}
      </div>

      {/* Prominent Totals Summary Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-white p-4 rounded-card border border-border">
        <div>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
            {t('staff.earned')}
          </div>
          <div className="text-2xl font-bold text-primary mt-1">
            {formatINR(summary.total_earned)}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <ArrowUpRight className="w-3.5 h-3.5 text-text-muted" />
            {t('staff.paid')}
          </div>
          <div className="text-2xl font-bold text-text mt-1">
            {formatINR(summary.total_paid)}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5 text-text-muted" />
            {t('staff.payable')}
          </div>
          <div
            className={`text-2xl font-bold mt-1 ${
              summary.balance_payable > 0 ? 'text-text' : 'text-text-muted'
            }`}
          >
            {formatINR(summary.balance_payable)}
          </div>
        </div>

        <div>
          <div className="text-xs font-semibold text-text-muted uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            {t('staff.upcoming')}
          </div>
          <div className="text-2xl font-bold text-amber-600 mt-1">
            {formatINR(summary.upcoming)}
          </div>
        </div>
      </div>

      {/* Period Selection & Staff Filter */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Period Tabs */}
        <Tabs value={period} onValueChange={(val) => setPeriod(val as any)}>
          <TabsList>
            <TabsTrigger value="DAY">{t('staff.day')}</TabsTrigger>
            <TabsTrigger value="MONTH">{t('staff.month')}</TabsTrigger>
            <TabsTrigger value="YEAR">{t('staff.year')}</TabsTrigger>
            <TabsTrigger value="ALL">{t('staff.all_time')}</TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Staff Dropdown Filter (hidden for Staff role) */}
        {!isStaff && (
          <div className="w-full sm:w-64">
            <Select
              value={selectedStaffId}
              onChange={(val) => setSelectedStaffId(val)}
              options={[
                { label: t('staff.all_staff'), value: '' },
                ...staffList.map((s) => ({
                  label: `${s.name} (${s.role})`,
                  value: s.id,
                })),
              ]}
            />
          </div>
        )}
      </div>

      {/* Sub-Tabs: Entries | Payouts | Team Balances */}
      <Tabs
        value={activeSubTab}
        onValueChange={(val) => setActiveSubTab(val as any)}
      >
        <TabsList className="w-full">
          <TabsTrigger value="entries" className="flex-1">
            {t('staff.commission_entries')} ({commissionData.entries.length})
          </TabsTrigger>
          <TabsTrigger value="payouts" className="flex-1">
            {t('staff.payouts_history')} ({commissionData.payouts.length})
          </TabsTrigger>
          {!isStaff && !selectedStaffId && (
            <TabsTrigger value="team" className="flex-1">
              {t('staff.team_summary')} ({summary.staff.length})
            </TabsTrigger>
          )}
        </TabsList>
      </Tabs>

      {/* Tab 1: Commission Entries Drill-down */}
      {activeSubTab === 'entries' && (
        <div className="space-y-3">
          {loading ? (
            <div className="py-12 text-center text-sm text-text-muted">
              {t('common.loading')}
            </div>
          ) : commissionData.entries.length === 0 ? (
            <EmptyState message={t('staff.no_entries')} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {commissionData.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="p-4 bg-white rounded-card border border-border flex flex-col justify-between gap-3 shadow-sm hover:border-primary/40 transition-all"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded bg-surface text-text border border-border">
                        <FileText className="w-3.5 h-3.5 mr-1 text-primary" />
                        {entry.invoice_number}
                      </span>
                      {entry.status === 'EARNED' ? (
                        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                          {t('staff.status_earned')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          <Clock className="w-3.5 h-3.5 mr-1" />
                          {t('staff.status_upcoming')}
                        </span>
                      )}
                    </div>

                    <div className="font-semibold text-text text-base">
                      {entry.job_type_name}
                      {entry.applicant_name && (
                        <span className="text-xs text-text-muted font-normal ml-1.5">
                          ({entry.applicant_name})
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-text-muted mt-1">
                      Party: <span className="text-text font-medium">{entry.party_name}</span>
                      {entry.party_mobile && ` • ${entry.party_mobile}`}
                    </div>

                    {!selectedStaffId && (
                      <div className="text-xs text-text-muted mt-0.5">
                        Staff: <span className="font-semibold text-text">{entry.staff_name}</span>
                      </div>
                    )}
                  </div>

                  <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                    <div className="text-text-muted">
                      Base: {formatINR(entry.base_amount)} × {entry.percent}%
                    </div>
                    <div className="font-bold text-sm text-primary">
                      {formatINR(entry.amount)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Payouts History */}
      {activeSubTab === 'payouts' && (
        <div className="space-y-3">
          {loading ? (
            <div className="py-12 text-center text-sm text-text-muted">
              {t('common.loading')}
            </div>
          ) : commissionData.payouts.length === 0 ? (
            <EmptyState message={t('staff.no_payouts')} />
          ) : (
            <div className="bg-white rounded-card border border-border divide-y divide-border">
              {commissionData.payouts.map((payout) => (
                <div
                  key={payout.id}
                  className="p-3.5 sm:p-4 flex items-center justify-between gap-3 hover:bg-surface/40 transition-colors"
                >
                  <div>
                    <div className="font-semibold text-text text-sm">
                      {payout.staff_name}
                    </div>
                    <div className="text-xs text-text-muted mt-0.5 flex items-center gap-2">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(payout.payout_date)}
                      </span>
                      <span>•</span>
                      <span>Mode: {payout.mode}</span>
                    </div>
                    {payout.notes && (
                      <div className="text-xs text-text-muted mt-0.5 italic">
                        "{payout.notes}"
                      </div>
                    )}
                  </div>

                  <div className="text-right">
                    <div className="font-bold text-base text-text">
                      {formatINR(payout.amount)}
                    </div>
                    <span className="inline-flex items-center text-[10px] uppercase font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                      Paid
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Team Balances (Visible to Owner/Accountant) */}
      {activeSubTab === 'team' && !isStaff && !selectedStaffId && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {summary.staff.map((st) => (
              <div
                key={st.id}
                className="p-4 bg-white rounded-card border border-border shadow-sm flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-bold text-base text-text">{st.name}</div>
                      <div className="text-xs text-text-muted">
                        {st.role} {st.mobile && `• ${st.mobile}`}
                      </div>
                    </div>
                    {isOwner && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleOpenPayStaff(st)}
                        className="text-xs h-8"
                      >
                        {t('staff.pay_staff')}
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border text-xs">
                    <div>
                      <span className="text-text-muted block">{t('staff.earned')}</span>
                      <strong className="text-primary font-semibold">
                        {formatINR(st.earned)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-text-muted block">{t('staff.paid')}</span>
                      <strong className="text-text font-semibold">
                        {formatINR(st.paid)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-text-muted block">{t('staff.payable')}</span>
                      <strong
                        className={`font-semibold ${
                          st.balance > 0 ? 'text-primary' : 'text-text-muted'
                        }`}
                      >
                        {formatINR(st.balance)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-text-muted block">{t('staff.upcoming')}</span>
                      <strong className="text-amber-600 font-semibold">
                        {formatINR(st.upcoming)}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pay Staff Modal */}
      <PayStaffModal
        open={payStaffModalOpen}
        onOpenChange={(open) => {
          setPayStaffModalOpen(open);
          if (!open) setTargetStaffForPayout(null);
        }}
        staffMember={targetStaffForPayout}
        onSuccess={() => {
          loadData();
        }}
      />
    </div>
  );
};
