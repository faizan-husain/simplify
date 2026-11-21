import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { Input } from '../ui/Input';
import { Dialog } from '../ui/Dialog';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useToast } from '../ui/Toast';
import {
  Users,
  UserPlus,
  Edit2,
  Trash2,
  Shield,
  Briefcase,
  Mail,
  Phone,
  KeyRound,
} from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  email: string | null;
  mobile: string | null;
  role: 'OWNER' | 'STAFF';
  active: boolean;
  can_login: boolean;
  has_auth_user: boolean;
  created_at: string;
}

import { StatusDot } from '../ui/StatusDot';

export const TeamMembersSection: React.FC = () => {
  const { showToast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Add Member Modal State
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [submittingAdd, setSubmittingAdd] = useState(false);
  const [addForm, setAddForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'STAFF' as 'STAFF',
    mobile: '',
  });

  // Edit Member Modal State
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [editForm, setEditForm] = useState({
    name: '',
    mobile: '',
    role: 'STAFF' as 'STAFF',
    active: true,
    newPassword: '',
  });

  // Delete State
  const [deletingMember, setDeletingMember] = useState<TeamMember | null>(null);
  const [submittingDelete, setSubmittingDelete] = useState(false);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc('list_team_members');
      if (error) throw error;
      setMembers((data as TeamMember[]) || []);
    } catch (err: any) {
      showToast(err.message || 'Failed to load team members', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, []);

  const handleCreateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addForm.name.trim()) {
      showToast('Name is required', 'error');
      return;
    }
    if (!addForm.email.trim() || !addForm.email.includes('@')) {
      showToast('Valid email is required', 'error');
      return;
    }
    if (!addForm.password || addForm.password.length < 6) {
      showToast('Password must be at least 6 characters', 'error');
      return;
    }

    setSubmittingAdd(true);
    try {
      const { error } = await supabase.rpc('create_team_member', {
        p_name: addForm.name.trim(),
        p_email: addForm.email.trim(),
        p_password: addForm.password,
        p_role: addForm.role,
        p_mobile: addForm.mobile.trim() || null,
      });

      if (error) throw error;

      showToast(`${addForm.name} added as Staff`, 'success');
      setIsAddOpen(false);
      setAddForm({
        name: '',
        email: '',
        password: '',
        role: 'STAFF',
        mobile: '',
      });
      fetchMembers();
    } catch (err: any) {
      showToast(err.message || 'Failed to create team member', 'error');
    } finally {
      setSubmittingAdd(false);
    }
  };

  const handleStartEdit = (m: TeamMember) => {
    setEditingMember(m);
    setEditForm({
      name: m.name,
      mobile: m.mobile || '',
      role: 'STAFF',
      active: m.active,
      newPassword: '',
    });
  };

  const handleUpdateMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;

    if (!editForm.name.trim()) {
      showToast('Name is required', 'error');
      return;
    }
    if (editForm.newPassword && editForm.newPassword.length < 6) {
      showToast('New password must be at least 6 characters', 'error');
      return;
    }

    setSubmittingEdit(true);
    try {
      const { error } = await supabase.rpc('update_team_member', {
        p_member_id: editingMember.id,
        p_name: editForm.name.trim(),
        p_mobile: editForm.mobile.trim() || null,
        p_role: editingMember.role === 'OWNER' ? 'OWNER' : editForm.role,
        p_active: editForm.active,
        p_new_password: editForm.newPassword.trim() || null,
      });

      if (error) throw error;

      showToast('Team member updated successfully', 'success');
      setEditingMember(null);
      fetchMembers();
    } catch (err: any) {
      showToast(err.message || 'Failed to update team member', 'error');
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleDeleteMember = async () => {
    if (!deletingMember) return;
    setSubmittingDelete(true);
    try {
      const { error } = await supabase.rpc('delete_team_member', {
        p_member_id: deletingMember.id,
      });

      if (error) throw error;

      showToast('Team member removed', 'success');
      setDeletingMember(null);
      fetchMembers();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete team member', 'error');
    } finally {
      setSubmittingDelete(false);
    }
  };

  const getRoleBadge = (role: TeamMember['role']) => {
    switch (role) {
      case 'OWNER':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 border-0 shrink-0">
            <Shield className="w-3 h-3 text-amber-700" />
            <span>Owner</span>
          </span>
        );
      case 'STAFF':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-teal-50 text-teal-700 border-0 shrink-0">
            <Briefcase className="w-3 h-3 text-teal-600" />
            <span>Staff</span>
          </span>
        );
    }
  };

  return (
    <div className="bg-white p-5 sm:p-6 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="w-9 h-9 rounded-xl bg-slate-100 border-0 text-slate-700 flex items-center justify-center shrink-0 shadow-2xs">
            <Users className="w-4.5 h-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-bold text-slate-900 tracking-tight truncate">Team Members &amp; Staff Logins</h2>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              Manage login credentials and access for Staff members
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsAddOpen(true)}
          className="self-start sm:self-auto inline-flex items-center justify-center gap-2 px-4 h-[38px] rounded-xl border-0 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-[13px] font-semibold shadow-2xs hover:shadow-xs transition-all active:scale-[0.98] cursor-pointer shrink-0"
        >
          <UserPlus className="w-4 h-4 shrink-0" />
          <span className="whitespace-nowrap">Add Member</span>
        </button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-xs text-text-muted">Loading team members...</div>
      ) : members.length === 0 ? (
        <div className="py-8 text-center text-xs text-text-muted">No team members found.</div>
      ) : (
        <div className="divide-y divide-slate-100 border-0 rounded-xl overflow-hidden bg-white shadow-2xs">
          {members.map((m) => (
            <div
              key={m.id}
              className="p-4 sm:p-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/80 transition-colors"
            >
              <div className="space-y-1.5 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-[14px] text-[#0F172A] truncate">{m.name}</span>
                  {getRoleBadge(m.role)}
                  {!m.active && (
                    <StatusDot status="danger" label="Inactive" />
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#64748B]">
                  {m.email && (
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{m.email}</span>
                    </div>
                  )}
                  {m.mobile && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Phone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>+91 {m.mobile}</span>
                    </div>
                  )}
                </div>
              </div>

              {m.role !== 'OWNER' && (
                <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto pt-1 sm:pt-0">
                  <button
                    type="button"
                    onClick={() => handleStartEdit(m)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border-0 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 hover:text-slate-900 text-xs font-semibold shadow-2xs hover:shadow-xs transition-all active:scale-95 cursor-pointer select-none"
                    title="Edit member"
                  >
                    <Edit2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingMember(m)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border-0 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 text-xs font-semibold shadow-2xs hover:shadow-xs transition-all active:scale-95 cursor-pointer select-none"
                    title="Remove member"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    <span>Remove</span>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Member Dialog */}
      <Dialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        title="Add Staff Member"
        description="Create credentials for a new Staff team member."
      >
        <form onSubmit={handleCreateMember} className="space-y-4 pt-2">
          <Input
            label="Full Name"
            value={addForm.name}
            onChange={(e) => setAddForm({ ...addForm, name: e.target.value })}
            placeholder="e.g. Ramesh Kumar"
            required
          />

          <div className="p-3 bg-teal-50/70 rounded-xl border-0 shadow-2xs flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0 pr-1">
              <Briefcase className="w-4 h-4 text-teal-700 shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-bold text-teal-900">Role: Staff Member</p>
                <p className="text-[11px] text-teal-700 leading-tight">Enters bills, completes jobs checklist &amp; earns commission</p>
              </div>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-teal-100 text-teal-800 px-2 py-0.5 rounded-md shrink-0">
              Staff
            </span>
          </div>

          <Input
            label="Login Email"
            type="email"
            value={addForm.email}
            onChange={(e) => setAddForm({ ...addForm, email: e.target.value })}
            placeholder="e.g. staff@example.com"
            autoComplete="off"
            required
          />

          <Input
            label="Login Password"
            type="password"
            value={addForm.password}
            onChange={(e) => setAddForm({ ...addForm, password: e.target.value })}
            placeholder="Minimum 6 characters"
            autoComplete="new-password"
            required
          />

          <Input
            label="Mobile Number (Optional)"
            type="tel"
            value={addForm.mobile}
            onChange={(e) => setAddForm({ ...addForm, mobile: e.target.value })}
            placeholder="10 digit Indian mobile number"
          />

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsAddOpen(false)}
              disabled={submittingAdd}
              className="w-full sm:w-auto px-5 h-[42px] border-0 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 font-semibold rounded-xl shadow-2xs hover:shadow-xs transition-all active:scale-[0.98] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingAdd}
              className="w-full sm:w-auto px-6 h-[42px] border-0 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-2xs hover:shadow-xs transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
            >
              {submittingAdd ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Creating...</span>
                </span>
              ) : (
                <span>Create Member</span>
              )}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Edit Member Dialog */}
      <Dialog
        open={Boolean(editingMember)}
        onOpenChange={(open) => !open && setEditingMember(null)}
        title="Edit Team Member"
        description={`Update settings for ${editingMember?.name}`}
      >
        <form onSubmit={handleUpdateMember} className="space-y-4 pt-2">
          <Input
            label="Full Name"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            required
          />

          <Input
            label="Mobile Number"
            type="tel"
            value={editForm.mobile}
            onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })}
            placeholder="10 digit Indian mobile number"
          />

          <div className="p-3.5 bg-[#EEF0F3] rounded-xl border-0 shadow-2xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">Account Active</p>
                <p className="text-xs text-slate-500">Allow user to log in and use the app</p>
              </div>
              <input
                type="checkbox"
                id="active-toggle"
                checked={editForm.active}
                onChange={(e) => setEditForm({ ...editForm, active: e.target.checked })}
                className="w-4.5 h-4.5 accent-slate-900 rounded cursor-pointer"
              />
            </div>
          </div>

          <div className="pt-1 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <KeyRound className="w-3.5 h-3.5 text-slate-400" />
              <span>Reset Password (Optional)</span>
            </div>
            <Input
              type="password"
              value={editForm.newPassword}
              onChange={(e) => setEditForm({ ...editForm, newPassword: e.target.value })}
              placeholder="Leave blank to keep existing password"
              autoComplete="new-password"
            />
          </div>

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setEditingMember(null)}
              disabled={submittingEdit}
              className="w-full sm:w-auto px-5 h-[42px] border-0 bg-[#EEF0F3] hover:bg-slate-200 text-slate-700 font-semibold rounded-xl shadow-2xs hover:shadow-xs transition-all active:scale-[0.98] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submittingEdit}
              className="w-full sm:w-auto px-6 h-[42px] border-0 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl shadow-2xs hover:shadow-xs transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2"
            >
              {submittingEdit ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Saving...</span>
                </span>
              ) : (
                <span>Save Changes</span>
              )}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={Boolean(deletingMember)}
        onOpenChange={(open) => !open && setDeletingMember(null)}
        title="Remove Team Member"
        description={`Are you sure you want to remove ${deletingMember?.name}? They will lose access immediately.`}
        confirmLabel="Remove Member"
        variant="danger"
        loading={submittingDelete}
        onConfirm={handleDeleteMember}
      />
    </div>
  );
};
