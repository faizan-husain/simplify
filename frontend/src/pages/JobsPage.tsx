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
  Search,
  Clock,
  User,
  CheckCircle2,
  AlertCircle,
  ListOrdered,
  TrendingUp,
  ChevronDown,
  MessageCircle,
  Check,
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

  // Connected Circle Stepper (exact match to user design)
  const renderConnectedStepper = (totalSteps: number, tickedSteps: number, isCompleted: boolean) => {
    const count = Math.max(1, totalSteps || 1);
    const nodes = [];

    for (let i = 0; i < count; i++) {
      const isDone = isCompleted || i < tickedSteps;

      nodes.push(
        <div key={`node-${i}`} className="flex items-center flex-1 last:flex-initial">
          {/* Circular Node */}
          <div
            className={`w-3.5 h-3.5 rounded-full shrink-0 transition-all ${
              isCompleted
                ? 'bg-emerald-500 ring-4 ring-emerald-100'
                : isDone
                ? 'bg-primary ring-4 ring-blue-100'
                : 'border-2 border-slate-300 bg-white'
            }`}
          />
          {/* Connecting Track between nodes */}
          {i < count - 1 && (
            <div
              className={`h-1 flex-1 mx-1.5 rounded-full transition-all ${
                isCompleted
                  ? 'bg-emerald-400'
                  : i < tickedSteps - 1
                  ? 'bg-primary'
                  : i === tickedSteps - 1
                  ? 'bg-gradient-to-r from-primary to-blue-200'
                  : 'bg-slate-200'
              }`}
            />
          )}
        </div>
      );
    }

    return (
      <div className="w-full flex items-center justify-between py-1">
        {nodes}
      </div>
    );
  };

  // Standard Pill Deadline Badge
  const getDeadlineBadge = (job: any) => {
    if (job.status === 'COMPLETED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#ECFDF5] text-[#059669] shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 text-[#059669]" />
          <span>Done</span>
        </span>
      );
    }
    const days = parseInt(String(job.days_left), 10);
    if (days < 0) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#FEF2F2] text-[#EF4444] shrink-0">
          <AlertCircle className="w-3.5 h-3.5 text-[#EF4444]" />
          <span>{Math.abs(days)}d late</span>
        </span>
      );
    }
    if (days === 0) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#FEF2F2] text-[#EF4444] shrink-0">
          <Clock className="w-3.5 h-3.5 text-[#EF4444]" />
          <span>Today</span>
        </span>
      );
    }
    if (job.deadline_bucket === 'RED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#FEF2F2] text-[#EF4444] shrink-0">
          <Clock className="w-3.5 h-3.5 text-[#EF4444]" />
          <span>{days}d left</span>
        </span>
      );
    }
    if (job.deadline_bucket === 'YELLOW') {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#FFFBEB] text-[#D97706] shrink-0">
          <Clock className="w-3.5 h-3.5 text-[#D97706]" />
          <span>{days}d left</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 shrink-0">
        <Clock className="w-3.5 h-3.5 text-slate-500" />
        <span>{days}d left</span>
      </span>
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

      {/* Professional Job Card matching reference layout */}
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

            // Left Urgency Strip color matching reference
            const accentBgClass = isLate || isToday || job.deadline_bucket === 'RED'
              ? 'bg-[#F85149]'
              : job.deadline_bucket === 'YELLOW'
              ? 'bg-[#F59E0B]'
              : isCompleted
              ? 'bg-[#10B981]'
              : 'bg-[#0862EC]';

            const count = Math.max(1, job.total_steps || 1);
            const ticked = job.ticked_steps || 0;
            const percent = isCompleted
              ? 100
              : Math.round((ticked / count) * 100);

            return (
              <div
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                className="group relative bg-white hover:bg-slate-50/50 rounded-2xl border border-slate-200/80 shadow-[0_2px_12px_rgba(0,0,0,0.03)] hover:shadow-subtle transition-all cursor-pointer p-4 sm:p-5 pl-5 sm:pl-6 overflow-hidden"
              >
                {/* Left Urgency Color Strip (rounded matching card corner) */}
                <div className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-2xl ${accentBgClass}`} />

                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
                  {/* Left Section: Customer Name, Phone, Badges, Applicant */}
                  <div className="space-y-2.5 min-w-[260px] lg:max-w-[340px]">
                    {/* Row 1: Customer Name + WhatsApp Phone Pill */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="font-bold text-slate-900 text-base sm:text-[17px] tracking-tight group-hover:text-primary transition-colors">
                        {job.party_name}
                      </h3>

                      {job.party_mobile && (
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
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#E8FAF0] text-[#047857] hover:bg-[#D1FAE5] text-xs font-semibold transition-colors"
                          title="Chat on WhatsApp"
                        >
                          <MessageCircle className="w-3.5 h-3.5 fill-[#047857] text-[#047857]" />
                          <span>{job.party_mobile}</span>
                        </button>
                      )}
                    </div>

                    {/* Row 2: #1, Job Type, Bill Number Badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-[#EFF6FF] text-[#0862EC]">
                        #{idx + 1}
                      </span>

                      <span className="px-3 py-1 rounded-lg text-xs font-bold bg-[#EFF6FF] text-[#0862EC]">
                        {job.job_type_name}
                      </span>

                      <span className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#F1F5F9] text-[#64748B]">
                        {job.invoice_number}
                      </span>
                    </div>

                    {/* Row 3: Applicant Box */}
                    <div>
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-[#F8FAFC] border border-slate-100/90 text-xs">
                        <span className="text-slate-500 font-medium">Applicant:</span>
                        <span className="font-bold text-slate-900">
                          {job.applicant_name || job.party_name}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Center Section: Connected Stepper & Status Row */}
                  <div className="flex-1 lg:border-l lg:border-slate-200/70 lg:pl-6 space-y-2.5 min-w-[280px]">
                    {/* Stepper with Circles & Connector Bar */}
                    <div className="max-w-md">
                      {renderConnectedStepper(job.total_steps, job.ticked_steps, isCompleted)}
                    </div>

                    {/* Status Meta Row: Step Ratio | Percent, Deadline Badge, Staff Badge */}
                    <div className="flex items-center gap-3 text-xs flex-wrap">
                      <div className="flex items-center gap-1.5 text-slate-600 font-medium shrink-0">
                        <span>
                          {ticked} of {job.total_steps || 0} steps
                        </span>
                        <span className="text-slate-300 font-light">|</span>
                        <span className="font-bold text-[#0862EC]">
                          {percent}%
                        </span>
                      </div>

                      {/* Deadline Badge */}
                      {getDeadlineBadge(job)}

                      {/* Staff Badge */}
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-[#F1F5F9] text-slate-700 text-xs font-semibold shrink-0">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span className="max-w-[100px] truncate">{job.assigned_staff_name || 'Unassigned'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Section: Total Amount & Tick Steps Action Button */}
                  <div className="flex items-center justify-between lg:justify-end gap-5 lg:border-l lg:border-slate-200/70 lg:pl-6 shrink-0 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                    {/* Amount */}
                    <div className="text-right">
                      <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">TOTAL</div>
                      <div className="text-2xl font-black text-[#0F172A] tracking-tight">
                        {formatINR(job.amount)}
                      </div>
                    </div>

                    {/* Action Button: Deep Royal Navy with White Checkmark */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedJobId(job.id);
                      }}
                      className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold shadow-xs transition-all shrink-0 cursor-pointer ${
                        isCompleted
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                          : 'bg-[#103D88] hover:bg-[#0C306B] text-white active:scale-[0.98]'
                      }`}
                    >
                      {isCompleted ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                          <span>Completed</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-4 h-4 stroke-[3]" />
                          <span>Tick Steps</span>
                        </>
                      )}
                    </button>
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
