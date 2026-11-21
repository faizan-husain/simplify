import React, { useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { normalizeCustomerMobile } from './documentSharing';
import { Smartphone } from 'lucide-react';

export interface UpdateMobileModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partyName?: string;
  initialMobile?: string;
  onSave: (normalizedMobile: string) => Promise<void> | void;
}

export const UpdateMobileModal: React.FC<UpdateMobileModalProps> = ({
  open,
  onOpenChange,
  partyName = 'Customer',
  initialMobile = '',
  onSave,
}) => {
  const [mobile, setMobile] = useState(initialMobile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const validation = normalizeCustomerMobile(mobile);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validation.valid) {
      setError('Please enter a valid 10-digit Indian mobile number (e.g. 9876543210)');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await onSave(validation.normalized);
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || 'Failed to update mobile number');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="WhatsApp Number Required"
      description={`Enter a 10-digit WhatsApp mobile number for ${partyName} to share this document.`}
      className="sm:max-w-[420px]"
    >
      <form onSubmit={handleSave} className="space-y-4 pt-1">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1.5">
            WhatsApp Mobile Number
          </label>
          <div className="relative flex items-center">
            <span className="absolute left-3 text-xs font-semibold text-slate-400 select-none flex items-center gap-1">
              <Smartphone className="w-3.5 h-3.5 text-slate-400" />
              +91
            </span>
            <input
              type="tel"
              value={mobile}
              onChange={(e) => {
                setMobile(e.target.value);
                if (error) setError('');
              }}
              placeholder="98765 43210"
              maxLength={15}
              autoFocus
              className="w-full pl-16 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F766E]/20 focus:border-[#0F766E] transition-all font-mono"
            />
          </div>
          {error && <p className="text-xs text-rose-600 mt-1.5 font-medium">{error}</p>}
          {validation.valid && (
            <p className="text-[11px] text-[#0F766E] mt-1 font-medium">
              Valid: {validation.international}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={loading || !validation.valid}
            className="bg-[#0F766E] hover:bg-[#0D655E] text-white"
          >
            {loading ? 'Saving...' : 'Save & Share'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
