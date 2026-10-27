import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { t, getErrorMessage } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Button } from '../components/ui/Button';
import { Tabs, TabsList, TabsTrigger } from '../components/ui/Tabs';
import { EmptyState } from '../components/ui/EmptyState';
import { JobDetailModal } from '../components/jobs/JobDetailModal';
import {
  Briefcase,
  Search,
  Clock,
  User,
  CheckCircle2,
  AlertTriangle,
  FileText,
} from 'lucide-react';

export const JobsPage: React.FC = () => {
  const { business, role, refreshProfile } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'CURRENT' | 'COMPLETED' | 'DUE' | 'YELLOW' | 'RED'>('CURRENT');
  const [search, setSearch] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [jobTypes, setJobTypes] = useState<any[]>([]);

  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<any[]>([]);
  const [tabCounts, setTabCounts] = useState({
    current: 0,
    completed: 0,
    due: 0,
    yellow: 0,
    red: 0,
  });

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [enablingJobs, setEnablingJobs] = useState(false);

  // Load available job types for filtering
  useEffect(() => {
    supabase
      .from('services')
      .select('id, name')
      .eq('is_job_type', true)
      .eq('active', true)
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => {
        setJobTypes(data || []);
      });
  }, []);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('list_jobs', {
        p_tab: activeTab,
        p_service_id: selectedServiceId || null,
        p_search: search.trim() || null,
        p_limit: 100,
        p_offset: 0,
      });

      if (error) throw error;

      if (data) {
        setJobs(data.jobs || []);
        if (data.tab_counts) {
          setTabCounts(data.tab_counts);
        }
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      loadJobs();
    }, 200);
    return () => clearTimeout(timer);
  }, [activeTab, search, selectedServiceId]);

  const handleEnableJobManagement = async () => {
    if (!business) return;
    setEnablingJobs(true);
    try {
      const { error } = await supabase
        .from('businesses')
        .update({ job_management_enabled: true })
        .eq('id', business.id);

      if (error) throw error;
      showToast('Job management enabled', 'success');
      await refreshProfile();
      loadJobs();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setEnablingJobs(false);
    }
  };

  const getDeadlineBadge = (job: any) => {
    if (job.status === 'COMPLETED') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
          {t('jobs.completed_badge')}
        </span>
      );
    }
    const days = parseInt(String(job.days_left), 10);
    if (days < 0) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-bg text-danger">
          <AlertTriangle className="w-3.5 h-3.5 mr-1" />
          {t('jobs.days_late', { days: Math.abs(days) })}
        </span>
      );
    }
    if (days === 0) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-bg text-danger">
          <Clock className="w-3.5 h-3.5 mr-1" />
          {t('jobs.due_today')}
        </span>
      );
    }
    if (job.deadline_bucket === 'RED') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-bg text-danger">
          <Clock className="w-3.5 h-3.5 mr-1" />
          {t('jobs.days_left', { days })}
        </span>
      );
    }
    if (job.deadline_bucket === 'YELLOW') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <Clock className="w-3.5 h-3.5 mr-1" />
          {t('jobs.days_left', { days })}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-text-muted">
        <Clock className="w-3.5 h-3.5 mr-1" />
        {t('jobs.days_left', { days })}
      </span>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">{t('jobs.title')}</h1>
          <p className="text-xs text-text-muted">
            Track multi-step customer orders, deadlines, and staff progress
          </p>
        </div>
      </div>

      {/* Disabled Banner if business has job management off */}
      {business && !business.job_management_enabled && (
        <div className="p-4 rounded-card border border-amber-200 bg-amber-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-amber-900">
                {t('jobs.disabled_notice')}
              </div>
              <div className="text-xs text-amber-700 mt-0.5">
                Enable job management to automatically create jobs from passport, license or service bill items.
              </div>
            </div>
          </div>
          {role === 'OWNER' && (
            <Button
              size="sm"
              onClick={handleEnableJobManagement}
              loading={enablingJobs}
              className="bg-amber-600 hover:bg-amber-700 text-white border-0"
            >
              {t('jobs.enable_jobs')}
            </Button>
          )}
        </div>
      )}

      {/* Search and Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search party, mobile, bill #, applicant, job type..."
            className="pl-9"
          />
        </div>
        <div>
          <Select
            value={selectedServiceId}
            onChange={(val) => setSelectedServiceId(val)}
            options={[
              { label: t('jobs.all_job_types'), value: '' },
              ...jobTypes.map((jt) => ({ label: jt.name, value: jt.id })),
            ]}
          />
        </div>
      </div>

      {/* Tab Navigation */}
      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)}>
        <TabsList className="w-full">
          <TabsTrigger value="CURRENT" className="flex-1">
            {t('jobs.current')} ({tabCounts.current})
          </TabsTrigger>
          <TabsTrigger value="COMPLETED" className="flex-1">
            {t('jobs.completed')} ({tabCounts.completed})
          </TabsTrigger>
          <TabsTrigger value="DUE" className="flex-1">
            {t('jobs.due')} ({tabCounts.due})
          </TabsTrigger>
          <TabsTrigger value="YELLOW" className="flex-1">
            {t('jobs.yellow')} ({tabCounts.yellow})
          </TabsTrigger>
          <TabsTrigger value="RED" className="flex-1">
            {t('jobs.red')} ({tabCounts.red})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Jobs List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-text-muted">
          {t('common.loading')}
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          message={t('jobs.no_jobs')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {jobs.map((job) => {
            return (
              <div
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                className="p-4 bg-white rounded-card border border-border hover:border-primary/40 hover:shadow-subtle transition-all cursor-pointer flex flex-col justify-between gap-3 group"
              >
                <div>
                  {/* Top Bar: Job Type & Deadline Badge */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-surface text-text border border-border group-hover:border-primary/30">
                      <Briefcase className="w-3.5 h-3.5 mr-1 text-primary" />
                      {job.job_type_name}
                    </span>
                    <div>{getDeadlineBadge(job)}</div>
                  </div>

                  {/* Customer / Party details */}
                  <div className="font-semibold text-text text-base">
                    {job.party_name}
                    {job.party_mobile && (
                      <span className="text-xs text-text-muted font-normal ml-1.5">
                        ({job.party_mobile})
                      </span>
                    )}
                  </div>

                  {job.applicant_name && (
                    <div className="text-xs text-text-muted mt-0.5">
                      {t('jobs.applicant')}:{' '}
                      <span className="font-medium text-text">{job.applicant_name}</span>
                    </div>
                  )}

                  <div className="text-xs text-text-muted mt-1 flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <FileText className="w-3.5 h-3.5" />
                      {job.invoice_number}
                    </span>
                    <span>•</span>
                    <span className="font-medium text-text">{formatINR(job.amount)}</span>
                  </div>
                </div>

                {/* Bottom Bar: Progress Bar and Assigned Staff */}
                <div className="space-y-2 pt-2 border-t border-border/60">
                  <div className="flex items-center justify-between text-xs text-text-muted">
                    <span className="font-medium text-text">
                      {job.ticked_steps} / {job.total_steps} {t('jobs.steps')} ({job.progress_percent}%)
                    </span>
                    <span className="flex items-center gap-1 text-[11px]">
                      <User className="w-3 h-3 text-text-muted" />
                      {job.assigned_staff_name || t('jobs.unassigned')}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden border border-border">
                    <div
                      className={`h-full transition-all duration-300 ${
                        job.status === 'COMPLETED' ? 'bg-primary' : 'bg-primary/80'
                      }`}
                      style={{ width: `${job.progress_percent}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Job Detail Modal */}
      <JobDetailModal
        open={Boolean(selectedJobId)}
        onOpenChange={(open) => {
          if (!open) setSelectedJobId(null);
        }}
        jobId={selectedJobId}
        onJobUpdated={() => {
          loadJobs();
        }}
      />
    </div>
  );
};
