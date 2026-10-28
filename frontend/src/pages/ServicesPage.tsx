import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../lib/money';
import { t, getErrorMessage } from '../i18n';
import { Input } from '../components/ui/Input';
import { AmountInput } from '../components/ui/AmountInput';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
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

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Sheet state
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);

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

      // If this is a job type, sync job_type_steps
      if (isJobType && serviceId) {
        // 1. Delete existing steps
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

  const handleDelete = async (service: Service, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete service "${service.name}"?`)) return;

    try {
      const { error } = await supabase.rpc('soft_delete', {
        p_table: 'services',
        p_id: service.id,
      });

      if (error) throw error;
      showToast(t('common.success'), 'success');
      fetchServices();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    }
  };

  const filteredServices = services.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return s.name.toLowerCase().includes(q) || (s.category && s.category.toLowerCase().includes(q));
  });

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">Services & Job Types</h1>
          <p className="text-xs text-text-muted">{services.length} registered items</p>
        </div>
        <Button variant="primary" size="md" onClick={handleOpenCreate}>
          <Plus className="w-4 h-4 mr-1.5" />
          <span>Add Service / Job</span>
        </Button>
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Input
          placeholder={t('common.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
        />
      </div>

      {/* Services Grid */}
      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : filteredServices.length === 0 ? (
        <EmptyState
          message={t('common.empty')}
          actionLabel="Add Service / Job"
          onAction={handleOpenCreate}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredServices.map((service) => (
            <Card
              key={service.id}
              className="cursor-pointer hover:border-primary/50 hover:shadow-subtle transition-all p-3.5 flex flex-col justify-between"
              onClick={() => handleOpenEdit(service)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-text truncate">{service.name}</span>
                    {service.is_job_type && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary/10 text-primary border border-primary/20">
                        <Briefcase className="w-3 h-3 mr-0.5" /> Job
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    {service.category ? `${service.category} · ` : ''}
                    {service.default_rate ? formatINR(service.default_rate) : 'Variable Rate'}
                  </div>
                </div>
                <button
                  onClick={(e) => handleDelete(service, e)}
                  className="p-1.5 text-text-muted hover:text-danger rounded hover:bg-danger/10 transition-colors"
                  title={t('common.delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {service.is_job_type && (
                <div className="mt-3 pt-2 border-t border-border/60 text-[11px] text-text-muted flex justify-between">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3 text-text-muted" /> {service.deadline_days || 0} days
                  </span>
                  <span className="inline-flex items-center gap-1 font-medium text-text">
                    <Percent className="w-3 h-3 text-primary" /> {service.commission_percent || 0}% Comm.
                  </span>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Service & Job Steps Drawer */}
      <Sheet
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        title={editingService ? 'Edit Service / Job Type' : 'Add Service / Job Type'}
      >
        <form onSubmit={handleSave} className="space-y-4 pb-8">
          <Input
            label="Service / Job Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Passport Application, PAN Card, Xerox, Lamination"
            disabled={saving}
            required
          />

          <div className="grid grid-cols-2 gap-2">
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
          <div className="p-3 rounded-lg border border-border bg-surface/40 space-y-2">
            <div className="flex items-center gap-2.5">
              <input
                type="checkbox"
                id="is_job_type"
                checked={isJobType}
                onChange={(e) => setIsJobType(e.target.checked)}
                className="w-4 h-4 text-primary rounded border-border focus:ring-primary cursor-pointer"
              />
              <label htmlFor="is_job_type" className="text-sm font-semibold text-text select-none cursor-pointer flex items-center gap-1.5">
                <Briefcase className="w-4 h-4 text-primary" />
                <span>Multi-step Job Type (e.g. Passport, PAN, License)</span>
              </label>
            </div>
            <p className="text-[11px] text-text-muted pl-6">
              When billed, SIMPLIFY automatically creates a trackable job with steps, deadlines, and staff commission.
            </p>
          </div>

          {/* Job Configuration & Steps Builder */}
          {isJobType && (
            <div className="space-y-4 bg-surface/70 p-3.5 rounded-lg border border-border/80">
              <div className="flex items-center justify-between pb-2 border-b border-border/60">
                <span className="text-xs font-bold text-text uppercase tracking-wider">
                  Job Settings
                </span>
                <span className="text-[11px] text-primary font-medium">Auto-tracks per bill</span>
              </div>

              {/* Deadline & Commission */}
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-text">Default Deadline (Days)</label>
                    <div className="flex gap-1">
                      {['8', '10', '15', '20', '30'].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDeadlineDays(d)}
                          className={`px-1.5 py-0.5 text-[10px] rounded font-medium transition-colors ${
                            deadlineDays === d
                              ? 'bg-primary text-white font-bold'
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
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-text">Staff Commission (%)</label>
                    <div className="flex gap-1">
                      {['0', '5', '10', '15', '20'].map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCommissionPercent(c)}
                          className={`px-1.5 py-0.5 text-[10px] rounded font-medium transition-colors ${
                            commissionPercent === c
                              ? 'bg-primary text-white font-bold'
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
              <div className="pt-2 border-t border-border/60 space-y-1.5">
                <div className="flex items-center gap-1 text-[11px] font-semibold text-text-muted">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <span>Quick Templates (Autofill Steps):</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(PASSPORT_PRESET)}
                    className="px-2.5 py-1 rounded bg-white hover:bg-primary-light hover:text-primary border border-border text-[11px] font-medium transition-colors"
                  >
                    Passport (4 steps)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(PAN_PRESET)}
                    className="px-2.5 py-1 rounded bg-white hover:bg-primary-light hover:text-primary border border-border text-[11px] font-medium transition-colors"
                  >
                    PAN Card (3 steps)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleApplyPreset(GOVT_CERT_PRESET)}
                    className="px-2.5 py-1 rounded bg-white hover:bg-primary-light hover:text-primary border border-border text-[11px] font-medium transition-colors"
                  >
                    Govt Certificate (3 steps)
                  </button>
                </div>
              </div>

              {/* Steps List */}
              <div className="space-y-3 pt-2 border-t border-border/60">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-text">
                    Workflow Steps ({steps.length})
                  </span>
                  <button
                    type="button"
                    onClick={handleAddStep}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
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
                        className="p-2.5 rounded-lg border border-border/70 bg-white space-y-2 shadow-sm"
                      >
                        {/* Step Title & Actions */}
                        <div className="flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary font-bold text-[11px] flex items-center justify-center shrink-0">
                            {idx + 1}
                          </span>
                          <input
                            type="text"
                            value={step.name}
                            onChange={(e) => handleUpdateStep(idx, 'name', e.target.value)}
                            placeholder={`Step ${idx + 1} name`}
                            className="flex-1 h-8 px-2.5 rounded border border-border text-xs font-medium focus:border-primary focus:outline-none"
                            required
                          />
                          <div className="flex items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => handleMoveStep(idx, 'UP')}
                              disabled={idx === 0}
                              className="p-1 text-text-muted hover:text-text disabled:opacity-30 rounded"
                              title="Move step up"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveStep(idx, 'DOWN')}
                              disabled={idx === steps.length - 1}
                              className="p-1 text-text-muted hover:text-text disabled:opacity-30 rounded"
                              title="Move step down"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveStep(idx)}
                              className="p-1 text-text-muted hover:text-danger rounded ml-1"
                              title="Delete step"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* WhatsApp Message Template */}
                        <div className="pl-6 space-y-1">
                          <div className="flex items-center justify-between text-[10px] text-text-muted">
                            <span className="flex items-center gap-1 font-semibold text-text">
                              <MessageSquare className="w-3 h-3 text-success" />
                              WhatsApp Message Template (Optional):
                            </span>
                          </div>
                          <textarea
                            value={step.whatsapp_message}
                            onChange={(e) => handleUpdateStep(idx, 'whatsapp_message', e.target.value)}
                            rows={2}
                            placeholder="Message sent to customer when this step is completed..."
                            className="w-full p-2 rounded border border-border text-xs focus:border-primary focus:outline-none font-mono"
                          />

                          {/* Variable Chips */}
                          <div className="flex flex-wrap gap-1 items-center pt-0.5">
                            <span className="text-[10px] text-text-muted">Insert tag:</span>
                            {WA_VARIABLES.map((v) => (
                              <button
                                key={v}
                                type="button"
                                onClick={() => handleInsertVariable(idx, v)}
                                className="px-1.5 py-0.5 rounded bg-surface hover:bg-primary-light hover:text-primary text-[10px] font-mono text-text-muted border border-border/60 transition-colors"
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
              className="w-4 h-4 text-primary rounded border-border focus:ring-primary cursor-pointer"
            />
            <label htmlFor="active_toggle" className="text-sm font-medium text-text select-none cursor-pointer">
              Active (available for quick selection in bills)
            </label>
          </div>

          {formError && <div className="text-xs text-danger font-medium">{formError}</div>}

          <div className="pt-2">
            <Button type="submit" variant="primary" size="md" className="w-full" loading={saving}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </Sheet>
    </div>
  );
};
