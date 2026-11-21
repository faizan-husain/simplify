import React from 'react';
import { useNavigate } from 'react-router-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X, User, Settings, LogOut, ShieldCheck, ChevronRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export interface MobileProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogoutClick: () => void;
}

export const MobileProfileSheet: React.FC<MobileProfileSheetProps> = ({
  open,
  onOpenChange,
  onLogoutClick,
}) => {
  const { business, member, role } = useAuth();
  const navigate = useNavigate();
  const isOwner = role === 'OWNER';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0F172A]/65 backdrop-blur-sm animate-in fade-in duration-200" />
        <DialogPrimitive.Content
          className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white rounded-t-[20px] max-h-[90dvh] shadow-pop duration-200 animate-in slide-in-from-bottom pb-[env(safe-area-inset-bottom)] overflow-hidden focus:outline-none"
        >
          {/* Sheet Handle */}
          <div className="pt-3 pb-1 px-4 shrink-0">
            <div className="w-10 h-1 bg-[#EEF0F3] rounded-full mx-auto" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-3 pb-4 border-b border-divider">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-ink text-white font-bold text-base flex items-center justify-center shrink-0 shadow-2xs">
                {(business?.name || 'B')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <h3 className="text-[17px] font-semibold text-text truncate">
                  {business?.name || 'SIMPLIFY Business'}
                </h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="inline-flex items-center gap-1 text-[12px] font-medium text-text-muted">
                    <ShieldCheck className="w-3.5 h-3.5 text-accent" />
                    <span>{isOwner ? 'Business Owner' : 'Staff Member'}</span>
                  </span>
                </div>
              </div>
            </div>
            <DialogPrimitive.Close className="p-2 rounded-xl text-text-muted hover:text-text hover:bg-surface-2 transition-colors">
              <X className="w-5 h-5" />
            </DialogPrimitive.Close>
          </div>

          {/* User Details Tile */}
          <div className="p-4 mx-4 mt-4 bg-surface-2 rounded-xl flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-text truncate">
                {member?.name || 'Active User'}
              </p>
              <p className="text-[12.5px] text-text-muted mt-0.5 truncate">
                {member?.mobile ? `+91 ${member.mobile}` : 'Signed in with credentials'}
              </p>
            </div>
            <span className="text-[12px] font-semibold text-accent bg-accent-soft px-2.5 py-1 rounded-md shrink-0">
              Active
            </span>
          </div>

          {/* Action Navigation Rows */}
          <div className="p-4 space-y-1">
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate('/profile');
              }}
              className="w-full flex items-center justify-between p-3.5 rounded-xl hover:bg-surface-2 active:bg-surface-3 transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-surface-3 flex items-center justify-center text-text">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-[15px] font-medium text-text">My Profile &amp; Security</p>
                  <p className="text-[12.5px] text-text-muted">Name, mobile, and password</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-text-muted" />
            </button>

            {isOwner && (
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  navigate('/settings');
                }}
                className="w-full flex items-center justify-between p-3.5 rounded-xl hover:bg-surface-2 active:bg-surface-3 transition-colors text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-surface-3 flex items-center justify-center text-text">
                    <Settings className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-[15px] font-medium text-text">Business Settings</p>
                    <p className="text-[12.5px] text-text-muted">Billing, numbering, and preferences</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-text-muted" />
              </button>
            )}

            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onLogoutClick();
                }}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl hover:bg-danger-soft/50 text-danger transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-lg bg-danger-soft flex items-center justify-center text-danger">
                  <LogOut className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold text-danger">Log Out</p>
                  <p className="text-[12.5px] text-danger/80">End current session on this device</p>
                </div>
              </button>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
