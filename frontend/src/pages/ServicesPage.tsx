import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { t, getErrorMessage } from '../i18n';
import { Input } from '../components/ui/Input';
import { AmountInput } from '../components/ui/AmountInput';
import { Sheet } from '../components/ui/Sheet';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useToast } from '../components/ui/Toast';
import {
  Plus,
  Search,
  Trash2,
  Briefcase,
  ChevronUp,
  ChevronDown,
  MessageSquare,
  Sparkles,
  Clock,
  Percent,
} from 'lucide-react';
import { Database } from '../types/supabase';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useAuth } from '../context/AuthContext';

type Service = Database['public']['Tables']['services']['Row'];

interface JobStepItem {
  id?: string;
  name: string;
  whatsapp_message: string;
}

const PASSPORT_PRESET: JobStepItem[] = [
  {
    name: 'Document Verification & Photos',
    whatsapp_message: 'Hello {party_name}, your documents for {job_name} ({bill_no}) have been verified successfully. - {business_name}',
  },
  {
    name: 'Online Application & Slot Booked',
    whatsapp_message: 'Hello {party_name}, your online appointment slot has been booked for {job_name}. - {business_name}',
  },
  {
    name: 'Police Verification & Biometrics',
    whatsapp_message: 'Hello {party_name}, reminder: your police verification is scheduled for {job_name}. - {business_name}',
  },
  {
    name: 'Passport Dispatched / Ready for Delivery',
    whatsapp_message: 'Hello {party_name}, great news! Your passport has been dispatched / is ready for pickup. - {business_name}',
  },
];

const PAN_PRESET: JobStepItem[] = [
  {
    name: 'Form & Aadhaar Verification',
    whatsapp_message: 'Hello {party_name}, your PAN application documents are verified. - {business_name}',
  },
  {
    name: 'NSDL / UTI Submission & Ack Generated',
    whatsapp_message: 'Hello {party_name}, your PAN application has been submitted. Bill #{bill_no}. - {business_name}',
  },
  {
    name: 'e-PAN Received & Physical Card Dispatched',
    whatsapp_message: 'Hello {party_name}, your PAN card has been generated and dispatched. - {business_name}',
  },
];

const GOVT_CERT_PRESET: JobStepItem[] = [
  {
    name: 'Online Application & Fee Paid',
    whatsapp_message: 'Hello {party_name}, your application for {job_name} has been submitted. - {business_name}',
  },
  {
    name: 'Department Scrutiny & Approval',
    whatsapp_message: 'Hello {party_name}, your application is under department verification. - {business_name}',
  },
  {
    name: 'Certificate Issued & Delivered',
    whatsapp_message: 'Hello {party_name}, your certificate for {job_name} is ready for collection! - {business_name}',
  },
];

const DEFAULT_GENERIC_STEPS: JobStepItem[] = [
  {
    name: 'Document Collection & Verification',
    whatsapp_message: 'Hello {party_name}, your documents for {job_name} ({bill_no}) have been received. - {business_name}',
  },
  {
    name: 'Processing & Application Submission',
    whatsapp_message: 'Hello {party_name}, your application for {job_name} is being processed. - {business_name}',
  },
  {
    name: 'Work Completed & Ready for Delivery',
    whatsapp_message: 'Hello {party_name}, your {job_name} is completed and ready for pickup! - {business_name}',
  },
];

const WA_VARIABLES = [
  '{party_name}',
  '{job_name}',
  '{applicant}',
  '{bill_no}',
  '{step_name}',
  '{business_name}',
];

export const ServicesPage: React.FC = () => {
  const { showToast } = useToast();
  const { role, member } = useAuth();
  const isStaff = role === 'STAFF' || member?.role === 'STAFF';

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Sheet state
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [serviceToDelete, setServiceToDelete] = useState<Service | null>(null);
  const [deletingService, setDeletingService] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [defaultRate, setDefaultRate] = useState('');
  const [category, setCategory] = useState('');
  const [isJobType, setIsJobType] = useState(false);
  const [deadlineDays, setDeadlineDays] = useState('15');
  const [commissionPercent, setCommissionPercent] = useState('10');
  const [active, setActive] = useState(true);
  const [steps, setSteps] = useState<JobStepItem[]>(DEFAULT_GENERIC_STEPS);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const fetchServices = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('services')
        .select('*')
        .is('deleted_at', null)
        .order('name', { ascending: true });

      if (error) throw error;
      setServices((data as Service[]) || []);
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const handleOpenCreate = () => {
    if (isStaff) return;
    setEditingService(null);
    setName('');
    setDefaultRate('');
    setCategory('');
    setIsJobType(false);
    setDeadlineDays('15');
    setCommissionPercent('10');
    setSteps([...DEFAULT_GENERIC_STEPS]);
    setActive(true);
    setFormError(null);
    setIsSheetOpen(true);
  };

  const handleOpenEdit = async (s: Service) => {
    if (isStaff) return;
    setEditingService(s);
    setName(s.name);
    setDefaultRate(s.default_rate ? String(s.default_rate) : '');
    setCategory(s.category || '');
    setIsJobType(s.is_job_type);
    setDeadlineDays(s.deadline_days ? String(s.deadline_days) : '15');
    setCommissionPercent(s.commission_percent ? String(s.commission_percent) : '10');
    setActive(s.active);
    setFormError(null);
    setIsSheetOpen(true);

    if (s.is_job_type) {
      setLoadingSteps(true);
      try {
        const { data, error } = await supabase
          .from('job_type_steps')
          .select('id, position, name, whatsapp_message')
          .eq('service_id', s.id)
          .is('deleted_at', null)
          .order('position', { ascending: true });

        if (error) throw error;
        if (data && data.length > 0) {
          setSteps(
            data.map((row: any) => ({
              id: row.id,
              name: row.name,
              whatsapp_message: row.whatsapp_message || '',
            }))
          );
        } else {
          setSteps([...DEFAULT_GENERIC_STEPS]);
        }
      } catch (err: any) {
        console.error('Failed to load steps:', err);
        setSteps([...DEFAULT_GENERIC_STEPS]);
      } finally {
        setLoadingSteps(false);
      }
    } else {
      setSteps([...DEFAULT_GENERIC_STEPS]);
    }
  };

  const handleAddStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        name: `Step ${prev.length + 1}`,
        whatsapp_message: 'Hello {party_name}, your {job_name} ({bill_no}) status has been updated. - {business_name}',
      },
    ]);
  };

  const handleRemoveStep = (index: number) => {
    if (steps.length <= 1) {
      showToast('A Job Type must have at least one step', 'error');
      return;
    }
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const handleMoveStep = (index: number, direction: 'UP' | 'DOWN') => {
    const targetIdx = direction === 'UP' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= steps.length) return;
    const newSteps = [...steps];
    const temp = newSteps[index];
    newSteps[index] = newSteps[targetIdx];
    newSteps[targetIdx] = temp;
    setSteps(newSteps);
  };

  const handleUpdateStep = (index: number, field: keyof JobStepItem, value: string) => {
    setSteps((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const handleInsertVariable = (index: number, variable: string) => {
    setSteps((prev) => {
      const copy = [...prev];
      const currentMsg = copy[index].whatsapp_message || '';
      copy[index] = {
        ...copy[index],
        whatsapp_message: currentMsg ? `${currentMsg} ${variable}` : variable,
      };
      return copy;
    });
  };

  const handleApplyPreset = (preset: JobStepItem[]) => {
    setSteps([...preset]);
    showToast('Workflow steps template applied!', 'success');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isStaff) return;
    if (!name.trim()) {
      setFormError(t('auth.required'));
      return;
    }

    if (isJobType) {
      const emptyStep = steps.some((st) => !st.name.trim());
      if (emptyStep) {
        setFormError('All job steps must have a title');
        return;
      }
    }

    setSaving(true);
    setFormError(null);
    try {
      const rateNum = defaultRate ? parseFloat(defaultRate) : null;
      const deadlineNum = isJobType && deadlineDays ? parseInt(deadlineDays, 10) : null;
      const commNum = isJobType && commissionPercent ? parseFloat(commissionPercent) : null;

      let serviceId = editingService?.id;

      if (editingService) {
        const { error } = await supabase
          .from('services')
          .update({
            name: name.trim(),
            default_rate: rateNum,
            category: category.trim() || null,
            is_job_type: isJobType,
            deadline_days: deadlineNum,
            commission_percent: commNum,
            active,
          })
          .eq('id', editingService.id);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('services')
          .insert({
            name: name.trim(),
            default_rate: rateNum,
            category: category.trim() || null,
            is_job_type: isJobType,
            deadline_days: deadlineNum,
            commission_percent: commNum,
            active,
          })
          .select('id')
          .single();

        if (error) throw error;
        serviceId = data.id;
      }

      // Synchronize job_type_steps and active jobs
      if (serviceId) {
        if (isJobType) {
          // 1. Delete existing steps in job_type_steps
          await supabase.from('job_type_steps').delete().eq('service_id', serviceId);

          // 2. Insert new steps
          const validSteps = steps.filter((st) => st.name.trim() !== '');
          if (validSteps.length > 0) {
            const rowsToInsert = validSteps.map((st, idx) => ({
              service_id: serviceId,
              position: idx + 1,
              name: st.name.trim(),
              whatsapp_message: st.whatsapp_message?.trim() || null,
            }));

            const { error: stepsError } = await supabase.from('job_type_steps').insert(rowsToInsert);
            if (stepsError) throw stepsError;
          }

          // 3. Automatically sync newly created steps to any active in-progress jobs for this service
          try {
            await supabase.rpc('sync_service_steps_to_jobs', { p_service_id: serviceId });
          } catch (syncErr) {
            console.warn('Failed to sync steps to existing jobs:', syncErr);
          }
        } else {
          // Admin switched service from multi-step to NORMAL service:
          // 1. Delete all steps from job_type_steps
          await supabase.from('job_type_steps').delete().eq('service_id', serviceId);

          // 2. Sync to active open jobs so their steps are removed and card displays "---- NO STEPS ----"
          try {
            await supabase.rpc('sync_service_steps_to_jobs', { p_service_id: serviceId });
          } catch (syncErr) {
            console.warn('Failed to sync normal service to existing jobs:', syncErr);
          }
        }
      }

      // Notify other views (like JobsPage) that service steps or definitions have updated (same tab + cross tab)
      window.dispatchEvent(new CustomEvent('simplify:jobs_updated'));
      try {
        localStorage.setItem('simplify:jobs_updated', Date.now().toString());
        const bc = new BroadcastChannel('simplify_events');
        bc.postMessage({ type: 'jobs_updated' });
        bc.close();
      } catch {
        // Fallback handled by localStorage
      }

      showToast(t('common.success'), 'success');
      setIsSheetOpen(false);
      fetchServices();
    } catch (err: any) {
      setFormError(getErrorMessage(err.message));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (service: Service, e: React.MouseEvent) => {
    e.stopPropagation();
    setServiceToDelete(service);
  };

  const handleConfirmDelete = async () => {
    if (!serviceToDelete) return;
    setDeletingService(true);
    try {
      const { error } = await supabase.rpc('soft_delete', {
        p_table: 'services',
        p_id: serviceToDelete.id,
      });

      if (error) throw error;
      showToast(t('common.success'), 'success');
      setServiceToDelete(null);
      fetchServices();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setDeletingService(false);
    }
  };

  const filteredServices = services.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.category && s.category.toLowerCase().includes(q));
  });

  return (
    <div className="max-w-6xl mx-auto space-y-5 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Services & Job Types</h1>
          <p className="text-xs text-text-muted mt-0.5">{services.length} registered items</p>
        </div>
        {!isStaff && (
          <button
            type="button"
            onClick={handleOpenCreate}
            className="h-10 px-4 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold shadow-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Service / Job</span>
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Input
          placeholder="Search service or category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftIcon={<Search className="w-4 h-4 text-[#94A3B8]" />}
          className="border-0 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] focus:ring-2 focus:ring-[#0F766E]/20 rounded-xl h-11"
        />
      </div>

      {/* Services Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <Skeleton className="h-28 w-full rounded-2xl border-0" />
          <Skeleton className="h-28 w-full rounded-2xl border-0" />
          <Skeleton className="h-28 w-full rounded-2xl border-0" />
        </div>
      ) : filteredServices.length === 0 ? (
        <EmptyState
          message={t('common.empty')}
          actionLabel={isStaff ? undefined : "Add Service / Job"}
          onAction={isStaff ? undefined : handleOpenCreate}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredServices.map((service) => (
            <div
              key={service.id}
              className={`bg-white border-0 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] transition-all group ${
                isStaff
                  ? 'cursor-default'
                  : 'cursor-pointer hover:shadow-[0_4px_16px_rgba(0,0,0,0.08)] hover:-translate-y-0.5'
              }`}
              onClick={isStaff ? undefined : () => handleOpenEdit(service)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-semibold text-slate-900 truncate group-hover:text-[#0F766E] transition-colors">
                      {service.name}
                    </span>
                    {service.is_job_type && (
                      <span className="px-2 py-0.5 text-[11px] font-semibold rounded-md border-0 bg-teal-50 text-[#0F766E] inline-flex items-center gap-1 shrink-0">
                        <Briefcase className="w-3 h-3" />
                        <span>Job</span>
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 mt-1 tabular-nums">
                    {service.category ? `${service.category} · ` : ''}
                    {service.default_rate ? formatINR(service.default_rate) : 'Variable Rate'}
                  </div>
                </div>
                {!isStaff && (
                  <button
                    type="button"
                    title={t('common.delete')}
                    onClick={(e) => handleDelete(service, e)}
                    className="w-7 h-7 rounded-lg border-0 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 transition-all flex items-center justify-center cursor-pointer hover:scale-105 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {service.is_job_type && (
                <div className="mt-3.5 pt-2.5 border-t border-slate-100/70 text-xs text-slate-500 flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{service.deadline_days || 0} days</span>
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-slate-700 tabular-nums">
                    <Percent className="w-3.5 h-3.5 text-[#0F766E]" />
                    <span>{service.commission_percent || 0}% Comm.</span>
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Service & Job Steps Drawer (Owner only) */}
      {!isStaff && (
        <Sheet
          open={isSheetOpen && !isStaff}
          onOpenChange={(op) => {
            if (isStaff) return;
            setIsSheetOpen(op);
          }}
          title={editingService ? 'Edit Service / Job Type' : 'Add Service / Job Type'}
          className="border-0 shadow-[0_8px_30px_rgba(0,0,0,0.1)]"
        >
          <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Service / Job Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Passport Application, PAN Card, Xerox, Lamination"
            disabled={saving}
            required
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AmountInput
              label="Default Rate (₹)"
              value={defaultRate}
              onChange={(val) => setDefaultRate(val)}
              disabled={saving}
              placeholder="0"
            />
            <Input
              label="Category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Govt Services"
              disabled={saving}
            />
          </div>

          {/* Job Type Toggle */}
          <div className="p-3.5 rounded-2xl border-0 bg-surface-2 shadow-2xs space-y-2">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                id="is_job_type"
                checked={isJobType}
                onChange={(e) => setIsJobType(e.target.checked)}
                className="w-4 h-4 text-accent rounded border-border focus:ring-accent cursor-pointer"
              />
              <label htmlFor="is_job_type" className="text-sm font-semibold text-text select-none cursor-pointer flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-accent" />
                <span>Multi-step Job Type (e.g. Passport, PAN, License)</span>
              </label>
            </div>
            <p className="text-xs text-text-muted pl-6">
              When billed, SIMPLIFY automatically creates a trackable job with steps, deadlines, and staff commission.
            </p>
          </div>

          {/* Job Configuration & Steps Builder */}
          {isJobType && (
            <div className="space-y-4 bg-surface-2 p-4 rounded-2xl border-0 shadow-2xs">
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <span className="text-xs font-semibold text-text uppercase tracking-wider">
                  Job Settings
                </span>
                <span className="text-xs text-accent font-medium">Auto-tracks per bill</span>
              </div>

              {/* Deadline & Commission */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-text">Default Deadline (Days)</label>
                    <div className="flex gap-1">
                      {['8', '10', '15', '20', '30'].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDeadlineDays(d)}
                          className={`px-2 py-0.5 text-[11px] rounded-lg font-medium transition-colors ${
                            deadlineDays === d
                              ? 'bg-ink text-white font-semibold shadow-btn'
                              : 'bg-white text-text-muted hover:text-text border border-border'
                          }`}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>
                  <Input
                    type="number"
                    value={deadlineDays}
                    onChange={(e) => setDeadlineDays(e.target.value)}
                    placeholder="15"
                    disabled={saving}
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-medium text-text">Staff Commission (%)</label>
                    <div className="flex gap-1">
                      {['0', '5', '10', '15', '20'].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCommissionPercent(c)}
                          className={`px-2 py-0.5 text-[11px] rounded-lg font-medium transition-colors ${
                            commissionPercent === c
                              ? 'bg-ink text-white font-semibold shadow-btn'
                              : 'bg-white text-text-muted hover:text-text border border-border'
                          }`}
                        >
                          {c}%
                        </button>
                      ))}
                    </div>
                  </div>
                  <Input
                    type="number"
                    value={commissionPercent}
                    onChange={(e) => setCommissionPercent(e.target.value)}
                    placeholder="10"
                    disabled={saving}
                  />
                </div>
              </div>

              {/* Presets Bar */}
              <div className="pt-2.5 border-t border-border space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                  <Sparkles className="w-3.5 h-3.5 text-accent" />
                  <span>Quick Templates (Autofill Steps):</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(PASSPORT_PRESET)}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-surface-3 text-text border border-border text-xs font-medium transition-colors cursor-pointer"
                  >
                    Passport (4 steps)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(PAN_PRESET)}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-surface-3 text-text border border-border text-xs font-medium transition-colors cursor-pointer"
                  >
                    PAN Card (3 steps)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(GOVT_CERT_PRESET)}
                    className="px-2.5 py-1 rounded-lg bg-white hover:bg-surface-3 text-text border border-border text-xs font-medium transition-colors cursor-pointer"
                  >
                    Govt Certificate (3 steps)
                  </button>
                </div>
              </div>

              {/* Steps List */}
              <div className="space-y-3 pt-2.5 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text">
                    Workflow Steps ({steps.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddStep}
                    className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Step</span>
                  </button>
                </div>

                {loadingSteps ? (
                  <div className="py-4 text-center text-xs text-text-muted">Loading steps...</div>
                ) : (
                  <div className="space-y-2.5">
                    {steps.map((step, idx) => (
                      <div
                        key={idx}
                        className="p-3 rounded-xl border-0 bg-white space-y-2 shadow-sm"
                      >
                        {/* Step Title & Actions */}
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-accent-soft text-accent font-semibold text-[11px] flex items-center justify-center shrink-0 tabular-nums">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            value={step.name}
                            onChange={(e) => handleUpdateStep(idx, 'name', e.target.value)}
                            placeholder={`Step ${idx + 1} name`}
                            className="flex-1 h-9 px-2.5 rounded-lg border border-border text-xs font-medium text-text focus:border-accent focus:outline-none"
                            required
                          />
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleMoveStep(idx, 'UP')}
                              disabled={idx === 0}
                              className="p-1 text-text-muted hover:text-text disabled:opacity-30 rounded-lg cursor-pointer"
                              title="Move step up"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveStep(idx, 'DOWN')}
                              disabled={idx === steps.length - 1}
                              className="p-1 text-text-muted hover:text-text disabled:opacity-30 rounded-lg cursor-pointer"
                              title="Move step down"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveStep(idx)}
                              className="p-1 text-text-muted hover:text-danger rounded-lg ml-0.5 cursor-pointer"
                              title="Delete step"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* WhatsApp Message Template */}
                        <div className="pl-7 space-y-1.5">
                          <div className="flex items-center justify-between text-[11px] text-text-muted">
                            <span className="flex items-center gap-1.5 font-medium text-text">
                              <MessageSquare className="w-3 h-3 text-accent" />
                              WhatsApp Message Template (Optional):
                            </span>
                          </div>
                          <textarea
                            value={step.whatsapp_message}
                            onChange={(e) => handleUpdateStep(idx, 'whatsapp_message', e.target.value)}
                            rows={2}
                            placeholder="Message sent to customer when this step is completed..."
                            className="w-full p-2.5 rounded-lg border border-border text-xs text-text focus:border-accent focus:outline-none font-mono"
                          />

                          {/* Variable Chips */}
                          <div className="flex flex-wrap gap-1.5 items-center pt-0.5">
                            <span className="text-[10px] text-text-muted">Insert tag:</span>
                            {WA_VARIABLES.map((v) => (
                              <button
                                key={v}
                                type="button"
                                onClick={() => handleInsertVariable(idx, v)}
                                className="px-2 py-0.5 rounded-md bg-surface-2 hover:bg-surface-3 text-[10px] font-mono text-text border border-border transition-colors cursor-pointer"
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Active Toggle */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="active_toggle"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 text-accent rounded border-border focus:ring-accent cursor-pointer"
            />
            <label htmlFor="active_toggle" className="text-sm font-medium text-text select-none cursor-pointer">
              Active (available for quick selection in bills)
            </label>
          </div>

          {formError && <div className="text-xs text-danger font-medium">{formError}</div>}

          <div className="pt-3">
            <button
              type="submit"
              disabled={saving}
              className="w-full h-11 rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50"
            >
              {saving
                ? 'Saving...'
                : editingService
                ? (isJobType ? 'Update Job Type' : 'Update Service')
                : (isJobType ? 'Save Job Type' : 'Save Service')}
            </button>
          </div>
        </form>
      </Sheet>
      )}

      {/* Delete Service Confirmation */}
      <ConfirmDialog
        open={Boolean(serviceToDelete)}
        onOpenChange={(open) => !open && setServiceToDelete(null)}
        title="Delete Service / Job Type"
        description={`Are you sure you want to delete "${serviceToDelete?.name}"? It will no longer appear when creating new bills.`}
        confirmLabel="Delete Service"
        variant="danger"
        loading={deletingService}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
};
