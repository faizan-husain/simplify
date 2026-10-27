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
  Circle,
  Clock,
  User,
  MessageCircle,
  FileText,
  Calendar,
  History,
  AlertTriangle,
} from 'lucide-react';

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
  const [staffList, setStaffList] = useState<any[]>([]);

  // Owner editable fields
  const [deadlineDate, setDeadlineDate] = useState('');
  const [assignedStaffId, setAssignedStaffId] = useState('');
  const [savingChanges, setSavingChanges] = useState(false);
  const [tickingStepId, setTickingStepId] = useState<string | null>(null);

  const isOwner = role === 'OWNER';

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
        setAssignedStaffId(data.job.assigned_staff_id || '');
      }
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadStaff = async () => {
    if (!isOwner) return;
    try {
      const { data } = await supabase
        .from('members')
        .select('id, name, role')
        .eq('active', true)
        .is('deleted_at', null)
        .order('name');
      setStaffList(data || []);
    } catch (err) {
      console.error('Failed to load staff list:', err);
    }
  };

  useEffect(() => {
    if (open && jobId) {
      loadJob();
      loadStaff();
    } else {
      setJobData(null);
      setSteps([]);
      setEvents([]);
    }
  }, [open, jobId]);

  const handleToggleStep = async (step: any) => {
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

  const handleSaveChanges = async () => {
    if (!jobId) return;
    setSavingChanges(true);
    try {
      const { error } = await supabase.rpc('update_job', {
        p_job_id: jobId,
        p_deadline_date: deadlineDate,
        p_assigned_staff_id: assignedStaffId || null,
      });
      if (error) throw error;
      showToast(t('jobs.job_updated'), 'success');
      await loadJob();
      onJobUpdated?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSavingChanges(false);
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
    if (isCompleted) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/10 text-primary">
          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
          {t('jobs.completed_badge')}
        </span>
      );
    }
    if (daysLeft < 0) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-bg text-danger">
          <AlertTriangle className="w-3.5 h-3.5 mr-1" />
          {t('jobs.days_late', { days: Math.abs(daysLeft) })}
        </span>
      );
    }
    if (daysLeft === 0) {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-bg text-danger">
          <Clock className="w-3.5 h-3.5 mr-1" />
          {t('jobs.due_today')}
        </span>
      );
    }
    if (jobData?.deadline_bucket === 'RED') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-danger-bg text-danger">
          <Clock className="w-3.5 h-3.5 mr-1" />
          {t('jobs.days_left', { days: daysLeft })}
        </span>
      );
    }
    if (jobData?.deadline_bucket === 'YELLOW') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
          <Clock className="w-3.5 h-3.5 mr-1" />
          {t('jobs.days_left', { days: daysLeft })}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-surface text-text-muted">
        <Clock className="w-3.5 h-3.5 mr-1" />
        {t('jobs.days_left', { days: daysLeft })}
      </span>
    );
  };

  const tickedCount = steps.filter((s) => s.ticked).length;
  const progressPercent = steps.length > 0 ? Math.round((tickedCount / steps.length) * 100) : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={jobData?.job_type_name || t('jobs.title')}
    >
      {loading || !jobData ? (
        <div className="py-8 text-center text-sm text-text-muted">
          {t('common.loading')}
        </div>
      ) : (
        <div className="space-y-4 max-h-[75vh] overflow-y-auto pr-1">
          {/* Header Card */}
          <div className="p-3 bg-surface rounded-card border border-border flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                <span>{jobData.invoice_number}</span>
                <span>•</span>
                <span>{formatINR(jobData.amount)}</span>
              </div>
              <div className="font-semibold text-text mt-0.5">
                {jobData.party_name}
                {jobData.party_mobile && (
                  <span className="text-xs text-text-muted font-normal ml-1.5">
                    ({jobData.party_mobile})
                  </span>
                )}
              </div>
              {jobData.applicant_name && (
                <div className="text-xs text-text-muted mt-0.5">
                  {t('jobs.applicant')}: <span className="font-medium text-text">{jobData.applicant_name}</span>
                </div>
              )}
            </div>
            <div>{getDeadlineBadge()}</div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-text-muted">
              <span>{t('jobs.progress')}</span>
              <span className="font-medium text-text">
                {tickedCount} / {steps.length} {t('jobs.steps')} ({progressPercent}%)
              </span>
            </div>
            <div className="w-full h-2 bg-surface rounded-full overflow-hidden border border-border">
              <div
                className={`h-full transition-all duration-300 ${
                  isCompleted ? 'bg-primary' : 'bg-primary/80'
                }`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Owner Assignment & Deadline Controls */}
          {isOwner ? (
            <div className="p-3 rounded-card border border-border bg-white space-y-3">
              <div className="text-xs font-semibold text-text uppercase tracking-wider">
                {t('jobs.deadline')} &amp; {t('jobs.assigned_to')}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Input
                  type="date"
                  label={t('jobs.deadline')}
                  value={deadlineDate}
                  onChange={(e) => setDeadlineDate(e.target.value)}
                />
                <Select
                  label={t('jobs.assigned_to')}
                  value={assignedStaffId}
                  onChange={(val) => setAssignedStaffId(val)}
                  options={[
                    { label: `-- ${t('jobs.unassigned')} --`, value: '' },
                    ...staffList.map((s) => ({
                      label: `${s.name} (${s.role})`,
                      value: s.id,
                    })),
                  ]}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSaveChanges}
                  loading={savingChanges}
                  disabled={
                    deadlineDate === (jobData.deadline_date || '') &&
                    assignedStaffId === (jobData.assigned_staff_id || '')
                  }
                >
                  {t('jobs.save_changes')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between p-2.5 text-xs text-text-muted bg-surface rounded-card border border-border">
              <div className="flex items-center gap-1.5">
                <User className="w-4 h-4 text-text-muted" />
                <span>
                  {t('jobs.assigned_to')}:{' '}
                  <strong className="text-text font-medium">
                    {jobData.assigned_staff_name || t('jobs.unassigned')}
                  </strong>
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-text-muted" />
                <span>
                  {t('jobs.deadline')}:{' '}
                  <strong className="text-text font-medium">
                    {formatDate(jobData.deadline_date)}
                  </strong>
                </span>
              </div>
            </div>
          )}

          {/* Interactive Steps Checklist */}
          <div className="space-y-2">
            <div className="text-xs font-semibold text-text uppercase tracking-wider">
              {t('jobs.steps')}
            </div>
            <div className="space-y-1.5">
              {steps.map((step) => {
                const isTicking = tickingStepId === step.id;
                const canWhatsApp =
                  step.ticked &&
                  Boolean(step.whatsapp_message) &&
                  Boolean(jobData.party_mobile);

                return (
                  <div
                    key={step.id}
                    className={`p-3 rounded-card border transition-all flex items-start justify-between gap-3 ${
                      step.ticked
                        ? 'bg-surface/50 border-border'
                        : 'bg-white border-border hover:border-primary/40'
                    }`}
                  >
                    <button
                      type="button"
                      disabled={isTicking}
                      onClick={() => handleToggleStep(step)}
                      className="flex items-start gap-2.5 flex-1 text-left group focus:outline-none"
                    >
                      <div className="mt-0.5">
                        {step.ticked ? (
                          <CheckCircle2 className="w-5 h-5 text-primary" />
                        ) : (
                          <Circle className="w-5 h-5 text-text-muted group-hover:text-primary" />
                        )}
                      </div>
                      <div>
                        <div
                          className={`text-sm font-medium ${
                            step.ticked ? 'text-text-muted line-through' : 'text-text'
                          }`}
                        >
                          {step.position}. {step.name}
                        </div>
                        {step.ticked && step.ticked_by_name && (
                          <div className="text-[11px] text-text-muted mt-0.5">
                            Ticked by {step.ticked_by_name} • {formatDate(step.ticked_at)}
                          </div>
                        )}
                      </div>
                    </button>

                    {/* WhatsApp action button if ticked and message configured */}
                    {canWhatsApp && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleSendWhatsApp(step)}
                        title={t('jobs.send_whatsapp_update')}
                        className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 px-2 py-1 h-8"
                      >
                        <MessageCircle className="w-4 h-4 mr-1 text-emerald-600" />
                        <span className="text-xs font-medium">WhatsApp</span>
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Activity Log */}
          {events.length > 0 && (
            <div className="space-y-1.5 pt-2 border-t border-border">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-text uppercase tracking-wider">
                <History className="w-3.5 h-3.5 text-text-muted" />
                <span>{t('jobs.activity_log')}</span>
              </div>
              <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                {events.map((evt: any) => (
                  <div
                    key={evt.id}
                    className="text-[11px] text-text-muted py-1 border-b border-border/50 flex items-center justify-between"
                  >
                    <span>
                      <strong className="text-text font-medium">{evt.member_name}</strong>{' '}
                      {evt.action === 'TICK' ? 'completed step' : 'reopened step'}
                    </span>
                    <span>{formatDate(evt.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
};
