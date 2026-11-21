import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { formatInputDate } from '../../lib/dates';
import { getErrorMessage } from '../../i18n';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { AmountInput } from '../ui/AmountInput';
import { useToast } from '../ui/Toast';
import { Briefcase, DollarSign, Info } from 'lucide-react';

export interface ConfigurePayTypeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staffMember: {
    id: string;
    name: string;
    compensation_type?: string;
    monthly_salary?: number;
    salary_start_date?: string;
  } | null;
  onSuccess?: () => void;
}

export const ConfigurePayTypeModal: React.FC<ConfigurePayTypeModalProps> = ({
  open,
  onOpenChange,
  staffMember,
  onSuccess,
}) => {
  const { showToast } = useToast();

  const [compensationType, setCompensationType] = useState<'COMMISSION' | 'SALARY'>('COMMISSION');
  const [monthlySalary, setMonthlySalary] = useState('');
  const [salaryStartDate, setSalaryStartDate] = useState(formatInputDate());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && staffMember) {
      const type = (staffMember.compensation_type || 'COMMISSION').toUpperCase() as 'COMMISSION' | 'SALARY';
      setCompensationType(type);
      setMonthlySalary(staffMember.monthly_salary ? String(staffMember.monthly_salary) : '');
      setSalaryStartDate(staffMember.salary_start_date ? staffMember.salary_start_date.slice(0, 10) : formatInputDate());
    }
  }, [open, staffMember]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!staffMember?.id) return;

    if (compensationType === 'SALARY') {
      const numSalary = parseFloat(monthlySalary);
      if (isNaN(numSalary) || numSalary <= 0) {
        showToast('Please enter a valid monthly salary', 'error');
        return;
      }
      if (!salaryStartDate) {
        showToast('Please select a salary start date', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('set_staff_salary_config', {
        p_staff_id: staffMember.id,
        p_compensation_type: compensationType,
        p_monthly_salary: compensationType === 'SALARY' ? parseFloat(monthlySalary) : null,
        p_salary_start_date: compensationType === 'SALARY' ? salaryStartDate : null,
      });

      if (error) throw error;

      showToast(`Pay type updated for ${staffMember.name}`, 'success');
      onOpenChange(false);
      onSuccess?.();
    } catch (err: any) {
      showToast(getErrorMessage(err.message), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Configure Pay Type · ${staffMember?.name || 'Staff'}`}
      description="Choose whether this staff member earns commission on completed jobs or a fixed monthly salary."
      className="sm:max-w-[480px] border-0 shadow-[0_8px_30px_rgba(0,0,0,0.1)]"
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-1">
        {/* Toggle options */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1 bg-[#EEF0F3] rounded-xl border-0 shadow-2xs">
          <button
            type="button"
            onClick={() => setCompensationType('COMMISSION')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              compensationType === 'COMMISSION'
                ? 'bg-white text-slate-900 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Briefcase className="w-3.5 h-3.5" />
            <span>Commission Based</span>
          </button>
          <button
            type="button"
            onClick={() => setCompensationType('SALARY')}
            className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
              compensationType === 'SALARY'
                ? 'bg-white text-slate-900 shadow-2xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <DollarSign className="w-3.5 h-3.5" />
            <span>Fixed Monthly Salary</span>
          </button>
        </div>

        {/* Dynamic configuration fields */}
        {compensationType === 'SALARY' ? (
          <div className="space-y-3 p-4 bg-[#EEF0F3] border-0 rounded-2xl shadow-2xs">
            <AmountInput
              label="Monthly Salary (₹)"
              value={monthlySalary}
              onChange={(val) => setMonthlySalary(val)}
              placeholder="e.g. 15000"
              required
            />
            <Input
              type="date"
              label="Salary Starts From Month"
              value={salaryStartDate}
              onChange={(e) => setSalaryStartDate(e.target.value)}
              required
            />
            <div className="flex items-start gap-1.5 text-[11px] text-slate-500 pt-1">
              <Info className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
              <span>
                Salary automatically becomes due at the end of each month. Completed jobs are counted towards "Jobs done" but will not generate commission.
              </span>
            </div>
          </div>
        ) : (
          <div className="p-4 bg-[#EEF0F3] border-0 rounded-2xl text-xs text-slate-600 space-y-1 shadow-2xs">
            <div className="font-semibold text-slate-800">Commission Model Active:</div>
            <p className="text-[11px] text-slate-600 leading-relaxed">
              Staff earns a percentage commission as configured on services when each job is completed. Pending jobs show as Upcoming commission.
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            loading={saving}
          >
            Save Configuration
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

