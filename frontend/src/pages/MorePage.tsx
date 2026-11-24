import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Tag, UserCheck, Settings, Trash2, LogOut, Smartphone, Keyboard, CheckCircle2 } from 'lucide-react';
import { t } from '../i18n';
import { ListRow } from '../components/ui/ListRow';
import { useAuth } from '../context/AuthContext';
import { usePwa } from '../context/PwaContext';
import { useKeyboardShortcuts } from '../context/KeyboardShortcutContext';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

export const MorePage: React.FC = () => {
  const navigate = useNavigate();
  const { business, member, signOut } = useAuth();
  const { isInstalled, openInstallModal } = usePwa();
  const { setShortcutsHelpOpen } = useKeyboardShortcuts();
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const handleSignOut = () => {
    setLogoutDialogOpen(true);
  };

  const confirmSignOut = async () => {
    setLogoutLoading(true);
    try {
      await signOut();
      setLogoutDialogOpen(false);
      navigate('/login');
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      setLogoutLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-4 pb-12">
      {/* Business & Profile Header */}
      <div
        onClick={() => navigate('/profile')}
        className="bg-white p-4 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] flex items-center gap-3.5 cursor-pointer hover:bg-surface-2 transition-colors group select-none"
      >
        <Avatar name={member?.name || business?.name || 'S'} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-text truncate group-hover:text-accent transition-colors">
            {member?.name || business?.name || 'Simplify'}
          </h2>
          <p className="text-xs text-text-muted truncate mt-0.5">
            {member?.role === 'STAFF' ? 'Staff Member' : 'Business Owner'} · {business?.name || 'Simplify'}
          </p>
        </div>
        <span className="text-xs font-semibold text-accent group-hover:underline">Edit</span>
      </div>

      {/* Main Settings & Modules List */}
      <div className="bg-white p-2 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] space-y-0.5">
        <ListRow
          title={t('customers.title')}
          subtitle="Manage customer profiles, numbers and dues"
          leftContent={<Users className="w-4 h-4 text-accent" />}
          onClick={() => navigate('/customers')}
        />
        <ListRow
          title="Services & Job Types"
          subtitle="Manage services, rates, deadline days and commission"
          leftContent={<Tag className="w-4 h-4 text-accent" />}
          onClick={() => navigate('/services')}
        />
        <ListRow
          title={member?.role === 'STAFF' ? 'My Earnings' : t('staff.title')}
          subtitle={
            member?.role === 'STAFF'
              ? 'Track your completed jobs, commissions and payments'
              : 'Staff commission, work earnings and payouts'
          }
          leftContent={<UserCheck className="w-4 h-4 text-accent" />}
          onClick={() => navigate(member?.role === 'STAFF' ? '/earnings' : '/staff')}
        />
        {isInstalled ? (
          <ListRow
            title="Simplify App"
            subtitle="Installed and ready on this device"
            leftContent={<CheckCircle2 className="w-4 h-4 text-emerald-600" />}
            rightContent={
              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800">
                Installed
              </span>
            }
          />
        ) : (
          <ListRow
            title="Install Simplify App"
            subtitle="Get the full app experience on your device"
            leftContent={<Smartphone className="w-4 h-4 text-accent" />}
            onClick={() => openInstallModal()}
          />
        )}
        <ListRow
          title="Keyboard Shortcuts"
          subtitle="Tally-style quick navigation and commands (Press ?)"
          leftContent={<Keyboard className="w-4 h-4 text-accent" />}
          onClick={() => setShortcutsHelpOpen(true)}
        />
        {member?.role !== 'STAFF' && (
          <>
            <ListRow
              title={t('settings.title')}
              subtitle="Business profile, invoice prefix, UPI QR and privacy PIN"
              leftContent={<Settings className="w-4 h-4 text-accent" />}
              onClick={() => navigate('/settings')}
            />
            <ListRow
              title={t('settings.recently_deleted')}
              titleClassName="text-danger"
              subtitle="View and restore soft-deleted records"
              leftContent={<Trash2 className="w-4 h-4 text-danger" />}
              onClick={() => navigate('/recently-deleted')}
            />
          </>
        )}
      </div>

      {/* Logout Card */}
      <div className="bg-white p-2 rounded-2xl border-0 shadow-[0_2px_8px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)]">
        <ListRow
          title={t('auth.logout')}
          showChevron={false}
          leftContent={<LogOut className="w-4 h-4 text-danger-fg" />}
          onClick={handleSignOut}
        />
      </div>

      {/* Logout Confirmation Dialog (matches delete confirmation modal style) */}
      <ConfirmDialog
        open={logoutDialogOpen}
        onOpenChange={setLogoutDialogOpen}
        title="Log Out of Simplify?"
        description="Are you sure you want to log out of your session? You will need your login credentials to sign back in."
        confirmLabel="Log Out"
        cancelLabel="Cancel"
        variant="danger"
        icon={<LogOut className="w-4 h-4 text-danger" />}
        loading={logoutLoading}
        onConfirm={confirmSignOut}
      />
    </div>
  );
};
