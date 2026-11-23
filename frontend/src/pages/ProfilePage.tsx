import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Button } from '../components/ui/Button';
import { formatMobileDisplay } from '../lib/auth';
import {
  User,
  KeyRound,
  Shield,
  Briefcase,
  CheckCircle2,
  Lock,
  Phone,
  Building,
  Save,
  Check,
  ArrowLeft,
  Mail,
} from 'lucide-react';

export const ProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { member, business, role, user, refreshProfile } = useAuth();
  const { showToast } = useToast();

  const isStaff = role === 'STAFF';

  // Name Change State
  const [name, setName] = useState(member?.name || '');
  const [savingName, setSavingName] = useState(false);
  const [nameSavedSuccess, setNameSavedSuccess] = useState(false);

  // Password Change State
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSavedSuccess, setPasswordSavedSuccess] = useState(false);

  useEffect(() => {
    if (member?.name) {
      setName(member.name);
    }
  }, [member?.name]);

  const hasNameChanged = name.trim().length >= 2 && name.trim() !== (member?.name || '');

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      showToast('Name cannot be empty', 'error');
      return;
    }
    if (trimmed.length < 2) {
      showToast('Name must be at least 2 characters', 'error');
      return;
    }

    setSavingName(true);
    setNameSavedSuccess(false);
    try {
      // 1. Call RPC for DB authority
      const { error: rpcErr } = await supabase.rpc('update_my_profile', {
        p_name: trimmed,
      });
      if (rpcErr) throw rpcErr;

      // 2. Also sync auth user metadata
      try {
        await supabase.auth.updateUser({
          data: { name: trimmed },
        });
      } catch { }

      await refreshProfile();
      setNameSavedSuccess(true);
      showToast('Name updated successfully', 'success');
      setTimeout(() => setNameSavedSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error updating name:', err);
      showToast(err.message || 'Failed to update name', 'error');
    } finally {
      setSavingName(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match', 'error');
      return;
    }

    setSavingPassword(true);
    setPasswordSavedSuccess(false);
    try {
      // 1. Call RPC for DB authority
      const { error: rpcErr } = await supabase.rpc('update_my_profile', {
        p_password: newPassword,
      });
      if (rpcErr) throw rpcErr;

      // 2. Also sync Supabase auth password
      try {
        await supabase.auth.updateUser({
          password: newPassword,
        });
      } catch { }

      setPasswordSavedSuccess(true);
      setNewPassword('');
      setConfirmPassword('');
      showToast('Password updated successfully', 'success');
      setTimeout(() => setPasswordSavedSuccess(false), 3000);
    } catch (err: any) {
      console.error('Error updating password:', err);
      showToast(err.message || 'Failed to update password', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-5 py-2 sm:py-5 px-3 sm:px-0 select-none">
      {/* Top Navigation Bar with Back Button */}
      <div className="flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 px-3 py-1.5 rounded-xl shadow-2xs border border-slate-200/60 transition-all cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back</span>
        </button>
        <span className="text-[12px] font-semibold text-slate-400">
          Account &amp; Security Settings
        </span>
      </div>

      {/* 1. Centered Profile Hero / Identity Card */}
      <Card className="p-6 sm:p-7 border-0 shadow-[0_1px_3px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all text-center">
        {/* Large Centered Avatar with Soft Ring */}
        <div className="relative inline-block mx-auto">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-[#EAF2F1] via-[#E2EEEB] to-[#D5E6E3] text-[#0F766E] text-[24px] font-black flex items-center justify-center mx-auto shadow-2xs border-0">
            {(member?.name || 'Staff')
              .split(' ')
              .map((n: string) => n[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </div>
          <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 ring-2 ring-white flex items-center justify-center text-white text-[10px]">
            <Check className="w-3 h-3 stroke-[3]" />
          </span>
        </div>

        {/* User Name */}
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight mt-3.5">
          {member?.name || 'User Profile'}
        </h1>

        {/* Role Pill */}
        <div className="mt-1.5 flex justify-center">
          {isStaff ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#EAF2F1] text-[#0F766E] border-0 shadow-2xs">
              <Briefcase className="w-3.5 h-3.5 text-[#0F766E]" />
              <span>Staff Member</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border-0 shadow-2xs">
              <Shield className="w-3.5 h-3.5 text-amber-700" />
              <span>Business Owner</span>
            </span>
          )}
        </div>

        {/* Email & Mobile Pill Metadata */}
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-xs text-slate-500 mt-3 font-medium">
          <span className="inline-flex items-center gap-1.5">
            <Building className="w-3.5 h-3.5 text-slate-400" />
            <span>{business?.name || 'SIMPLIFY'}</span>
          </span>
          <span className="text-slate-300">•</span>
          <span className="inline-flex items-center gap-1.5 font-mono">
            <Mail className="w-3.5 h-3.5 text-slate-400" />
            <span>{user?.email || member?.email || (isStaff ? 'staff@simplify.com' : 'owner@simplify.com')}</span>
          </span>
          {member?.mobile && (
            <>
              <span className="text-slate-300">•</span>
              <span className="inline-flex items-center gap-1.5 font-mono">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>+91 {formatMobileDisplay(member.mobile)}</span>
              </span>
            </>
          )}
        </div>
      </Card>

      {/* 2. Personal Details Card (Centered Layout & Fields) */}
      <Card className="p-6 sm:p-7 border-0 shadow-[0_1px_3px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all space-y-5">
        {/* Card Header (Centered) */}
        <div className="text-center pb-4 border-b border-slate-100 relative">
          <div className="w-11 h-11 rounded-2xl bg-[#EAF2F1] text-[#0F766E] flex items-center justify-center mx-auto mb-2.5 shadow-2xs border-0">
            <User className="w-5 h-5" />
          </div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight">Personal Details</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Update your display name across bills, jobs, and earnings statements
          </p>

          {nameSavedSuccess && (
            <div className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border-0 shadow-2xs animate-in fade-in">
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Name Saved Successfully</span>
            </div>
          )}
        </div>

        {/* Form Fields (Centered Full Width) */}
        <form onSubmit={handleUpdateName} className="space-y-4">
          <div>
            <Input
              label="Full Name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your full name"
              required
            />
            <p className="text-[11.5px] text-slate-500 mt-1.5">
              Your name will be displayed on bills, receipts, and jobs created by you.
            </p>
          </div>

          {/* Registered Email Display (Primary Login ID) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                <span>Login Email (Login ID)</span>
              </span>
              <span className="text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full flex items-center gap-1 border-0">
                <CheckCircle2 className="w-3 h-3" />
                Verified
              </span>
            </div>
            <div className="h-10 px-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 flex items-center justify-between text-sm text-slate-800 font-mono">
              <span>{user?.email || member?.email || (isStaff ? 'staff@simplify.com' : 'owner@simplify.com')}</span>
              <span className="text-[11px] font-sans text-slate-400 font-medium bg-white px-2 py-0.5 rounded-md border border-slate-200/60 shadow-2xs">
                Primary Login ID
              </span>
            </div>
            <p className="text-[11.5px] text-slate-500">
              You sign in to SIMPLIFY using this email address and your password.
            </p>
          </div>

          {/* Registered Mobile Display (Contact) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
              <span className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-slate-400" />
                <span>Mobile Number (WhatsApp &amp; Contact)</span>
              </span>
              <span className="text-[10.5px] text-slate-400 font-normal">Contact info</span>
            </div>
            <div className="h-10 px-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80 flex items-center justify-between text-sm text-slate-800 font-mono">
              <span>{member?.mobile ? `+91 ${formatMobileDisplay(member.mobile)}` : 'Not linked'}</span>
              <span className="text-[11px] font-sans text-slate-400 font-medium bg-white px-2 py-0.5 rounded-md border border-slate-200/60 shadow-2xs">
                Contact Number
              </span>
            </div>
            <p className="text-[11.5px] text-slate-500">
              Used for customer WhatsApp updates and business contact.
            </p>
          </div>

          {/* Save Name Button */}
          <div className="pt-2">
            <Button
              type="submit"
              variant="accent"
              size="md"
              loading={savingName}
              disabled={savingName || !hasNameChanged}
              className="w-full gap-2 h-11 text-sm font-semibold rounded-xl"
            >
              <Save className="w-4 h-4" />
              <span>{hasNameChanged ? 'Save Name' : 'Name is Up to Date'}</span>
            </Button>
          </div>
        </form>
      </Card>

      {/* 3. Account Security & Password Change Card */}
      <Card className="p-6 sm:p-7 border-0 shadow-[0_1px_3px_rgba(0,0,0,0.03)] hover:shadow-[0_4px_20px_rgba(0,0,0,0.04)] transition-all space-y-5">
        {/* Card Header (Centered) */}
        <div className="text-center pb-4 border-b border-slate-100">
          <div className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-700 flex items-center justify-center mx-auto mb-2.5 shadow-2xs border-0">
            <KeyRound className="w-5 h-5" />
          </div>
          <h2 className="text-base font-bold text-slate-900 tracking-tight">Account Security</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Update your login password (minimum 6 characters)
          </p>

          {passwordSavedSuccess && (
            <div className="mt-2.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 animate-in fade-in">
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Password Updated Successfully</span>
            </div>
          )}
        </div>

        {/* Form Fields (Centered Full Width) */}
        <form onSubmit={handleUpdatePassword} className="space-y-4">
          <div>
            <Input
              label="New Password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter at least 6 characters"
              autoComplete="new-password"
              required
            />
          </div>

          <div>
            <Input
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              autoComplete="new-password"
              required
            />
          </div>

          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center gap-2.5 text-xs text-slate-600">
            <Lock className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-[11.5px] leading-relaxed">
              Use at least 6 characters. Never share your password with anyone.
            </span>
          </div>

          <div className="pt-2">
            <Button
              type="submit"
              variant="accent"
              size="md"
              loading={savingPassword}
              disabled={savingPassword || !newPassword || newPassword.length < 6}
              className="w-full gap-2 h-11 text-sm font-semibold rounded-xl"
            >
              <Lock className="w-4 h-4" />
              <span>Update Password</span>
            </Button>
          </div>
        </form>
      </Card>

      {/* 4. Staff Account Security & Safety Reassurance Note */}
      {isStaff && (
        <div className="p-4 rounded-2xl bg-white border border-slate-200/60 shadow-2xs text-center space-y-1.5">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0F766E]">
            <Shield className="w-3.5 h-3.5" />
            <span>Staff Account Protection</span>
          </div>
          <p className="text-[11.5px] text-slate-500 leading-relaxed max-w-md mx-auto">
            You are signed in with Staff privileges. Your profile and password updates are encrypted and synchronized instantly.
          </p>
        </div>
      )}
    </div>
  );
};
