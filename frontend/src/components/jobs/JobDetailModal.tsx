import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatINR } from '../../lib/money';
import { formatDate } from '../../lib/dates';
import { getWhatsAppUrl } from '../../lib/auth';
import { t, getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/Select';
import { useToast } from '../ui/Toast';
import { useAuth } from '../../context/AuthContext';
import {
  CheckCircle2,
  Clock,
  User,
  MessageCircle,
  Calendar,
  History,
  AlertTriangle,
  XCircle,
  X,
  Pencil,
  ChevronDown,
} from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';

export interface JobDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string | null;
  onJobUpdated?: () => void;
}

export const JobDetailModal: React.FC<JobDetailModalProps> = ({
  open,
  onOpenChange,
  jobId,
  onJobUpdated,
}) => {
  const { business, role } = useAuth();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(false);
  const [jobData, setJobData] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [staffMembers, setStaffMembers] = useState<any[]>([]);

  // Owner editable fields
  const [isEditing, setIsEditing] = useState(false);
  const [deadlineDate, setDeadlineDate] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partyMobile, setPartyMobile] = useState('');
  const [applicantName, setApplicantName] = useState('');
  const [assignedStaffId, setAssignedStaffId] = useState('');
  const [savingChanges, setSavingChanges] = useState(false);
  const [tickingStepId, setTickingStepId] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState(false);

  // Job cancellation
  const [isCancelConfirmOpen, setIsCancelConfirmOpen] = useState(false);
  const [cancellingJob, setCancellingJob] = useState(false);

  const isOwner = role === 'OWNER';

  // Fetch active staff members for assignment
  useEffect(() => {
    if (open && isOwner) {
      supabase
        .from('members')
        .select('id, name, role')
        .eq('active', true)
        .order('name')
        .then(({ data }) => {
          if (data) setStaffMembers(data);
        });
    }
  }, [open, isOwner]);

  const loadJob = async () => {
    if (!jobId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('job_detail', { p_job_id: jobId });
      if (error) throw error;

      if (data) {
        setJobData(data.job);
        setSteps(data.steps || []);
        setEvents(data.events || []);
        setDeadlineDate(data.job.deadline_date || '');
        setPartyName(data.job.party_name || '');
        setPartyMobile(data.job.party_mobile || '');
        setApplicantName(data.job.applicant_name || '');
        setAssignedStaffId(data.job.assigned_staff_id || '');
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && jobId) {
      setIsEditing(false);
      setShowEvents(false);
      loadJob();
    } else {
      setJobData(null);
      setSteps([]);
      setEvents([]);
    }
  }, [open, jobId]);

  const handleToggleStep = async (step: any) => {
    if (jobData?.status === 'CANCELLED') {
      showToast('Cannot tick steps on a cancelled job', 'info');
      return;
    }
    setTickingStepId(step.id);
    try {
      if (step.ticked) {
        const { error } = await supabase.rpc('untick_step', { p_step_id: step.id });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('tick_step', { p_step_id: step.id });
        if (error) throw error;
      }
      await loadJob();
      onJobUpdated?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setTickingStepId(null);
    }
  };

  const handleDirectComplete = async () => {
    if (!jobId) return;
    try {
      const { data, error } = await supabase.rpc('complete_job_directly', { p_job_id: jobId });
      if (error) throw error;
      showToast(data?.status === 'COMPLETED' ? 'Job completed!' : 'Job reopened', 'success');
      await loadJob();
      onJobUpdated?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    }
  };

  const handleSaveChanges = async () => {
    if (!jobId) return;
    setSavingChanges(true);
    try {
      const { error } = await supabase.rpc('update_job', {
        p_job_id: jobId,
        p_deadline_date: deadlineDate || null,
        p_assigned_staff_id: assignedStaffId || null,
        p_applicant_name: applicantName || null,
        p_party_name: partyName || null,
        p_party_mobile: partyMobile || null,
      });
      if (error) throw error;
      showToast(t('jobs.job_updated'), 'success');
      setIsEditing(false);
      await loadJob();
      onJobUpdated?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSavingChanges(false);
    }
  };

  const handleCancelJob = async () => {
    if (!jobId) return;
    setCancellingJob(true);
    try {
      const { error } = await supabase.rpc('cancel_job', {
        p_job_id: jobId,
        p_reason: 'Cancelled by user',
      });
      if (error) throw error;
      showToast('Job cancelled successfully', 'info');
      setIsCancelConfirmOpen(false);
      await loadJob();
      onJobUpdated?.();
      onOpenChange(false);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setCancellingJob(false);
    }
  };

  const handleSendWhatsApp = (step: any) => {
    if (!jobData || !jobData.party_mobile || !step.whatsapp_message) return;

    let text = step.whatsapp_message;
    text = text.replace(/{party_name}/g, jobData.party_name || '');
    text = text.replace(/{job_name}/g, jobData.job_type_name || '');
    text = text.replace(/{applicant}/g, jobData.applicant_name || jobData.party_name || '');
    text = text.replace(/{bill_no}/g, jobData.invoice_number || '');
    text = text.replace(/{step_name}/g, step.name || '');
    text = text.replace(/{business_name}/g, business?.name || '');

    const url = getWhatsAppUrl(jobData.party_mobile, text);
    window.open(url, '_blank');
  };

  if (!open) return null;

  const isCompleted = jobData?.status === 'COMPLETED';
  const daysLeft = jobData ? parseInt(String(jobData.days_left), 10) : 0;

  const getDeadlineBadge = () => {
    if (jobData?.status === 'CANCELLED') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-500 line-through shrink-0">
          <XCircle className="w-3.5 h-3.5 text-slate-400" />
          <span>Cancelled</span>
        </span>
      );
    }
    if (isCompleted) {
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)] shrink-0">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
          <span>{t('jobs.completed_badge')}</span>
        </span>
      );
    }
    if (daysLeft < 0) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-50 text-rose-700 border-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)] shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse" />
          <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
          <span>{t('jobs.days_late', { days: Math.abs(daysLeft) })} · Late</span>
        </span>
      );
    }
    if (daysLeft === 0) {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-red-50 text-red-700 border-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)] shrink-0">
          <Clock className="w-3.5 h-3.5 text-red-600" />
          <span>{t('jobs.due_today')} · Red Box</span>
        </span>
      );
    }
    if (jobData?.deadline_bucket === 'RED') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700 border-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)] shrink-0">
          <Clock className="w-3.5 h-3.5 text-red-600" />
          <span>{t('jobs.days_left', { days: daysLeft })} · Red Box</span>
        </span>
      );
    }
    if (jobData?.deadline_bucket === 'YELLOW') {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-800 border-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)] shrink-0">
          <Clock className="w-3.5 h-3.5 text-amber-600" />
          <span>{t('jobs.days_left', { days: daysLeft })} · Yellow Box</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)] shrink-0">
        <Clock className="w-3.5 h-3.5 text-slate-500" />
        <span>{t('jobs.days_left', { days: daysLeft })} · On track</span>
      </span>
    );
  };

  const tickedCount = steps.filter((s) => s.ticked).length;
  const progressPercent = steps.length > 0 ? Math.round((tickedCount / steps.length) * 100) : 0;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        className="sm:max-w-[620px] p-0 sm:p-0 overflow-hidden max-sm:overflow-hidden sm:overflow-hidden rounded-2xl border-0 shadow-[0_12px_40px_rgba(0,0,0,0.08),0_2px_8px_rgba(0,0,0,0.04)]"
      >
        {loading || !jobData ? (
          <div className="py-16 text-center text-sm text-slate-400 font-medium">
            {t('common.loading')}
          </div>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            {/* 1. Custom Quiet Luxury Header */}
            <div className="px-5 sm:px-6 pt-5 pb-4 border-b border-[#F1F5F9] bg-white flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0 flex-1">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight leading-snug break-words">
                  {jobData.job_type_name}
                </h2>
                <div className="flex flex-wrap items-center gap-2 mt-1.5">
                  <span className="bg-[#EAF2F1] text-[#0F766E] border-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)] px-2.5 py-0.5 rounded-md text-xs font-semibold font-mono">
                    #{jobData.invoice_number}
                  </span>
                  <span className="bg-slate-100 text-slate-800 border-0 shadow-[0_1px_2px_rgba(0,0,0,0.02)] px-2 py-0.5 rounded-md text-xs font-bold tabular-nums">
                    {formatINR(jobData.amount)}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    {formatDate(jobData.invoice_date || jobData.created_at)}
                  </span>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-2">
                {getDeadlineBadge()}
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="rounded-lg p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none cursor-pointer"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 2. Scrollable Modal Content */}
            <div className="px-5 sm:px-6 py-4 space-y-4 overflow-y-auto overscroll-contain min-h-0 flex-1 bg-white">
              {/* Customer & Particulars Info Card */}
              <div className="bg-[#F6F7F9] border-0 shadow-2xs rounded-xl p-3.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="font-bold text-slate-900 text-sm">{jobData.party_name}</span>
                    {jobData.party_mobile && (
                      <a
                        href={getWhatsAppUrl(
                          jobData.party_mobile,
                          `Hello ${jobData.party_name}, this is regarding your ${jobData.job_type_name} (${jobData.invoice_number}). - ${business?.name || 'SIMPLIFY'}`
                        )}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-white hover:bg-emerald-50 text-[#075E54] border-0 shadow-2xs transition-colors"
                        title="Chat on WhatsApp"
                      >
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{jobData.party_mobile}</span>
                      </a>
                    )}
                  </div>

                  {isOwner && jobData.status !== 'CANCELLED' && (
                    <button
                      type="button"
                      onClick={() => setIsEditing(!isEditing)}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border-0 bg-white hover:bg-slate-100 text-slate-700 hover:text-[#0F766E] shadow-2xs transition-all shrink-0 cursor-pointer hover:scale-105"
                    >
                      <Pencil className="w-3 h-3" />
                      <span>{isEditing ? 'Close' : 'Edit'}</span>
                    </button>
                  )}
                </div>

                {jobData.applicant_name && (
                  <div className="text-xs text-slate-600 flex items-start gap-1.5 pt-0.5">
                    <span className="text-slate-400 font-medium shrink-0">Particular:</span>
                    <span className="text-slate-800 font-medium break-words leading-relaxed">
                      {jobData.applicant_name}
                    </span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-2 border-t border-slate-200/60">
                  <div className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>
                      Created by:{' '}
                      <strong className="text-slate-800 font-semibold">
                        {jobData.created_by_name || 'Owner'}
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>
                      Assigned:{' '}
                      <strong className="text-slate-800 font-semibold">
                        {jobData.assigned_staff_name || 'Unassigned'}
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>
                      Deadline:{' '}
                      <strong className="text-slate-800 font-semibold">
                        {formatDate(jobData.deadline_date)}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Collapsible Owner Edit Form */}
              {isEditing && isOwner && jobData.status !== 'CANCELLED' && (
                <div className="p-4 bg-[#F6F7F9] rounded-xl border border-[#0F766E]/30 shadow-2xs space-y-3.5 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-200/70">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Edit Job Details
                    </span>
                    <span className="text-[11px] text-slate-400">Owner Controls</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Customer / Party Name"
                      value={partyName}
                      onChange={(e) => setPartyName(e.target.value)}
                    />
                    <Input
                      label="Mobile Number"
                      value={partyMobile}
                      onChange={(e) => setPartyMobile(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Input
                      label="Applicant / Particular"
                      value={applicantName}
                      onChange={(e) => setApplicantName(e.target.value)}
                      placeholder="e.g. Passport Holder Name"
                    />
                    <Input
                      type="date"
                      label={t('jobs.deadline')}
                      value={deadlineDate}
                      onChange={(e) => setDeadlineDate(e.target.value)}
                    />
                  </div>

                  <div>
                    <Select
                      label="Assign Staff Member"
                      value={assignedStaffId}
                      onChange={setAssignedStaffId}
                      options={[
                        { value: '', label: 'Unassigned (None)' },
                        ...staffMembers.map((m: any) => ({
                          value: m.id,
                          label: `${m.name} (${m.role})`,
                        })),
                      ]}
                      placeholder="Select Staff Member"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-danger hover:text-danger hover:bg-danger/10 text-xs"
                      onClick={() => setIsCancelConfirmOpen(true)}
                    >
                      <XCircle className="w-3.5 h-3.5 mr-1" />
                      Cancel Job
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={handleSaveChanges}
                      loading={savingChanges}
                      disabled={
                        deadlineDate === (jobData.deadline_date || '') &&
                        partyName === (jobData.party_name || '') &&
                        partyMobile === (jobData.party_mobile || '') &&
                        applicantName === (jobData.applicant_name || '') &&
                        assignedStaffId === (jobData.assigned_staff_id || '')
                      }
                      className="text-xs"
                    >
                      Save Changes
                    </Button>
                  </div>
                </div>
              )}

              {/* 3. Steps Checklist or Single-Step Direct Action */}
              <div className="space-y-2 pt-1">
                {steps.length >= 2 ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Workflow Steps
                      </span>
                      <span className="text-xs font-semibold text-slate-700 tabular-nums">
                        {tickedCount} of {steps.length} completed ({progressPercent}%)
                      </span>
                    </div>

                    <div className="w-full h-2 bg-[#E2E8F0] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#0F766E] rounded-full transition-all duration-300"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>

                    <div className="space-y-2 pt-1">
                      {steps.map((step) => {
                        const isTicking = tickingStepId === step.id;
                        const canWhatsApp =
                          step.ticked &&
                          Boolean(step.whatsapp_message) &&
                          Boolean(jobData.party_mobile);

                        return (
                          <div
                            key={step.id}
                            className={`p-3.5 rounded-xl border-0 transition-all flex items-center justify-between gap-3 ${step.ticked
                              ? 'bg-[#EAF2F1] shadow-[0_2px_8px_rgba(15,118,110,0.08),0_1px_2px_rgba(0,0,0,0.02)]'
                              : 'bg-[#F6F7F9] hover:bg-[#EEF2F6] shadow-2xs'
                              }`}
                          >
                            <button
                              type="button"
                              disabled={isTicking || jobData.status === 'CANCELLED'}
                              onClick={() => handleToggleStep(step)}
                              className={`flex items-start gap-3 flex-1 text-left min-w-0 cursor-pointer ${jobData.status === 'CANCELLED' ? 'cursor-not-allowed opacity-60' : ''
                                }`}
                            >
                              <div className="mt-0.5 shrink-0">
                                {step.ticked ? (
                                  <div className="w-5 h-5 rounded-full bg-[#0F766E] text-white flex items-center justify-center shadow-xs">
                                    <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                                  </div>
                                ) : (
                                  <div className="w-5 h-5 rounded-full bg-white text-slate-700 flex items-center justify-center text-[10.5px] font-bold shadow-2xs">
                                    {step.position}
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div
                                  className={`text-sm font-semibold break-words ${step.ticked
                                    ? 'text-slate-800 line-through decoration-[#0F766E]/50'
                                    : 'text-slate-900'
                                    }`}
                                >
                                  {step.name}
                                </div>
                                {step.ticked && step.ticked_by_name && (
                                  <div className="text-[11px] text-[#0F766E] mt-0.5 truncate font-medium">
                                    Completed by {step.ticked_by_name} · {formatDate(step.ticked_at)}
                                  </div>
                                )}
                              </div>
                            </button>

                            {canWhatsApp && (
                              <button
                                type="button"
                                onClick={() => handleSendWhatsApp(step)}
                                title={t('jobs.send_whatsapp_update')}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold text-[#075E54] bg-white hover:bg-emerald-50 border-0 rounded-lg transition-colors shrink-0 shadow-2xs cursor-pointer"
                              >
                                <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                                <span>WhatsApp</span>
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <div className="p-6 rounded-2xl border-0 shadow-2xs bg-[#F6F7F9] text-center space-y-3">
                    <div className="w-10 h-10 rounded-full bg-[#EAF2F1] text-[#0F766E] flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-800">Single-Step Service</h4>
                      <p className="text-xs text-slate-500 mt-0.5">
                        This service is processed in a single stage without sub-steps.
                      </p>
                    </div>
                    {jobData.status !== 'CANCELLED' && (
                      <Button
                        variant={isCompleted ? 'outline' : 'primary'}
                        size="sm"
                        onClick={handleDirectComplete}
                        className="text-xs mt-1 border-0 shadow-xs"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                        {isCompleted ? 'Reopen Job' : 'Mark Job Complete'}
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {/* 4. Collapsible Activity History */}
              {events.length > 0 && (
                <div className="pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setShowEvents(!showEvents)}
                    className="flex items-center justify-between w-full text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors py-1 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      <History className="w-3.5 h-3.5 text-slate-400" />
                      <span>Activity History ({events.length})</span>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${showEvents ? 'rotate-180' : ''
                        }`}
                    />
                  </button>

                  {showEvents && (
                    <div className="mt-2 space-y-1.5">
                      {events.map((evt: any) => (
                        <div
                          key={evt.id}
                          className="text-[11px] text-slate-600 py-1.5 px-2.5 rounded-lg bg-[#F6F7F9] border-0 shadow-2xs flex items-center justify-between gap-2"
                        >
                          <span className="truncate">
                            <strong className="text-slate-800 font-semibold">{evt.member_name}</strong>{' '}
                            {evt.action === 'TICK' ? 'completed a step' : 'reopened a step'}
                          </span>
                          <span className="text-slate-400 shrink-0">{formatDate(evt.at)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>

      {/* Cancel Job Confirmation */}
      <ConfirmDialog
        open={isCancelConfirmOpen}
        onOpenChange={setIsCancelConfirmOpen}
        title="Cancel Job"
        description={`Are you sure you want to cancel the job "${jobData?.job_type_name}" for ${jobData?.party_name}? Any upcoming commission for this job will also be cancelled.`}
        confirmLabel="Cancel Job"
        variant="danger"
        loading={cancellingJob}
        onConfirm={handleCancelJob}
      />
    </>
  );
};
