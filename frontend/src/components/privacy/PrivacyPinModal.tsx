import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { Lock } from 'lucide-react';

export interface PrivacyPinModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export const PrivacyPinModal: React.FC<PrivacyPinModalProps> = ({
  open,
  onOpenChange,
  onSuccess,
}) => {
  const { showToast } = useToast();
  const [pin, setPin] = useState('');
  const [verifying, setVerifying] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length !== 4) {
      showToast('Please enter your 4-digit Privacy PIN', 'error');
      return;
    }

    setVerifying(true);
    try {
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
    } catch (err: any) {
      showToast(err.message || 'Failed to verify PIN', 'error');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Privacy PIN Required"
      description="Enter your 4-digit Privacy PIN to access previous financial year data."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex justify-center my-2">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary">
            <Lock className="w-6 h-6" />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-text-muted block text-center mb-2">
            4-Digit PIN
          </label>
          <input
            type="password"
            maxLength={4}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoFocus
            className="w-40 mx-auto text-center tracking-[1em] text-2xl font-bold h-12 border border-border rounded-lg bg-surface focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary block"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setPin('');
              onOpenChange(false);
            }}
            disabled={verifying}
          >
            Cancel
          </Button>
          <Button type="submit" loading={verifying} disabled={pin.length !== 4}>
            Unlock
          </Button>
        </div>
      </form>
    </Dialog>
  );
};
