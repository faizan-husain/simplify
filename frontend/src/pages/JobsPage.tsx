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
  ListOrdered,
  Zap,
  TrendingUp,
} from 'lucide-react';

export const JobsPage: React.FC = () => {
  const { business, role, refreshProfile } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'CURRENT' | 'COMPLETED' | 'DUE' | 'YELLOW' | 'RED'>('CURRENT');
  const [search, setSearch] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [sortOrder, setSortOrder] = useState<'QUEUE' | 'URGENT' | 'PROGRESS'>('QUEUE');
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

  // Client-side instant sort priority (guarantees Progress brings jobs with most completed steps to the top immediately)
  const sortedJobs = React.useMemo(() => {
    return [...jobs].sort((a, b) => {
      if (sortOrder === 'PROGRESS') {
        const aTicked = a.ticked_steps || 0;
        const bTicked = b.ticked_steps || 0;
        if (bTicked !== aTicked) {
          return bTicked - aTicked; // Most ticked steps come to the top!
        }
        const aProg = parseFloat(String(a.progress_percent || '0'));
        const bProg = parseFloat(String(b.progress_percent || '0'));
        if (bProg !== aProg) {
          return bProg - aProg; // Highest percentage next
        }
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      if (sortOrder === 'URGENT') {
        const aDays = parseInt(String(a.days_left || '0'), 10);
        const bDays = parseInt(String(b.days_left || '0'), 10);
        return aDays - bDays;
      }
      // 'QUEUE' (FIFO): earliest created_at first
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [jobs, sortOrder]);

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
        p_sort: sortOrder,
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
  }, [activeTab, search, selectedServiceId, sortOrder]);

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
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-success/10 text-success border border-success/20">
          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
          Completed
        </span>
      );
    }
    const days = parseInt(String(job.days_left), 10);
    if (days < 0) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-danger-bg text-danger border border-danger/30">
          <AlertTriangle className="w-3.5 h-3.5 mr-1" />
          {Math.abs(days)}d late
        </span>
      );
    }
    if (days === 0) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-danger-bg text-danger border border-danger/30 animate-pulse">
          <Clock className="w-3.5 h-3.5 mr-1" />
          Due Today
        </span>
      );
    }
    if (job.deadline_bucket === 'RED') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">
          <Clock className="w-3.5 h-3.5 mr-1 text-red-600" />
          {days}d left (Red Alert)
        </span>
      );
    }
    if (job.deadline_bucket === 'YELLOW') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-300">
          <Clock className="w-3.5 h-3.5 mr-1 text-amber-600" />
          {days}d left (Yellow Alert)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-text-muted border border-border">
        <Clock className="w-3.5 h-3.5 mr-1" />
        {days}d left
      </span>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">Customer Work Queue (Jobs)</h1>
          <p className="text-xs text-text-muted">
            Track multi-step customer orders in FIFO queue order, deadlines, and staff commission
          </p>
        </div>

        {/* Sort Order Selector */}
        <div className="flex items-center gap-1.5 bg-surface p-1 rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setSortOrder('QUEUE')}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all ${
              sortOrder === 'QUEUE'
                ? 'bg-white text-primary shadow-sm border border-border/80'
                : 'text-text-muted hover:text-text'
            }`}
            title="First In, First Out — Serve customers in order of arrival"
          >
            <ListOrdered className="w-3.5 h-3.5" />
            <span>Queue Order (FIFO)</span>
          </button>
          <button
            type="button"
            onClick={() => setSortOrder('URGENT')}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all ${
              sortOrder === 'URGENT'
                ? 'bg-white text-danger shadow-sm border border-border/80'
                : 'text-text-muted hover:text-text'
            }`}
            title="Nearest deadline and late jobs first"
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Urgent Deadlines</span>
          </button>
          <button
            type="button"
            onClick={() => setSortOrder('PROGRESS')}
            className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-all ${
              sortOrder === 'PROGRESS'
                ? 'bg-white text-primary shadow-sm border border-border/80'
                : 'text-text-muted hover:text-text'
            }`}
            title="Most completed steps first"
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Progress</span>
          </button>
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
                Enable job management to automatically track multi-step customer orders, deadlines, and staff commission.
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
            placeholder="Search customer, mobile, bill #, applicant, job type..."
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
            Current Queue ({tabCounts.current})
          </TabsTrigger>
          <TabsTrigger value="DUE" className="flex-1 font-semibold text-danger">
            Late Jobs ({tabCounts.due})
          </TabsTrigger>
          <TabsTrigger value="YELLOW" className="flex-1 font-semibold text-amber-700">
            Yellow Box Jobs ({tabCounts.yellow})
          </TabsTrigger>
          <TabsTrigger value="RED" className="flex-1 font-semibold text-red-600">
            Red Box Jobs ({tabCounts.red})
          </TabsTrigger>
          <TabsTrigger value="COMPLETED" className="flex-1">
            Completed ({tabCounts.completed})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Single-Row FIFO Work Queue List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-text-muted">
          {t('common.loading')}
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          message="No jobs found in this queue."
        />
      ) : (
        <div className="space-y-2">
          {sortedJobs.map((job, idx) => {
            const days = parseInt(String(job.days_left), 10);
            const isLate = days < 0;
            const isToday = days === 0;
            const isCompleted = job.status === 'COMPLETED';

            return (
              <div
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                className="group relative bg-white hover:bg-slate-50/90 rounded-xl border border-border/80 hover:border-primary/50 hover:shadow-subtle transition-all cursor-pointer p-3 sm:px-4 sm:py-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                {/* Left Section: Queue Rank, Pulse indicator, Party Name, Mobile, Applicant, Bill */}
                <div className="flex items-start md:items-center gap-3 min-w-0 flex-1">
                  {/* Queue Rank Badge */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="w-8 h-8 rounded-lg bg-primary/10 text-primary font-bold text-xs flex items-center justify-center border border-primary/20">
                      #{idx + 1}
                    </span>
                    {/* Status Dot */}
                    <span className="relative flex h-2.5 w-2.5">
                      {isLate ? (
                        <>
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-danger opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-danger"></span>
                        </>
                      ) : isToday || job.deadline_bucket === 'RED' ? (
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                      ) : job.deadline_bucket === 'YELLOW' ? (
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500"></span>
                      ) : isCompleted ? (
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-success"></span>
                      ) : (
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
                      )}
                    </span>
                  </div>

                  {/* Customer and Work info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-text text-sm sm:text-base group-hover:text-primary transition-colors">
                        {job.party_name}
                      </span>
                      {job.party_mobile && (
                        <span className="text-xs text-text-muted">
                          ({job.party_mobile})
                        </span>
                      )}
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-surface text-text border border-border">
                        <Briefcase className="w-3 h-3 mr-1 text-primary" />
                        {job.job_type_name}
                      </span>
                      <span className="text-xs font-semibold text-text-muted flex items-center gap-1">
                        <FileText className="w-3 h-3" />
                        {job.invoice_number}
                      </span>
                    </div>

                    {/* Applicant & Next Action */}
                    <div className="flex items-center gap-3 text-xs text-text-muted mt-1 flex-wrap">
                      {job.applicant_name && (
                        <span>
                          Applicant: <strong className="text-text font-semibold">{job.applicant_name}</strong>
                        </span>
                      )}
                      {job.next_step_name && !isCompleted ? (
                        <span className="text-primary font-medium flex items-center gap-1">
                          👉 Next: <span className="font-semibold underline">{job.next_step_name}</span>
                        </span>
                      ) : isCompleted ? (
                        <span className="text-success font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5" /> All steps completed
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Middle / Right Section: Progress Bar, Deadline, Assigned Staff, Action */}
                <div className="flex items-center justify-between md:justify-end gap-3 sm:gap-4 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-border/50">
                  {/* Progress Bar & Step counts */}
                  <div className="w-28 sm:w-36 space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-text">
                        {job.ticked_steps}/{job.total_steps} Steps
                      </span>
                      <span className="text-text-muted font-medium">{job.progress_percent}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-surface rounded-full overflow-hidden border border-border/60">
                      <div
                        className={`h-full transition-all duration-300 ${
                          isCompleted ? 'bg-success' : 'bg-primary'
                        }`}
                        style={{ width: `${job.progress_percent}%` }}
                      />
                    </div>
                  </div>

                  {/* Deadline badge */}
                  <div className="shrink-0">{getDeadlineBadge(job)}</div>

                  {/* Assigned Staff */}
                  <div className="hidden lg:flex items-center gap-1 text-xs text-text-muted w-24 truncate">
                    <User className="w-3.5 h-3.5 text-text-muted shrink-0" />
                    <span className="truncate">{job.assigned_staff_name || 'Unassigned'}</span>
                  </div>

                  {/* Amount */}
                  <div className="font-bold text-sm text-text shrink-0 w-16 text-right">
                    {formatINR(job.amount)}
                  </div>

                  {/* Quick Action button */}
                  <Button
                    size="sm"
                    variant={isCompleted ? 'outline' : 'primary'}
                    className="shrink-0 h-8 text-xs font-semibold px-2.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedJobId(job.id);
                    }}
                  >
                    {isCompleted ? 'View' : 'Tick Steps'}
                  </Button>
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
