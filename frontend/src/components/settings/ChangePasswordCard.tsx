import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { useToast } from '../ui/Toast';
import { KeyRound, Check, Eye, EyeOff } from 'lucide-react';

export const ChangePasswordCard: React.FC = () => {
  const { showToast } = useToast();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!newPassword || newPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }

    setLoading(true);
    try {
      // 1. Call RPC for DB authority
      const { error: rpcError } = await supabase.rpc('change_own_password', {
        p_new_password: newPassword,
      });

      if (rpcError) {
        showToast(rpcError.message || 'Failed to update password', 'error');
        return;
      }

      // 2. Also sync auth user session
      try {
        await supabase.auth.updateUser({ password: newPassword });
      } catch {
        // Ignored if local-dev bridge handles via RPC
      }

      showToast('Password updated successfully', 'success');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      showToast(err.message || 'An error occurred while updating password', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-5 sm:p-6 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-5">
      <div className="flex items-start justify-between pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-slate-100 border-0 text-slate-700 flex items-center justify-center shrink-0 shadow-2xs">
            <KeyRound className="w-4.5 h-4.5" />
          </div>
          <div>
            <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">Account Security &amp; Password</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Update your personal login password (minimum 6 characters)
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="New Password"
            type={showPassword ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password"
            autoComplete="new-password"
            required
            rightIcon={
              <button
                type="button"
                className="p-1 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer select-none"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }
          />

          <Input
            label="Confirm New Password"
            type={showPassword ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter new password"
            autoComplete="new-password"
            required
            rightIcon={
              <button
                type="button"
                className="p-1 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer select-none"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            }
          />
        </div>

        <div className="pt-1">
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={loading}
            disabled={!newPassword || newPassword.length < 6 || newPassword !== confirmPassword}
            className="bg-slate-900 hover:bg-slate-800 text-white shadow-2xs font-semibold px-5"
          >
            <Check className="w-4 h-4 mr-2" />
            <span>Update Password</span>
          </Button>
        </div>
      </form>
    </div>
  );
};
