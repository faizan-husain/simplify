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
import { Plus, Search, Trash2, Briefcase } from 'lucide-react';
import { Database } from '../types/supabase';

type Service = Database['public']['Tables']['services']['Row'];

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
    setActive(true);
    setFormError(null);
    setIsSheetOpen(true);
  };

  const handleOpenEdit = (s: Service) => {
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
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setFormError(t('auth.required'));
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const rateNum = defaultRate ? parseFloat(defaultRate) : null;
      const deadlineNum = isJobType && deadlineDays ? parseInt(deadlineDays, 10) : null;
      const commNum = isJobType && commissionPercent ? parseFloat(commissionPercent) : null;

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
        showToast(t('common.success'), 'success');
      } else {
        const { error } = await supabase
          .from('services')
          .insert({
            name: name.trim(),
            default_rate: rateNum,
            category: category.trim() || null,
            is_job_type: isJobType,
            deadline_days: deadlineNum,
            commission_percent: commNum,
            active,
          });

        if (error) throw error;
        showToast(t('common.success'), 'success');
      }

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
    if (!window.confirm(`Delete service ${service.name}?`)) return;

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-text">Services & Job Types</h1>
          <p className="text-xs text-text-muted">{services.length} items</p>
        </div>
        <Button variant="primary" size="md" onClick={handleOpenCreate}>
          <Plus className="w-4 h-4 mr-1.5" />
          <span>Add Service</span>
        </Button>
      </div>

      <div className="relative">
        <Input
          placeholder={t('common.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftIcon={<Search className="w-4 h-4" />}
        />
      </div>

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : filteredServices.length === 0 ? (
        <EmptyState
          message={t('common.empty')}
          actionLabel="Add Service"
          onAction={handleOpenCreate}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredServices.map((service) => (
            <Card
              key={service.id}
              className="cursor-pointer hover:border-gray-400 p-3.5 flex flex-col justify-between"
              onClick={() => handleOpenEdit(service)}
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-text truncate">{service.name}</span>
                    {service.is_job_type && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary-light text-primary">
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
                  className="p-1 text-text-muted hover:text-danger rounded"
                  title={t('common.delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {service.is_job_type && (
                <div className="mt-3 pt-2 border-t border-border/50 text-[11px] text-text-muted flex justify-between">
                  <span>Deadline: {service.deadline_days || 0} days</span>
                  <span>Commission: {service.commission_percent || 0}%</span>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Sheet Form */}
      <Sheet
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        title={editingService ? 'Edit Service' : 'Add Service'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Input
            label="Service Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Passport Application, Xerox, Lamination"
            disabled={saving}
          />

          <AmountInput
            label="Default Rate (Optional)"
            value={defaultRate}
            onChange={(val) => setDefaultRate(val)}
            disabled={saving}
          />

          <Input
            label="Category (Optional)"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. Government Services, Printing"
            disabled={saving}
          />

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="is_job_type"
              checked={isJobType}
              onChange={(e) => setIsJobType(e.target.checked)}
              className="w-4 h-4 text-primary rounded border-border focus:ring-primary"
            />
            <label htmlFor="is_job_type" className="text-sm font-medium text-text select-none cursor-pointer">
              This is a multi-step Job Type (e.g. Passport, PAN Card)
            </label>
          </div>

          {isJobType && (
            <div className="space-y-3 bg-surface p-3.5 rounded-lg border border-border">
              <Input
                label="Default Deadline (Days)"
                type="number"
                value={deadlineDays}
                onChange={(e) => setDeadlineDays(e.target.value)}
                placeholder="15"
                disabled={saving}
              />
              <Input
                label="Staff Commission (%)"
                type="number"
                value={commissionPercent}
                onChange={(e) => setCommissionPercent(e.target.value)}
                placeholder="10"
                disabled={saving}
              />
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="active_toggle"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 text-primary rounded border-border focus:ring-primary"
            />
            <label htmlFor="active_toggle" className="text-sm font-medium text-text select-none cursor-pointer">
              Active (available in bill creation)
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
