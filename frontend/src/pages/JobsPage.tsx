import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { t, getErrorMessage } from '../i18n';
import { getWhatsAppUrl } from '../lib/auth';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Input } from '../components/ui/Input';
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
  AlertCircle,
  FileText,
  ListOrdered,
  TrendingUp,
  ChevronRight,
  ChevronDown,
  MessageCircle,
} from 'lucide-react';

export const JobsPage: React.FC = () => {
  const { business, role, refreshProfile } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'CURRENT' | 'COMPLETED' | 'DUE' | 'YELLOW' | 'RED'>('CURRENT');
  const [search, setSearch] = useState('');
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [sortOrder, setSortOrder] = useState<'QUEUE' | 'PROGRESS'>('QUEUE');
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

  // Dual-layer client + server resilient filter and instant sort priority
  const filteredAndSortedJobs = React.useMemo(() => {
    let result = [...jobs];

    // Client-side real-time instant search
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter((j) => {
        return (
          (j.party_name && j.party_name.toLowerCase().includes(q)) ||
          (j.party_mobile && j.party_mobile.toLowerCase().includes(q)) ||
          (j.applicant_name && j.applicant_name.toLowerCase().includes(q)) ||
          (j.invoice_number && j.invoice_number.toLowerCase().includes(q)) ||
          (j.job_type_name && j.job_type_name.toLowerCase().includes(q))
        );
      });
    }

    // Client-side resilient job type filter (matching ID or snapshotted name)
    if (selectedServiceId) {
      const selectedObj = jobTypes.find((jt) => jt.id === selectedServiceId);
      const selectedName = selectedObj ? selectedObj.name.toLowerCase() : '';

      result = result.filter((j) => {
        if (j.service_id === selectedServiceId) return true;
        if (selectedName && j.job_type_name && j.job_type_name.toLowerCase() === selectedName) return true;
        return false;
      });
    }

    // Sort order
    return result.sort((a, b) => {
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
      // 'QUEUE' (FIFO): earliest created_at first
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [jobs, search, selectedServiceId, jobTypes, sortOrder]);

  // Standard Fixed-Size Deadline Badge (exact w-[84px] h-7, never shifts card height or width)
  const getDeadlineBadge = (job: any) => {
    if (job.status === 'COMPLETED') {
      return (
        <span className="w-[84px] h-7 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          Done
        </span>
      );
    }
    const days = parseInt(String(job.days_left), 10);
    if (days < 0) {
      return (
        <span className="w-[84px] h-7 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 shrink-0">
          <AlertCircle className="w-3.5 h-3.5 text-red-600" />
          {Math.abs(days)}d late
        </span>
      );
    }
    if (days === 0) {
      return (
        <span className="w-[84px] h-7 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 shrink-0">
          <Clock className="w-3.5 h-3.5 text-red-600" />
          Today
        </span>
      );
    }
    if (job.deadline_bucket === 'RED') {
      return (
        <span className="w-[84px] h-7 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold bg-red-50 text-red-700 border border-red-200 shrink-0">
          <Clock className="w-3.5 h-3.5 text-red-600" />
          {days}d left
        </span>
      );
    }
    if (job.deadline_bucket === 'YELLOW') {
      return (
        <span className="w-[84px] h-7 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold bg-amber-50 text-amber-800 border border-amber-300 shrink-0">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          {days}d left
        </span>
      );
    }
    return (
      <span className="w-[84px] h-7 inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
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
          className={`h-2 flex-1 rounded-full transition-all duration-300 ${
            isCompleted
              ? 'bg-emerald-500'
              : isDone
              ? 'bg-primary'
              : 'bg-slate-200'
          }`}
        />
      );
    }
    return (
      <div className="w-full space-y-1">
        <div className="flex items-center gap-1.5 w-full">{segments}</div>
        <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
          <span>
            {ticked} of {total} steps
          </span>
          <span className="font-semibold text-slate-800">
            {isCompleted ? '100%' : `${Math.round((ticked / count) * 100)}%`}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">Customer Work Queue (Jobs)</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Live order tracking, workflow step management, and deadline monitoring
          </p>
        </div>

        {/* Sort Order Selector (Only Queue and Progress) */}
        <div className="flex items-center gap-1.5 bg-slate-100/90 p-1.5 rounded-xl border border-slate-200/80 shrink-0">
          <button
            type="button"
            onClick={() => setSortOrder('QUEUE')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              sortOrder === 'QUEUE'
                ? 'bg-white text-primary shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Queue (FIFO) — Serve customers in order of arrival"
          >
            <ListOrdered className="w-4 h-4 text-primary" />
            <span>Queue</span>
          </button>

          <button
            type="button"
            onClick={() => setSortOrder('PROGRESS')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              sortOrder === 'PROGRESS'
                ? 'bg-white text-primary shadow-xs border border-slate-200'
                : 'text-slate-600 hover:text-slate-900'
            }`}
            title="Most completed steps first"
          >
            <TrendingUp className="w-4 h-4 text-primary" />
            <span>Progress</span>
          </button>
        </div>
      </div>

      {/* Disabled Banner if business has job management off */}
      {business && !business.job_management_enabled && (
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
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
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name, mobile, bill #, applicant, or service..."
            className="pl-10 h-11 text-sm bg-white border-slate-200 rounded-xl shadow-2xs focus:border-primary focus:ring-primary/20"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400 hover:text-slate-600 px-1 py-0.5"
            >
              Clear
            </button>
          )}
        </div>
        <div className="relative">
          <select
            value={selectedServiceId}
            onChange={(e) => setSelectedServiceId(e.target.value)}
            className="w-full h-11 px-3.5 pr-9 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 shadow-2xs hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all appearance-none cursor-pointer"
          >
            <option value="">{t('jobs.all_job_types') || 'All Job Types'}</option>
            {jobTypes.map((jt) => (
              <option key={jt.id} value={jt.id}>
                {jt.name}
              </option>
            ))}
          </select>
          <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        </div>
      </div>

      {/* Tab Navigation */}
      <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as any)}>
        <TabsList className="w-full h-11 p-1 bg-slate-100 rounded-xl">
          <TabsTrigger value="CURRENT" className="flex-1 font-semibold text-xs sm:text-sm">
            Current Queue ({tabCounts.current})
          </TabsTrigger>
          <TabsTrigger value="DUE" className="flex-1 font-semibold text-xs sm:text-sm text-red-600">
            Late Jobs ({tabCounts.due})
          </TabsTrigger>
          <TabsTrigger value="YELLOW" className="flex-1 font-semibold text-xs sm:text-sm text-amber-700">
            Yellow Box Jobs ({tabCounts.yellow})
          </TabsTrigger>
          <TabsTrigger value="RED" className="flex-1 font-semibold text-xs sm:text-sm text-red-600">
            Red Box Jobs ({tabCounts.red})
          </TabsTrigger>
          <TabsTrigger value="COMPLETED" className="flex-1 font-semibold text-xs sm:text-sm text-emerald-700">
            Completed ({tabCounts.completed})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Spacious, Elegant, Premium Job Cards */}
      {loading ? (
        <div className="py-16 text-center text-sm font-medium text-slate-500">
          {t('common.loading')}
        </div>
      ) : filteredAndSortedJobs.length === 0 ? (
        <EmptyState
          message="No jobs found matching your filters."
        />
      ) : (
        <div className="space-y-3">
          {filteredAndSortedJobs.map((job, idx) => {
            const days = parseInt(String(job.days_left), 10);
            const isLate = days < 0;
            const isToday = days === 0;
            const isCompleted = job.status === 'COMPLETED';

            // Distinctive left accent border for quick visual hierarchy
            const leftBorderClass = isLate
              ? 'border-l-[5px] border-l-red-500'
              : isToday || job.deadline_bucket === 'RED'
              ? 'border-l-[5px] border-l-red-500'
              : job.deadline_bucket === 'YELLOW'
              ? 'border-l-[5px] border-l-amber-400'
              : isCompleted
              ? 'border-l-[5px] border-l-emerald-500'
              : 'border-l-[5px] border-l-primary';

            return (
              <div
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                className={`group relative bg-white hover:bg-slate-50/70 rounded-2xl border border-slate-200/90 shadow-2xs hover:shadow-subtle transition-all cursor-pointer p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 ${leftBorderClass}`}
              >
                {/* Left Section: Rank, Customer info, Job Badge, Subtitle info */}
                <div className="flex items-start sm:items-center gap-3.5 min-w-0 flex-1">
                  {/* Queue Rank Badge */}
                  <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 font-extrabold text-sm flex items-center justify-center border border-slate-200 shrink-0 group-hover:bg-blue-50 group-hover:text-primary group-hover:border-blue-200 transition-colors">
                    #{idx + 1}
                  </div>

                  {/* Customer and Job Info */}
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Top Row: Customer Name, Phone, Job Type, Bill # */}
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-bold text-slate-900 text-base sm:text-lg group-hover:text-primary transition-colors tracking-tight">
                        {job.party_name}
                      </span>

                      {job.party_mobile && (
                        <div className="inline-flex items-center gap-1.5 text-xs text-slate-700 font-medium bg-slate-100/90 px-2.5 py-1 rounded-lg border border-slate-200 shrink-0">
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
                            className="text-emerald-600 hover:text-emerald-700 p-0.5 rounded transition-colors"
                            title="Chat on WhatsApp"
                          >
                            <MessageCircle className="w-3.5 h-3.5 fill-emerald-600/10 text-emerald-600" />
                          </button>
                        </div>
                      )}

                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-primary border border-blue-100 shrink-0">
                        <Briefcase className="w-3.5 h-3.5" />
                        {job.job_type_name}
                      </span>

                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-50 px-2 py-1 rounded-lg border border-slate-200 shrink-0">
                        <FileText className="w-3.5 h-3.5 text-slate-400" />
                        {job.invoice_number}
                      </span>

                      {job.applicant_name && (
                        <span className="text-xs text-slate-600 font-medium bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200 shrink-0">
                          Applicant: <strong className="text-slate-800 font-semibold">{job.applicant_name}</strong>
                        </span>
                      )}
                    </div>

                    {/* Middle Row: Next Action Callout */}
                    <div className="flex items-center gap-2">
                      {job.next_step_name && !isCompleted ? (
                        <div
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50/70 border border-blue-200/60 text-xs text-slate-800"
                          title={job.next_step_name}
                        >
                          <span className="w-2 h-2 rounded-full bg-primary shrink-0 animate-pulse" />
                          <span className="text-primary font-bold text-[10px] uppercase tracking-wider">Next Step:</span>
                          <span className="font-semibold text-slate-900">{job.next_step_name}</span>
                        </div>
                      ) : isCompleted ? (
                        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-semibold border border-emerald-200/60 shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>All workflow steps completed</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Right Section: Progress Segments, Fixed-Size Deadline, Staff, Amount, Button */}
                <div className="flex flex-wrap sm:flex-nowrap items-center justify-between lg:justify-end gap-3.5 shrink-0 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                  {/* Step Segments */}
                  <div className="w-36 shrink-0">
                    {renderStepSegments(job.total_steps, job.ticked_steps, isCompleted)}
                  </div>

                  {/* Fixed-size Deadline Badge (Exact w-[84px] h-7) */}
                  <div className="w-[84px] shrink-0 flex items-center justify-center">
                    {getDeadlineBadge(job)}
                  </div>

                  {/* Assigned Staff */}
                  <div className="hidden xl:flex items-center gap-1.5 text-xs text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 w-[120px] shrink-0">
                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{job.assigned_staff_name || 'Unassigned'}</span>
                  </div>

                  {/* Amount */}
                  <div className="w-[88px] shrink-0 text-right">
                    <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 leading-none">Total</div>
                    <div className="text-base font-bold text-slate-900 mt-0.5">{formatINR(job.amount)}</div>
                  </div>

                  {/* Action Button */}
                  <Button
                    size="sm"
                    variant={isCompleted ? 'outline' : 'primary'}
                    className={`w-[104px] shrink-0 h-9 px-3 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1 ${
                      isCompleted
                        ? 'border-slate-300 text-slate-700 hover:bg-slate-100'
                        : 'bg-primary text-white hover:bg-primary-hover shadow-2xs'
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedJobId(job.id);
                    }}
                  >
                    <span>{isCompleted ? 'View' : 'Tick Steps'}</span>
                    <ChevronRight className="w-4 h-4" />
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
