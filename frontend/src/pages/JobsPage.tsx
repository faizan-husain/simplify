import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { clsx } from 'clsx';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { t, getErrorMessage } from '../i18n';
import { getWhatsAppUrl } from '../lib/auth';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { Select } from '../components/ui/Select';
import { EmptyState } from '../components/ui/EmptyState';
import { JobDetailModal } from '../components/jobs/JobDetailModal';
import {
  Search,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ListOrdered,
  TrendingUp,
  MessageCircle,
  Check,
} from 'lucide-react';

export const JobsPage: React.FC = () => {
  const { business, role, refreshProfile } = useAuth();
  const { showToast } = useToast();

  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab')?.toUpperCase();
  const validTabs = ['CURRENT', 'COMPLETED', 'DUE', 'YELLOW', 'RED'];
  const [activeTab, setActiveTab] = useState<'CURRENT' | 'COMPLETED' | 'DUE' | 'YELLOW' | 'RED'>(
    validTabs.includes(urlTab || '') ? (urlTab as any) : 'CURRENT'
  );

  useEffect(() => {
    const tabParam = searchParams.get('tab')?.toUpperCase();
    if (tabParam && validTabs.includes(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam as any);
    }
  }, [searchParams]);

  const handleTabChange = (val: string) => {
    setActiveTab(val as any);
    setSearchParams({ tab: val });
  };
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
  const [focusedJobIndex, setFocusedJobIndex] = useState<number>(-1);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  // Keyboard navigation for jobs
  // Load available job types for filtering
  const loadJobTypes = async () => {
    const { data } = await supabase
      .from('services')
      .select('id, name')
      .eq('is_job_type', true)
      .eq('active', true)
      .is('deleted_at', null)
      .order('name');
    setJobTypes(data || []);
  };

  useEffect(() => {
    loadJobTypes();
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

  // Live auto-refresh when services are updated by admin, cross-tab broadcast, or window gains focus
  useEffect(() => {
    const handleRefresh = () => {
      loadJobs();
      loadJobTypes();
    };

    window.addEventListener('simplify:jobs_updated', handleRefresh);
    window.addEventListener('focus', handleRefresh);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'simplify:jobs_updated') {
        handleRefresh();
      }
    };
    window.addEventListener('storage', handleStorage);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('simplify_events');
      bc.onmessage = (msg) => {
        if (msg.data?.type === 'jobs_updated') {
          handleRefresh();
        }
      };
    } catch {
      // BroadcastChannel optional fallback
    }

    return () => {
      window.removeEventListener('simplify:jobs_updated', handleRefresh);
      window.removeEventListener('focus', handleRefresh);
      window.removeEventListener('storage', handleStorage);
      bc?.close();
    };
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

  const handleDirectComplete = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const { data, error } = await supabase.rpc('complete_job_directly', { p_job_id: jobId });
      if (error) throw error;
      showToast(data?.status === 'COMPLETED' ? 'Job completed!' : 'Job reopened', 'success');
      loadJobs();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
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
        if (aTicked !== bTicked) {
          return aTicked - bTicked; // Fewer ticked steps at top, more ticked at bottom (Ascending)
        }
        const aProg = parseFloat(String(a.progress_percent || '0'));
        const bProg = parseFloat(String(b.progress_percent || '0'));
        if (aProg !== bProg) {
          return aProg - bProg; // Lower percentage first
        }
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      // 'QUEUE' (FIFO): earliest created_at first
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [jobs, search, selectedServiceId, jobTypes, sortOrder]);

  useEffect(() => {
    const handleJobsKeyDown = (e: KeyboardEvent) => {
      if (selectedJobId) return;

      const activeEl = document.activeElement as HTMLElement | null;
      const isInputActive =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.isContentEditable);

      if (e.key === '/' && !isInputActive) {
        e.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (isInputActive && activeEl === searchInputRef.current) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          searchInputRef.current?.blur();
          setFocusedJobIndex(0);
        }
        return;
      }

      if (isInputActive) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedJobIndex((prev) => (prev + 1 >= filteredAndSortedJobs.length ? 0 : prev + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedJobIndex((prev) => (prev <= 0 ? Math.max(0, filteredAndSortedJobs.length - 1) : prev - 1));
      } else if (e.key === 'Enter' && focusedJobIndex >= 0 && focusedJobIndex < filteredAndSortedJobs.length) {
        e.preventDefault();
        setSelectedJobId(filteredAndSortedJobs[focusedJobIndex].id);
      }
    };

    window.addEventListener('keydown', handleJobsKeyDown);
    return () => window.removeEventListener('keydown', handleJobsKeyDown);
  }, [filteredAndSortedJobs, focusedJobIndex, selectedJobId]);

  // Format Indian mobile number as 5 digits + space + 5 digits (e.g. 98110 01044)
  const formatMobile = (mob?: string) => {
    if (!mob) return '';
    const clean = mob.replace(/\D/g, '');
    if (clean.length === 10) {
      return `${clean.slice(0, 5)} ${clean.slice(5)}`;
    }
    if (clean.length === 12 && clean.startsWith('91')) {
      const raw = clean.slice(2);
      return `${raw.slice(0, 5)} ${raw.slice(5)}`;
    }
    return mob;
  };

  // Get 2-letter staff initials for avatar (e.g. 'AK' for Amit Kumar)
  const getInitials = (name?: string) => {
    if (!name) return 'OW';
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  // Discrete Step Segment Bar (matches reference image: split into N equal segments)
  const renderDiscreteStepBar = (
    totalSteps: number,
    tickedSteps: number,
    isCompleted: boolean,
    isLate: boolean = false,
    isRed: boolean = false,
    isYellow: boolean = false
  ) => {
    const count = Math.max(totalSteps || 1, 1);
    const ticked = isCompleted ? count : Math.min(tickedSteps || 0, count);

    // Active filled segment color based on status
    const activeSegmentColor = isCompleted
      ? 'bg-emerald-600'
      : isLate
        ? 'bg-red-600'
        : isRed
          ? 'bg-red-600'
          : isYellow
            ? 'bg-amber-500'
            : 'bg-[#0D746E]'; // Deep elegant teal/slate as in reference

    // Inactive pending segment color (soft pastel tint)
    const inactiveSegmentColor = isCompleted
      ? 'bg-emerald-100'
      : isLate
        ? 'bg-red-200/60'
        : isRed
          ? 'bg-red-200/60'
          : isYellow
            ? 'bg-amber-200/60'
            : 'bg-slate-200';

    return (
      <div className="w-full flex items-center gap-1.5 py-0.5">
        {Array.from({ length: count }).map((_, i) => {
          const isDone = i < ticked;
          return (
            <div
              key={i}
              className={clsx(
                'h-1.5 flex-1 rounded-full transition-all duration-300',
                isDone ? activeSegmentColor : inactiveSegmentColor
              )}
            />
          );
        })}
      </div>
    );
  };

  // Luxury Pill Deadline Badge (clean borderless days late / days left pill)
  const getDeadlineBadge = (job: any) => {
    if (job.status === 'COMPLETED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border-0 shrink-0 shadow-2xs">
          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
          <span>Completed</span>
        </span>
      );
    }
    const days = parseInt(String(job.days_left), 10);
    if (days < 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-600 text-white shrink-0 shadow-2xs border-0">
          <AlertTriangle className="w-3 h-3 text-white" />
          <span>{Math.abs(days)} days late</span>
        </span>
      );
    }
    if (days === 0) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border-0 shrink-0 shadow-2xs">
          <Clock className="w-3 h-3 text-red-600" />
          <span>Due today</span>
        </span>
      );
    }
    if (job.deadline_bucket === 'RED' || days <= 3) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border-0 shrink-0 shadow-2xs">
          <Clock className="w-3 h-3 text-red-600" />
          <span>{days} days left</span>
        </span>
      );
    }
    if (job.deadline_bucket === 'YELLOW' || days <= 5) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border-0 shrink-0 shadow-2xs">
          <Clock className="w-3 h-3 text-amber-600" />
          <span>{days} days left</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700 border-0 shrink-0 shadow-2xs">
        <Clock className="w-3 h-3 text-slate-500" />
        <span>{days} days left</span>
      </span>
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text">Customer Work Queue (Jobs)</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Live order tracking, workflow step management, and deadline monitoring
          </p>
        </div>

        {/* Sort Order Selector (Only Queue and Progress) */}
        <div className="flex items-center gap-1 bg-surface-3 p-1 rounded-xl shrink-0">
          <button
            type="button"
            onClick={() => setSortOrder('QUEUE')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${sortOrder === 'QUEUE'
              ? 'bg-white text-text shadow-xs font-semibold'
              : 'text-text-muted hover:text-text'
              }`}
            title="Queue (FIFO) — Serve customers in order of arrival"
          >
            <ListOrdered className="w-3.5 h-3.5 text-accent" />
            <span>Queue</span>
          </button>

          <button
            type="button"
            onClick={() => setSortOrder('PROGRESS')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${sortOrder === 'PROGRESS'
              ? 'bg-white text-text shadow-xs font-semibold'
              : 'text-text-muted hover:text-text'
              }`}
            title="Sort by progress (least completed steps first)"
          >
            <TrendingUp className="w-3.5 h-3.5 text-accent" />
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
            ref={searchInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by customer name, mobile, bill #, applicant, or service... (Press / to search)"
            className="pl-10 h-11 text-sm bg-white border-0 rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#0F766E]/20"
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
        <div className="w-full sm:w-[220px]">
          <Select
            value={selectedServiceId}
            onChange={setSelectedServiceId}
            options={[
              { value: '', label: t('jobs.all_job_types') || 'All Job Types' },
              ...jobTypes.map((jt) => ({
                value: jt.id,
                label: jt.name,
              })),
            ]}
            variant="card"
            placeholder={t('jobs.all_job_types') || 'All Job Types'}
            searchable={jobTypes.length > 5}
          />
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="border-b border-divider bg-transparent p-0 overflow-x-auto max-w-full no-scrollbar">
        <div className="inline-flex items-center justify-start gap-4 sm:gap-6 min-w-full sm:min-w-0">
          {[
            {
              key: 'CURRENT',
              label: 'Current Queue',
              count: tabCounts.current,
              activeText: 'text-primary font-bold',
              activeIndicator: 'after:bg-primary',
              inactiveBadge: 'bg-slate-100 text-slate-600 font-semibold',
              activeBadge: 'bg-primary text-white font-bold',
            },
            {
              key: 'DUE',
              label: 'Late Jobs',
              count: tabCounts.due,
              activeText: 'text-rose-700 font-bold',
              activeIndicator: 'after:bg-rose-600',
              inactiveBadge:
                tabCounts.due > 0
                  ? 'bg-rose-100 text-rose-700 font-bold'
                  : 'bg-slate-100 text-slate-500 font-medium',
              activeBadge: 'bg-rose-600 text-white font-bold',
            },
            {
              key: 'YELLOW',
              label: 'Yellow Box',
              count: tabCounts.yellow,
              activeText: 'text-amber-800 font-bold',
              activeIndicator: 'after:bg-amber-500',
              inactiveBadge:
                tabCounts.yellow > 0
                  ? 'bg-amber-100 text-amber-800 font-bold'
                  : 'bg-slate-100 text-slate-500 font-medium',
              activeBadge: 'bg-amber-500 text-white font-bold',
            },
            {
              key: 'RED',
              label: 'Red Box',
              count: tabCounts.red,
              activeText: 'text-red-700 font-bold',
              activeIndicator: 'after:bg-red-600',
              inactiveBadge:
                tabCounts.red > 0
                  ? 'bg-red-100 text-red-700 font-bold'
                  : 'bg-slate-100 text-slate-500 font-medium',
              activeBadge: 'bg-red-600 text-white font-bold',
            },
            {
              key: 'COMPLETED',
              label: 'Completed',
              count: tabCounts.completed,
              activeText: 'text-emerald-700 font-bold',
              activeIndicator: 'after:bg-emerald-600',
              inactiveBadge:
                tabCounts.completed > 0
                  ? 'bg-emerald-100 text-emerald-800 font-bold'
                  : 'bg-slate-100 text-slate-500 font-medium',
              activeBadge: 'bg-emerald-600 text-white font-bold',
            },
          ].map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabChange(tab.key)}
                className={clsx(
                  'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap pb-3 pt-1 text-[13.5px] sm:text-[14px] font-medium transition-all select-none outline-none cursor-pointer',
                  'after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[2.5px] after:transition-all after:duration-200',
                  isActive
                    ? clsx(tab.activeText, tab.activeIndicator, 'after:bg-current')
                    : 'text-text-muted hover:text-text after:bg-transparent'
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={clsx(
                    'text-[11px] tabular-nums px-1.5 py-0.5 min-w-[20px] rounded-md transition-all duration-200 border-0 flex items-center justify-center font-semibold leading-none',
                    isActive ? tab.activeBadge : tab.inactiveBadge
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Professional Job Card matching reference layout */}
      {loading ? (
        <div className="py-16 text-center text-sm font-medium text-text-muted">
          {t('common.loading')}
        </div>
      ) : filteredAndSortedJobs.length === 0 ? (
        <EmptyState
          message="No jobs found matching your filters."
        />
      ) : (
        <div className="space-y-3">
          {filteredAndSortedJobs.map((job, idx) => {
            const isCompleted = job.status === 'COMPLETED';
            const days = parseInt(String(job.days_left), 10);
            const isLate = !isCompleted && days < 0;
            const isToday = !isCompleted && days === 0;
            const isRed = !isCompleted && !isLate && (isToday || job.deadline_bucket === 'RED' || days <= 3);
            const isYellow = !isCompleted && !isLate && !isToday && !isRed && (job.deadline_bucket === 'YELLOW' || days <= 5);

            // Clean White Background for All Cards with tactile elevation shadow
            const cardBgBorderClass =
              'bg-white border-0 shadow-[0_4px_20px_rgba(15,23,42,0.08),0_1px_3px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_30px_rgba(15,23,42,0.12),0_2px_6px_rgba(15,23,42,0.06)]';

            const count = job.total_steps || 0;
            const hasMultiSteps = count >= 2;
            const ticked = job.ticked_steps || 0;
            const percent = isCompleted
              ? 100
              : hasMultiSteps
                ? Math.round((ticked / count) * 100)
                : count === 1 && ticked === 1
                  ? 100
                  : 0;

            const rankStr = `#${String(idx + 1).padStart(2, '0')}`;
            const isFocused = idx === focusedJobIndex;

            return (
              <div
                key={job.id}
                onClick={() => setSelectedJobId(job.id)}
                className={clsx(
                  'group rounded-2xl transition-all duration-200 cursor-pointer p-4 sm:p-5 hover:-translate-y-0.5 select-none',
                  cardBgBorderClass,
                  isFocused && 'ring-2 ring-[#0F766E]'
                )}
              >
                <div className="flex flex-col lg:flex-row lg:items-stretch justify-between gap-5 lg:gap-0">
                  {/* Left Half: 50% of card for Customer, Service, and Particulars */}
                  <div className="w-full lg:w-1/2 min-w-0 space-y-1.5 lg:pr-6 xl:lg:pr-8 flex flex-col justify-center">
                    {/* Row 1: Party Name + Phone WhatsApp Pill (Borderless) */}
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h3 className="font-semibold text-slate-900 text-[15px] sm:text-[16px] tracking-tight group-hover:text-primary transition-colors">
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
                          className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 hover:bg-emerald-50 text-slate-700 hover:text-emerald-800 text-[11.5px] font-medium border-0 transition-all shadow-2xs cursor-pointer"
                          title="Chat on WhatsApp"
                        >
                          <MessageCircle className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span className="tabular-nums tracking-wide">{formatMobile(job.party_mobile)}</span>
                        </button>
                      )}
                    </div>

                    {/* Row 2: #09 · Job Type · INV-1102 */}
                    <div className="flex items-center gap-2 text-xs text-slate-500 font-medium flex-wrap">
                      <span className="font-semibold text-slate-700">{rankStr}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-600">{job.job_type_name}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-slate-500 font-mono">{job.invoice_number}</span>
                    </div>

                    {/* Row 3: Particular [applicant_name || party_name] */}
                    <div className="flex items-center text-xs text-slate-600 gap-2 min-w-0 pt-0.5">
                      <span className="text-slate-400 font-normal shrink-0">Particular</span>
                      <span className="font-medium text-slate-700 truncate" title={job.applicant_name || job.party_name}>
                        {job.applicant_name || job.party_name}
                      </span>
                    </div>

                    {/* Row 4: Created by */}
                    <div className="flex items-center text-xs text-slate-500 gap-1.5 min-w-0 pt-0.5">
                      <span className="text-slate-400 font-normal shrink-0">Created by:</span>
                      <span className="font-semibold text-slate-700 truncate">
                        {job.created_by_name || 'Owner'}
                      </span>
                    </div>
                  </div>

                  {/* Right Half: 50% of card containing Steps Progress & Total Action */}
                  <div
                    className={clsx(
                      'w-full lg:w-1/2 min-w-0 flex flex-col sm:flex-row sm:items-center justify-between gap-5 lg:gap-6',
                      'pt-4 lg:pt-0 lg:pl-6 xl:lg:pl-8'
                    )}
                  >
                    {/* Steps & Progress: flex-1 with generous room to breathe */}
                    <div className="flex-1 min-w-0 space-y-1.5">
                      {/* Line 1: Step Ratio + Percentage */}
                      <div className="flex items-center justify-between text-xs font-semibold text-slate-800">
                        <span>
                          {hasMultiSteps
                            ? `${ticked} of ${count} steps`
                            : count === 1
                              ? isCompleted ? '1 of 1 step' : '0 of 1 step'
                              : 'Direct Job'}
                        </span>
                        <span className="font-bold tabular-nums text-slate-700">
                          {percent}%
                        </span>
                      </div>

                      {/* Line 2: Discrete Step Segment Bar */}
                      {renderDiscreteStepBar(count, ticked, isCompleted, isLate, isRed, isYellow)}

                      {/* Line 3: Next Step */}
                      <div className="text-xs text-slate-500 font-normal truncate pt-0.5">
                        {isCompleted ? (
                          <span className="text-emerald-700 font-medium inline-flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                            <span>All steps completed</span>
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="text-slate-400 shrink-0">Next</span>
                            <span className="text-slate-300 shrink-0">·</span>
                            <span className="text-slate-600 font-medium truncate">
                              {job.next_step_name || 'Processing next step'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Line 4: Badges (Deadline + Staff) */}
                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        {getDeadlineBadge(job)}

                        {/* Staff Avatar + Name */}
                        <div className="inline-flex items-center gap-1.5 shrink-0" title={`Assigned to ${job.assigned_staff_name || 'Owner'}`}>
                          <span className="text-xs text-slate-400 font-normal">Assigned:</span>
                          <div className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 border-0 shadow-2xs flex items-center justify-center text-[10px] font-bold">
                            {getInitials(job.assigned_staff_name)}
                          </div>
                          <span className="text-xs text-slate-700 font-medium truncate max-w-[110px]">
                            {job.assigned_staff_name || 'Owner'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Total Amount + Tick steps Button */}
                    <div className="shrink-0 flex items-center justify-between sm:flex-col sm:items-end sm:justify-center gap-2.5 min-w-[125px] pt-3 sm:pt-0">
                      <div className="text-left sm:text-right">
                        <div className="text-[11.5px] font-normal text-slate-400">Total</div>
                        <div className="text-xl sm:text-[22px] font-bold text-slate-900 tabular-nums tracking-tight leading-tight">
                          {formatINR(job.amount)}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!hasMultiSteps && !isCompleted) {
                            handleDirectComplete(job.id, e);
                          } else {
                            setSelectedJobId(job.id);
                          }
                        }}
                        className={clsx(
                          'inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-all shrink-0 cursor-pointer shadow-sm active:scale-[0.98] border-0',
                          isCompleted
                            ? 'bg-emerald-50 text-emerald-800 border-0 hover:bg-emerald-100 shadow-2xs'
                            : 'bg-slate-900 hover:bg-black text-white hover:shadow border-0'
                        )}
                      >
                        <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        <span>
                          {isCompleted ? 'Completed' : !hasMultiSteps ? 'Mark Done' : 'Tick steps'}
                        </span>
                      </button>
                    </div>
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
