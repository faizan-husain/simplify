import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { Lock, Eye, EyeOff } from 'lucide-react';

export interface PrivacyPinModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  mode?: 'verify' | 'set';
}

export const PrivacyPinModal: React.FC<PrivacyPinModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
  mode = 'verify',
}) => {
  const { showToast } = useToast();
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) {
      showToast('Please enter a 4-digit PIN', 'error');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'set') {
        const { error } = await supabase.rpc('set_privacy_pin', { pin });
        if (error) throw error;
        sessionStorage.setItem('privacy_pin_unlocked', String(Date.now()));
        showToast('Privacy PIN set successfully', 'success');
        setPin('');
        onOpenChange(false);
        onSuccess();
      } else {
        const { data, error } = await supabase.rpc('verify_privacy_pin', { pin });
        if (error) throw error;

        if (data === true) {
          // Mark session unlocked
          sessionStorage.setItem('privacy_pin_unlocked', String(Date.now()));
          showToast('Privacy gate unlocked for this session', 'success');
          setPin('');
          onOpenChange(false);
          onSuccess();
        } else {
          showToast('Incorrect Privacy PIN', 'error');
          setPin('');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to process PIN', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={mode === 'set' ? 'Set Privacy PIN' : 'Privacy PIN Required'}
      description={
        mode === 'set'
          ? 'Set a 4-digit PIN to restrict access to previous financial years.'
          : 'Enter your 4-digit Privacy PIN to access previous financial year data.'
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 pt-2">
        <div className="flex justify-center my-2">
          <div className="w-12 h-12 rounded-full bg-surface-2 border border-hair flex items-center justify-center text-accent">
            <Lock className="w-5 h-5" />
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-text-muted block text-center mb-2">
            4-Digit PIN
          </label>
          <div className="relative w-48 mx-auto flex items-center justify-center">
            <input
              type={showPin ? 'text' : 'password'}
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              autoFocus
              className="w-full text-center tracking-[0.8em] pl-6 pr-10 text-2xl font-bold h-12 border border-hair rounded-control bg-surface-2 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-accent focus:border-accent block transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPin(!showPin)}
              tabIndex={-1}
              aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
              title={showPin ? 'Hide PIN' : 'Show PIN'}
              className="absolute right-2 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors cursor-pointer select-none"
            >
              {showPin ? <EyeOff className="w-4 h-4 text-slate-600" /> : <Eye className="w-4 h-4 text-slate-400" />}
            </button>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setPin('');
              onOpenChange(false);
            }}
            disabled={submitting}
            className="border-0 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 font-semibold rounded-xl shadow-2xs"
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={submitting} disabled={pin.length !== 4} className="bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-2xs border-0">
            {mode === 'set' ? 'Save PIN' : 'Unlock'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
