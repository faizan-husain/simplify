import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { t, getErrorMessage } from '../i18n';
import { getWhatsAppUrl } from '../lib/auth';
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
  AlertCircle,
  FileText,
  ListOrdered,
  Zap,
  TrendingUp,
  ChevronRight,
  MessageCircle,
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

  // Clean Deadline Badge
  const getDeadlineBadge = (job: any) => {
    if (job.status === 'COMPLETED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          Completed
        </span>
      );
    }
    const days = parseInt(String(job.days_left), 10);
    if (days < 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-red-50 text-red-700 border border-red-200">
          <AlertCircle className="w-3.5 h-3.5 text-red-600" />
          {Math.abs(days)}d Overdue
        </span>
      );
    }
    if (days === 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-red-500 text-white shadow-sm animate-pulse">
          <Clock className="w-3.5 h-3.5" />
          Due Today
        </span>
      );
    }
    if (job.deadline_bucket === 'RED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-red-50 text-red-700 border border-red-200">
          <Clock className="w-3.5 h-3.5 text-red-600" />
          {days}d left (Red Alert)
        </span>
      );
    }
    if (job.deadline_bucket === 'YELLOW') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          {days}d left (Yellow Alert)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
        <Clock className="w-3.5 h-3.5 text-slate-500" />
        {days}d left
      </span>
    );
  };

  // Step Segments Visualizer
  const renderStepSegments = (total: number, ticked: number, isCompleted: boolean) => {
    const count = Math.max(1, total || 1);
    const segments = [];
    for (let i = 0; i < count; i++) {
      const isDone = i < ticked;
      segments.push(
        <div
          key={i}
          className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
            isCompleted
              ? 'bg-emerald-500'
              : isDone
              ? 'bg-[#0B67F6]'
              : 'bg-slate-200'
          }`}
        />
      );
    }
    return (
      <div className="w-full space-y-1">
        <div className="flex items-center gap-1 w-full">{segments}</div>
        <div className="flex items-center justify-between text-[11px] text-slate-500 font-medium">
          <span>
            {ticked} of {total} steps done
          </span>
          <span className="font-semibold text-slate-700">
            {isCompleted ? '100%' : `${Math.round((ticked / count) * 100)}%`}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Customer Work Queue (Jobs)</h1>
          <p className="text-xs text-slate-500">
            Live order tracking, workflow step management, and deadline monitoring
          </p>
        </div>

        {/* Sort Order Selector */}
        <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-lg border border-slate-200/80">
          <button
            type="button"
            onClick={() => setSortOrder('QUEUE')}
            className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
              sortOrder === 'QUEUE'
                ? 'bg-white text-primary shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="First In, First Out — Serve customers in order of arrival"
          >
            <ListOrdered className="w-3.5 h-3.5 text-primary" />
            <span>Queue (FIFO)</span>
          </button>
          <button
            type="button"
            onClick={() => setSortOrder('URGENT')}
            className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
              sortOrder === 'URGENT'
                ? 'bg-white text-danger shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Nearest deadline and late jobs first"
          >
            <Zap className="w-3.5 h-3.5 text-danger" />
            <span>Urgent Deadlines</span>
          </button>
          <button
            type="button"
            onClick={() => setSortOrder('PROGRESS')}
            className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all ${
              sortOrder === 'PROGRESS'
                ? 'bg-white text-primary shadow-sm border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Most completed steps first"
          >
            <TrendingUp className="w-3.5 h-3.5 text-primary" />
            <span>Progress</span>
          </button>
        </div>
      </div>

      {/* Disabled Banner if business has job management off */}
      {business && !business.job_management_enabled && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
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
          <TabsTrigger value="CURRENT" className="flex-1 font-semibold">
            Current Queue ({tabCounts.current})
          </TabsTrigger>
          <TabsTrigger value="DUE" className="flex-1 font-semibold text-red-600">
            Late Jobs ({tabCounts.due})
          </TabsTrigger>
          <TabsTrigger value="YELLOW" className="flex-1 font-semibold text-amber-700">
            Yellow Box Jobs ({tabCounts.yellow})
          </TabsTrigger>
          <TabsTrigger value="RED" className="flex-1 font-semibold text-red-600">
            Red Box Jobs ({tabCounts.red})
          </TabsTrigger>
          <TabsTrigger value="COMPLETED" className="flex-1 font-semibold text-emerald-700">
            Completed ({tabCounts.completed})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Single-Row FIFO Work Queue List */}
      {loading ? (
        <div className="py-12 text-center text-sm text-slate-500">
          {t('common.loading')}
        </div>
      ) : sortedJobs.length === 0 ? (
        <EmptyState
          message="No jobs found in this queue."
        />
      ) : (
        <div className="space-y-2.5">
          {sortedJobs.map((job, idx) => {
            const days = parseInt(String(job.days_left), 10);
            const isLate = days < 0;
            const isToday = days === 0;
            const isCompleted = job.status === 'COMPLETED';

            // Left accent border color based on status
            const leftBorderClass = isLate
              ? 'border-l-[5px] border-l-red-500'
              : isToday || job.deadline_bucket === 'RED'
              ? 'border-l-[5px] border-l-red-500'
              : job.deadline_bucket === 'YELLOW'
              ? 'border-l-[5px] border-l-amber-400'
              : isCompleted
              ? 'border-l-[5px] border-l-emerald-500'
              : 'border-l-[5px] border-l-[#0B67F6]';

            return (
              <div
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                className={`group relative bg-white hover:bg-slate-50/70 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer p-3 sm:p-4 ${leftBorderClass}`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 sm:gap-4">
                  {/* Left Column: Queue Rank & Customer Info */}
                  <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                    {/* Queue Rank Squircle Badge */}
                    <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-800 font-bold text-xs sm:text-sm flex items-center justify-center border border-slate-200/90 shrink-0 group-hover:bg-blue-50 group-hover:text-primary group-hover:border-blue-200 transition-colors shadow-2xs">
                      #{idx + 1}
                    </div>

                    {/* Customer & Bill details */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 text-sm sm:text-base group-hover:text-primary transition-colors">
                          {job.party_name}
                        </span>

                        {job.party_mobile && (
                          <div className="inline-flex items-center gap-1 text-xs text-slate-500 font-medium bg-slate-50 px-2 py-0.5 rounded border border-slate-200/70">
                            <span>{job.party_mobile}</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const waUrl = getWhatsAppUrl(
                                  job.party_mobile,
                                  `Hello ${job.party_name}, this is regarding your ${job.job_type_name} (Bill #${job.invoice_number}).`
                                );
                                window.open(waUrl, '_blank');
                              }}
                              className="text-emerald-600 hover:text-emerald-700 p-0.5 hover:bg-emerald-50 rounded"
                              title="Chat on WhatsApp"
                            >
                              <MessageCircle className="w-3 h-3" />
                            </button>
                          </div>
                        )}

                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-primary border border-blue-100">
                          <Briefcase className="w-3 h-3" />
                          {job.job_type_name}
                        </span>

                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200/70">
                          <FileText className="w-3 h-3 text-slate-400" />
                          {job.invoice_number}
                        </span>
                      </div>

                      {/* Sub-line: Applicant and Next Action Step Callout */}
                      <div className="flex items-center gap-2.5 text-xs text-slate-600 flex-wrap pt-0.5">
                        {job.applicant_name && (
                          <span className="font-medium">
                            Applicant:{' '}
                            <strong className="text-slate-800 font-semibold">{job.applicant_name}</strong>
                          </span>
                        )}

                        {job.next_step_name && !isCompleted ? (
                          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-blue-50/80 border border-blue-200/80 text-xs text-slate-800 font-medium">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0 animate-pulse"></span>
                            <span className="text-primary font-semibold text-[11px] uppercase tracking-wider">Next:</span>
                            <span className="font-semibold text-slate-900">{job.next_step_name}</span>
                          </div>
                        ) : isCompleted ? (
                          <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200/60">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>All steps completed</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Right Section: Progress Segments, Deadline, Staff, Amount, Action Button */}
                  <div className="flex items-center justify-between lg:justify-end gap-3 sm:gap-4 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                    {/* Visual Step Segments */}
                    <div className="w-32 sm:w-36 shrink-0">
                      {renderStepSegments(job.total_steps, job.ticked_steps, isCompleted)}
                    </div>

                    {/* Deadline Badge */}
                    <div className="shrink-0">{getDeadlineBadge(job)}</div>

                    {/* Assigned Staff (Hidden on mobile, visible on desktop) */}
                    <div className="hidden xl:flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200/70 w-28 truncate">
                      <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{job.assigned_staff_name || 'Unassigned'}</span>
                    </div>

                    {/* Bill Amount */}
                    <div className="text-right shrink-0 min-w-[70px]">
                      <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">Total</div>
                      <div className="text-sm sm:text-base font-bold text-slate-900">{formatINR(job.amount)}</div>
                    </div>

                    {/* Primary Action Button */}
                    <Button
                      size="sm"
                      variant={isCompleted ? 'outline' : 'primary'}
                      className={`shrink-0 h-9 px-3 font-semibold text-xs rounded-lg transition-all flex items-center gap-1 ${
                        isCompleted
                          ? 'border-slate-300 text-slate-700 hover:bg-slate-100'
                          : 'bg-gradient-to-r from-primary to-primary-hover text-white shadow-soft hover:opacity-95'
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedJobId(job.id);
                      }}
                    >
                      <span>{isCompleted ? 'View' : 'Tick Steps'}</span>
                      <ChevronRight className="w-3.5 h-3.5 ml-0.5" />
                    </Button>
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
